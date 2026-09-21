import { TenantClient } from '@db/prisma.service';
import { AssistantTool } from '@shared/ai/assistant';
import {
  VARIANT_INCLUDE,
  variantLabel,
  variantValues,
} from '@modules/catalog/providers/variant-mapping';

/**
 * Lo único que el asistente puede consultar de la tienda.
 *
 * Son las mismas consultas que alimentan la vitrina, recortadas a lo que cabe
 * en una respuesta de chat: cinco productos, no el catálogo. Eso es lo que hace
 * que el asistente sea barato —solo viaja lo que hizo falta— y lo que impide
 * que hable de productos que no existen: si no salió de acá, no lo sabe.
 *
 * Todo corre dentro de `forStore`, así que ni con una herramienta mal escrita
 * podría mirar el catálogo de otra tienda.
 */

/** Cuántos productos se le pasan al modelo por búsqueda. Más es más caro y no responde mejor. */
const MAX_PRODUCTOS = 5;

export const STORE_TOOLS: AssistantTool[] = [
  {
    name: 'buscar_productos',
    description:
      'Busca productos activos de la tienda por texto o por una variación concreta. Devuelve ' +
      'nombre, precio, dirección y qué variaciones tienen existencias. Úsala siempre antes de ' +
      'hablar de un producto, un precio o una variación.',
    input: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'Palabras de la clienta: «vestido negro», «blusa».' },
        // Un solo campo y no uno por eje: cada producto declara los suyos, así
        // que la herramienta no puede saber de antemano si existe «variación».
        variacion: {
          type: 'string',
          description: 'Un valor concreto: «M», «Rojo», «500 g», «Fina».',
        },
      },
    },
  },
  {
    name: 'ver_envios',
    description:
      'Zonas de envío con su costo y demora, y desde qué monto el envío es gratis. Úsala para ' +
      'cualquier pregunta de envíos o entregas.',
    input: { type: 'object', properties: {} },
  },
];

export interface ToolContext {
  tx: TenantClient;
  storeId: string;
}

/** Ejecuta la herramienta que pidió el modelo. Lo que no exista devuelve un error legible. */
export async function runStoreTool(
  { tx, storeId }: ToolContext,
  name: string,
  input: unknown,
): Promise<unknown> {
  const args = (input ?? {}) as { texto?: string; variacion?: string };

  if (name === 'buscar_productos') return buscarProductos(tx, storeId, args);
  if (name === 'ver_envios') return verEnvios(tx, storeId);

  return { error: `La herramienta ${name} no existe.` };
}

async function buscarProductos(
  tx: TenantClient,
  storeId: string,
  args: { texto?: string; variacion?: string },
) {
  const products = await tx.product.findMany({
    where: {
      storeId,
      // Lo mismo que ve la vitrina: si un producto se puede abrir en la tienda,
      // el asistente tiene que poder nombrarlo.
      status: 'ACTIVE',
      ...(args.texto ? { name: { contains: args.texto, mode: 'insensitive' } } : {}),
      // La variación se filtra solo si la preguntaron: exigir siempre una
      // variante escondería los productos que todavía no tienen ninguna.
      //
      // Se compara contra el VALOR, sin mirar de qué eje es: la clienta dice
      // «M» o «Rojo», no «Variación: M». Sin distinguir mayúsculas, porque lo
      // escribe una persona.
      ...(args.variacion
        ? {
            variants: {
              some: {
                active: true,
                optionValues: {
                  some: {
                    value: {
                      is: { value: { equals: args.variacion, mode: 'insensitive' } },
                    },
                  },
                },
              },
            },
          }
        : {}),
    },
    orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }],
    take: MAX_PRODUCTOS,
    select: {
      name: true,
      slug: true,
      basePrice: true,
      compareAtPrice: true,
      variants: {
        where: { active: true },
        select: { stock: true, ...VARIANT_INCLUDE },
      },
    },
  });

  return {
    productos: products.map((product) => ({
      nombre: product.name,
      direccion: `/tienda/${product.slug}`,
      precio: product.basePrice,
      // Solo si de verdad está tachado: un «antes» que no es menos no es una
      // rebaja, es una trampa.
      antes:
        product.compareAtPrice && product.compareAtPrice > product.basePrice
          ? product.compareAtPrice
          : undefined,
      // Solo lo que se puede comprar hoy: ofrecer algo agotado es peor que
      // decir que no hay. La variante se nombra con sus propios ejes, sean los
      // que sean: "Rojo · M" en ropa, "500 g · Fina" en café.
      disponible: product.variants
        .filter((variant) => variant.stock > 0)
        .map((variant) => variantLabel(variantValues(variant)))
        .filter((etiqueta) => etiqueta.length > 0),
    })),
  };
}

async function verEnvios(tx: TenantClient, storeId: string) {
  const zones = await tx.shippingZone.findMany({
    where: { storeId, active: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { name: true, cost: true, etaDays: true },
  });

  const settings = await tx.storeSettings.findUnique({
    where: { storeId },
    select: { freeShippingThreshold: true },
  });

  return {
    zonas: zones.map((zone) => ({
      nombre: zone.name,
      costo: zone.cost,
      dias: zone.etaDays ?? undefined,
    })),
    envioGratisDesde: settings?.freeShippingThreshold ?? undefined,
  };
}
