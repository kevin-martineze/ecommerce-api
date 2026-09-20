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

/**
 * Que un valor de opción sea de ESE producto, no solo de esa tienda.
 *
 * La comprobación por tienda ya no basta: los valores cuelgan del producto, y
 * colgarle a una foto el "Rojo" de otro producto dejaría una referencia que no
 * significa nada en su pantalla.
 */
export async function assertOptionValueInProduct(
  tx: TenantClient,
  storeId: string,
  productId: string,
  optionValueId: string,
): Promise<void> {
  const valor = await tx.productOptionValue.findFirst({
    where: { id: optionValueId, storeId, option: { productId } },
    select: { id: true },
  });

  if (!valor) {
    throw new BadRequestException('Ese valor no es de este producto.');
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
