import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { PlatformService } from '@modules/platform/providers/platform.service';

import { AppModule } from '../app.module';

/**
 * Marca como vencidas las tiendas cuyo período o prueba terminó.
 *
 *   pnpm platform:reconcile                          en desarrollo
 *   docker compose exec api node dist/tasks/reconcile  en el servidor
 *
 * Para el cron diario. Levanta la aplicación sin HTTP y llama al mismo
 * servicio que `POST /platform/reconcile`, así el cron no necesita un token de
 * administración.
 *
 * Vive en `src/` y no en `scripts/` para que `nest build` lo compile: la
 * imagen de producción no trae TypeScript ni `ts-node`.
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
