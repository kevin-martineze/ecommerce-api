import { Order, OrderItem, Prisma } from '@prisma/client';
import { PublicOrderDto } from '@shared/dtos/orders/checkout.dto';
import { OrderAdminDto, OrderItemAdminDto } from '@shared/dtos/orders/order-admin.dto';

/** Las líneas de un pedido no tienen fecha propia: se muestran en un orden estable y legible. */
export const ITEMS_ORDER: Prisma.OrderItemOrderByWithRelationInput[] = [
  { productName: 'asc' },
  { colorName: 'asc' },
  { sizeLabel: 'asc' },
];

export function toOrderAdmin(order: Order): OrderAdminDto {
  return {
    id: order.id,
    number: order.number,
    publicToken: order.publicToken,
    status: order.status,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    customerCity: order.customerCity,
    customerAddress: order.customerAddress,
    customerNotes: order.customerNotes,
    shippingZoneId: order.shippingZoneId,
    shippingZoneName: order.shippingZoneName,
    shippingCost: order.shippingCost,
    couponCode: order.couponCode,
    subtotal: order.subtotal,
    discount: order.discount,
    total: order.total,
    whatsappOpenedAt: order.whatsappOpenedAt,
    adminNotes: order.adminNotes,
    paymentStatus: order.paymentStatus,
    paidAt: order.paidAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

export function toOrderItemAdmin(item: OrderItem): OrderItemAdminDto {
  return {
    id: item.id,
    variantId: item.variantId,
    productId: item.productId,
    productName: item.productName,
    productSlug: item.productSlug,
    colorName: item.colorName,
    sizeLabel: item.sizeLabel,
    sku: item.sku,
    unitPrice: item.unitPrice,
    qty: item.qty,
    lineTotal: item.lineTotal,
  };
}

/** Lo que ve la clienta. Se arma campo por campo para que nada interno se cuele. */
export function toPublicOrder(order: Order & { items: OrderItem[] }): PublicOrderDto {
  return {
    number: order.number,
    token: order.publicToken,
    status: order.status,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    customerCity: order.customerCity,
    customerAddress: order.customerAddress,
    customerNotes: order.customerNotes,
    shippingZoneName: order.shippingZoneName,
    shippingCost: order.shippingCost,
    couponCode: order.couponCode,
    subtotal: order.subtotal,
    discount: order.discount,
    total: order.total,
    whatsappOpenedAt: order.whatsappOpenedAt,
    paymentStatus: order.paymentStatus,
    paidAt: order.paidAt,
    createdAt: order.createdAt,
    items: order.items.map((item) => ({
      id: item.id,
      productName: item.productName,
      productSlug: item.productSlug,
      colorName: item.colorName,
      sizeLabel: item.sizeLabel,
      sku: item.sku,
      unitPrice: item.unitPrice,
      qty: item.qty,
      lineTotal: item.lineTotal,
    })),
  };
}

/** Un número de pedido que no cabe en la columna no existe: 404, no un 500 de Prisma. */
export function isStorableOrderNumber(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;
}
