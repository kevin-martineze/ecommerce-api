import { Prisma } from '@prisma/client';
import { VariantDto, VariantValueDto } from '@shared/dtos/catalog/variant.dto';

/**
 * Cómo se lee y se nombra una variante ahora que sus ejes son libres.
 *
 * Antes la variante traía su color y su talla como dos relaciones fijas. Ahora
 * trae N valores, cada uno perteneciente a un eje del producto, y el orden en
 * que se leen lo manda el eje: si el producto declaró Color primero, la
 * variante se llama "Rojo · M" y no "M · Rojo".
 */

/** Lo que toda respuesta con variantes necesita de sus valores. */
export const VARIANT_INCLUDE = {
  optionValues: {
    include: {
      value: {
        include: { option: { select: { id: true, name: true, sortOrder: true } } },
      },
    },
  },
} satisfies Prisma.VariantInclude;

export type VariantWithValues = Prisma.VariantGetPayload<{ include: typeof VARIANT_INCLUDE }>;

/**
 * Los valores de una variante, en el orden de sus ejes.
 *
 * El desempate por nombre del eje no es decoración: dos ejes con el mismo
 * `sortOrder` —fácil de conseguir editando— darían un nombre distinto en cada
 * consulta, y el pedido guarda ese nombre.
 */
export function variantValues(
  // Solo los valores: así sirve igual para una variante entera que para una
  // consulta que seleccionó cuatro columnas.
  variant: Pick<VariantWithValues, 'optionValues'>,
): VariantValueDto[] {
  return variant.optionValues
    .map((enlace) => enlace.value)
    .sort(
      (uno, otro) =>
        uno.option.sortOrder - otro.option.sortOrder ||
        uno.option.name.localeCompare(otro.option.name) ||
        uno.sortOrder - otro.sortOrder,
    )
    .map((valor) => ({
      id: valor.id,
      optionId: valor.option.id,
      optionName: valor.option.name,
      value: valor.value,
      hex: valor.hex,
    }));
}

/** "Rojo · M". Vacío cuando el producto no tiene ejes. */
export function variantLabel(values: VariantValueDto[]): string {
  return values.map((valor) => valor.value).join(' · ');
}

/**
 * La huella de una combinación, para que la base pueda prohibir duplicados.
 *
 * Se ordena por id y no por eje a propósito: lo que tiene que ser estable es
 * la comparación entre dos variantes, no cómo se lee. Reordenar los ejes del
 * producto no puede cambiar la huella de una variante que ya existe.
 */
export function optionsKey(optionValueIds: readonly string[]): string {
  return [...optionValueIds].sort().join(',');
}

export function toVariantDto(variant: VariantWithValues): VariantDto {
  const values = variantValues(variant);

  return {
    id: variant.id,
    productId: variant.productId,
    sku: variant.sku,
    stock: variant.stock,
    priceOverride: variant.priceOverride,
    active: variant.active,
    label: variantLabel(values),
    values,
  };
}

/**
 * Ordena variantes como las ordenaría su dueña: por el orden de sus ejes.
 *
 * Postgres no puede hacerlo —los valores viven en una tabla puente, no en dos
 * columnas de la variante—, así que se ordena acá. Ordenar por SKU parecía
 * equivalente y no lo es: alfabéticamente la L va antes que la M y que la S,
 * y nadie gestiona un inventario de ropa en ese orden.
 */
export function compareVariants(uno: VariantWithValues, otro: VariantWithValues): number {
  const izquierda = variantValues(uno);
  const derecha = variantValues(otro);

  for (let indice = 0; indice < Math.max(izquierda.length, derecha.length); indice += 1) {
    const valorIzquierda = izquierda[indice];
    const valorDerecha = derecha[indice];

    if (!valorIzquierda) return -1;
    if (!valorDerecha) return 1;

    const orden = ordenDe(uno, valorIzquierda.id) - ordenDe(otro, valorDerecha.id);

    if (orden !== 0) return orden;

    const alfabetico = valorIzquierda.value.localeCompare(valorDerecha.value);

    if (alfabetico !== 0) return alfabetico;
  }

  return 0;
}

/** El `sortOrder` del valor dentro de su eje. */
function ordenDe(variant: VariantWithValues, valueId: string): number {
  return variant.optionValues.find((enlace) => enlace.value.id === valueId)?.value.sortOrder ?? 0;
}
