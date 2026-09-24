/**
 * La pasarela de pagos, vista desde el dominio.
 *
 * Dos usos con el mismo contrato: cobrarle a la tienda su plan, y cobrarle a
 * la clienta su pedido. Lo que cambia entre los dos es de quién es la cuenta
 * de comercio, y eso viaja en las credenciales, no en el código.
 *
 * El cobro NO se confirma con lo que diga el navegador de quien paga: el
 * navegador puede volver por una URL cualquiera, o no volver nunca. Se confirma
 * con el evento firmado que manda la pasarela. Por eso `parseEvent` es parte
 * del contrato y no un detalle de cada implementación.
 */

export interface GatewayCredentials {
  publicKey: string;
  privateKey: string;
  /** Con el que se firma la referencia en el enlace de pago. */
  integritySecret: string;
  /** Con el que se firman los eventos que llegan. */
  eventsSecret: string;
}

export interface CheckoutInput {
  /** Nuestra referencia. Vuelve en el evento y es lo que dice a qué corresponde el pago. */
  reference: string;
  amountCop: number;
  description: string;
  customerEmail?: string;
  /** A dónde vuelve quien pagó. Es cortesía, no la confirmación. */
  redirectUrl: string;
}

export interface CheckoutSession {
  /** La página de la pasarela. Se le abre a quien paga. */
  url: string;
  reference: string;
}

/**
 * Lo que el navegador necesita para convertir una tarjeta en un token.
 *
 * La tarjeta NO pasa por nuestro servidor en ningún momento: el navegador se
 * la da a la pasarela con la llave pública y recibe un token de un solo uso.
 * Lo único que viaja hacia acá es ese token.
 */
export interface SetupInfo {
  publicKey: string;
  /** Los términos de la pasarela, ya firmados por ella. Hay que aceptarlos. */
  acceptanceToken: string;
  /** Dónde se leen esos términos. Se enlaza junto a la casilla. */
  termsUrl: string;
}

export interface PaymentSourceInput {
  /** El token de la tarjeta, hecho en el navegador. Dura poco y sirve una vez. */
  cardToken: string;
  acceptanceToken: string;
  customerEmail: string;
}

/** Un medio de pago guardado en la pasarela. Acá solo vive su identificador. */
export interface PaymentSource {
  id: string;
  /** `VISA`, `MASTERCARD`… para poder decir con qué se va a cobrar. */
  brand: string | null;
  last4: string | null;
}

export interface ChargeInput {
  reference: string;
  amountCop: number;
  description: string;
  customerEmail: string;
  paymentSourceId: string;
}

export type PaymentStatus = 'approved' | 'declined' | 'pending';

export interface PaymentEvent {
  reference: string;
  /** El identificador de la pasarela. Lo que hace que un pago no se aplique dos veces. */
  transactionId: string;
  status: PaymentStatus;
  amountCop: number;
  method: string;
}

export abstract class PaymentGateway {
  /** Cómo se llama en los registros: `wompi`, `simulado`. */
  abstract readonly name: string;

  /** Si la plataforma tiene con qué cobrar. */
  abstract readonly available: boolean;

  /**
   * Si se le puede guardar un medio de pago y cobrar sin nadie delante.
   *
   * No todas pueden, y no todos los medios se dejan guardar: PSE es de un solo
   * uso por diseño —cada pago exige volver al banco—, así que una suscripción
   * que se cobre sola es, hoy, tarjeta.
   */
  abstract readonly supportsRecurring: boolean;

  abstract checkout(input: CheckoutInput, credentials?: GatewayCredentials): CheckoutSession;

  /** Lo que el navegador necesita para tokenizar una tarjeta. */
  abstract setup(credentials?: GatewayCredentials): Promise<SetupInfo>;

  /** Guarda el medio de pago en la pasarela y devuelve con qué quedó. */
  abstract createPaymentSource(
    input: PaymentSourceInput,
    credentials?: GatewayCredentials,
  ): Promise<PaymentSource>;

  /**
   * Cobra contra un medio ya guardado, sin nadie delante.
   *
   * Devuelve lo mismo que un evento, para que quien aplica el pago no tenga
   * que distinguir si lo cobró un cron o lo pagó alguien en la pasarela.
   */
  abstract charge(input: ChargeInput, credentials?: GatewayCredentials): Promise<PaymentEvent>;

  /**
   * Comprueba la firma del evento y lo traduce. `null` si la firma no cuadra:
   * el que llama no tiene que distinguir entre «vino mal firmado» y «vino
   * mal escrito», las dos cosas se tiran igual.
   */
  abstract parseEvent(body: unknown, credentials?: GatewayCredentials): PaymentEvent | null;
}
