import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { QueryArray, QueryInt, Trim } from '@shared/dtos/transforms';

/** Mismo tamaño de página que la tienda actual. */
export const PRODUCTS_PER_PAGE = 12;

export const PRODUCT_SORTS = ['newest', 'price-asc', 'price-desc', 'name'] as const;

export type ProductSort = (typeof PRODUCT_SORTS)[number];

const MAX_PRICE = 100_000_000;

export class CardImageDto {
  @ApiProperty()
  urlCard!: string;

  @ApiProperty()
  urlThumb!: string;

  @ApiProperty({ nullable: true })
  lqip!: string | null;

  @ApiProperty({ nullable: true })
  alt!: string | null;
}

export class CardColorDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  hex!: string;
}

/** Tarjeta de prenda: lo mínimo para pintarla en una grilla. */
export class ProductCardDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ description: 'Precio base en pesos enteros.' })
  price!: number;

  @ApiProperty({ nullable: true })
  compareAtPrice!: number | null;

  @ApiProperty({ type: [CardImageDto], description: 'Las dos primeras fotos, en su orden.' })
  images!: CardImageDto[];

  @ApiProperty({ type: [CardColorDto], description: 'Colores con alguna variante activa.' })
  colors!: CardColorDto[];

  @ApiProperty({ description: 'Si alguna variante activa tiene stock.' })
  inStock!: boolean;
}

export class ProductSearchQueryDto {
  @ApiPropertyOptional({ description: 'Slug de categoría. Oculta o inexistente: lista vacía.' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(80)
  category?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Slugs de color. Se repite: ?colors=a&colors=b',
  })
  @IsOptional()
  @QueryArray()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  colors?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Etiquetas de talla, sin distinguir mayúsculas.',
  })
  @IsOptional()
  @QueryArray()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(12, { each: true })
  sizes?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @QueryInt()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE)
  minPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @QueryInt()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE)
  maxPrice?: number;

  @ApiPropertyOptional({ enum: PRODUCT_SORTS, default: 'newest' })
  @IsOptional()
  @IsIn(PRODUCT_SORTS)
  sort?: ProductSort;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @QueryInt()
  @IsInt()
  @Min(1)
  @Max(1000)
  page?: number;

  @ApiPropertyOptional({ description: 'Busca por nombre.' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(120)
  q?: string;
}

export class ProductPageDto {
  @ApiProperty({ type: [ProductCardDto] })
  products!: ProductCardDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageCount!: number;

  @ApiProperty()
  pageSize!: number;
}

export class FacetCategoryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  parentId!: string | null;

  @ApiProperty()
  sortOrder!: number;
}

export class FacetColorDto extends CardColorDto {
  @ApiProperty()
  sortOrder!: number;
}

export class FacetSizeDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty()
  sortOrder!: number;
}

export class PriceRangeDto {
  @ApiProperty()
  min!: number;

  @ApiProperty()
  max!: number;
}

export class CatalogFacetsDto {
  @ApiProperty({ type: [FacetCategoryDto] })
  categories!: FacetCategoryDto[];

  @ApiProperty({ type: [FacetColorDto] })
  colors!: FacetColorDto[];

  @ApiProperty({ type: [FacetSizeDto] })
  sizes!: FacetSizeDto[];

  @ApiProperty({ type: PriceRangeDto, description: 'Entre las prendas publicadas.' })
  priceRange!: PriceRangeDto;
}

export class PublicProductImageDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true })
  colorId!: string | null;

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

export class VariantOptionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  colorId!: string;

  @ApiProperty()
  sizeId!: string;

  @ApiProperty({ nullable: true })
  sku!: string | null;

  @ApiProperty()
  stock!: number;

  @ApiProperty({ description: 'Precio final de la variante: su precio propio o el base.' })
  price!: number;
}

export class PublicProductDetailDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ nullable: true })
  material!: string | null;

  @ApiProperty({ nullable: true })
  care!: string | null;

  @ApiProperty()
  basePrice!: number;

  @ApiProperty({ nullable: true })
  compareAtPrice!: number | null;

  @ApiProperty({
    nullable: true,
    description: 'Null si no tiene categoría o la categoría está oculta.',
  })
  categoryName!: string | null;

  @ApiProperty({ nullable: true })
  categorySlug!: string | null;

  @ApiProperty({ type: [PublicProductImageDto] })
  images!: PublicProductImageDto[];

  @ApiProperty({ type: [FacetColorDto] })
  colors!: FacetColorDto[];

  @ApiProperty({ type: [FacetSizeDto] })
  sizes!: FacetSizeDto[];

  @ApiProperty({ type: [VariantOptionDto], description: 'Solo variantes activas.' })
  variants!: VariantOptionDto[];
}

/** Fichas frescas para una lista de slugs guardada en el navegador (favoritos). */
export class ProductLookupDto {
  @ApiProperty({ type: [String], maxItems: 60 })
  @IsArray()
  @ArrayMaxSize(60)
  @Matches(/^[a-z0-9-]{1,80}$/, { each: true, message: 'Algún slug no es válido.' })
  slugs!: string[];
}
