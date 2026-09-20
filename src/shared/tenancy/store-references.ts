import { BadRequestException } from '@nestjs/common';
import { TenantClient } from '@db/prisma.service';

/**
 * Verificaciones de que un id que llega en el cuerpo pertenece a ESTA tienda.
 *
 * Hacen falta aunque haya RLS, y es fácil creer que no. RLS filtra lo que una
 * consulta VE, pero Postgres verifica las claves foráneas por fuera de las
 * políticas, para que la integridad no dependa de quién mira. Resultado: la
 * base acepta sin quejarse un producto de la tienda A que apunte a una
 * categoría de la tienda B. Después, leído con el contexto de A, ese padre "no
 * existe", y si la relación es obligatoria —el color de una variante— la
 * consulta entera se rompe.
 *
 * Una clave foránea compuesta `(store_id, id)` lo cerraría en la base. Mientras
 * no exista, estas funciones son la única barrera: todo id de otra tabla que
 * entre por un DTO pasa por aquí antes de escribirse.
 *
 * Viven en `shared/` porque las usan varios módulos de dominio (catálogo y
 * contenido), y un módulo no importa de otro.
 */

export async function assertCategoryInStore(
  tx: TenantClient,
  storeId: string,
  categoryId: string,
): Promise<void> {
  const category = await tx.category.findFirst({
    where: { id: categoryId, storeId },
    select: { id: true },
  });

  if (!category) {
    throw new BadRequestException('Esa categoría no existe en esta tienda.');
  }
}

export async function assertColorInStore(
  tx: TenantClient,
  storeId: string,
  colorId: string,
): Promise<void> {
  const color = await tx.color.findFirst({ where: { id: colorId, storeId }, select: { id: true } });

  if (!color) {
    throw new BadRequestException('Ese color no existe en esta tienda.');
  }
}

export async function assertProductInStore(
  tx: TenantClient,
  storeId: string,
  productId: string,
): Promise<void> {
  const product = await tx.product.findFirst({
    where: { id: productId, storeId },
    select: { id: true },
  });

  if (!product) {
    throw new BadRequestException('Esa prenda no existe en esta tienda.');
  }
}

export async function assertCollectionInStore(
  tx: TenantClient,
  storeId: string,
  collectionId: string,
): Promise<void> {
  const collection = await tx.collection.findFirst({
    where: { id: collectionId, storeId },
    select: { id: true },
  });

  if (!collection) {
    throw new BadRequestException('Esa colección no existe en esta tienda.');
  }
}

export interface ColorRef {
  id: string;
  slug: string;
}

export interface SizeRef {
  id: string;
  label: string;
}

/** Devuelve colores y tallas en su orden de catálogo, o 400 si alguno no es de la tienda. */
export async function findColorsAndSizesInStore(
  tx: TenantClient,
  storeId: string,
  colorIds: string[],
  sizeIds: string[],
): Promise<{ colors: ColorRef[]; sizes: SizeRef[] }> {
  const uniqueColorIds = [...new Set(colorIds)];
  const uniqueSizeIds = [...new Set(sizeIds)];

  // En serie y no con Promise.all: la transacción interactiva usa UNA conexión,
  // y una conexión de Postgres atiende una consulta a la vez.
  const colors = await tx.color.findMany({
    where: { storeId, id: { in: uniqueColorIds } },
    select: { id: true, slug: true },
    orderBy: { sortOrder: 'asc' },
  });

  if (colors.length !== uniqueColorIds.length) {
    throw new BadRequestException('Alguno de los colores elegidos no existe en esta tienda.');
  }

  const sizes = await tx.size.findMany({
    where: { storeId, id: { in: uniqueSizeIds } },
    select: { id: true, label: true },
    orderBy: { sortOrder: 'asc' },
  });

  if (sizes.length !== uniqueSizeIds.length) {
    throw new BadRequestException('Alguna de las tallas elegidas no existe en esta tienda.');
  }

  return { colors, sizes };
}
