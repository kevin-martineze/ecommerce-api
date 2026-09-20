import { Injectable, NotFoundException } from '@nestjs/common';
import { StoreSettings } from '@prisma/client';
import { Assistant } from '@shared/ai/assistant';
import { StoreSettingsDto, UpdateStoreSettingsDto } from '@shared/dtos/content/settings.dto';
import { assertCollectionInStore } from '@shared/tenancy/store-references';
import { blankToNull } from '@shared/utils/text';
import { PrismaService, TenantClient } from '@db/prisma.service';

const MISSING = 'La tienda no tiene ajustes.';

@Injectable()
export class StoreSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assistant: Assistant,
  ) {}

  /**
   * Si esta tienda tiene asistente hoy: hace falta que la plataforma tenga un
   * modelo encendido Y que el plan lo incluya. Se pregunta en cada lectura y
   * no se guarda en los ajustes: cambiar de plan tiene que verse enseguida.
   */
  private async hasAssistant(tx: TenantClient, storeId: string): Promise<boolean> {
    if (!this.assistant.available) return false;

    const subscription = await tx.subscription.findUnique({
      where: { storeId },
      select: { plan: { select: { aiRepliesPerMonth: true } } },
    });

    return (subscription?.plan.aiRepliesPerMonth ?? 0) > 0;
  }

  get(storeId: string): Promise<StoreSettingsDto> {
    return this.prisma.forStore(storeId, async (tx) => {
      const store = await tx.store.findUnique({ where: { id: storeId }, select: { name: true } });
      const settings = await tx.storeSettings.findUnique({ where: { storeId } });

      if (!store || !settings) {
        throw new NotFoundException(MISSING);
      }

      return toDto(store.name, settings, await this.hasAssistant(tx, storeId));
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
          // Obligatoria: null no la vacía, no la toca.
          template: dto.template ?? undefined,
        },
      });

      const store = await tx.store.findUnique({ where: { id: storeId }, select: { name: true } });

      if (!store) {
        throw new NotFoundException(MISSING);
      }

      return toDto(store.name, settings, await this.hasAssistant(tx, storeId));
    });
  }
}

function toDto(storeName: string, settings: StoreSettings, assistant: boolean): StoreSettingsDto {
  return {
    storeName,
    whatsappPhone: settings.whatsappPhone,
    instagramUrl: settings.instagramUrl,
    announcement: settings.announcement,
    freeShippingThreshold: settings.freeShippingThreshold,
    heroCollectionId: settings.heroCollectionId,
    heroTitle: settings.heroTitle,
    heroSubtitle: settings.heroSubtitle,
    template: settings.template,
    assistant,
    updatedAt: settings.updatedAt,
  };
}
