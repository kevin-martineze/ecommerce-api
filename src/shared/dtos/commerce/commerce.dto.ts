import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { CouponType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Trim, TrimUpperCase } from '@shared/dtos/transforms';

const MAX_MONEY = 100_000_000;

// ---------------------------------------------------------------------------
// Cupones
// ---------------------------------------------------------------------------

export class CreateCouponDto {
  @ApiProperty({ example: 'VERANO10', description: 'Se guarda en mayúsculas.' })
  @TrimUpperCase()
  @IsString()
  @Matches(/^[A-Z0-9]{3,40}$/, { message: 'Solo letras y números, entre 3 y 40 caracteres.' })
  code!: string;

  @ApiProperty({ enum: CouponType })
  @IsEnum(CouponType, { message: 'Tipo de cupón inválido.' })
  type!: CouponType;

  @ApiProperty({ description: 'Porcentaje (1-100) o pesos, según el tipo.' })
  @IsInt({ message: 'El valor no lleva decimales.' })
  @Min(1, { message: 'El valor debe ser mayor que cero.' })
  @Max(MAX_MONEY)
  value!: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY)
  minSubtotal?: number;

  /** Con zona horaria (`2026-10-01T00:00:00-05:00`): sin ella la hora depende del servidor. */
  @ApiPropertyOptional({ nullable: true, example: '2026-10-01T00:00:00-05:00' })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'La fecha de inicio no es válida.' })
  startsAt?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-10-31T23:59:59-05:00' })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'La fecha de fin no es válida.' })
  endsAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  maxUses?: number | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/** El código no se edita: los pedidos lo guardan copiado y dejaría de coincidir. */
export class UpdateCouponDto extends PartialType(OmitType(CreateCouponDto, ['code'] as const)) {}

export class CouponAdminDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty({ enum: CouponType })
  type!: CouponType;

  @ApiProperty()
  value!: number;

  @ApiProperty()
  minSubtotal!: number;

  @ApiProperty({ nullable: true })
  startsAt!: Date | null;

  @ApiProperty({ nullable: true })
  endsAt!: Date | null;

  @ApiProperty({ nullable: true })
  maxUses!: number | null;

  @ApiProperty()
  uses!: number;

  @ApiProperty()
  active!: boolean;

  @ApiProperty()
  createdAt!: Date;
}

// ---------------------------------------------------------------------------
// Zonas de envío
// ---------------------------------------------------------------------------

export class CreateShippingZoneDto {
  @ApiProperty({ example: 'Bogotá' })
  @Trim()
  @IsString()
  @MinLength(2, { message: 'Ponle nombre a la zona.' })
  @MaxLength(80)
  name!: string;

  @ApiProperty({ example: 8000 })
  @IsInt({ message: 'El costo no lleva decimales.' })
  @Min(0, { message: 'El costo no puede ser negativo.' })
  @Max(MAX_MONEY)
  cost!: number;

  @ApiPropertyOptional({ nullable: true, description: 'Días estimados. Null lo oculta.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  etaDays?: number | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 999 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;
}

export class UpdateShippingZoneDto extends PartialType(CreateShippingZoneDto) {}

export class ShippingZoneAdminDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  cost!: number;

  @ApiProperty({ nullable: true })
  etaDays!: number | null;

  @ApiProperty()
  active!: boolean;

  @ApiProperty()
  sortOrder!: number;
}

/** Resultado de quitar un cupón o una zona. */
export class DeactivateOrDeleteResultDto {
  @ApiProperty({
    enum: ['deleted', 'deactivated'],
    description:
      'deactivated: ya se usó en pedidos, así que se desactivó para no romper el historial.',
  })
  result!: 'deleted' | 'deactivated';
}

// ---------------------------------------------------------------------------
// Avisos de reposición
// ---------------------------------------------------------------------------

export class RestockRequestAdminDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'Teléfono o correo que dejó la clienta.' })
  contact!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ nullable: true })
  notifiedAt!: Date | null;

  @ApiProperty()
  variantId!: string;

  @ApiProperty({ description: 'Stock actual: si es mayor que cero, ya se le puede escribir.' })
  stock!: number;

  @ApiProperty()
  productName!: string;

  @ApiProperty()
  productSlug!: string;

  @ApiProperty()
  colorName!: string;

  @ApiProperty()
  sizeLabel!: string;
}

export class UpdateRestockRequestDto {
  @ApiProperty({ description: 'true marca como avisada; false lo vuelve a pendiente.' })
  @IsBoolean()
  notified!: boolean;
}
