import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { checkOutcome } from '@shared/domains/check-transitions';
import { DomainProvider } from '@shared/domains/domain-provider';
import { PrismaService } from '@db/prisma.service';

/** Lo que cambió en una pasada. Lo imprime la tarea diaria. */
export interface DomainCheckSummary {
  checked: number;
  activated: number;
  failed: number;
  released: number;
  /** Dominios que no se pudieron revisar: el proveedor no respondió. No cambian de estado. */
  errors: number;
}

export interface DomainCheckOptions {
  /** Cuándo se corre. Por defecto, ahora. Los tests lo fijan para probar la liberación. */
  now?: Date;
  /** Solo estas tiendas. La tarea diaria no lo pasa: revisa todas. Los tests lo usan para no tocar a nadie más. */
  storeIds?: string[];
}

const MISSING_TXT = 'Falta el registro TXT de verificación.';

/** Lo que se borra al liberar un dominio. */
const RELEASED = {
  customDomain: null,
  customDomainStatus: null,
  customDomainToken: null,
  customDomainRecords: Prisma.DbNull,
  customDomainVerifiedAt: null,
  customDomainCheckedAt: null,
  customDomainError: null,
  customDomainAddedAt: null,
} satisfies Prisma.StoreUpdateInput;

/**
 * La revisión diaria de los dominios propios: vuelve a mirar cada dominio y
 * ajusta su estado (ver `checkOutcome`). Corre desde la tarea de cron, nunca
 * desde una petición.
 */
@Injectable()
export class DomainCheckService {
  private readonly logger = new Logger('DomainCheck');

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: DomainProvider,
  ) {}

  async runDailyCheck(options: DomainCheckOptions = {}): Promise<DomainCheckSummary> {
    const now = options.now ?? new Date();

    // `stores` no está bajo RLS: la tarea recorre todas las tiendas con dominio.
    const stores = await this.prisma.store.findMany({
      where: {
        customDomainStatus: { not: null },
        ...(options.storeIds ? { id: { in: options.storeIds } } : {}),
      },
      select: {
        id: true,
        customDomain: true,
        customDomainStatus: true,
        customDomainToken: true,
        customDomainAddedAt: true,
      },
    });

    const summary: DomainCheckSummary = {
      checked: 0,
      activated: 0,
      failed: 0,
      released: 0,
      errors: 0,
    };

    for (const store of stores) {
      const { customDomain: host, customDomainStatus: current, customDomainToken: token } = store;

      if (!host || !current || !token) continue;

      summary.checked++;

      try {
        const owned = await this.provider.verifyOwnership(host, token);
        const inspection = await this.provider.inspect(host);
        const ok = inspection.configured && owned;

        const outcome = checkOutcome({
          current,
          ok,
          addedAt: store.customDomainAddedAt,
          now,
        });

        if (outcome.kind === 'release') {
          await this.provider.remove(host);

          await this.prisma.forStore(store.id, (tx) =>
            tx.store.update({ where: { id: store.id }, data: RELEASED }),
          );

          summary.released++;
          continue;
        }

        await this.prisma.forStore(store.id, (tx) =>
          tx.store.update({
            where: { id: store.id },
            data: {
              customDomainStatus: outcome.status,
              customDomainCheckedAt: now,
              customDomainVerifiedAt: ok ? now : undefined,
              customDomainError: ok
                ? null
                : !inspection.configured
                  ? inspection.error
                  : MISSING_TXT,
            },
          }),
        );

        if (outcome.status === 'ACTIVE' && current !== 'ACTIVE') summary.activated++;
        if (outcome.status === 'FAILED' && current === 'ACTIVE') summary.failed++;
      } catch (cause) {
        // Un fallo del proveedor no debe frenar a las demás tiendas. El identificador es el de la tienda, nunca su dominio.
        summary.errors++;
        this.logger.warn(
          `Dominio de la tienda ${store.id} sin revisar: ${cause instanceof Error ? cause.message : 'error desconocido'}`,
        );
      }
    }

    return summary;
  }
}
