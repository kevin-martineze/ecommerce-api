import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StoreStatus, SubscriptionStatus } from '@prisma/client';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { QueryBoolean, Trim } from '@shared/dtos/transforms';

// ---------------------------------------------------------------------------
// Planes
// ---------------------------------------------------------------------------

export class PlanDto {
  @ApiProperty({ example: 'basico' })
  code!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ description: 'Mensualidad en pesos enteros.' })
  priceCop!: number;

  @ApiProperty({ nullable: true, description: 'Null: sin límite.' })
  maxProducts!: number | null;

  @ApiProperty({ nullable: true })
  maxOrdersPerMonth!: number | null;

  @ApiProperty({ nullable: true })
  maxImagesPerProduct!: number | null;

  @ApiProperty()
  customDomain!: boolean;

  @ApiProperty()
  active!: boolean;
}

// ---------------------------------------------------------------------------
// Lo que la tienda ve de su suscripción
// ---------------------------------------------------------------------------

export class PlanUsageDto {
  @ApiProperty()
  products!: number;

  @ApiProperty({ description: 'Pedidos desde el día 1 del mes, hora de Colombia.' })
  ordersThisMonth!: number;
}

export class SubscriptionSummaryDto {
  @ApiProperty({ type: PlanDto })
  plan!: PlanDto;

  @ApiProperty({ enum: SubscriptionStatus })
  status!: SubscriptionStatus;

  @ApiProperty({ enum: StoreStatus, description: 'Decide si la tienda pública responde.' })
  storeStatus!: StoreStatus;

  @ApiProperty({ description: 'Hasta cuándo está pago (o dura la prueba). Fecha, sin hora.' })
  currentPeriodEnd!: string;

  @ApiProperty({ nullable: true })
  trialEndsAt!: Date | null;

  @ApiProperty({ description: 'Días hasta el fin del período. Negativo si ya venció.' })
  daysLeft!: number;

  @ApiProperty({ type: PlanUsageDto })
  usage!: PlanUsageDto;
}

// ---------------------------------------------------------------------------
// Administración de la plataforma
// ---------------------------------------------------------------------------

export class PlatformStoreListQueryDto {
  @ApiPropertyOptional({ description: 'Nombre o slug de la tienda, o correo de una dueña.' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ enum: StoreStatus })
  @IsOptional()
  @IsIn(Object.values(StoreStatus))
  status?: StoreStatus;

  @ApiPropertyOptional({ default: false, description: 'Solo tiendas con el período vencido.' })
  @IsOptional()
  @QueryBoolean()
  overdue?: boolean;
}

export class PlatformMemberDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ nullable: true })
  fullName!: string | null;

  @ApiProperty({ enum: ['OWNER', 'STAFF'] })
  role!: string;
}

export class PlatformStoreDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty({ nullable: true })
  customDomain!: string | null;

  @ApiProperty({ enum: StoreStatus })
  status!: StoreStatus;

  @ApiProperty({ nullable: true })
  trialEndsAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({
    description: 'Código del plan. Null si la tienda no tiene suscripción.',
    nullable: true,
  })
  planCode!: string | null;

  @ApiProperty({ enum: SubscriptionStatus, nullable: true })
  subscriptionStatus!: SubscriptionStatus | null;

  @ApiProperty({ nullable: true, description: 'Fecha, sin hora.' })
  currentPeriodEnd!: string | null;

  @ApiProperty({ type: [PlatformMemberDto] })
  members!: PlatformMemberDto[];

  @ApiProperty()
  productCount!: number;

  @ApiProperty()
  orderCount!: number;
}

export class PaymentDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  amountCop!: number;

  @ApiProperty({ description: 'Fecha, sin hora.' })
  periodStart!: string;

  @ApiProperty({ description: 'Fecha, sin hora.' })
  periodEnd!: string;

  @ApiProperty()
  method!: string;

  @ApiProperty({ nullable: true })
  reference!: string | null;

  @ApiProperty({ nullable: true, description: 'Correo de quien lo registró.' })
  recordedBy!: string | null;

  @ApiProperty()
  createdAt!: Date;
}

export class PlatformStoreDetailDto extends PlatformStoreDto {
  @ApiProperty({ nullable: true })
  subscriptionNotes!: string | null;

  @ApiProperty({ type: [PaymentDto], description: 'Libro de asientos, el más nuevo primero.' })
  payments!: PaymentDto[];
}

export class UpdateStoreStatusDto {
  @ApiProperty({
    enum: ['ACTIVE', 'SUSPENDED'],
    description: 'Solo estos dos se fijan a mano; TRIAL y PAST_DUE los pone el sistema.',
  })
  @IsIn(['ACTIVE', 'SUSPENDED'], { message: 'Solo se puede activar o suspender.' })
  status!: 'ACTIVE' | 'SUSPENDED';
}

export class ChangePlanDto {
  @ApiProperty({ example: 'pro' })
  @Trim()
  @IsString()
  @Matches(/^[a-z0-9-]{2,40}$/, { message: 'El código del plan no es válido.' })
  planCode!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

/** Fecha sin hora, `YYYY-MM-DD`. La mensualidad se cuenta por días, no por horas. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class RecordPaymentDto {
  @ApiProperty({ example: 49000 })
  @IsInt({ message: 'El monto no lleva decimales.' })
  @Min(1, { message: 'El monto debe ser mayor que cero.' })
  @Max(100_000_000)
  amountCop!: number;

  @ApiProperty({ example: '2026-10-01', description: 'Primer día que cubre el pago.' })
  @Matches(DATE_ONLY, { message: 'La fecha va como AAAA-MM-DD.' })
  @IsISO8601({ strict: true })
  periodStart!: string;

  @ApiProperty({ example: '2026-10-31', description: 'Último día que cubre el pago.' })
  @Matches(DATE_ONLY, { message: 'La fecha va como AAAA-MM-DD.' })
  @IsISO8601({ strict: true })
  periodEnd!: string;

  @ApiProperty({ example: 'nequi', description: 'Texto libre: nequi, transferencia, efectivo…' })
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  method!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Número de comprobante.' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(120)
  reference?: string | null;
}

export class ReconcileQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Solo esta tienda. Sin él, todas: es lo que corre el cron.',
  })
  @IsOptional()
  @IsUUID()
  storeId?: string;
}

export class ReconcileResultDto {
  @ApiProperty({ description: 'Tiendas que pasaron a PAST_DUE en esta corrida.' })
  markedPastDue!: number;
}
