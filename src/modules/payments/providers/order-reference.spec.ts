import { orderReference, parseOrderReference } from './order-reference';

const STORE = '5fad162d-fb0a-494a-bd06-d7511f126b39';
const ORDER = '0b6c1f2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e';

describe('referencia del cobro de un pedido', () => {
  it('lleva la tienda y el pedido, y se lee de vuelta', () => {
    const reference = orderReference(STORE, ORDER);

    expect(reference).toBe(`ord-${STORE}-${ORDER}`);
    expect(parseOrderReference(reference)).toEqual({ storeId: STORE, orderId: ORDER });
  });

  it('las viejas, sin tienda, se siguen leyendo', () => {
    expect(parseOrderReference(`ord-${ORDER}`)).toEqual({ storeId: null, orderId: ORDER });
  });

  it('lo que no es de un pedido no se lee como pedido', () => {
    expect(parseOrderReference(`sub-${STORE}-pro-1a2b3c4d`)).toBeNull();
    expect(parseOrderReference('ord-1')).toBeNull();
    expect(parseOrderReference(`ord-${STORE}_${ORDER}`)).toBeNull();
    expect(parseOrderReference(`ord-${STORE}-no-es-un-uuid-pero-mide-36-caracteres`)).toBeNull();
  });
});
