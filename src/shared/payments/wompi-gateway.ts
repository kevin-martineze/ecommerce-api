import { createHash } from 'node:crypto';

import { timingSafeEqualString } from '@shared/utils/secrets';

import {
  CheckoutInput,
  CheckoutSession,
  GatewayCredentials,
  PaymentEvent,
  PaymentGateway,
  PaymentStatus,
} from './gateway';

/**
 * Wompi (Bancolombia): tarjetas, PSE, Nequi y botón Bancolombia.
 *
 * El enlace de pago se arma, no se pide: el Checkout Web de Wompi es una URL
 * con la referencia, el monto y una firma de integridad. Así, crear un cobro
 * no depende de que su API esté arriba en ese instante.
 *
 * Los montos viajan en centavos. En Colombia el peso no tiene centavos, pero
 * la API los pide igual, y confundir la unidad es cobrar cien veces de más:
 * la conversión vive solo acá.
 */
export class WompiGateway extends PaymentGateway {
  readonly name = 'wompi';
  readonly available = true;

  constructor(
    private readonly checkoutUrl: string,
    private readonly platform?: GatewayCredentials,
  ) {
    super();
  }

  checkout(input: CheckoutInput, credentials?: GatewayCredentials): CheckoutSession {
    const keys = this.keysOf(credentials);
    const cents = toCents(input.amountCop);
    const url = new URL(this.checkoutUrl);

    url.searchParams.set('public-key', keys.publicKey);
    url.searchParams.set('currency', CURRENCY);
    url.searchParams.set('amount-in-cents', String(cents));
    url.searchParams.set('reference', input.reference);
    url.searchParams.set('redirect-url', input.redirectUrl);
    // Sin esto Wompi rechaza el enlace: es lo que impide que alguien cambie el
    // monto en la barra de direcciones y pague mil pesos por lo que vale cien mil.
    url.searchParams.set(
      'signature:integrity',
      sha256(`${input.reference}${cents}${CURRENCY}${keys.integritySecret}`),
    );

    if (input.customerEmail) {
      url.searchParams.set('customer-data:email', input.customerEmail);
    }

    return { url: url.toString(), reference: input.reference };
  }

  /**
   * La firma de un evento de Wompi se calcula concatenando los valores de las
   * propiedades que el propio evento enumera, en ese orden, más la marca de
   * tiempo y el secreto de eventos. Se recalcula y se compara: si no cuadra,
   * el evento no vino de Wompi por mucho que lo diga.
   */
  parseEvent(body: unknown, credentials?: GatewayCredentials): PaymentEvent | null {
    const keys = this.keysOf(credentials);
    const event = body as WompiEvent | null;

    if (!event || typeof event !== 'object') return null;
    if (event.event !== 'transaction.updated') return null;

    const checksum = event.signature?.checksum;
    const properties = event.signature?.properties;
    const transaction = event.data?.transaction;

    if (!checksum || !Array.isArray(properties) || !transaction) return null;

    const concatenado = properties
      .map((path) => String(valueAt(event.data, path.replace(/^transaction\./, 'transaction.'))))
      .join('');

    const esperado = sha256(`${concatenado}${event.timestamp ?? ''}${keys.eventsSecret}`);

    if (!timingSafeEqualString(esperado, checksum)) return null;

    return {
      reference: transaction.reference,
      transactionId: transaction.id,
      status: toStatus(transaction.status),
      amountCop: Math.round(transaction.amount_in_cents / 100),
      method: transaction.payment_method_type?.toLowerCase() ?? this.name,
    };
  }

  /** Las llaves de la tienda si las hay; si no, las de la plataforma. */
  private keysOf(credentials?: GatewayCredentials): GatewayCredentials {
    const keys = credentials ?? this.platform;

    if (!keys) throw new Error('Wompi sin credenciales: ni de la tienda ni de la plataforma.');

    return keys;
  }
}

const CURRENCY = 'COP';

interface WompiEvent {
  event?: string;
  timestamp?: number;
  signature?: { checksum?: string; properties?: string[] };
  data?: {
    transaction?: {
      id: string;
      reference: string;
      status: string;
      amount_in_cents: number;
      payment_method_type?: string;
    };
  };
}

/** El peso colombiano no tiene centavos, pero la API los pide. */
function toCents(amountCop: number): number {
  return Math.round(amountCop) * 100;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function toStatus(status: string): PaymentStatus {
  if (status === 'APPROVED') return 'approved';
  if (status === 'PENDING') return 'pending';

  return 'declined';
}

/** Lee `transaction.amount_in_cents` dentro del objeto de datos del evento. */
function valueAt(data: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((actual, parte) => {
    if (actual === null || typeof actual !== 'object') return undefined;

    return (actual as Record<string, unknown>)[parte];
  }, data);
}
