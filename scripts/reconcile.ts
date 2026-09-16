import 'dotenv/config';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PlatformService } from '../src/modules/platform/providers/platform.service';

/**
 * Marca como vencidas las tiendas cuyo período o prueba terminó.
 *
 *   pnpm platform:reconcile
 *
 * Para el cron diario del servidor. Levanta la aplicación sin HTTP y llama al
 * mismo servicio que `POST /platform/reconcile`, así el cron no necesita un
 * token de administración.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

  try {
    const { markedPastDue } = await app.get(PlatformService).reconcile();

    process.stdout.write(`${markedPastDue} tiendas pasaron a vencidas.\n`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
