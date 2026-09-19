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

  abstract checkout(input: CheckoutInput, credentials?: GatewayCredentials): CheckoutSession;

  /**
   * Comprueba la firma del evento y lo traduce. `null` si la firma no cuadra:
   * el que llama no tiene que distinguir entre «vino mal firmado» y «vino
   * mal escrito», las dos cosas se tiran igual.
   */
  abstract parseEvent(body: unknown, credentials?: GatewayCredentials): PaymentEvent | null;
}
