import { TenantClient } from '@db/prisma.service';
import { AssistantTool } from '@shared/ai/assistant';

/**
 * Lo único que el asistente puede consultar de la tienda.
 *
 * Son las mismas consultas que alimentan la vitrina, recortadas a lo que cabe
 * en una respuesta de chat: cinco prendas, no el catálogo. Eso es lo que hace
 * que el asistente sea barato —solo viaja lo que hizo falta— y lo que impide
 * que hable de prendas que no existen: si no salió de acá, no lo sabe.
 *
 * Todo corre dentro de `forStore`, así que ni con una herramienta mal escrita
 * podría mirar el catálogo de otra tienda.
 */

/** Cuántas prendas se le pasan al modelo por búsqueda. Más es más caro y no responde mejor. */
const MAX_PRENDAS = 5;

export const STORE_TOOLS: AssistantTool[] = [
  {
    name: 'buscar_prendas',
    description:
      'Busca prendas activas de la tienda por texto, talla o color. Devuelve nombre, precio, ' +
      'dirección y qué tallas y colores tienen existencias. Úsala siempre antes de hablar de ' +
      'una prenda, un precio o una talla.',
    input: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'Palabras de la clienta: «vestido negro», «blusa».' },
        talla: { type: 'string', description: 'Etiqueta de talla, por ejemplo M o 10.' },
        color: { type: 'string', description: 'Nombre del color, por ejemplo negro o arena.' },
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
  const args = (input ?? {}) as { texto?: string; talla?: string; color?: string };

  if (name === 'buscar_prendas') return buscarPrendas(tx, storeId, args);
  if (name === 'ver_envios') return verEnvios(tx, storeId);

  return { error: `La herramienta ${name} no existe.` };
}

async function buscarPrendas(
  tx: TenantClient,
  storeId: string,
  args: { texto?: string; talla?: string; color?: string },
) {
  const products = await tx.product.findMany({
    where: {
      storeId,
      // Lo mismo que ve la vitrina: si una prenda se puede abrir en la tienda,
      // el asistente tiene que poder nombrarla.
      status: 'ACTIVE',
      ...(args.texto ? { name: { contains: args.texto, mode: 'insensitive' } } : {}),
      // La talla y el color se filtran solo si los preguntaron: exigir siempre
      // una variante escondería las prendas que todavía no tienen.
      ...(args.talla || args.color
        ? {
            variants: {
              some: {
                active: true,
                ...(args.talla
                  ? { size: { label: { equals: args.talla, mode: 'insensitive' } } }
                  : {}),
                ...(args.color
                  ? { color: { name: { contains: args.color, mode: 'insensitive' } } }
                  : {}),
              },
            },
          }
        : {}),
    },
    orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }],
    take: MAX_PRENDAS,
    select: {
      name: true,
      slug: true,
      basePrice: true,
      compareAtPrice: true,
      variants: {
        where: { active: true },
        select: {
          stock: true,
          size: { select: { label: true } },
          color: { select: { name: true } },
        },
      },
    },
  });

  return {
    prendas: products.map((product) => ({
      nombre: product.name,
      direccion: `/tienda/${product.slug}`,
      precio: product.basePrice,
      // Solo si de verdad está tachado: un «antes» que no es menos no es una
      // rebaja, es una trampa.
      antes:
        product.compareAtPrice && product.compareAtPrice > product.basePrice
          ? product.compareAtPrice
          : undefined,
      // Solo lo que se puede comprar hoy: ofrecer una talla agotada es peor
      // que decir que no hay.
      disponible: product.variants
        .filter((variant) => variant.stock > 0)
        .map((variant) => `${variant.color.name} talla ${variant.size.label}`),
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
