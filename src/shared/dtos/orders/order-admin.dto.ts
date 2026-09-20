import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderPaymentStatus, OrderStatus } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { QueryInt, Trim } from '@shared/dtos/transforms';

export const ORDERS_PER_PAGE = 20;

export class OrderListQueryDto {
  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus, { message: 'Estado inválido.' })
  status?: OrderStatus;

  @ApiPropertyOptional({ description: 'Número de pedido (con o sin #) o parte del nombre.' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @QueryInt()
  @IsInt()
  @Min(1)
  @Max(1000)
  page?: number;
}

export class OrderItemAdminDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true })
  variantId!: string | null;

  @ApiProperty({ nullable: true })
  productId!: string | null;

  @ApiProperty()
  productName!: string;

  @ApiProperty()
  productSlug!: string;

  @ApiProperty()
  colorName!: string;

  @ApiProperty()
  sizeLabel!: string;

  @ApiProperty({ nullable: true })
  sku!: string | null;

  @ApiProperty()
  unitPrice!: number;

  @ApiProperty()
  qty!: number;

  @ApiProperty()
  lineTotal!: number;
}

export class OrderAdminDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  number!: number;

  @ApiProperty()
  publicToken!: string;

  @ApiProperty({ enum: OrderStatus })
  status!: OrderStatus;

  @ApiProperty()
  customerName!: string;

  @ApiProperty()
  customerPhone!: string;

  @ApiProperty({ nullable: true })
  customerCity!: string | null;

  @ApiProperty({ nullable: true })
  customerAddress!: string | null;

  @ApiProperty({ nullable: true })
  customerNotes!: string | null;

  @ApiProperty({ nullable: true })
  shippingZoneId!: string | null;

  @ApiProperty({ nullable: true })
  shippingZoneName!: string | null;

  @ApiProperty()
  shippingCost!: number;

  @ApiProperty({ nullable: true })
  couponCode!: string | null;

  @ApiProperty()
  subtotal!: number;

  @ApiProperty()
  discount!: number;

  @ApiProperty()
  total!: number;

  @ApiProperty({ nullable: true })
  whatsappOpenedAt!: Date | null;

  @ApiProperty({ nullable: true })
  adminNotes!: string | null;

  @ApiProperty({
    enum: OrderPaymentStatus,
    description: 'Cómo va el cobro. Una venta contra entrega va confirmada y sin pagar.',
  })
  paymentStatus!: OrderPaymentStatus;

  @ApiProperty({ nullable: true })
  paidAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class OrderDetailAdminDto extends OrderAdminDto {
  @ApiProperty({ type: [OrderItemAdminDto] })
  items!: OrderItemAdminDto[];
}

export class OrderPageDto {
  @ApiProperty({ type: [OrderAdminDto] })
  orders!: OrderAdminDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageCount!: number;

  @ApiProperty()
  pageSize!: number;
}

export class UpdateOrderDto {
  @ApiPropertyOptional({
    enum: OrderStatus,
    description: 'CANCELLED devuelve el stock y el uso del cupón, una sola vez.',
  })
  @IsOptional()
  @IsEnum(OrderStatus, { message: 'Estado inválido.' })
  status?: OrderStatus;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(1000, { message: 'Máximo 1000 caracteres.' })
  adminNotes?: string | null;
}

export class LowStockDto {
  @ApiProperty()
  variantId!: string;

  @ApiProperty()
  stock!: number;

  @ApiProperty()
  productName!: string;

  @ApiProperty()
  colorName!: string;

  @ApiProperty()
  sizeLabel!: string;
}

export class DashboardDto {
  @ApiProperty()
  pendingOrders!: number;

  @ApiProperty({ description: 'Pendientes con más de 24 horas: retienen stock sin avanzar.' })
  stalePendingOrders!: number;

  @ApiProperty({ description: 'Ventas no canceladas desde el día 1 del mes, hora de Colombia.' })
  monthRevenue!: number;

  @ApiProperty()
  monthOrders!: number;

  @ApiProperty({ type: [LowStockDto] })
  lowStock!: LowStockDto[];

  @ApiProperty()
  pendingRestock!: number;
}
