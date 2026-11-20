/**
 * La referencia con que se cobra un pedido en la pasarela.
 *
 * Lleva la tienda además del pedido: `ord-<tienda>-<pedido>`. Una tienda que
 * cobra con la misma cuenta de Wompi que la plataforma comparte con ella la
 * única URL de eventos que Wompi permite por cuenta, y el aviso llega a la de
 * la plataforma. Con la tienda en la referencia, la plataforma sabe a quién
 * pasárselo sin buscar el pedido en todas las tiendas.
 *
 * Las referencias viejas, `ord-<pedido>`, se siguen leyendo: un enlace de pago
 * que ya se mandó tiene que poder pagarse.
 */
const ORDER_PREFIX = 'ord';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** El uuid mide 36 caracteres, guiones incluidos. */
const UUID_LENGTH = 36;

export interface OrderReference {
  /** `null` en las referencias viejas, que no la traían. */
  storeId: string | null;
  orderId: string;
}

export function orderReference(storeId: string, orderId: string): string {
  return `${ORDER_PREFIX}-${storeId}-${orderId}`;
}

/** El pedido y la tienda de una referencia, o `null` si no es de un pedido. */
export function parseOrderReference(reference: string): OrderReference | null {
  if (!reference.startsWith(`${ORDER_PREFIX}-`)) return null;

  const rest = reference.slice(ORDER_PREFIX.length + 1);

  if (rest.length === UUID_LENGTH) {
    return UUID.test(rest) ? { storeId: null, orderId: rest } : null;
  }

  if (rest.length !== UUID_LENGTH * 2 + 1 || rest[UUID_LENGTH] !== '-') return null;

  const storeId = rest.slice(0, UUID_LENGTH);
  const orderId = rest.slice(UUID_LENGTH + 1);

  return UUID.test(storeId) && UUID.test(orderId) ? { storeId, orderId } : null;
}
