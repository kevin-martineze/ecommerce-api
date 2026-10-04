import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
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
  ValidateNested,
} from 'class-validator';
import { STOREFRONT_TEMPLATES } from '@shared/content/templates';
import {
  HEX_COLOR,
  THEME_CORNERS,
  THEME_FONTS,
  THEME_HEROES,
  ThemeCorners,
  ThemeFont,
  ThemeHero,
} from '@shared/content/theme';
import { Trim } from '@shared/dtos/transforms';

/** Lo que la tienda le ajusta a su plantilla. Cada `null` es «lo que diga la plantilla». */
export class StoreThemeDto {
  @ApiProperty({ nullable: true, example: '#1D4ED8', description: 'Color de la marca.' })
  accent!: string | null;

  @ApiProperty({ nullable: true, enum: THEME_FONTS, description: 'Pareja de letras.' })
  fonts!: ThemeFont | null;

  @ApiProperty({ nullable: true, enum: THEME_CORNERS })
  corners!: ThemeCorners | null;

  @ApiProperty({ nullable: true, enum: THEME_HEROES, description: 'Cómo se arma la portada.' })
  hero!: ThemeHero | null;
}

/**
 * Los ajustes se mandan siempre juntos y reemplazan a los anteriores: es un
 * solo formulario, y así quitar uno es mandarlo en `null` sin tener que pensar
 * en qué había antes.
 */
export class UpdateStoreThemeDto {
  @ApiPropertyOptional({ nullable: true, example: '#1D4ED8' })
  @IsOptional()
  @Matches(HEX_COLOR, { message: 'El color va en formato #RRGGBB.' })
  accent?: string | null;

  @ApiPropertyOptional({ nullable: true, enum: THEME_FONTS })
  @IsOptional()
  @IsIn(THEME_FONTS, { message: 'Elige una de las letras disponibles.' })
  fonts?: ThemeFont | null;

  @ApiPropertyOptional({ nullable: true, enum: THEME_CORNERS })
  @IsOptional()
  @IsIn(THEME_CORNERS, { message: 'Elige una de las esquinas disponibles.' })
  corners?: ThemeCorners | null;

  @ApiPropertyOptional({ nullable: true, enum: THEME_HEROES })
  @IsOptional()
  @IsIn(THEME_HEROES, { message: 'Elige una de las portadas disponibles.' })
  hero?: ThemeHero | null;
}

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

  @ApiProperty({ type: StoreThemeDto, description: 'Lo que la tienda le ajusta a su plantilla.' })
  theme!: StoreThemeDto;

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

  @ApiPropertyOptional({
    type: UpdateStoreThemeDto,
    nullable: true,
    description: 'Reemplaza los ajustes de la plantilla; `null` vuelve a la plantilla tal cual.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateStoreThemeDto)
  theme?: UpdateStoreThemeDto | null;
}
