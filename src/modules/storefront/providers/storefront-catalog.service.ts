import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CatalogFacetsDto,
  PRODUCTS_PER_PAGE,
  ProductCardDto,
  ProductPageDto,
  ProductSearchQueryDto,
  ProductSort,
  PublicProductDetailDto,
} from '@shared/dtos/storefront/product.dto';
import { PrismaService } from '@db/prisma.service';
import { PublicStoreResolver } from '@shared/tenancy/public-store.resolver';
import { compareVariants } from '@modules/catalog/providers/variant-mapping';

import { CARD_INCLUDE, NEWEST_FIRST, toProductCard } from './product-card';

const RELATED_LIMIT = 4;

const SORT_ORDER: Record<ProductSort, Prisma.ProductOrderByWithRelationInput[]> = {
  newest: NEWEST_FIRST,
  'price-asc': [{ basePrice: 'asc' }, { id: 'asc' }],
  'price-desc': [{ basePrice: 'desc' }, { id: 'asc' }],
  name: [{ name: 'asc' }, { id: 'asc' }],
};

const PRODUCT_GONE = 'Este producto ya no está disponible.';

/**
 * Catálogo que ve la visitante.
 *
 * Toda consulta de productos lleva `status: 'ACTIVE'`. Es la regla que en la
 * versión con Supabase ponía la política `products_read`; acá la pone el
 * servicio, porque RLS en esta API aísla tiendas, no estados.
 */
@Injectable()
export class StorefrontCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: PublicStoreResolver,
  ) {}

  async search(storeSlug: string, query: ProductSearchQueryDto): Promise<ProductPageDto> {
    const store = await this.stores.resolve(storeSlug);
    const page = query.page ?? 1;
    const filters = searchFilters(query);

    return this.prisma.forStore(store.id, async (tx) => {
      const total = await tx.product.count({
        where: { storeId: store.id, status: 'ACTIVE', ...filters },
      });

      const products = await tx.product.findMany({
        where: { storeId: store.id, status: 'ACTIVE', ...filters },
        orderBy: SORT_ORDER[query.sort ?? 'newest'],
        skip: (page - 1) * PRODUCTS_PER_PAGE,
        take: PRODUCTS_PER_PAGE,
        include: CARD_INCLUDE,
      });

      return {
        products: products.map(toProductCard),
        total,
        page,
        pageCount: Math.max(1, Math.ceil(total / PRODUCTS_PER_PAGE)),
        pageSize: PRODUCTS_PER_PAGE,
      };
    });
  }

  async facets(storeSlug: string): Promise<CatalogFacetsDto> {
    const store = await this.stores.resolve(storeSlug);

    return this.prisma.forStore(store.id, async (tx) => {
      const categories = await tx.category.findMany({
        where: { storeId: store.id, active: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, slug: true, name: true, parentId: true, sortOrder: true },
      });

      // Los ejes se agrupan por NOMBRE entre todos los productos publicados:
      // el "Color" de una camisa y el de otra son el mismo filtro para quien
      // navega, aunque en la base sean filas distintas. Un eje que no use
      // ningún producto publicado no aparece.
      const valores = await tx.productOptionValue.findMany({
        where: { storeId: store.id, option: { product: { status: 'ACTIVE' } } },
        select: {
          value: true,
          hex: true,
          sortOrder: true,
          option: { select: { name: true, sortOrder: true } },
        },
      });

      const prices = await tx.product.aggregate({
        where: { storeId: store.id, status: 'ACTIVE' },
        _min: { basePrice: true },
        _max: { basePrice: true },
      });

      return {
        categories,
        options: agruparFacetas(valores),
        priceRange: { min: prices._min.basePrice ?? 0, max: prices._max.basePrice ?? 0 },
      };
    });
  }

  async detail(storeSlug: string, productSlug: string): Promise<PublicProductDetailDto> {
    const store = await this.stores.resolve(storeSlug);

    return this.prisma.forStore(store.id, async (tx) => {
      const product = await tx.product.findFirst({
        where: { storeId: store.id, slug: productSlug, status: 'ACTIVE' },
        include: {
          category: { select: { name: true, slug: true, active: true } },
          images: { orderBy: { sortOrder: 'asc' } },
          attributes: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
          variants: {
            where: { active: true },
            include: {
              optionValues: {
                include: {
                  value: {
                    include: { option: { select: { id: true, name: true, sortOrder: true } } },
                  },
                },
              },
            },
            orderBy: [{ sku: 'asc' }],
          },
        },
      });

      if (!product) {
        throw new NotFoundException(PRODUCT_GONE);
      }

      // Los ejes salen de las variantes ACTIVAS y no de los ejes declarados:
      // la ficha ofrece solo lo que de verdad se puede elegir. Un color cuyas
      // variantes se desactivaron todas no se pinta para luego no existir.
      const ejes = new Map<
        string,
        {
          id: string;
          name: string;
          sortOrder: number;
          values: Map<string, { id: string; value: string; hex: string | null; sortOrder: number }>;
        }
      >();

      for (const variant of product.variants) {
        for (const { value } of variant.optionValues) {
          const eje = ejes.get(value.option.id) ?? {
            id: value.option.id,
            name: value.option.name,
            sortOrder: value.option.sortOrder,
            values: new Map(),
          };

          eje.values.set(value.id, {
            id: value.id,
            value: value.value,
            hex: value.hex,
            sortOrder: value.sortOrder,
          });

          ejes.set(value.option.id, eje);
        }
      }

      // Una categoría oculta no se nombra: enlazaría a un listado vacío.
      const category = product.category?.active ? product.category : null;

      return {
        id: product.id,
        slug: product.slug,
        name: product.name,
        description: product.description,
        basePrice: product.basePrice,
        compareAtPrice: product.compareAtPrice,
        categoryName: category?.name ?? null,
        categorySlug: category?.slug ?? null,
        images: product.images.map((image) => ({
          id: image.id,
          optionValueId: image.optionValueId,
          urlFull: image.urlFull,
          urlCard: image.urlCard,
          urlThumb: image.urlThumb,
          lqip: image.lqip,
          alt: image.alt,
          sortOrder: image.sortOrder,
        })),
        options: [...ejes.values()]
          .sort((uno, otro) => uno.sortOrder - otro.sortOrder || uno.name.localeCompare(otro.name))
          .map((eje) => ({
            id: eje.id,
            name: eje.name,
            sortOrder: eje.sortOrder,
            values: [...eje.values.values()].sort(
              (uno, otro) => uno.sortOrder - otro.sortOrder || uno.value.localeCompare(otro.value),
            ),
          })),
        attributes: product.attributes.map(({ name, value }) => ({ name, value })),
        variants: [...product.variants].sort(compareVariants).map((variant) => ({
          id: variant.id,
          valueIds: variant.optionValues.map((enlace) => enlace.optionValueId),
          sku: variant.sku,
          stock: variant.stock,
          price: variant.priceOverride ?? product.basePrice,
        })),
      };
    });
  }

  /** Otros productos de la misma categoría; si no tiene una visible, cualquiera publicada. */
  async related(storeSlug: string, productSlug: string): Promise<ProductCardDto[]> {
    const store = await this.stores.resolve(storeSlug);

    return this.prisma.forStore(store.id, async (tx) => {
      const product = await tx.product.findFirst({
        where: { storeId: store.id, slug: productSlug, status: 'ACTIVE' },
        select: { id: true, categoryId: true, category: { select: { active: true } } },
      });

      if (!product) {
        throw new NotFoundException(PRODUCT_GONE);
      }

      const sameCategory =
        product.categoryId && product.category?.active ? { categoryId: product.categoryId } : {};

      const related = await tx.product.findMany({
        where: { storeId: store.id, status: 'ACTIVE', id: { not: product.id }, ...sameCategory },
        orderBy: NEWEST_FIRST,
        take: RELATED_LIMIT,
        include: CARD_INCLUDE,
      });

      return related.map(toProductCard);
    });
  }

  /**
   * Fichas frescas para los slugs que el navegador guardó (favoritos).
   *
   * Se devuelven en el orden en que llegaron, y lo que ya no está publicado
   * simplemente no vuelve: la clienta ve precio y stock de hoy, no los del día
   * en que marcó el corazón.
   */
  async lookup(storeSlug: string, slugs: string[]): Promise<ProductCardDto[]> {
    const store = await this.stores.resolve(storeSlug);

    if (slugs.length === 0) {
      return [];
    }

    return this.prisma.forStore(store.id, async (tx) => {
      const products = await tx.product.findMany({
        where: { storeId: store.id, status: 'ACTIVE', slug: { in: slugs } },
        include: CARD_INCLUDE,
      });

      const position = new Map(slugs.map((slug, index) => [slug, index]));

      return products
        .sort((a, b) => (position.get(a.slug) ?? 0) - (position.get(b.slug) ?? 0))
        .map(toProductCard);
    });
  }
}

/**
 * Filtros del listado, sin `storeId` ni estado: esos los pone la consulta, a la
 * vista, para que el test de arquitectura los encuentre.
 */
/**
 * Agrupa `Eje:Valor` por eje.
 *
 * Varios valores del mismo eje suman (rojo o azul); ejes distintos restringen
 * (rojo Y variación M). Es lo que espera cualquiera que haya usado una tienda.
 */
function porEje(options: readonly string[]): Map<string, string[]> {
  const grupos = new Map<string, string[]>();

  for (const entrada of options) {
    const corte = entrada.indexOf(':');

    if (corte < 1) continue;

    const eje = entrada.slice(0, corte).trim();
    const valor = entrada.slice(corte + 1).trim();

    if (!eje || !valor) continue;

    grupos.set(eje, [...(grupos.get(eje) ?? []), valor]);
  }

  return grupos;
}

function searchFilters(query: ProductSearchQueryDto): Prisma.ProductWhereInput {
  const ejes = porEje(query.options ?? []);
  const hasPriceRange = query.minPrice !== undefined || query.maxPrice !== undefined;

  return {
    ...(query.q ? { name: { contains: query.q, mode: Prisma.QueryMode.insensitive } } : {}),
    ...(hasPriceRange ? { basePrice: { gte: query.minPrice, lte: query.maxPrice } } : {}),
    // Una categoría oculta o inexistente deja la lista vacía en vez de ignorar
    // el filtro, igual que la tienda actual.
    ...(query.category ? { category: { is: { slug: query.category, active: true } } } : {}),
    // Todos los ejes se evalúan sobre LA MISMA variante y con stock: "hay M
    // negra", no "hay algo negro y algo en M". Así el conteo de páginas
    // coincide con lo que de verdad se puede comprar.
    //
    // La comparación ignora mayúsculas porque el valor viene de una URL que
    // alguien pudo teclear o compartir en minúsculas.
    ...(ejes.size > 0
      ? {
          variants: {
            some: {
              active: true,
              stock: { gt: 0 },
              AND: [...ejes].map(([eje, valores]) => ({
                optionValues: {
                  some: {
                    value: {
                      is: {
                        option: {
                          is: { name: { equals: eje, mode: Prisma.QueryMode.insensitive } },
                        },
                        OR: valores.map((valor) => ({
                          value: { equals: valor, mode: Prisma.QueryMode.insensitive },
                        })),
                      },
                    },
                  },
                },
              })),
            },
          },
        }
      : {}),
  };
}

/** Agrupa por nombre de eje los valores de todos los productos publicados. */
function agruparFacetas(
  valores: readonly {
    value: string;
    hex: string | null;
    sortOrder: number;
    option: { name: string; sortOrder: number };
  }[],
): CatalogFacetsDto['options'] {
  const ejes = new Map<
    string,
    {
      name: string;
      sortOrder: number;
      values: Map<string, { value: string; hex: string | null; sortOrder: number }>;
    }
  >();

  for (const valor of valores) {
    const eje = ejes.get(valor.option.name) ?? {
      name: valor.option.name,
      sortOrder: valor.option.sortOrder,
      values: new Map(),
    };

    // Gana el orden más bajo: si una camisa pone "Color" primero y otra
    // tercero, el filtro sale donde la mayoría espera encontrarlo.
    eje.sortOrder = Math.min(eje.sortOrder, valor.option.sortOrder);

    if (!eje.values.has(valor.value)) {
      eje.values.set(valor.value, {
        value: valor.value,
        hex: valor.hex,
        sortOrder: valor.sortOrder,
      });
    }

    ejes.set(valor.option.name, eje);
  }

  return [...ejes.values()]
    .sort((uno, otro) => uno.sortOrder - otro.sortOrder || uno.name.localeCompare(otro.name))
    .map((eje) => ({
      name: eje.name,
      sortOrder: eje.sortOrder,
      values: [...eje.values.values()].sort(
        (uno, otro) => uno.sortOrder - otro.sortOrder || uno.value.localeCompare(otro.value),
      ),
    }));
}
