import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { STOREFRONT_TEMPLATES } from '@shared/content/templates';
import { Trim } from '@shared/dtos/transforms';

export class StoreSettingsDto {
  @ApiProperty()
  storeName!: string;

  @ApiProperty()
  whatsappPhone!: string;

  @ApiProperty({ nullable: true })
  instagramUrl!: string | null;

  @ApiProperty({ nullable: true })
  announcement!: string | null;

  @ApiProperty({ nullable: true })
  freeShippingThreshold!: number | null;

  @ApiProperty({ nullable: true })
  heroCollectionId!: string | null;

  @ApiProperty({ nullable: true })
  heroTitle!: string | null;

  @ApiProperty({ nullable: true })
  heroSubtitle!: string | null;

  @ApiProperty({ enum: STOREFRONT_TEMPLATES, description: 'Diseño de la vitrina.' })
  template!: string;

  @ApiProperty({ description: 'Si la tienda tiene asistente: lo deciden su plan y la plataforma.' })
  assistant!: boolean;

  @ApiProperty()
  updatedAt!: Date;
}

/**
 * Ajustes de la tienda y textos de la portada. Todo opcional: se cambia solo lo
 * que viene. En los campos que admiten vacío, `null` o `''` los quitan.
 *
 * Nombre y WhatsApp no se pueden vaciar: una tienda sin nombre o sin número al
 * que escribir no puede vender.
 */
export class UpdateStoreSettingsDto {
  @ApiPropertyOptional({ example: 'Atelier Norte', description: 'Nombre visible de la tienda.' })
  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(2, { message: 'Escribe el nombre de la tienda.' })
  @MaxLength(80)
  storeName?: string;

  @ApiPropertyOptional({ example: '573001234567' })
  @IsOptional()
  @Trim()
  @IsString()
  @Matches(/^[0-9]{10,15}$/, {
    message: 'Escribe el número con indicativo y sin símbolos. Ej: 573001234567',
  })
  whatsappPhone?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Trim()
  @ValidateIf((_dto, value) => value !== '')
  @IsUrl({ require_protocol: true }, { message: 'Escribe una URL válida.' })
  @MaxLength(300)
  instagramUrl?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Barra de aviso de la cabecera.' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(160, { message: 'Máximo 160 caracteres.' })
  announcement?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Desde este subtotal el envío es gratis.' })
  @IsOptional()
  @IsInt({ message: 'El valor no lleva decimales.' })
  @Min(0)
  @Max(100_000_000)
  freeShippingThreshold?: number | null;

  @ApiPropertyOptional({ nullable: true, format: 'uuid', description: 'Colección de la portada.' })
  @IsOptional()
  @IsUUID(undefined, { message: 'La colección no es válida.' })
  heroCollectionId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(120, { message: 'Máximo 120 caracteres.' })
  heroTitle?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(300, { message: 'Máximo 300 caracteres.' })
  heroSubtitle?: string | null;

  @ApiPropertyOptional({ enum: STOREFRONT_TEMPLATES, description: 'Diseño de la vitrina.' })
  @IsOptional()
  @Trim()
  @IsIn(STOREFRONT_TEMPLATES, { message: 'Elige una de las plantillas disponibles.' })
  template?: string;
}
