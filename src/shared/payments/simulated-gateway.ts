import {
  ChargeInput,
  CheckoutInput,
  CheckoutSession,
  PaymentEvent,
  PaymentGateway,
  PaymentSource,
  PaymentSourceInput,
  SetupInfo,
} from './gateway';

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
  readonly supportsRecurring = true;

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
   * No hay pasarela a la que pedirle nada: la llave y el token son de mentira
   * y el navegador los reconoce como tales para no llamar a Wompi.
   */
  setup(): Promise<SetupInfo> {
    return Promise.resolve({
      publicKey: 'pub_simulado',
      // Vacío a propósito: el navegador lo reconoce y no llama a nadie.
      apiUrl: '',
      acceptanceToken: 'simulado',
      termsUrl: new URL('/legales/terminos', this.frontendUrl).toString(),
    });
  }

  /** Guarda una tarjeta que no existe. Los últimos cuatro salen del token. */
  createPaymentSource(input: PaymentSourceInput): Promise<PaymentSource> {
    return Promise.resolve({
      id: `sim-${input.cardToken.slice(-8)}`,
      brand: 'SIMULADA',
      last4: input.cardToken.slice(-4),
    });
  }

  /** Cobra siempre bien: para probar lo que pasa DESPUÉS de un cobro. */
  charge(input: ChargeInput): Promise<PaymentEvent> {
    return Promise.resolve({
      reference: input.reference,
      transactionId: `sim-${input.reference}`,
      status: 'approved',
      amountCop: input.amountCop,
      method: this.name,
    });
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
