import { Env } from '@shared/config/env';

import { PaymentGateway } from './gateway';
import { SimulatedGateway } from './simulated-gateway';
import { WompiGateway } from './wompi-gateway';

type PaymentsEnv = Pick<
  Env,
  | 'PAYMENTS_DRIVER'
  | 'FRONTEND_URL'
  | 'WOMPI_CHECKOUT_URL'
  | 'WOMPI_API_URL'
  | 'WOMPI_PUBLIC_KEY'
  | 'WOMPI_PRIVATE_KEY'
  | 'WOMPI_INTEGRITY_SECRET'
  | 'WOMPI_EVENTS_SECRET'
>;

/**
 * La pasarela que pide el entorno.
 *
 * Con `none` no hay ninguna y los pagos se registran a mano desde la consola,
 * que es como estaba antes de que existiera esto.
 */
export function createPaymentGateway(env: PaymentsEnv): PaymentGateway | null {
  if (env.PAYMENTS_DRIVER === 'simulated') return new SimulatedGateway(env.FRONTEND_URL);

  if (env.PAYMENTS_DRIVER === 'wompi') {
    // La validación del entorno ya exigió estas variables con este driver.
    return new WompiGateway(env.WOMPI_CHECKOUT_URL, env.WOMPI_API_URL, {
      publicKey: env.WOMPI_PUBLIC_KEY ?? '',
      privateKey: env.WOMPI_PRIVATE_KEY ?? '',
      integritySecret: env.WOMPI_INTEGRITY_SECRET ?? '',
      eventsSecret: env.WOMPI_EVENTS_SECRET ?? '',
    });
  }

  return null;
}
