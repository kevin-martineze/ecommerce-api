import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '@shared/config/env';

import { createPaymentGateway } from './create-gateway';
import { PaymentGateway } from './gateway';

/**
 * La pasarela, global como el almacenamiento: la usan la suscripción de cada
 * tienda y, más adelante, el checkout de sus clientas.
 *
 * Se inyecta como `PaymentGateway | null`: sin pasarela configurada no hay
 * objeto que inventar, y quien la use tiene que decidir qué hace sin ella.
 * Nest no admite `null` como valor de un proveedor por clase, así que el token
 * es la propia clase y el valor puede ser nulo.
 */
@Global()
@Module({
  providers: [
    {
      provide: PaymentGateway,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): PaymentGateway | null =>
        createPaymentGateway({
          PAYMENTS_DRIVER: config.get('PAYMENTS_DRIVER', { infer: true }),
          FRONTEND_URL: config.get('FRONTEND_URL', { infer: true }),
          WOMPI_CHECKOUT_URL: config.get('WOMPI_CHECKOUT_URL', { infer: true }),
          WOMPI_API_URL: config.get('WOMPI_API_URL', { infer: true }),
          WOMPI_PUBLIC_KEY: config.get('WOMPI_PUBLIC_KEY', { infer: true }),
          WOMPI_PRIVATE_KEY: config.get('WOMPI_PRIVATE_KEY', { infer: true }),
          WOMPI_INTEGRITY_SECRET: config.get('WOMPI_INTEGRITY_SECRET', { infer: true }),
          WOMPI_EVENTS_SECRET: config.get('WOMPI_EVENTS_SECRET', { infer: true }),
        }),
    },
  ],
  exports: [PaymentGateway],
})
export class PaymentsModule {}
