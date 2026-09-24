import { createHash } from 'node:crypto';

import { timingSafeEqualString } from '@shared/utils/secrets';

import {
  ChargeInput,
  CheckoutInput,
  CheckoutSession,
  GatewayCredentials,
  PaymentEvent,
  PaymentGateway,
  PaymentSource,
  PaymentSourceInput,
  PaymentStatus,
  SetupInfo,
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
  readonly supportsRecurring = true;

  constructor(
    private readonly checkoutUrl: string,
    private readonly apiUrl: string,
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

  /**
   * El token de aceptación de los términos, firmado por Wompi.
   *
   * Caduca, así que se pide cada vez que alguien va a guardar una tarjeta en
   * vez de guardarlo: un token viejo hace fallar la creación de la fuente de
   * pago con un error que no dice nada.
   */
  async setup(credentials?: GatewayCredentials): Promise<SetupInfo> {
    const keys = this.keysOf(credentials);
    const merchant = await this.get<WompiMerchant>(`/merchants/${keys.publicKey}`);
    const acceptance = merchant.data?.presigned_acceptance;

    if (!acceptance?.acceptance_token) {
      throw new Error('Wompi no devolvió el token de aceptación de sus términos.');
    }

    return {
      publicKey: keys.publicKey,
      acceptanceToken: acceptance.acceptance_token,
      termsUrl: acceptance.permalink ?? '',
    };
  }

  async createPaymentSource(
    input: PaymentSourceInput,
    credentials?: GatewayCredentials,
  ): Promise<PaymentSource> {
    const keys = this.keysOf(credentials);

    const created = await this.post<WompiPaymentSource>(
      '/payment_sources',
      {
        type: 'CARD',
        token: input.cardToken,
        customer_email: input.customerEmail,
        acceptance_token: input.acceptanceToken,
      },
      keys.privateKey,
    );

    const source = created.data;

    if (!source?.id) {
      throw new Error('Wompi no devolvió la fuente de pago.');
    }

    return {
      id: String(source.id),
      brand: source.public_data?.brand ?? null,
      last4: source.public_data?.last_four ?? null,
    };
  }

  /**
   * Cobra contra una tarjeta guardada.
   *
   * `recurrent` no es cosmético: le dice a la red que el cobro lo inició el
   * comercio y no quien paga, que es lo que evita que el banco lo rechace por
   * venir sin nadie delante.
   */
  async charge(input: ChargeInput, credentials?: GatewayCredentials): Promise<PaymentEvent> {
    const keys = this.keysOf(credentials);
    const cents = toCents(input.amountCop);

    const created = await this.post<WompiTransaction>(
      '/transactions',
      {
        amount_in_cents: cents,
        currency: CURRENCY,
        customer_email: input.customerEmail,
        reference: input.reference,
        payment_source_id: Number(input.paymentSourceId),
        recurrent: true,
        signature: sha256(`${input.reference}${cents}${CURRENCY}${keys.integritySecret}`),
      },
      keys.privateKey,
    );

    const transaction = created.data;

    if (!transaction?.id) {
      throw new Error('Wompi no devolvió la transacción del cobro.');
    }

    return {
      reference: transaction.reference ?? input.reference,
      transactionId: transaction.id,
      status: toStatus(transaction.status ?? ''),
      amountCop: Math.round((transaction.amount_in_cents ?? cents) / 100),
      method: transaction.payment_method_type?.toLowerCase() ?? 'card',
    };
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  private async post<T>(path: string, body: unknown, privateKey: string): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${privateKey}` },
      body: JSON.stringify(body),
    });
  }

  /**
   * Una petición a la API de Wompi.
   *
   * El cuerpo del error se incluye en el mensaje porque sin él un 422 no dice
   * qué campo rechazó, y eso es media hora a ciegas. Nunca lleva la tarjeta:
   * lo que se manda es un token.
   */
  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.apiUrl}${path}`, init);
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`Wompi respondió ${response.status} a ${path}: ${text.slice(0, 300)}`);
    }

    return JSON.parse(text) as T;
  }

  /** Las llaves de la tienda si las hay; si no, las de la plataforma. */
  private keysOf(credentials?: GatewayCredentials): GatewayCredentials {
    const keys = credentials ?? this.platform;

    if (!keys) throw new Error('Wompi sin credenciales: ni de la tienda ni de la plataforma.');

    return keys;
  }
}

const CURRENCY = 'COP';

interface WompiMerchant {
  data?: { presigned_acceptance?: { acceptance_token?: string; permalink?: string } };
}

interface WompiPaymentSource {
  data?: { id?: number | string; public_data?: { brand?: string; last_four?: string } };
}

interface WompiTransaction {
  data?: {
    id?: string;
    reference?: string;
    status?: string;
    amount_in_cents?: number;
    payment_method_type?: string;
  };
}

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
