import { Injectable, NotFoundException } from '@nestjs/common';
import { StoreSettings } from '@prisma/client';
import { StoreSettingsDto, UpdateStoreSettingsDto } from '@shared/dtos/content/settings.dto';
import { assertCollectionInStore } from '@shared/tenancy/store-references';
import { blankToNull } from '@shared/utils/text';
import { PrismaService } from '@db/prisma.service';

const MISSING = 'La tienda no tiene ajustes.';

@Injectable()
export class StoreSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  get(storeId: string): Promise<StoreSettingsDto> {
    return this.prisma.forStore(storeId, async (tx) => {
      const store = await tx.store.findUnique({ where: { id: storeId }, select: { name: true } });
      const settings = await tx.storeSettings.findUnique({ where: { storeId } });

      if (!store || !settings) {
        throw new NotFoundException(MISSING);
      }

      return toDto(store.name, settings);
    });
  }

  /**
   * El nombre vive en `stores.name` y el resto en `store_settings` —el nombre
   * no se duplica, ver schema.prisma—, así que un mismo PATCH toca dos tablas.
   * Van en la misma transacción: o cambian las dos, o ninguna.
   */
  update(storeId: string, dto: UpdateStoreSettingsDto): Promise<StoreSettingsDto> {
    return this.prisma.forStore(storeId, async (tx) => {
      if (dto.heroCollectionId) {
        await assertCollectionInStore(tx, storeId, dto.heroCollectionId);
      }

      if (dto.storeName) {
        await tx.store.update({ where: { id: storeId }, data: { name: dto.storeName } });
      }

      const settings = await tx.storeSettings.update({
        where: { storeId },
        data: {
          // Obligatorio: null no vacía, no toca.
          whatsappPhone: dto.whatsappPhone ?? undefined,
          instagramUrl: blankToNull(dto.instagramUrl),
          announcement: blankToNull(dto.announcement),
          freeShippingThreshold: dto.freeShippingThreshold,
          heroCollectionId: dto.heroCollectionId,
          heroTitle: blankToNull(dto.heroTitle),
          heroSubtitle: blankToNull(dto.heroSubtitle),
        },
      });

      const store = await tx.store.findUnique({ where: { id: storeId }, select: { name: true } });

      if (!store) {
        throw new NotFoundException(MISSING);
      }

      return toDto(store.name, settings);
    });
  }
}

function toDto(storeName: string, settings: StoreSettings): StoreSettingsDto {
  return {
    storeName,
    whatsappPhone: settings.whatsappPhone,
    instagramUrl: settings.instagramUrl,
    announcement: settings.announcement,
    freeShippingThreshold: settings.freeShippingThreshold,
    heroCollectionId: settings.heroCollectionId,
    heroTitle: settings.heroTitle,
    heroSubtitle: settings.heroSubtitle,
    updatedAt: settings.updatedAt,
  };
}
