import { NestFactory } from '@nestjs/core';
import { DomainCheckService } from '@modules/domains/providers/domain-check.service';

import { AppModule } from '../app.module';

/**
 * Revisa cada dominio propio: activa los que ya funcionan, marca como fallidos
 * los que dejaron de funcionar, y libera los pendientes de más de 7 días.
 *
 * No importa `dotenv`: ver reconcile.ts, que tiene la misma razón.
 *
 *   pnpm platform:check-domains                          en desarrollo
 *   docker compose exec api node dist/tasks/check-domains  en el servidor
 *
 * Para el cron diario, junto con los vencimientos. Vive en `src/` por la misma
 * razón que reconcile: la imagen de producción no trae TypeScript.
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

  try {
    const summary = await app.get(DomainCheckService).runDailyCheck();

    process.stdout.write(
      `Dominios revisados: ${summary.checked}. Activados: ${summary.activated}. ` +
        `Fallidos: ${summary.failed}. Liberados: ${summary.released}. ` +
        `Sin revisar: ${summary.errors}.\n`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
