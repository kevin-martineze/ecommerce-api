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

import { CARD_INCLUDE, NEWEST_FIRST, toProductCard } from './product-card';

const RELATED_LIMIT = 4;

const SORT_ORDER: Record<ProductSort, Prisma.ProductOrderByWithRelationInput[]> = {
  newest: NEWEST_FIRST,
  'price-asc': [{ basePrice: 'asc' }, { id: 'asc' }],
  'price-desc': [{ basePrice: 'desc' }, { id: 'asc' }],
  name: [{ name: 'asc' }, { id: 'asc' }],
};

const PRODUCT_GONE = 'Esta prenda ya no está disponible.';

/**
 * Catálogo que ve la visitante.
 *
 * Toda consulta de prendas lleva `status: 'ACTIVE'`. Es la regla que en la
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

      const colors = await tx.color.findMany({
        where: { storeId: store.id, active: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, slug: true, name: true, hex: true, sortOrder: true },
      });

      const sizes = await tx.size.findMany({
        where: { storeId: store.id, active: true },
        orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
        select: { id: true, label: true, sortOrder: true },
      });

      const prices = await tx.product.aggregate({
        where: { storeId: store.id, status: 'ACTIVE' },
        _min: { basePrice: true },
        _max: { basePrice: true },
      });

      return {
        categories,
        colors,
        sizes,
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
          variants: {
            where: { active: true },
            include: { color: true, size: true },
            orderBy: [{ color: { sortOrder: 'asc' } }, { size: { sortOrder: 'asc' } }],
          },
        },
      });

      if (!product) {
        throw new NotFoundException(PRODUCT_GONE);
      }

      // Colores y tallas salen de las variantes, no del catálogo: la ficha
      // ofrece solo lo que de verdad existe para esta prenda.
      const colors = new Map<string, (typeof product.variants)[number]['color']>();
      const sizes = new Map<string, (typeof product.variants)[number]['size']>();

      for (const variant of product.variants) {
        colors.set(variant.color.id, variant.color);
        sizes.set(variant.size.id, variant.size);
      }

      // Una categoría oculta no se nombra: enlazaría a un listado vacío.
      const category = product.category?.active ? product.category : null;

      return {
        id: product.id,
        slug: product.slug,
        name: product.name,
        description: product.description,
        material: product.material,
        care: product.care,
        basePrice: product.basePrice,
        compareAtPrice: product.compareAtPrice,
        categoryName: category?.name ?? null,
        categorySlug: category?.slug ?? null,
        images: product.images.map((image) => ({
          id: image.id,
          colorId: image.colorId,
          urlFull: image.urlFull,
          urlCard: image.urlCard,
          urlThumb: image.urlThumb,
          lqip: image.lqip,
          alt: image.alt,
          sortOrder: image.sortOrder,
        })),
        colors: [...colors.values()]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map(({ id, slug, name, hex, sortOrder }) => ({ id, slug, name, hex, sortOrder })),
        sizes: [...sizes.values()]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map(({ id, label, sortOrder }) => ({ id, label, sortOrder })),
        variants: product.variants.map((variant) => ({
          id: variant.id,
          colorId: variant.colorId,
          sizeId: variant.sizeId,
          sku: variant.sku,
          stock: variant.stock,
          price: variant.priceOverride ?? product.basePrice,
        })),
      };
    });
  }

  /** Otras prendas de la misma categoría; si no tiene una visible, cualquiera publicada. */
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
function searchFilters(query: ProductSearchQueryDto): Prisma.ProductWhereInput {
  const colors = query.colors ?? [];
  const sizes = (query.sizes ?? []).map((size) => size.toUpperCase());
  const hasPriceRange = query.minPrice !== undefined || query.maxPrice !== undefined;

  return {
    ...(query.q ? { name: { contains: query.q, mode: Prisma.QueryMode.insensitive } } : {}),
    ...(hasPriceRange ? { basePrice: { gte: query.minPrice, lte: query.maxPrice } } : {}),
    // Una categoría oculta o inexistente deja la lista vacía en vez de ignorar
    // el filtro, igual que la tienda actual.
    ...(query.category ? { category: { is: { slug: query.category, active: true } } } : {}),
    // Color y talla se evalúan sobre LA MISMA variante y con stock: "hay M
    // negra", no "hay algo negro y algo en M". Así el conteo de páginas
    // coincide con lo que de verdad se puede comprar.
    ...(colors.length > 0 || sizes.length > 0
      ? {
          variants: {
            some: {
              active: true,
              stock: { gt: 0 },
              ...(colors.length > 0 ? { color: { is: { slug: { in: colors } } } } : {}),
              ...(sizes.length > 0 ? { size: { is: { label: { in: sizes } } } } : {}),
            },
          },
        }
      : {}),
  };
}
