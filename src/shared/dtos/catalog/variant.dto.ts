import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

const MAX_STOCK = 9999;
const MAX_PRICE = 100_000_000;

/**
 * Arma la matriz color × talla de una prenda.
 *
 * Solo CREA las combinaciones que faltan; nunca borra las existentes, que
 * pueden estar dentro de un pedido. Mandar la misma matriz dos veces es seguro.
 */
export class GenerateVariantsDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayMinSize(1, { message: 'Elige al menos un color.' })
  @ArrayMaxSize(50)
  @IsUUID(undefined, { each: true })
  colorIds!: string[];

  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayMinSize(1, { message: 'Elige al menos una talla.' })
  @ArrayMaxSize(50)
  @IsUUID(undefined, { each: true })
  sizeIds!: string[];

  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: MAX_STOCK })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_STOCK)
  defaultStock?: number;
}

export class GenerateVariantsResultDto {
  @ApiProperty({ description: 'Combinaciones nuevas. Cero si ya estaban todas.' })
  created!: number;
}

export class UpdateVariantDto {
  @ApiPropertyOptional({ minimum: 0, maximum: MAX_STOCK })
  @IsOptional()
  @IsInt({ message: 'El stock es un número entero.' })
  @Min(0, { message: 'El stock no puede ser negativo.' })
  @Max(MAX_STOCK)
  stock?: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Precio propio de la variante. null vuelve al precio base de la prenda.',
  })
  @IsOptional()
  @IsInt({ message: 'El precio no lleva decimales.' })
  @Min(0, { message: 'El precio no puede ser negativo.' })
  @Max(MAX_PRICE, { message: 'Ese precio parece un error.' })
  priceOverride?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class VariantColorDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  hex!: string;
}

export class VariantSizeDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty()
  sortOrder!: number;
}

export class VariantDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  productId!: string;

  @ApiProperty({ nullable: true })
  sku!: string | null;

  @ApiProperty()
  stock!: number;

  @ApiProperty({ nullable: true })
  priceOverride!: number | null;

  @ApiProperty()
  active!: boolean;

  @ApiProperty({ type: VariantColorDto })
  color!: VariantColorDto;

  @ApiProperty({ type: VariantSizeDto })
  size!: VariantSizeDto;
}

export class DeleteVariantResultDto {
  @ApiProperty({
    enum: ['deleted', 'deactivated'],
    description: 'deactivated: estaba en pedidos, así que quedó inactiva y en cero.',
  })
  result!: 'deleted' | 'deactivated';
}
