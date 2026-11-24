import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, StoreSettings } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { Env } from '@shared/config/env';
import { Assistant } from '@shared/ai/assistant';
import { isEmptyTheme, readTheme } from '@shared/content/theme';
import {
  StoreSettingsDto,
  UpdateStoreSettingsDto,
  UpdateStoreThemeDto,
} from '@shared/dtos/content/settings.dto';
import { iconKey, logoKey, newStoragePath, processIcon, processLogo } from '@shared/media/images';
import { Upload } from '@shared/media/upload';
import { MediaStorage } from '@shared/storage/media-storage';
import { planAllowsCustomDomain } from '@shared/tenancy/custom-domain-plan';
import { assertCollectionInStore } from '@shared/tenancy/store-references';
import { publicUrl } from '@shared/tenancy/public-url';
import { blankToNull } from '@shared/utils/text';
import { PrismaService, TenantClient } from '@db/prisma.service';

const MISSING = 'La tienda no tiene ajustes.';

/** Las imágenes de la marca: el logo ancho de la cabecera y el ícono cuadrado. */
type BrandImage = 'logo' | 'icon';

const BRAND_IMAGES = {
  logo: { process: processLogo, key: logoKey, contentType: 'image/webp' },
  icon: { process: processIcon, key: iconKey, contentType: 'image/png' },
} as const;

/** Las dos columnas de una imagen de la marca: su URL pública y su ruta base. */
function brandColumns(
  kind: BrandImage,
  url: string | null,
  storagePath: string | null,
): Prisma.StoreSettingsUpdateInput {
  return kind === 'logo'
    ? { logoUrl: url, logoStoragePath: storagePath }
    : { iconUrl: url, iconStoragePath: storagePath };
}

/** Lo que se lee de la tienda para armar sus ajustes y su dirección pública. */
const STORE_FIELDS = {
  name: true,
  slug: true,
  status: true,
  customDomain: true,
  customDomainStatus: true,
} satisfies Prisma.StoreSelect;

@Injectable()
export class StoreSettingsService {
  private readonly logger = new Logger(StoreSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly assistant: Assistant,
    private readonly config: ConfigService<Env, true>,
    private readonly storage: MediaStorage,
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
      const store = await tx.store.findUnique({ where: { id: storeId }, select: STORE_FIELDS });
      const settings = await tx.storeSettings.findUnique({ where: { storeId } });

      if (!store || !settings) {
        throw new NotFoundException(MISSING);
      }

      return toDto(
        store,
        settings,
        await this.hasAssistant(tx, storeId),
        await planAllowsCustomDomain(tx, storeId),
        this.config.get('FRONTEND_URL', { infer: true }),
      );
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
          theme: themeColumn(dto.theme),
        },
      });

      const store = await tx.store.findUnique({ where: { id: storeId }, select: STORE_FIELDS });

      if (!store) {
        throw new NotFoundException(MISSING);
      }

      return toDto(
        store,
        settings,
        await this.hasAssistant(tx, storeId),
        await planAllowsCustomDomain(tx, storeId),
        this.config.get('FRONTEND_URL', { infer: true }),
      );
    });
  }

  /** Sube el logo. Reemplaza el anterior. */
  setLogo(storeId: string, upload: Upload): Promise<StoreSettingsDto> {
    return this.setBrandImage(storeId, 'logo', upload);
  }

  /** Quita el logo: la tienda vuelve a mostrar el nombre. */
  removeLogo(storeId: string): Promise<StoreSettingsDto> {
    return this.removeBrandImage(storeId, 'logo');
  }

  /** Sube el ícono: el favicon y el ícono del celular. Reemplaza el anterior. */
  setIcon(storeId: string, upload: Upload): Promise<StoreSettingsDto> {
    return this.setBrandImage(storeId, 'icon', upload);
  }

  /** Quita el ícono: la tienda vuelve a usar su logo. */
  removeIcon(storeId: string): Promise<StoreSettingsDto> {
    return this.removeBrandImage(storeId, 'icon');
  }

  /**
   * Sigue el orden de `CollectionsService.setHero`: la imagen se convierte
   * antes de abrir la transacción, el archivo nuevo se escribe dentro, y el
   * anterior se borra solo cuando el nuevo ya está guardado.
   */
  private async setBrandImage(
    storeId: string,
    kind: BrandImage,
    upload: Upload,
  ): Promise<StoreSettingsDto> {
    const image = BRAND_IMAGES[kind];
    const body = await image.process(upload.buffer);
    const storagePath = newStoragePath(storeId, 'branding', kind);
    const key = image.key(storagePath);
    let previous: string | null = null;

    try {
      await this.prisma.forStore(storeId, async (tx) => {
        const current = await tx.storeSettings.findUnique({
          where: { storeId },
          select: { logoStoragePath: true, iconStoragePath: true },
        });

        if (!current) {
          throw new NotFoundException(MISSING);
        }

        previous = kind === 'logo' ? current.logoStoragePath : current.iconStoragePath;

        await this.storage.put([{ key, body, contentType: image.contentType }]);

        await tx.storeSettings.update({
          where: { storeId },
          data: brandColumns(kind, this.storage.publicUrl(key), storagePath),
        });
      });
    } catch (error) {
      await this.discard([key]);
      throw error;
    }

    if (previous) {
      await this.discard([image.key(previous)]);
    }

    return this.get(storeId);
  }

  private async removeBrandImage(storeId: string, kind: BrandImage): Promise<StoreSettingsDto> {
    const previous = await this.prisma.forStore(storeId, async (tx) => {
      const current = await tx.storeSettings.findUnique({
        where: { storeId },
        select: { logoStoragePath: true, iconStoragePath: true },
      });

      if (!current) {
        throw new NotFoundException(MISSING);
      }

      await tx.storeSettings.update({
        where: { storeId },
        data: brandColumns(kind, null, null),
      });

      return kind === 'logo' ? current.logoStoragePath : current.iconStoragePath;
    });

    if (previous) {
      await this.discard([BRAND_IMAGES[kind].key(previous)]);
    }

    return this.get(storeId);
  }

  private async discard(keys: string[]): Promise<void> {
    try {
      await this.storage.remove(keys);
    } catch (error) {
      this.logger.warn(
        `No se pudo borrar la imagen de la marca del almacenamiento: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

/**
 * Qué se escribe en la columna: nada si no vino, `NULL` si se quitó o quedó
 * sin ajustes —la plantilla tal cual no necesita guardarse—, y si no, el
 * objeto normalizado por `readTheme`.
 */
function themeColumn(
  theme: UpdateStoreThemeDto | null | undefined,
): Prisma.InputJsonObject | typeof Prisma.DbNull | undefined {
  if (theme === undefined) return undefined;

  const normalized = readTheme(theme);

  if (isEmptyTheme(normalized)) return Prisma.DbNull;

  return { ...normalized };
}

function toDto(
  store: Prisma.StoreGetPayload<{ select: typeof STORE_FIELDS }>,
  settings: StoreSettings,
  assistant: boolean,
  customDomainAllowed: boolean,
  frontendUrl: string,
): StoreSettingsDto {
  return {
    storeName: store.name,
    publicUrl: publicUrl(
      {
        slug: store.slug,
        status: store.status,
        customDomain: store.customDomain,
        customDomainStatus: store.customDomainStatus,
        planAllowsCustomDomain: customDomainAllowed,
      },
      frontendUrl,
    ),
    whatsappPhone: settings.whatsappPhone,
    instagramUrl: settings.instagramUrl,
    announcement: settings.announcement,
    freeShippingThreshold: settings.freeShippingThreshold,
    heroCollectionId: settings.heroCollectionId,
    heroTitle: settings.heroTitle,
    heroSubtitle: settings.heroSubtitle,
    logoUrl: settings.logoUrl,
    iconUrl: settings.iconUrl,
    template: settings.template,
    theme: readTheme(settings.theme),
    assistant,
    updatedAt: settings.updatedAt,
  };
}
