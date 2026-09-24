import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StoreStatus, SubscriptionStatus } from '@prisma/client';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
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

  @ApiProperty({ description: 'Respuestas del asistente al mes. 0: el plan no lo incluye.' })
  aiRepliesPerMonth!: number;

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

export class SubscriptionCheckoutDto {
  @ApiProperty({ description: 'La página de la pasarela. Se abre en el navegador de la dueña.' })
  url!: string;

  @ApiProperty({ description: 'Nuestra referencia del cobro. Vuelve en el evento de la pasarela.' })
  reference!: string;

  @ApiProperty()
  amountCop!: number;
}

export class SubscriptionPaymentDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  amountCop!: number;

  @ApiProperty({ description: 'Fecha, sin hora.' })
  periodStart!: string;

  @ApiProperty({ description: 'Fecha, sin hora.' })
  periodEnd!: string;

  @ApiProperty({ description: '`simulado` mientras no haya pasarela.' })
  method!: string;

  @ApiProperty()
  createdAt!: Date;
}

export class BillingSetupDto {
  @ApiProperty({ description: 'Si hoy se puede guardar una tarjeta. Con `false` no se ofrece.' })
  available!: boolean;

  @ApiProperty({ description: 'La llave con que el navegador tokeniza la tarjeta. Es pública.' })
  publicKey!: string;

  @ApiProperty({
    description: 'Contra dónde tokeniza el navegador. Vacío con la pasarela simulada.',
  })
  apiUrl!: string;

  @ApiProperty({ description: 'Los términos de la pasarela, firmados por ella. Caduca.' })
  acceptanceToken!: string;

  @ApiProperty({ description: 'Dónde se leen esos términos.' })
  termsUrl!: string;
}

export class PaymentMethodDto {
  @ApiProperty({ description: 'Si hay una tarjeta guardada con que cobrar el plan.' })
  connected!: boolean;

  @ApiProperty({ nullable: true, example: 'VISA' })
  brand!: string | null;

  @ApiProperty({ nullable: true, example: '4242', description: 'Los cuatro últimos, nada más.' })
  last4!: string | null;
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

  @ApiProperty({
    description: 'Si la tienda puede activar su plan sola (hay pasarela, aunque sea simulada).',
  })
  selfServiceBilling!: boolean;

  @ApiProperty({ type: PaymentMethodDto, description: 'Con qué se cobra el plan, si hay algo.' })
  paymentMethod!: PaymentMethodDto;

  @ApiProperty({ type: [SubscriptionPaymentDto], description: 'Sus pagos, el más nuevo primero.' })
  payments!: SubscriptionPaymentDto[];
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

// ---------------------------------------------------------------------------
// Resumen del negocio y pagos
// ---------------------------------------------------------------------------

export class StoreCountsDto {
  @ApiProperty()
  total!: number;

  @ApiProperty()
  trial!: number;

  @ApiProperty()
  active!: number;

  @ApiProperty()
  pastDue!: number;

  @ApiProperty()
  suspended!: number;
}

export class PlatformStoreRefDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty({ nullable: true, description: 'Correo de la primera dueña.' })
  ownerEmail!: string | null;
}

export class TrialEndingDto extends PlatformStoreRefDto {
  @ApiProperty()
  trialEndsAt!: Date;

  @ApiProperty({ description: 'Negativo si ya venció y el cron no ha pasado.' })
  daysLeft!: number;
}

export class OverdueStoreDto extends PlatformStoreRefDto {
  @ApiProperty({ nullable: true, description: 'Fecha, sin hora.' })
  currentPeriodEnd!: string | null;

  @ApiProperty({ description: 'Días desde que venció.' })
  daysOverdue!: number;
}

export class PlatformPaymentDto extends PaymentDto {
  @ApiProperty()
  storeId!: string;

  @ApiProperty()
  storeName!: string;

  @ApiProperty()
  storeSlug!: string;
}

export class PlatformDashboardDto {
  @ApiProperty({ type: StoreCountsDto })
  stores!: StoreCountsDto;

  @ApiProperty({ description: 'Tiendas con suscripción activa: ya pagaron al menos una vez.' })
  payingStores!: number;

  @ApiProperty({
    description:
      'Ingreso mensual recurrente: suma del plan de las tiendas que pagan y no están suspendidas.',
  })
  mrr!: number;

  @ApiProperty({ description: 'Pagos registrados este mes, hora de Colombia.' })
  revenueThisMonth!: number;

  @ApiProperty()
  revenueLastMonth!: number;

  @ApiProperty({
    type: [TrialEndingDto],
    description: 'Pruebas que terminan en 7 días o ya terminaron.',
  })
  trialsEnding!: TrialEndingDto[];

  @ApiProperty({ type: [OverdueStoreDto] })
  overdue!: OverdueStoreDto[];

  @ApiProperty({
    type: [PlatformPaymentDto],
    description: 'Los últimos 10 pagos, el más nuevo primero.',
  })
  recentPayments!: PlatformPaymentDto[];
}

export class PaymentsQueryDto {
  @ApiPropertyOptional({
    example: '2026-09',
    description: 'Mes de Colombia. Por defecto, el actual.',
  })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'El mes va como AAAA-MM.' })
  month?: string;
}

export class MonthPaymentsDto {
  @ApiProperty({ example: '2026-09' })
  month!: string;

  @ApiProperty({ description: 'Suma de los pagos del mes.' })
  total!: number;

  @ApiProperty({ type: [PlatformPaymentDto], description: 'El más nuevo primero.' })
  payments!: PlatformPaymentDto[];
}

// ---------------------------------------------------------------------------
// Lo que la tienda hace con su plan
// ---------------------------------------------------------------------------

export class SavePaymentMethodDto {
  @ApiProperty({
    description:
      'El token de la tarjeta, hecho en el navegador con la llave pública. La tarjeta no llega acá.',
  })
  @Trim()
  @IsString()
  @Length(8, 200, { message: 'El token de la tarjeta no es válido.' })
  cardToken!: string;

  @ApiProperty({ description: 'El token de aceptación de los términos de la pasarela.' })
  @Trim()
  @IsString()
  @Length(4, 5000, { message: 'Falta aceptar los términos de la pasarela.' })
  acceptanceToken!: string;
}

export class ActivatePlanDto {
  @ApiProperty({ example: 'pro', description: 'Plan que se activa y se cobra.' })
  @Trim()
  @IsString()
  @Matches(/^[a-z0-9-]{2,40}$/, { message: 'Elige un plan.' })
  planCode!: string;
}
