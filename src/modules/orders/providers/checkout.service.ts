import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assertWithinPlan } from '@shared/billing/plan-limits';
import {
  computeTotals,
  COUPON_REJECTION_MESSAGE,
  couponDiscount,
  couponRejection,
  CouponRejection,
  MAX_QTY_PER_LINE,
  mergeLines,
  normalizeCouponCode,
} from '@shared/commerce/pricing';
import {
  AppliedCouponDto,
  CartQuoteDto,
  CartQuoteResultDto,
  CreateOrderDto,
  OrderCreatedDto,
  PublicOrderDto,
  PublicShippingZoneDto,
  QuotedLineDto,
  RemovedLineDto,
  StockProblemDto,
} from '@shared/dtos/orders/checkout.dto';
import { PublicStoreResolver } from '@shared/tenancy/public-store.resolver';
import { startOfMonthInBogota } from '@shared/utils/bogota-time';
import { blankToNull } from '@shared/utils/text';
import { isUniqueViolation, PrismaService, TenantClient } from '@db/prisma.service';
import {
  VARIANT_INCLUDE,
  variantLabel,
  variantValues,
} from '@modules/catalog/providers/variant-mapping';

import { isStorableOrderNumber, ITEMS_ORDER, toPublicOrder } from './order-mapping';

const LINE_INCLUDE = {
  ...VARIANT_INCLUDE,
  product: {
    select: {
      id: true,
      name: true,
      slug: true,
      basePrice: true,
      status: true,
      images: { select: { urlThumb: true }, orderBy: { sortOrder: 'asc' }, take: 1 },
    },
  },
} satisfies Prisma.VariantInclude;

type VariantForLine = Prisma.VariantGetPayload<{ include: typeof LINE_INCLUDE }>;

const CREATED_SELECT = {
  id: true,
  number: true,
  publicToken: true,
  subtotal: true,
  discount: true,
  shippingCost: true,
  total: true,
} satisfies Prisma.OrderSelect;

type CreatedOrder = Prisma.OrderGetPayload<{ select: typeof CREATED_SELECT }>;

/** Una línea ya validada y con precio de hoy: exactamente lo que se copia al pedido. */
interface PricedLine {
  variantId: string;
  productId: string;
  productName: string;
  productSlug: string;
  variantLabel: string;
  sku: string | null;
  unitPrice: number;
  qty: number;
  lineTotal: number;
}

const ORDER_NOT_FOUND = 'Pedido no encontrado.';

/**
 * Carrito y pedido de la tienda pública.
 *
 * Reemplaza a `validate_coupon`, `create_order` y `mark_whatsapp_opened` de la
 * versión con Supabase. Conserva lo que importaba de la versión SQL (ver
 * ARCHITECTURE.md § 5) y le suma la idempotencia.
 */
@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: PublicStoreResolver,
  ) {}

  async shippingZones(storeSlug: string): Promise<PublicShippingZoneDto[]> {
    const store = await this.stores.resolve(storeSlug);

    return this.prisma.forStore(store.id, (tx) =>
      tx.shippingZone.findMany({
        where: { storeId: store.id, active: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, cost: true, etaDays: true },
      }),
    );
  }

  /**
   * Cotiza el carrito del navegador contra la base: precios y stock de hoy,
   * cupón y envío. No reserva nada; es la vista previa antes de confirmar.
   */
  async quote(storeSlug: string, dto: CartQuoteDto): Promise<CartQuoteResultDto> {
    const store = await this.stores.resolve(storeSlug);
    const lines = mergeLines(dto.items);

    return this.prisma.forStore(store.id, async (tx) => {
      const variants = await findVariants(
        tx,
        store.id,
        lines.map((line) => line.variantId),
      );

      const quoted: QuotedLineDto[] = [];
      const removed: RemovedLineDto[] = [];

      for (const line of lines) {
        const variant = variants.get(line.variantId);

        if (!isSellable(variant)) {
          removed.push({ variantId: line.variantId, label: 'Prenda no disponible' });
          continue;
        }

        if (variant.stock <= 0) {
          removed.push({ variantId: line.variantId, label: lineLabel(variant) });
          continue;
        }

        // Se recorta a lo que hay y se avisa: el carrito del navegador puede
        // llevar días guardado.
        const qty = Math.min(line.qty, variant.stock);

        quoted.push({
          ...priceLine(variant, qty),
          stock: variant.stock,
          imageUrl: variant.product.images[0]?.urlThumb ?? null,
          adjustedFrom: qty < line.qty ? line.qty : null,
        });
      }

      const subtotal = quoted.reduce((sum, line) => sum + line.lineTotal, 0);
      const code = normalizeCouponCode(dto.couponCode ?? '');

      let coupon: AppliedCouponDto | null = null;
      let rejection: CouponRejection | null = null;

      if (code) {
        const row = await tx.coupon.findFirst({ where: { storeId: store.id, code } });

        rejection = couponRejection(row, subtotal, new Date());

        if (row && !rejection) {
          coupon = {
            code: row.code,
            type: row.type,
            value: row.value,
            discount: couponDiscount(row, subtotal),
          };
        }
      }

      const zone = dto.shippingZoneId
        ? await tx.shippingZone.findFirst({
            where: { storeId: store.id, id: dto.shippingZoneId, active: true },
            select: { id: true, name: true, cost: true, etaDays: true },
          })
        : null;

      const settings = await tx.storeSettings.findUnique({
        where: { storeId: store.id },
        select: { freeShippingThreshold: true },
      });

      return {
        lines: quoted,
        removed,
        coupon,
        couponRejection: rejection,
        couponRejectionMessage: rejection ? COUPON_REJECTION_MESSAGE[rejection] : null,
        zone,
        totals: computeTotals(
          subtotal,
          coupon?.discount ?? 0,
          zone?.cost ?? 0,
          settings?.freeShippingThreshold ?? null,
        ),
      };
    });
  }

  /**
   * Crea el pedido.
   *
   * Con `Idempotency-Key`, repetir el envío —el doble clic con la red lenta—
   * devuelve el mismo pedido en vez de crear dos y descontar el stock dos veces.
   */
  async createOrder(
    storeSlug: string,
    dto: CreateOrderDto,
    idempotencyKey: string | null,
  ): Promise<OrderCreatedDto> {
    const store = await this.stores.resolve(storeSlug);

    try {
      return await this.prisma.forStore(store.id, (tx) =>
        this.placeOrder(tx, store.id, dto, idempotencyKey),
      );
    } catch (error) {
      // Carrera entre dos envíos con la misma clave que no compartían ninguna
      // variante bloqueada: el segundo choca con el unique de la clave. Se
      // devuelve el pedido que creó el primero.
      if (idempotencyKey && isUniqueViolation(error)) {
        const existing = await this.prisma.forStore(store.id, (tx) =>
          findByIdempotencyKey(tx, store.id, idempotencyKey),
        );

        if (existing) {
          return toCreated(existing);
        }
      }

      throw error;
    }
  }

  async publicOrder(storeSlug: string, number: number, token: string): Promise<PublicOrderDto> {
    const store = await this.stores.resolve(storeSlug);

    if (!isStorableOrderNumber(number)) {
      throw new NotFoundException(ORDER_NOT_FOUND);
    }

    return this.prisma.forStore(store.id, async (tx) => {
      // Número Y token: el número solo es adivinable, el token no. Un token
      // equivocado responde igual que un pedido inexistente.
      const order = await tx.order.findFirst({
        where: { storeId: store.id, number, publicToken: token },
        include: { items: { orderBy: ITEMS_ORDER } },
      });

      if (!order) {
        throw new NotFoundException(ORDER_NOT_FOUND);
      }

      return toPublicOrder(order);
    });
  }

  /** Registra que la clienta sí llegó a abrir el chat. Solo la primera vez cuenta. */
  async markWhatsappOpened(storeSlug: string, number: number, token: string): Promise<void> {
    const store = await this.stores.resolve(storeSlug);

    if (!isStorableOrderNumber(number)) {
      return;
    }

    await this.prisma.forStore(store.id, (tx) =>
      tx.order.updateMany({
        where: { storeId: store.id, number, publicToken: token, whatsappOpenedAt: null },
        data: { whatsappOpenedAt: new Date() },
      }),
    );
  }

  private async placeOrder(
    tx: TenantClient,
    storeId: string,
    dto: CreateOrderDto,
    idempotencyKey: string | null,
  ): Promise<OrderCreatedDto> {
    if (idempotencyKey) {
      const previous = await findByIdempotencyKey(tx, storeId, idempotencyKey);

      if (previous) {
        return toCreated(previous);
      }
    }

    const lines = mergeLines(dto.items);

    if (lines.some((line) => line.qty > MAX_QTY_PER_LINE)) {
      throw new BadRequestException({
        message: `Máximo ${MAX_QTY_PER_LINE} unidades por prenda.`,
        error: 'qty_too_high',
      });
    }

    const variantIds = lines.map((line) => line.variantId).sort();

    // Bloqueo ordenado por id: dos pedidos que comparten prendas las toman en el
    // mismo orden y no pueden bloquearse en cruz.
    await tx.$queryRaw`
      select id from variants
      where store_id = ${storeId}::uuid and id = any(${variantIds}::uuid[])
      order by id
      for update`;

    // Otra vez, ya con el lock: si llegaron dos envíos con la misma clave, el
    // segundo esperó aquí a que el primero terminara y ahora ve su pedido.
    if (idempotencyKey) {
      const previous = await findByIdempotencyKey(tx, storeId, idempotencyKey);

      if (previous) {
        return toCreated(previous);
      }
    }

    // El stock se revalida DESPUÉS de tomar el lock: lo que se leyó antes pudo
    // cambiar mientras se esperaba.
    const variants = await findVariants(tx, storeId, variantIds);
    const priced: PricedLine[] = [];
    const problems: StockProblemDto[] = [];

    for (const line of lines) {
      const variant = variants.get(line.variantId);

      if (!isSellable(variant) || variant.stock < line.qty) {
        problems.push({
          variantId: line.variantId,
          requested: line.qty,
          available: isSellable(variant) ? variant.stock : 0,
          product: variant?.product.name ?? 'Producto',
          variantLabel: variant ? etiqueta(variant) : '',
        });
        continue;
      }

      priced.push(priceLine(variant, line.qty));
    }

    if (problems.length > 0) {
      throw new ConflictException({
        message:
          'Se agotaron algunas prendas mientras armabas el pedido. Ajusta las cantidades e intenta de nuevo.',
        error: 'out_of_stock',
        details: problems,
      });
    }

    // El límite del plan se mira con las variantes ya bloqueadas: dos pedidos
    // simultáneos no pueden colarse los dos como "el último del mes".
    await assertWithinPlan(
      tx,
      storeId,
      'maxOrdersPerMonth',
      await tx.order.count({
        where: { storeId, createdAt: { gte: startOfMonthInBogota(new Date()) } },
      }),
    );

    const subtotal = priced.reduce((sum, line) => sum + line.lineTotal, 0);
    const coupon = await claimCoupon(tx, storeId, dto.couponCode, subtotal);

    const zone = await tx.shippingZone.findFirst({
      where: { storeId, id: dto.shippingZoneId, active: true },
      select: { id: true, name: true, cost: true },
    });

    if (!zone) {
      throw new BadRequestException({
        message: 'Esa zona de envío ya no está disponible. Elige otra.',
        error: 'invalid_zone',
      });
    }

    const settings = await tx.storeSettings.findUnique({
      where: { storeId },
      select: { freeShippingThreshold: true },
    });

    const totals = computeTotals(
      subtotal,
      coupon?.discount ?? 0,
      zone.cost,
      settings?.freeShippingThreshold ?? null,
    );

    // El número sale del contador de la tienda, incrementado con un UPDATE que
    // toma el lock de su fila: dos pedidos simultáneos no pueden llevarse el
    // mismo. Una secuencia global no sirve (ver `Store.nextOrderNumber`).
    const [counter] = await tx.$queryRaw<{ number: number }[]>`
      update stores set next_order_number = next_order_number + 1
      where id = ${storeId}::uuid
      returning next_order_number - 1 as number`;

    if (!counter) {
      throw new NotFoundException('Esta tienda no existe.');
    }

    const order = await tx.order.create({
      data: {
        storeId,
        number: counter.number,
        customerName: dto.customer.name,
        customerPhone: dto.customer.phone,
        customerCity: blankToNull(dto.customer.city) ?? null,
        customerAddress: blankToNull(dto.customer.address) ?? null,
        customerNotes: blankToNull(dto.customer.notes) ?? null,
        shippingZoneId: zone.id,
        // El nombre se congela: si la zona se renombra, el pedido dice lo que vio la clienta.
        shippingZoneName: zone.name,
        shippingCost: totals.shippingCost,
        couponId: coupon?.id ?? null,
        couponCode: coupon?.code ?? null,
        subtotal: totals.subtotal,
        discount: totals.discount,
        total: totals.total,
        idempotencyKey,
      },
      select: CREATED_SELECT,
    });

    await tx.orderItem.createMany({
      data: priced.map((line) => ({ storeId, orderId: order.id, ...line })),
    });

    for (const line of priced) {
      await tx.variant.update({
        where: { id: line.variantId, storeId },
        data: { stock: { decrement: line.qty } },
      });
    }

    if (coupon) {
      await tx.coupon.update({
        where: { id: coupon.id, storeId },
        data: { uses: { increment: 1 } },
      });
    }

    return toCreated(order);
  }
}

/**
 * Valida el cupón bajo lock y devuelve lo que se va a aplicar.
 *
 * El lock importa en el último uso disponible: sin él, dos pedidos simultáneos
 * leen `uses < maxUses` a la vez y lo gastan los dos.
 */
async function claimCoupon(
  tx: TenantClient,
  storeId: string,
  rawCode: string | undefined,
  subtotal: number,
): Promise<{ id: string; code: string; discount: number } | null> {
  const code = normalizeCouponCode(rawCode ?? '');

  if (!code) {
    return null;
  }

  await tx.$queryRaw`
    select id from coupons where store_id = ${storeId}::uuid and code = ${code} for update`;

  const coupon = await tx.coupon.findFirst({ where: { storeId, code } });
  const rejection = couponRejection(coupon, subtotal, new Date());

  if (!coupon || rejection) {
    const reason = rejection ?? 'not_found';

    throw new BadRequestException({
      message: COUPON_REJECTION_MESSAGE[reason],
      error: 'coupon_rejected',
      details: { reason },
    });
  }

  return { id: coupon.id, code: coupon.code, discount: couponDiscount(coupon, subtotal) };
}

async function findVariants(
  tx: TenantClient,
  storeId: string,
  ids: string[],
): Promise<Map<string, VariantForLine>> {
  if (ids.length === 0) {
    return new Map();
  }

  const variants = await tx.variant.findMany({
    where: { storeId, id: { in: ids } },
    include: LINE_INCLUDE,
  });

  return new Map(variants.map((variant) => [variant.id, variant]));
}

function findByIdempotencyKey(
  tx: TenantClient,
  storeId: string,
  key: string,
): Promise<CreatedOrder | null> {
  return tx.order.findFirst({ where: { storeId, idempotencyKey: key }, select: CREATED_SELECT });
}

/** Mismas condiciones que las políticas de Supabase: variante activa de una prenda publicada. */
function isSellable(variant: VariantForLine | undefined): variant is VariantForLine {
  return variant !== undefined && variant.active && variant.product.status === 'ACTIVE';
}

/** Cómo se llama la variante hoy: "Rojo · M". Vacío si el producto no tiene ejes. */
function etiqueta(variant: VariantForLine): string {
  return variantLabel(variantValues(variant));
}

function lineLabel(variant: VariantForLine): string {
  const propia = etiqueta(variant);

  return propia ? `${variant.product.name} — ${propia}` : variant.product.name;
}

/** El precio sale siempre de la base: el de la variante si tiene, si no el del producto. */
function priceLine(variant: VariantForLine, qty: number): PricedLine {
  const unitPrice = variant.priceOverride ?? variant.product.basePrice;

  return {
    variantId: variant.id,
    productId: variant.product.id,
    productName: variant.product.name,
    productSlug: variant.product.slug,
    variantLabel: etiqueta(variant),
    sku: variant.sku,
    unitPrice,
    qty,
    lineTotal: unitPrice * qty,
  };
}

function toCreated(order: CreatedOrder): OrderCreatedDto {
  return {
    id: order.id,
    number: order.number,
    token: order.publicToken,
    subtotal: order.subtotal,
    discount: order.discount,
    shippingCost: order.shippingCost,
    total: order.total,
  };
}
