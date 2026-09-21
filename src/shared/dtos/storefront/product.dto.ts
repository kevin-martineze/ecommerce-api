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

/**
 * Una muestra de color en la tarjeta.
 *
 * Sale de cualquier eje cuyos valores traigan tono, se llame "Color" o
 * "Acabado". Un producto sin ningún eje con tono —un libro— no trae ninguna,
 * y la tarjeta simplemente no pinta puntos.
 */
export class CardSwatchDto {
  @ApiProperty({ example: 'Rojo' })
  value!: string;

  @ApiProperty({ example: '#c0392b' })
  hex!: string;
}

/** Tarjeta de producto: lo mínimo para pintarla en una grilla. */
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

  @ApiProperty({ type: [CardSwatchDto], description: 'Tonos con alguna variante activa.' })
  swatches!: CardSwatchDto[];

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
    description:
      'Filtra por eje, como `Color:Rojo`. Se repite: ?options=Color:Rojo&options=Talla:M. ' +
      'Varios valores del MISMO eje suman (Rojo o Azul); ejes distintos restringen.',
    example: ['Color:Rojo', 'Talla:M'],
  })
  @IsOptional()
  @QueryArray()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  @Matches(/^[^:]+:[^:]+$/, {
    each: true,
    message: 'Cada filtro va como Eje:Valor, por ejemplo Color:Rojo.',
  })
  options?: string[];

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

export class FacetOptionValueDto {
  @ApiProperty({ example: 'Rojo' })
  value!: string;

  @ApiProperty({ nullable: true, example: '#c0392b' })
  hex!: string | null;

  @ApiProperty()
  sortOrder!: number;
}

/**
 * Un eje por el que se puede filtrar el catálogo.
 *
 * Se arma de los productos publicados, no de una lista de la tienda: si nadie
 * vende por talla, el filtro de talla no aparece. Los ejes son por producto,
 * así que se agrupan por NOMBRE —el "Color" de una camisa y el de otra son el
 * mismo filtro para quien navega—.
 */
export class FacetOptionDto {
  @ApiProperty({ example: 'Color' })
  name!: string;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty({ type: [FacetOptionValueDto] })
  values!: FacetOptionValueDto[];
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

  @ApiProperty({
    type: [FacetOptionDto],
    description: 'Los ejes que usan los productos publicados.',
  })
  options!: FacetOptionDto[];

  @ApiProperty({ type: PriceRangeDto, description: 'Entre los productos publicados.' })
  priceRange!: PriceRangeDto;
}

export class PublicProductImageDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    nullable: true,
    description: 'El valor de opción al que corresponde la foto, si corresponde a alguno.',
  })
  optionValueId!: string | null;

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

export class PublicOptionValueDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'Rojo' })
  value!: string;

  @ApiProperty({ nullable: true })
  hex!: string | null;

  @ApiProperty()
  sortOrder!: number;
}

/** Un eje de ESTE producto, con los valores que de verdad tiene en stock. */
export class PublicOptionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'Talla' })
  name!: string;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty({ type: [PublicOptionValueDto] })
  values!: PublicOptionValueDto[];
}

export class PublicAttributeDto {
  @ApiProperty({ example: 'Material' })
  name!: string;

  @ApiProperty({ example: 'Algodón' })
  value!: string;
}

export class VariantOptionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    type: [String],
    description:
      'Un valor por cada eje del producto. Es con lo que la ficha resuelve qué variante ' +
      'corresponde a la selección. Vacío si el producto no tiene ejes.',
  })
  valueIds!: string[];

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

  @ApiProperty({ type: [PublicOptionDto], description: 'Los ejes de este producto.' })
  options!: PublicOptionDto[];

  @ApiProperty({ type: [PublicAttributeDto], description: 'Material, ISBN, Origen…' })
  attributes!: PublicAttributeDto[];

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
