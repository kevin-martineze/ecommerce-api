import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsHexColor,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';

/**
 * Los ejes por los que se divide un producto.
 *
 * Son del PRODUCTO y no de la tienda: una tienda de ropa declara Color y
 * Variación, una librería declara Formato, una tostadora declara Molienda y Peso.
 * El modelo no conoce ningún rubro de antemano.
 */

/** Cuántos ejes admite un producto. Tres ya es Shopify; cuatro no lo pide nadie. */
const MAX_OPCIONES = 3;

/** Valores por eje. Cuarenta variaciones es mucho; cien es un error de carga. */
const MAX_VALORES = 50;

export class ProductOptionValueDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  value!: string;

  @ApiProperty({ nullable: true, description: 'Solo cuando el valor es un color.' })
  hex!: string | null;

  @ApiProperty()
  sortOrder!: number;
}

export class ProductOptionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'Variación' })
  name!: string;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty({ type: [ProductOptionValueDto] })
  values!: ProductOptionValueDto[];
}

export class OptionValueInputDto {
  @ApiProperty({ example: 'M' })
  @IsString()
  @Length(1, 60, { message: 'Cada valor lleva entre 1 y 60 caracteres.' })
  value!: string;

  @ApiPropertyOptional({ example: '#1c3d99', description: 'Solo si el valor es un color.' })
  @IsOptional()
  @IsHexColor({ message: 'El color va en formato #rrggbb.' })
  hex?: string;
}

export class OptionInputDto {
  @ApiProperty({ example: 'Variación' })
  @IsString()
  @Length(1, 40, { message: 'El nombre del eje lleva entre 1 y 40 caracteres.' })
  name!: string;

  @ApiProperty({ type: [OptionValueInputDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Un eje sin valores no divide nada.' })
  @ArrayMaxSize(MAX_VALORES)
  @ValidateNested({ each: true })
  @Type(() => OptionValueInputDto)
  values!: OptionValueInputDto[];
}

/**
 * Reemplaza los ejes del producto por los que vengan.
 *
 * Es declarativo y no incremental —se manda la lista entera— porque la pantalla
 * que lo usa edita la lista entera. Un valor que alguna variante ya usa no se
 * puede quitar: la base lo impide y el servicio lo explica.
 */
export class SetProductOptionsDto {
  @ApiProperty({ type: [OptionInputDto] })
  @IsArray()
  @ArrayMaxSize(MAX_OPCIONES, { message: `Un producto admite hasta ${MAX_OPCIONES} ejes.` })
  @ValidateNested({ each: true })
  @Type(() => OptionInputDto)
  options!: OptionInputDto[];
}

export class ProductAttributeDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'Material' })
  name!: string;

  @ApiProperty({ example: 'Algodón' })
  value!: string;

  @ApiProperty()
  sortOrder!: number;
}

export class AttributeInputDto {
  @ApiProperty({ example: 'Material' })
  @IsString()
  @Length(1, 40)
  name!: string;

  @ApiProperty({ example: 'Algodón' })
  @IsString()
  @Length(1, 200)
  value!: string;
}

/** Reemplaza los datos sueltos del producto. Mismo criterio que las opciones. */
export class SetProductAttributesDto {
  @ApiProperty({ type: [AttributeInputDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AttributeInputDto)
  attributes!: AttributeInputDto[];
}
