import { NestFactory } from '@nestjs/core';
import { SubscriptionsService } from '@modules/platform/providers/subscriptions.service';

import { AppModule } from '../app.module';

/**
 * Cobra las suscripciones que vencen hoy, contra la tarjeta guardada.
 *
 * Es lo que hace que esto sea una suscripción y no una compra mensual: nadie
 * tiene que acordarse de pagar. Para una tienda en prueba, el período que
 * termina es la prueba, así que este es su primer cobro.
 *
 * Corre ANTES que `reconcile` en el cron: si cobra bien, la tienda no llega a
 * marcarse como vencida ese mismo día. Al revés, la dueña vería un aviso de
 * pago vencido por una tarjeta que sí funcionó.
 *
 * No importa `dotenv`, por lo mismo que `reconcile`: es dependencia de
 * desarrollo y no está en la imagen.
 *
 *   pnpm platform:charge-due                            en desarrollo
 *   docker compose exec api node dist/tasks/charge-due  en el servidor
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

  try {
    const { charged, failed } = await app.get(SubscriptionsService).chargeDue();

    process.stdout.write(`${charged} planes cobrados, ${failed} fallaron.\n`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
