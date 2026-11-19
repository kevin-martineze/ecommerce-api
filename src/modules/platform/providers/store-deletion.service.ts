import { Injectable, Logger } from '@nestjs/common';
import { DomainProvider } from '@shared/domains/domain-provider';
import { imageObjectKeys, logoKey } from '@shared/media/images';
import { MediaStorage } from '@shared/storage/media-storage';
import { PrismaService, TenantClient } from '@db/prisma.service';

/** Lo que queda fuera de la base cuando se borra una tienda: fotos y dominio propio. */
export interface StoreLeftovers {
  storeIds: string[];
  keys: string[];
  hosts: string[];
}

/**
 * Borrado definitivo de tiendas. Lo usan el borrado de una tienda y el de una
 * cuenta que era su única dueña.
 *
 * Va en dos tiempos, igual que el borrado de una foto suelta: primero las
 * filas, dentro de la transacción de quien llama; después, con la base ya
 * confirmada, los archivos y el dominio. Si lo de afuera falla queda un archivo
 * huérfano o un host registrado sin tienda —espacio perdido—, nunca una tienda
 * a medio borrar.
 *
 * La fila de `stores` arrastra todo lo demás por `on delete cascade`. Las rutas
 * de las fotos se leen antes con el contexto de cada tienda, porque
 * `product_images` y compañía están bajo RLS.
 */
@Injectable()
export class StoreDeletionService {
  private readonly logger = new Logger(StoreDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: MediaStorage,
    private readonly domains: DomainProvider,
  ) {}

  /** Borra las filas de estas tiendas dentro de `tx`. Devuelve lo que hay que limpiar afuera. */
  async deleteRows(tx: TenantClient, storeIds: string[]): Promise<StoreLeftovers> {
    const leftovers: StoreLeftovers = { storeIds: [], keys: [], hosts: [] };

    for (const storeId of storeIds) {
      await this.prisma.setStoreContext(tx, storeId);

      const store = await tx.store.findUnique({
        where: { id: storeId },
        select: { customDomain: true },
      });

      if (!store) {
        continue;
      }

      const settings = await tx.storeSettings.findUnique({
        where: { storeId },
        select: { logoStoragePath: true },
      });
      const collections = await tx.collection.findMany({
        where: { storeId, heroStoragePath: { not: null } },
        select: { heroStoragePath: true },
      });
      const images = await tx.productImage.findMany({
        where: { storeId },
        select: { storagePath: true },
      });

      if (settings?.logoStoragePath) {
        leftovers.keys.push(logoKey(settings.logoStoragePath));
      }

      for (const { heroStoragePath } of collections) {
        if (heroStoragePath) leftovers.keys.push(...imageObjectKeys(heroStoragePath));
      }

      for (const { storagePath } of images) {
        leftovers.keys.push(...imageObjectKeys(storagePath));
      }

      if (store.customDomain) {
        leftovers.hosts.push(store.customDomain);
      }

      // `refresh_tokens.store_id` no es una llave foránea: sin esto, las
      // sesiones abiertas en la tienda seguirían renovándose hacia una tienda
      // que ya no existe.
      await tx.refreshToken.updateMany({
        where: { storeId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await tx.store.delete({ where: { id: storeId } });

      leftovers.storeIds.push(storeId);
    }

    return leftovers;
  }

  /** Lo de afuera, con la base ya confirmada. Nunca lanza: lo que falle queda en el log. */
  async cleanUp(leftovers: StoreLeftovers): Promise<void> {
    if (leftovers.keys.length > 0) {
      try {
        await this.storage.remove(leftovers.keys);
      } catch (error) {
        this.logger.error(
          `No se pudieron borrar ${leftovers.keys.length} archivos de las tiendas ${leftovers.storeIds.join(', ')}: ${describe(error)}`,
        );
      }
    }

    for (const host of leftovers.hosts) {
      try {
        await this.domains.remove(host);
      } catch (error) {
        this.logger.error(`No se pudo dar de baja el dominio ${host}: ${describe(error)}`);
      }
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
