import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CreateVariantDto,
  DeleteVariantResultDto,
  GenerateVariantsDto,
  GenerateVariantsResultDto,
  UpdateVariantDto,
  VariantDto,
} from '@shared/dtos/catalog/variant.dto';
import { translatePrismaErrors } from '@shared/errors/translate-prisma-errors';
import { buildSku, firstAvailable, skuBase } from '@shared/utils/slug';
import { PrismaService } from '@db/prisma.service';

import { optionsKey, toVariantDto, VARIANT_INCLUDE } from './variant-mapping';

const NOT_FOUND = 'Esa variante no existe.';
const PRODUCTO_NO_EXISTE = 'Ese producto no existe.';

/**
 * Techo de combinaciones por producto.
 *
 * Tres ejes de cincuenta valores dan ciento veinticinco mil filas: nadie
 * gestiona eso, pero un clic distraído lo crea. El tope convierte un accidente
 * en un mensaje.
 */
const MAX_VARIANTES = 200;

/** Una combinación por armar: qué valores la forman y cómo se llama. */
interface Combinacion {
  valueIds: string[];
  etiquetas: string[];
}

@Injectable()
export class VariantsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crea las combinaciones que le falten al producto.
   *
   * Qué combinar no viene en la petición: sale de los ejes que el producto ya
   * declaró. Un producto SIN ejes tiene igual su variante única, con la huella
   * vacía, para que el stock viva siempre en el mismo sitio.
   *
   * Nunca borra: una variante existente puede estar dentro de un pedido. Pedir
   * lo mismo dos veces crea cero la segunda.
   */
  generate(
    storeId: string,
    productId: string,
    dto: GenerateVariantsDto,
  ): Promise<GenerateVariantsResultDto> {
    return this.prisma.forStore(storeId, async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: productId, storeId },
        select: {
          slug: true,
          options: {
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
            select: {
              values: {
                orderBy: [{ sortOrder: 'asc' }, { value: 'asc' }],
                select: { id: true, value: true },
              },
            },
          },
          variants: { select: { optionsKey: true } },
        },
      });

      if (!product) {
        throw new NotFoundException(PRODUCTO_NO_EXISTE);
      }

      const combinaciones = combinar(product.options);

      if (combinaciones.length > MAX_VARIANTES) {
        throw new BadRequestException(
          `Esos ejes dan ${combinaciones.length} combinaciones y el tope es ${MAX_VARIANTES}. Quita valores o divide el producto.`,
        );
      }

      const existentes = new Set(product.variants.map((variante) => variante.optionsKey));
      const faltantes = combinaciones.filter(
        (combinacion) => !existentes.has(optionsKey(combinacion.valueIds)),
      );

      if (faltantes.length === 0) {
        return { created: 0 };
      }

      // El SKU se corta a 10 caracteres del producto, así que dos productos que
      // empiezan igual ("vestido-negro-largo", "vestido-negro-corto") generan el
      // mismo. El repetido se numera, como los slugs.
      const usados = await tx.variant.findMany({
        where: { storeId, sku: { startsWith: skuBase(product.slug) } },
        select: { sku: true },
      });

      const tomados = new Set(usados.flatMap((fila) => (fila.sku ? [fila.sku] : [])));

      const nuevas = faltantes.map((combinacion) => {
        const sku = firstAvailable(buildSku(product.slug, combinacion.etiquetas), tomados);

        tomados.add(sku);

        return { id: randomUUID(), sku, combinacion };
      });

      await tx.variant.createMany({
        data: nuevas.map(({ id, sku, combinacion }) => ({
          id,
          // El trigger `variants_store_id` lo reescribe con el del producto de
          // todos modos; Prisma lo exige porque la columna no tiene default.
          storeId,
          productId,
          optionsKey: optionsKey(combinacion.valueIds),
          sku,
          stock: dto.defaultStock ?? 0,
        })),
      });

      await tx.variantOptionValue.createMany({
        data: nuevas.flatMap(({ id, combinacion }) =>
          combinacion.valueIds.map((optionValueId) => ({
            storeId,
            variantId: id,
            optionValueId,
          })),
        ),
      });

      return { created: nuevas.length };
    });
  }

  /**
   * Crea UNA combinación concreta.
   *
   * Sirve para lo que `generate` no cubre: la variación suelta que solo existe en
   * un color. Los valores tienen que ser del propio producto —si no, una
   * tienda podría colgarle a su variante el valor de otra— y no puede repetir
   * una combinación que ya existe.
   */
  create(storeId: string, productId: string, dto: CreateVariantDto): Promise<VariantDto> {
    return this.prisma.forStore(storeId, async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: productId, storeId },
        select: {
          slug: true,
          options: { select: { id: true } },
        },
      });

      if (!product) {
        throw new NotFoundException(PRODUCTO_NO_EXISTE);
      }

      const valores = await tx.productOptionValue.findMany({
        where: { id: { in: dto.optionValueIds }, storeId, option: { productId } },
        select: { id: true, value: true, optionId: true },
      });

      if (valores.length !== dto.optionValueIds.length) {
        throw new BadRequestException('Alguno de esos valores no es de este producto.');
      }

      // Un valor por eje, ni dos del mismo ni ninguno: si no, "Rojo · Azul · M"
      // sería una variante válida y no significa nada.
      const ejesCubiertos = new Set(valores.map((valor) => valor.optionId));

      if (ejesCubiertos.size !== valores.length || ejesCubiertos.size !== product.options.length) {
        throw new BadRequestException('Hay que elegir exactamente un valor por cada eje.');
      }

      const huella = optionsKey(dto.optionValueIds);

      const repetida = await tx.variant.findFirst({
        where: { productId, storeId, optionsKey: huella },
        select: { id: true },
      });

      if (repetida) {
        throw new BadRequestException('Esa combinación ya existe.');
      }

      const usados = await tx.variant.findMany({
        where: { storeId, sku: { startsWith: skuBase(product.slug) } },
        select: { sku: true },
      });

      const etiquetas = valores.map((valor) => valor.value);
      const sku = firstAvailable(
        buildSku(product.slug, etiquetas),
        new Set(usados.flatMap((fila) => (fila.sku ? [fila.sku] : []))),
      );

      const variante = await tx.variant.create({
        data: {
          storeId,
          productId,
          optionsKey: huella,
          sku,
          stock: dto.stock ?? 0,
          priceOverride: dto.priceOverride ?? null,
          optionValues: {
            create: dto.optionValueIds.map((optionValueId) => ({ storeId, optionValueId })),
          },
        },
        include: VARIANT_INCLUDE,
      });

      return toVariantDto(variante);
    });
  }

  update(storeId: string, variantId: string, dto: UpdateVariantDto): Promise<VariantDto> {
    return translatePrismaErrors(
      this.prisma.forStore(storeId, async (tx) => {
        const variant = await tx.variant.update({
          where: { id: variantId, storeId },
          data: {
            // En stock y active null es "no lo toques"; en priceOverride null
            // es "volver al precio base", así que ese pasa tal cual.
            stock: dto.stock ?? undefined,
            priceOverride: dto.priceOverride,
            active: dto.active ?? undefined,
          },
          include: VARIANT_INCLUDE,
        });

        return toVariantDto(variant);
      }),
      { notFound: NOT_FOUND },
    );
  }

  /**
   * Borra la variante, o la desactiva en cero si ya se vendió.
   *
   * Mismo criterio que con el producto: la línea de pedido sobrevive al borrado
   * porque guarda copia, pero perdería el enlace a la variante.
   */
  remove(storeId: string, variantId: string): Promise<DeleteVariantResultDto> {
    return this.prisma.forStore<DeleteVariantResultDto>(storeId, async (tx) => {
      const variant = await tx.variant.findFirst({
        where: { id: variantId, storeId },
        select: { _count: { select: { orderItems: true } } },
      });

      if (!variant) {
        throw new NotFoundException(NOT_FOUND);
      }

      if (variant._count.orderItems > 0) {
        await tx.variant.update({
          where: { id: variantId, storeId },
          data: { active: false, stock: 0 },
        });

        return { result: 'deactivated' };
      }

      await tx.variant.delete({ where: { id: variantId, storeId } });

      return { result: 'deleted' };
    });
  }
}

/**
 * El producto cartesiano de los ejes.
 *
 * Sin ejes devuelve UNA combinación vacía, no cero: ese es el caso del libro
 * o la vela, que tienen una sola variante y por tanto un solo stock.
 */
function combinar(
  options: readonly { values: readonly { id: string; value: string }[] }[],
): Combinacion[] {
  return options
    .filter((eje) => eje.values.length > 0)
    .reduce<Combinacion[]>(
      (acumulado, eje) =>
        acumulado.flatMap((parcial) =>
          eje.values.map((valor) => ({
            valueIds: [...parcial.valueIds, valor.id],
            etiquetas: [...parcial.etiquetas, valor.value],
          })),
        ),
      [{ valueIds: [], etiquetas: [] }],
    );
}
