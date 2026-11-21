import { ActivationMilestones, currentStage, stagesReachedBy } from './activation';

const CREADA = new Date('2026-11-01T15:00:00Z');
const CATALOGO = new Date('2026-11-02T15:00:00Z');
const PEDIDO = new Date('2026-11-03T15:00:00Z');
const VENTA = new Date('2026-11-04T15:00:00Z');
const PAGO = new Date('2026-11-05T15:00:00Z');

/** Una tienda sin nada más que su fecha de creación. */
function sinHitos(): ActivationMilestones {
  return {
    createdAt: CREADA,
    firstProductAt: null,
    firstOrderAt: null,
    firstSaleAt: null,
    firstPaymentAt: null,
  };
}

describe('currentStage', () => {
  it('una tienda recién creada está en created, con la fecha de creación', () => {
    expect(currentStage(sinHitos())).toEqual({ stage: 'created', reachedAt: CREADA });
  });

  it('con un producto activo con foto llega a catalog', () => {
    expect(currentStage({ ...sinHitos(), firstProductAt: CATALOGO })).toEqual({
      stage: 'catalog',
      reachedAt: CATALOGO,
    });
  });

  it('con un pedido llega a first_order', () => {
    expect(currentStage({ ...sinHitos(), firstProductAt: CATALOGO, firstOrderAt: PEDIDO })).toEqual(
      { stage: 'first_order', reachedAt: PEDIDO },
    );
  });

  it('con una venta llega a first_sale', () => {
    expect(
      currentStage({
        ...sinHitos(),
        firstProductAt: CATALOGO,
        firstOrderAt: PEDIDO,
        firstSaleAt: VENTA,
      }),
    ).toEqual({ stage: 'first_sale', reachedAt: VENTA });
  });

  it('con un pago llega a paying', () => {
    expect(
      currentStage({
        ...sinHitos(),
        firstProductAt: CATALOGO,
        firstOrderAt: PEDIDO,
        firstSaleAt: VENTA,
        firstPaymentAt: PAGO,
      }),
    ).toEqual({ stage: 'paying', reachedAt: PAGO });
  });

  it('un pago a mano sin pedidos salta directo a paying', () => {
    expect(currentStage({ ...sinHitos(), firstPaymentAt: PAGO })).toEqual({
      stage: 'paying',
      reachedAt: PAGO,
    });
  });

  it('una venta sin pedido previo cuenta como first_sale, no como first_order', () => {
    expect(currentStage({ ...sinHitos(), firstSaleAt: VENTA }).stage).toBe('first_sale');
  });

  it('gana la etapa más alta aunque una más baja tenga fecha posterior', () => {
    const posterior = new Date('2030-01-01T00:00:00Z');

    expect(
      currentStage({ ...sinHitos(), firstProductAt: posterior, firstOrderAt: PEDIDO }),
    ).toEqual({ stage: 'first_order', reachedAt: PEDIDO });
  });
});

describe('stagesReachedBy', () => {
  it('una tienda en created solo alcanzó created', () => {
    expect(stagesReachedBy('created')).toEqual(['created']);
  });

  it('una tienda en first_sale alcanzó todas las anteriores', () => {
    expect(stagesReachedBy('first_sale')).toEqual([
      'created',
      'catalog',
      'first_order',
      'first_sale',
    ]);
  });

  it('una tienda que paga alcanzó todo el embudo', () => {
    expect(stagesReachedBy('paying')).toHaveLength(5);
    expect(stagesReachedBy('paying')).toContain('created');
  });
});
