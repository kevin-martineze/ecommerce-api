import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MAX_QTY_PER_LINE } from '@shared/commerce/pricing';
import { Trim } from '@shared/dtos/transforms';

/** Una línea del carrito: el navegador manda identificadores y cantidades, nunca precios. */
export class CartLineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID(undefined, { message: 'Alguna prenda del carrito no es válida.' })
  variantId!: string;

  @ApiProperty({ minimum: 1, maximum: MAX_QTY_PER_LINE })
  @IsInt({ message: 'La cantidad es un número entero.' })
  @Min(1)
  @Max(MAX_QTY_PER_LINE, { message: `Máximo ${MAX_QTY_PER_LINE} unidades por prenda.` })
  qty!: number;
}

export class CartQuoteDto {
  @ApiProperty({ type: [CartLineDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CartLineDto)
  items!: CartLineDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(40)
  couponCode?: string;

  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID(undefined, { message: 'La zona de envío no es válida.' })
  shippingZoneId?: string | null;
}

export class QuotedLineDto {
  @ApiProperty()
  variantId!: string;

  @ApiProperty()
  productId!: string;

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

  @ApiProperty({
    description: 'Precio de hoy, de la base: el propio de la variante o el de la prenda.',
  })
  unitPrice!: number;

  @ApiProperty()
  qty!: number;

  @ApiProperty()
  lineTotal!: number;

  @ApiProperty()
  stock!: number;

  @ApiProperty({ nullable: true })
  imageUrl!: string | null;

  @ApiProperty({ nullable: true, description: 'Cantidad pedida si hubo que recortarla al stock.' })
  adjustedFrom!: number | null;
}

export class RemovedLineDto {
  @ApiProperty()
  variantId!: string;

  @ApiProperty()
  label!: string;
}

export class AppliedCouponDto {
  @ApiProperty()
  code!: string;

  @ApiProperty({ enum: ['PERCENT', 'FIXED'] })
  type!: 'PERCENT' | 'FIXED';

  @ApiProperty()
  value!: number;

  @ApiProperty()
  discount!: number;
}

export class PublicShippingZoneDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  cost!: number;

  @ApiProperty({ nullable: true })
  etaDays!: number | null;
}

export class TotalsDto {
  @ApiProperty()
  subtotal!: number;

  @ApiProperty()
  discount!: number;

  @ApiProperty()
  shippingCost!: number;

  @ApiProperty()
  total!: number;
}

export class CartQuoteResultDto {
  @ApiProperty({ type: [QuotedLineDto] })
  lines!: QuotedLineDto[];

  @ApiProperty({ type: [RemovedLineDto], description: 'Prendas que ya no existen o se agotaron.' })
  removed!: RemovedLineDto[];

  @ApiProperty({ type: AppliedCouponDto, nullable: true })
  coupon!: AppliedCouponDto | null;

  @ApiProperty({
    nullable: true,
    enum: ['not_found', 'inactive', 'not_started', 'expired', 'exhausted', 'min_subtotal'],
  })
  couponRejection!: string | null;

  @ApiProperty({ nullable: true, description: 'El motivo en español, listo para mostrar.' })
  couponRejectionMessage!: string | null;

  @ApiProperty({ type: PublicShippingZoneDto, nullable: true })
  zone!: PublicShippingZoneDto | null;

  @ApiProperty({ type: TotalsDto })
  totals!: TotalsDto;
}

export class CustomerDto {
  @ApiProperty({ example: 'Ana Gómez' })
  @Trim()
  @IsString()
  @MinLength(2, { message: 'Escribe tu nombre.' })
  @MaxLength(120, { message: 'Ese nombre es demasiado largo.' })
  name!: string;

  /** Mismo patrón que `create_order`: se acepta como la clienta lo escriba. */
  @ApiProperty({ example: '300 123 4567' })
  @Trim()
  @IsString()
  @Matches(/^[0-9+ ()-]{7,20}$/, {
    message: 'El número solo puede tener dígitos, espacios, +, ( ) o -.',
  })
  phone!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500, { message: 'Máximo 500 caracteres.' })
  notes?: string;
}

export class CreateOrderDto {
  @ApiProperty({ type: CustomerDto })
  @ValidateNested()
  @Type(() => CustomerDto)
  customer!: CustomerDto;

  @ApiProperty({ format: 'uuid' })
  @IsUUID(undefined, { message: 'Elige una zona de envío.' })
  shippingZoneId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(40)
  couponCode?: string;

  @ApiProperty({ type: [CartLineDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Tu carrito está vacío.' })
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CartLineDto)
  items!: CartLineDto[];
}

export class OrderCreatedDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'Correlativo de la tienda.' })
  number!: number;

  @ApiProperty({ description: 'Token del enlace público del pedido.' })
  token!: string;

  @ApiProperty()
  subtotal!: number;

  @ApiProperty()
  discount!: number;

  @ApiProperty()
  shippingCost!: number;

  @ApiProperty()
  total!: number;
}

/** Detalle de un 409 `out_of_stock`: qué se pidió y qué queda. */
export class StockProblemDto {
  @ApiProperty()
  variantId!: string;

  @ApiProperty()
  requested!: number;

  @ApiProperty()
  available!: number;

  @ApiProperty()
  product!: string;

  @ApiProperty()
  color!: string;

  @ApiProperty()
  size!: string;
}

export class OrderTokenQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID(undefined, { message: 'Este enlace de pedido no es válido.' })
  token!: string;
}

export class PublicOrderItemDto {
  @ApiProperty({ description: 'Clave estable de la línea, para listarla.' })
  id!: string;

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

/** Lo que ve la clienta de su pedido. Sin notas internas ni datos de control. */
export class PublicOrderDto {
  @ApiProperty()
  number!: number;

  @ApiProperty()
  token!: string;

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

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ type: [PublicOrderItemDto] })
  items!: PublicOrderItemDto[];
}
