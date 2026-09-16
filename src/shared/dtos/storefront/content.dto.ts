import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { FacetCategoryDto, ProductCardDto } from '@shared/dtos/storefront/product.dto';
import { Trim } from '@shared/dtos/transforms';

export class PublicStoreDto {
  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;
}

export class PublicSettingsDto {
  @ApiProperty({ description: 'Número al que se abre el chat para cerrar la venta.' })
  whatsappPhone!: string;

  @ApiProperty({ nullable: true })
  instagramUrl!: string | null;

  @ApiProperty({ nullable: true, description: 'Barra de aviso de la cabecera.' })
  announcement!: string | null;

  @ApiProperty({ nullable: true })
  freeShippingThreshold!: number | null;

  @ApiProperty({
    nullable: true,
    description: 'Si hay colección elegida manda ella; si no, los textos.',
  })
  heroCollectionId!: string | null;

  @ApiProperty({ nullable: true })
  heroTitle!: string | null;

  @ApiProperty({ nullable: true })
  heroSubtitle!: string | null;
}

export class PublicCollectionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ nullable: true })
  heroImageUrl!: string | null;

  @ApiProperty()
  sortOrder!: number;
}

/** Lo que necesita el layout de la tienda en cada página, en una sola petición. */
export class StorefrontDto {
  @ApiProperty({ type: PublicStoreDto })
  store!: PublicStoreDto;

  @ApiProperty({ type: PublicSettingsDto })
  settings!: PublicSettingsDto;

  @ApiProperty({ type: [FacetCategoryDto] })
  categories!: FacetCategoryDto[];

  @ApiProperty({ type: [PublicCollectionDto] })
  collections!: PublicCollectionDto[];
}

export class HomeHighlightDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  eyebrow!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  body!: string;

  @ApiProperty()
  sortOrder!: number;
}

export class HomeDto {
  @ApiProperty({ type: [ProductCardDto] })
  featured!: ProductCardDto[];

  @ApiProperty({ type: [ProductCardDto] })
  newest!: ProductCardDto[];

  @ApiProperty({ type: [HomeHighlightDto] })
  highlights!: HomeHighlightDto[];
}

export class CollectionItemDto {
  @ApiProperty({
    nullable: true,
    description: 'Posición 0-100 sobre la foto. Null: solo va en la lista.',
  })
  hotspotX!: number | null;

  @ApiProperty({ nullable: true })
  hotspotY!: number | null;

  @ApiProperty({ type: ProductCardDto })
  product!: ProductCardDto;
}

export class PublicCollectionDetailDto extends PublicCollectionDto {
  @ApiProperty({ type: [CollectionItemDto], description: 'Solo prendas publicadas, en su orden.' })
  items!: CollectionItemDto[];
}

export class SitemapProductDto {
  @ApiProperty()
  slug!: string;

  @ApiProperty()
  updatedAt!: Date;
}

export class SitemapDto {
  @ApiProperty({ type: [SitemapProductDto] })
  products!: SitemapProductDto[];

  @ApiProperty({ type: [String] })
  collections!: string[];

  @ApiProperty({ type: [String] })
  categories!: string[];
}

export class CreateRestockRequestDto {
  @ApiProperty({ format: 'uuid', description: 'La variante agotada: color y talla.' })
  @IsUUID(undefined, { message: 'Elige color y talla.' })
  variantId!: string;

  /** Mismo rango que la política de la versión con Supabase: 5 a 120 caracteres. */
  @ApiProperty({
    example: '3001234567',
    description: 'Teléfono o correo, lo que prefiera la clienta.',
  })
  @Trim()
  @IsString()
  @MinLength(5, { message: 'Déjanos un teléfono o un correo para avisarte.' })
  @MaxLength(120)
  contact!: string;
}
