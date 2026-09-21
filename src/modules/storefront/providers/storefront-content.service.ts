import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  CreateRestockRequestDto,
  HomeDto,
  PublicCollectionDetailDto,
  SitemapDto,
  StorefrontDto,
} from '@shared/dtos/storefront/content.dto';
import { Assistant } from '@shared/ai/assistant';
import { DEFAULT_TEMPLATE } from '@shared/content/templates';
import { PaymentGateway } from '@shared/payments/gateway';
import { PrismaService } from '@db/prisma.service';
import { PublicStoreResolver } from '@shared/tenancy/public-store.resolver';

import { CARD_INCLUDE, NEWEST_FIRST, toProductCard } from './product-card';

/** Mismo número de tarjetas que la portada actual. */
const HOME_LIMIT = 8;

@Injectable()
export class StorefrontContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: PublicStoreResolver,
    private readonly assistant: Assistant,
    @Inject(PaymentGateway) private readonly gateway: PaymentGateway | null,
  ) {}

  /** Lo que el layout necesita en cada página: tienda, ajustes, categorías y colecciones. */
  async storefront(storeSlug: string): Promise<StorefrontDto> {
    const store = await this.stores.resolve(storeSlug);

    return this.prisma.forStore(store.id, async (tx) => {
      const settings = await tx.storeSettings.findUnique({ where: { storeId: store.id } });

      // El chat se ofrece solo si hay modelo encendido en la plataforma Y el
      // plan de la tienda lo incluye. Es un booleano y no la cuota: cuánto le
      // queda a la tienda es asunto de la tienda, no de quien la visita.
      const subscription = await tx.subscription.findUnique({
        where: { storeId: store.id },
        select: { plan: { select: { aiRepliesPerMonth: true } } },
      });

      // Cobrar en línea depende de dos cosas: que la plataforma tenga pasarela
      // y que ESTA tienda haya conectado su cuenta. La plata de la venta es
      // suya, así que sin su cuenta no hay cobro.
      const paymentAccount = await tx.storePaymentAccount.findUnique({
        where: { storeId: store.id },
        select: { active: true },
      });

      const categories = await tx.category.findMany({
        where: { storeId: store.id, active: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, slug: true, name: true, parentId: true, sortOrder: true },
      });

      const collections = await tx.collection.findMany({
        where: { storeId: store.id, active: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          heroImageUrl: true,
          sortOrder: true,
        },
      });

      return {
        store: { name: store.name, slug: store.slug },
        // Toda tienda nace con ajustes (registro e importación los crean). El
        // valor vacío es solo para no tumbar la tienda si faltara la fila.
        settings: {
          whatsappPhone: settings?.whatsappPhone ?? '',
          instagramUrl: settings?.instagramUrl ?? null,
          announcement: settings?.announcement ?? null,
          freeShippingThreshold: settings?.freeShippingThreshold ?? null,
          heroCollectionId: settings?.heroCollectionId ?? null,
          heroTitle: settings?.heroTitle ?? null,
          heroSubtitle: settings?.heroSubtitle ?? null,
          template: settings?.template ?? DEFAULT_TEMPLATE,
          assistant: this.assistant.available && (subscription?.plan.aiRepliesPerMonth ?? 0) > 0,
          onlinePayments: this.gateway !== null && Boolean(paymentAccount?.active),
        },
        categories,
        collections,
      };
    });
  }

  async home(storeSlug: string): Promise<HomeDto> {
    const store = await this.stores.resolve(storeSlug);

    return this.prisma.forStore(store.id, async (tx) => {
      const featured = await tx.product.findMany({
        where: { storeId: store.id, status: 'ACTIVE', featured: true },
        orderBy: NEWEST_FIRST,
        take: HOME_LIMIT,
        include: CARD_INCLUDE,
      });

      const newest = await tx.product.findMany({
        where: { storeId: store.id, status: 'ACTIVE' },
        orderBy: NEWEST_FIRST,
        take: HOME_LIMIT,
        include: CARD_INCLUDE,
      });

      const highlights = await tx.homeHighlight.findMany({
        where: { storeId: store.id, active: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, eyebrow: true, title: true, body: true, sortOrder: true },
      });

      return {
        featured: featured.map(toProductCard),
        newest: newest.map(toProductCard),
        highlights,
      };
    });
  }

  async collection(storeSlug: string, collectionSlug: string): Promise<PublicCollectionDetailDto> {
    const store = await this.stores.resolve(storeSlug);

    return this.prisma.forStore(store.id, async (tx) => {
      const collection = await tx.collection.findFirst({
        where: { storeId: store.id, slug: collectionSlug, active: true },
        include: {
          items: {
            orderBy: { sortOrder: 'asc' },
            include: { product: { include: CARD_INCLUDE } },
          },
        },
      });

      if (!collection) {
        throw new NotFoundException('Esa colección no existe.');
      }

      return {
        id: collection.id,
        slug: collection.slug,
        name: collection.name,
        description: collection.description,
        heroImageUrl: collection.heroImageUrl,
        sortOrder: collection.sortOrder,
        // Un producto despublicada sale de la colección sin tocar la colección.
        items: collection.items
          .filter((item) => item.product.status === 'ACTIVE')
          .map((item) => ({
            hotspotX: item.hotspotX?.toNumber() ?? null,
            hotspotY: item.hotspotY?.toNumber() ?? null,
            product: toProductCard(item.product),
          })),
      };
    });
  }

  async sitemap(storeSlug: string): Promise<SitemapDto> {
    const store = await this.stores.resolve(storeSlug);

    return this.prisma.forStore(store.id, async (tx) => {
      const products = await tx.product.findMany({
        where: { storeId: store.id, status: 'ACTIVE' },
        orderBy: NEWEST_FIRST,
        select: { slug: true, updatedAt: true },
      });

      const collections = await tx.collection.findMany({
        where: { storeId: store.id, active: true },
        orderBy: { sortOrder: 'asc' },
        select: { slug: true },
      });

      const categories = await tx.category.findMany({
        where: { storeId: store.id, active: true },
        orderBy: { sortOrder: 'asc' },
        select: { slug: true },
      });

      return {
        products,
        collections: collections.map((collection) => collection.slug),
        categories: categories.map((category) => category.slug),
      };
    });
  }

  /**
   * "Avísame cuando vuelva".
   *
   * Solo se acepta sobre una variante que la visitante puede ver: activa y de
   * un producto publicada. Pedir aviso de algo oculto no sirve de nada y dejaría
   * sondear qué variantes existen.
   */
  async requestRestock(storeSlug: string, dto: CreateRestockRequestDto): Promise<void> {
    const store = await this.stores.resolve(storeSlug);

    await this.prisma.forStore(store.id, async (tx) => {
      const variant = await tx.variant.findFirst({
        where: {
          id: dto.variantId,
          storeId: store.id,
          active: true,
          product: { status: 'ACTIVE' },
        },
        select: { id: true },
      });

      if (!variant) {
        throw new NotFoundException('Esa variación ya no está disponible.');
      }

      await tx.restockRequest.create({
        data: { storeId: store.id, variantId: variant.id, contact: dto.contact },
      });
    });
  }
}
