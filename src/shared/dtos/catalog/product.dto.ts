import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ProductStatus } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ProductAttributeDto, ProductOptionDto } from '@shared/dtos/catalog/product-option.dto';
import { VariantDto } from '@shared/dtos/catalog/variant.dto';
import { Trim } from '@shared/dtos/transforms';
import { SLUG_MAX_LENGTH } from '@shared/utils/slug';

/** Techo de cordura para un precio en pesos. Por encima, casi seguro sobra un cero. */
const MAX_PRICE = 100_000_000;

export class CreateProductDto {
  @ApiProperty({ example: 'Vestido Lino Arena' })
  @Trim()
  @IsString()
  @MinLength(2, { message: 'Ponle nombre al producto.' })
  @MaxLength(120)
  name!: string;

  /**
   * Opcional: sin él se deriva del nombre y se numera si ya existe. Si viene y
   * choca con otro producto, es 409: quien lo escribió a mano quería ESE slug.
   *
   * El patrón es el mismo, laxo, del panel actual y no uno más estricto, para
   * no rechazar slugs que ya existen al migrar los datos.
   */
  @ApiPropertyOptional({ example: 'vestido-lino-arena' })
  @IsOptional()
  @Trim()
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'El slug solo admite minúsculas, números y guiones.' })
  @MaxLength(SLUG_MAX_LENGTH)
  slug?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID(undefined, { message: 'La categoría no es válida.' })
  categoryId?: string | null;

  @ApiProperty({ example: 189000, description: 'Pesos enteros.' })
  @IsInt({ message: 'El precio no lleva decimales.' })
  @Min(0, { message: 'El precio no puede ser negativo.' })
  @Max(MAX_PRICE, { message: 'Ese precio parece un error.' })
  basePrice!: number;

  @ApiPropertyOptional({
    nullable: true,
    example: 229000,
    description: 'Precio tachado. Tiene que ser mayor que basePrice; 0 o null lo quitan.',
  })
  @IsOptional()
  @IsInt({ message: 'El precio no lleva decimales.' })
  @Min(0, { message: 'El precio no puede ser negativo.' })
  @Max(MAX_PRICE, { message: 'Ese precio parece un error.' })
  compareAtPrice?: number | null;

  @ApiPropertyOptional({ enum: ProductStatus, default: ProductStatus.DRAFT })
  @IsOptional()
  @IsEnum(ProductStatus, { message: 'Estado de producto inválido.' })
  status?: ProductStatus;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  featured?: boolean;
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}

export class ProductListQueryDto {
  @ApiPropertyOptional({ description: 'Busca por nombre, sin distinguir mayúsculas.' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(120)
  q?: string;
}

export class CategoryRefDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

export class ProductListItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ProductStatus })
  status!: ProductStatus;

  @ApiProperty()
  featured!: boolean;

  @ApiProperty()
  basePrice!: number;

  @ApiProperty({ nullable: true })
  compareAtPrice!: number | null;

  @ApiProperty({ type: CategoryRefDto, nullable: true })
  category!: CategoryRefDto | null;

  @ApiProperty()
  variantCount!: number;

  @ApiProperty({ description: 'Suma del stock de todas las variantes.' })
  totalStock!: number;

  @ApiProperty({ nullable: true, description: 'Miniatura de la primera foto.' })
  thumbnailUrl!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class ProductImageDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true })
  optionValueId!: string | null;

  @ApiProperty()
  storagePath!: string;

  @ApiProperty()
  urlFull!: string;

  @ApiProperty()
  urlCard!: string;

  @ApiProperty()
  urlThumb!: string;

  @ApiProperty({ nullable: true })
  lqip!: string | null;

  @ApiProperty({ nullable: true })
  alt!: string | null;

  @ApiProperty()
  sortOrder!: number;
}

export class ProductDetailDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ nullable: true })
  categoryId!: string | null;

  @ApiProperty()
  basePrice!: number;

  @ApiProperty({ nullable: true })
  compareAtPrice!: number | null;

  @ApiProperty({ enum: ProductStatus })
  status!: ProductStatus;

  @ApiProperty()
  featured!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiProperty({ type: [ProductImageDto], description: 'En su orden; la primera es la principal.' })
  images!: ProductImageDto[];

  @ApiProperty({ type: [ProductOptionDto], description: 'Los ejes por los que se divide.' })
  options!: ProductOptionDto[];

  @ApiProperty({ type: [ProductAttributeDto], description: 'Datos sueltos: Material, ISBN…' })
  attributes!: ProductAttributeDto[];

  @ApiProperty({ type: [VariantDto], description: 'Ordenadas por sus ejes.' })
  variants!: VariantDto[];
}

export class DeleteProductResultDto {
  @ApiProperty({
    enum: ['deleted', 'archived'],
    description:
      'archived: el producto está en pedidos, así que se archivó para no perder el rastro.',
  })
  result!: 'deleted' | 'archived';
}
