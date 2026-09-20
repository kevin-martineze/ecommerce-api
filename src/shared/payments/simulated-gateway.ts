import { CheckoutInput, CheckoutSession, PaymentEvent, PaymentGateway } from './gateway';

/**
 * La pasarela de mentira, para desarrollo y demostraciones.
 *
 * No cobra nada: lleva a una página del propio sitio con un botón que aprueba
 * el pago. Existe porque el flujo completo —crear el cobro, volver, confirmar
 * por evento— se puede probar entero sin abrir una cuenta de comercio, y
 * porque enseñarle el producto a alguien no debería costar plata.
 *
 * Deja el mismo rastro que dejará la de verdad: una referencia, un
 * identificador de transacción y un pago registrado. Cuando llegue Wompi
 * cambia quién aprueba, no lo que pasa después.
 */
export class SimulatedGateway extends PaymentGateway {
  readonly name = 'simulado';
  readonly available = true;

  constructor(private readonly frontendUrl: string) {
    super();
  }

  checkout(input: CheckoutInput): CheckoutSession {
    const url = new URL('/pagos/simulado', this.frontendUrl);

    url.searchParams.set('referencia', input.reference);
    url.searchParams.set('monto', String(input.amountCop));
    url.searchParams.set('concepto', input.description);
    url.searchParams.set('volver', input.redirectUrl);

    return { url: url.toString(), reference: input.reference };
  }

  /**
   * Acá no hay firma que comprobar: el «evento» lo manda nuestro propio
   * frontend. Por eso esta pasarela solo se enciende a mano y nunca es la de
   * por defecto.
   */
  parseEvent(body: unknown): PaymentEvent | null {
    const event = body as { reference?: unknown; amountCop?: unknown } | null;

    if (!event || typeof event.reference !== 'string') return null;

    return {
      reference: event.reference,
      transactionId: `sim-${event.reference}`,
      status: 'approved',
      amountCop: typeof event.amountCop === 'number' ? event.amountCop : 0,
      method: this.name,
    };
  }
}
