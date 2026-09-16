import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ORDERS_PER_PAGE,
  OrderDetailAdminDto,
  OrderListQueryDto,
  OrderPageDto,
  UpdateOrderDto,
} from '@shared/dtos/orders/order-admin.dto';
import { blankToNull } from '@shared/utils/text';
import { PrismaService, TenantClient } from '@db/prisma.service';

import {
  isStorableOrderNumber,
  ITEMS_ORDER,
  toOrderAdmin,
  toOrderItemAdmin,
} from './order-mapping';

const NOT_FOUND = 'Pedido no encontrado.';

/** Pedidos en el panel: listar, ver, cambiar estado y anotar. */
@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  list(storeId: string, query: OrderListQueryDto): Promise<OrderPageDto> {
    const page = query.page ?? 1;
    const filters = listFilters(query);

    return this.prisma.forStore(storeId, async (tx) => {
      const total = await tx.order.count({ where: { storeId, ...filters } });

      const orders = await tx.order.findMany({
        where: { storeId, ...filters },
        orderBy: [{ createdAt: 'desc' }, { number: 'desc' }],
        skip: (page - 1) * ORDERS_PER_PAGE,
        take: ORDERS_PER_PAGE,
      });

      return {
        orders: orders.map(toOrderAdmin),
        total,
        page,
        pageCount: Math.max(1, Math.ceil(total / ORDERS_PER_PAGE)),
        pageSize: ORDERS_PER_PAGE,
      };
    });
  }

  detail(storeId: string, orderId: string): Promise<OrderDetailAdminDto> {
    return this.prisma.forStore(storeId, async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, storeId },
        include: { items: { orderBy: ITEMS_ORDER } },
      });

      if (!order) {
        throw new NotFoundException(NOT_FOUND);
      }

      return { ...toOrderAdmin(order), items: order.items.map(toOrderItemAdmin) };
    });
  }

  /** Para abrir desde el panel el enlace público de un pedido, que solo trae el número. */
  async byNumber(storeId: string, number: number): Promise<OrderDetailAdminDto> {
    if (!isStorableOrderNumber(number)) {
      throw new NotFoundException(NOT_FOUND);
    }

    const found = await this.prisma.forStore(storeId, (tx) =>
      tx.order.findFirst({ where: { storeId, number }, select: { id: true } }),
    );

    if (!found) {
      throw new NotFoundException(NOT_FOUND);
    }

    return this.detail(storeId, found.id);
  }

  /**
   * Cambia estado y notas.
   *
   * Cancelar devuelve el stock y el uso del cupón, UNA sola vez: `stockRestored`
   * lo marca, y la fila del pedido se bloquea antes de leerlo para que dos
   * cancelaciones simultáneas no devuelvan el stock dos veces.
   *
   * Un pedido cancelado no se reabre. En la versión con Supabase se podía, y el
   * pedido volvía a "pendiente" con su stock ya devuelto al inventario: vendido
   * dos veces. Si hace falta, se crea un pedido nuevo.
   */
  update(storeId: string, orderId: string, dto: UpdateOrderDto): Promise<OrderDetailAdminDto> {
    return this.prisma.forStore(storeId, async (tx) => {
      await tx.$queryRaw`
        select id from orders where id = ${orderId}::uuid and store_id = ${storeId}::uuid for update`;

      const current = await tx.order.findFirst({
        where: { id: orderId, storeId },
        select: { status: true, stockRestored: true, couponId: true },
      });

      if (!current) {
        throw new NotFoundException(NOT_FOUND);
      }

      if (dto.status && current.status === 'CANCELLED' && dto.status !== 'CANCELLED') {
        throw new ConflictException(
          'Un pedido cancelado no se puede reabrir: su stock ya volvió al inventario.',
        );
      }

      const cancelling = dto.status === 'CANCELLED' && !current.stockRestored;

      if (cancelling) {
        await restoreStock(tx, storeId, orderId, current.couponId);
      }

      const order = await tx.order.update({
        where: { id: orderId, storeId },
        data: {
          status: dto.status ?? undefined,
          adminNotes: blankToNull(dto.adminNotes),
          ...(cancelling ? { stockRestored: true } : {}),
        },
        include: { items: { orderBy: ITEMS_ORDER } },
      });

      return { ...toOrderAdmin(order), items: order.items.map(toOrderItemAdmin) };
    });
  }
}

/**
 * Devuelve al inventario lo que el pedido había descontado.
 *
 * Las variantes que ya no existen (su prenda se borró, y la línea quedó con
 * `variantId` en null) se saltan: no hay dónde devolver ese stock.
 */
async function restoreStock(
  tx: TenantClient,
  storeId: string,
  orderId: string,
  couponId: string | null,
): Promise<void> {
  const items = await tx.orderItem.findMany({
    where: { storeId, orderId, variantId: { not: null } },
    select: { variantId: true, qty: true },
  });

  for (const item of items) {
    if (item.variantId) {
      await tx.variant.updateMany({
        where: { id: item.variantId, storeId },
        data: { stock: { increment: item.qty } },
      });
    }
  }

  if (couponId) {
    await tx.coupon.updateMany({
      where: { id: couponId, storeId, uses: { gt: 0 } },
      data: { uses: { decrement: 1 } },
    });
  }
}

/** Filtros del listado, sin `storeId`: ese va escrito en la consulta, a la vista. */
function listFilters(query: OrderListQueryDto): Prisma.OrderWhereInput {
  const search = query.q?.replace(/^#/, '') ?? '';
  const asNumber = Number(search);
  const byNumber = search !== '' && isStorableOrderNumber(asNumber);

  return {
    ...(query.status ? { status: query.status } : {}),
    ...(byNumber ? { number: asNumber } : {}),
    ...(search !== '' && !byNumber
      ? { customerName: { contains: search, mode: Prisma.QueryMode.insensitive } }
      : {}),
  };
}
