import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Trim } from '@shared/dtos/transforms';
import { SLUG_MAX_LENGTH } from '@shared/utils/slug';

export class CreateCollectionDto {
  @ApiProperty({ example: 'Temporada clara' })
  @Trim()
  @IsString()
  @MinLength(2, { message: 'Ponle nombre a la colección.' })
  @MaxLength(80)
  name!: string;

  /** Sin slug se deriva del nombre y se numera; uno escrito a mano que choca es 409. */
  @ApiPropertyOptional({ example: 'temporada-clara' })
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
  @MaxLength(1000)
  description?: string | null;

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

  /**
   * Foto de portada ya subida al almacenamiento (puente hasta la fase de
   * medios). URL y ruta van juntas: una sin la otra deja un archivo que nadie
   * sabe borrar, o una foto que no se ve.
   */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUrl(
    { require_protocol: true, require_tld: false, protocols: ['http', 'https'] },
    { message: 'La URL de la foto no es válida.' },
  )
  @MaxLength(500)
  heroImageUrl?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  heroStoragePath?: string | null;
}

/** El slug no se edita: es la URL pública de la colección. */
export class UpdateCollectionDto extends PartialType(
  OmitType(CreateCollectionDto, ['slug'] as const),
) {}

export class SetCollectionProductDto {
  @ApiPropertyOptional({
    nullable: true,
    minimum: 0,
    maximum: 100,
    description: 'Posición horizontal sobre la foto, en %.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'La posición admite hasta dos decimales.' })
  @Min(0)
  @Max(100)
  hotspotX?: number | null;

  @ApiPropertyOptional({ nullable: true, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'La posición admite hasta dos decimales.' })
  @Min(0)
  @Max(100)
  hotspotY?: number | null;

  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 999 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;
}

export class CollectionItemAdminDto {
  @ApiProperty()
  productId!: string;

  @ApiProperty()
  productName!: string;

  @ApiProperty()
  productSlug!: string;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty({ nullable: true })
  hotspotX!: number | null;

  @ApiProperty({ nullable: true })
  hotspotY!: number | null;
}

export class CollectionAdminDto {
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

  @ApiProperty({ nullable: true })
  heroStoragePath!: string | null;

  @ApiProperty()
  active!: boolean;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ type: [CollectionItemAdminDto] })
  items!: CollectionItemAdminDto[];
}

export class UpdateCollectionResultDto {
  @ApiProperty({ type: CollectionAdminDto })
  collection!: CollectionAdminDto;

  @ApiProperty({
    nullable: true,
    description:
      'Ruta de la foto anterior si se reemplazó o quitó: hay que borrarla del almacenamiento.',
  })
  replacedHeroStoragePath!: string | null;
}

export class DeleteCollectionResultDto {
  @ApiProperty({ type: [String], description: 'Archivos que quedaron sin fila y hay que borrar.' })
  storagePaths!: string[];
}
