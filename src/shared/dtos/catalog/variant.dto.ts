import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
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
 * Crea las combinaciones que faltan entre los ejes del producto.
 *
 * No recibe qué combinar: los ejes ya están declarados en el producto, y
 * repetirlos en la petición sería pedir que coincidan dos fuentes. Solo CREA
 * lo que falta; nunca borra, porque una variante puede estar en un pedido.
 * Mandarlo dos veces es seguro.
 */
export class GenerateVariantsDto {
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

export class CreateVariantDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Un valor por cada eje del producto. Vacío si el producto no tiene ejes.',
  })
  @IsArray()
  @ArrayMaxSize(3)
  @IsUUID(undefined, { each: true })
  optionValueIds!: string[];

  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: MAX_STOCK })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_STOCK)
  stock?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE)
  priceOverride?: number | null;
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
    description: 'Precio propio de la variante. null vuelve al precio base del producto.',
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

/** Un eje resuelto de la variante: "Color" vale "Rojo". */
export class VariantValueDto {
  @ApiProperty({ description: 'Id del valor, no del eje.' })
  id!: string;

  @ApiProperty()
  optionId!: string;

  @ApiProperty({ example: 'Color' })
  optionName!: string;

  @ApiProperty({ example: 'Rojo' })
  value!: string;

  @ApiProperty({ nullable: true })
  hex!: string | null;
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

  @ApiProperty({
    example: 'Rojo · M',
    description: 'Cómo nombrar la variante. Vacío si el producto no tiene ejes.',
  })
  label!: string;

  @ApiProperty({ type: [VariantValueDto] })
  values!: VariantValueDto[];
}

export class DeleteVariantResultDto {
  @ApiProperty({
    enum: ['deleted', 'deactivated'],
    description: 'deactivated: estaba en pedidos, así que quedó inactiva y en cero.',
  })
  result!: 'deleted' | 'deactivated';
}
