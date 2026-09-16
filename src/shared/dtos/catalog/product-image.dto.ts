import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Trim } from '@shared/dtos/transforms';

const IMAGE_URL = { require_protocol: true, require_tld: false, protocols: ['http', 'https'] };

/**
 * Registra una foto que el panel YA subió al almacenamiento.
 *
 * Es un puente hasta la fase de medios: hoy el frontend convierte la foto con
 * `sharp` y la sube a Supabase Storage, y la API solo guarda dónde quedó. Cuando
 * la subida pase a la API, este endpoint desaparece.
 */
export class AddProductImageDto {
  @ApiProperty({ description: 'Ruta base en el almacenamiento, sin sufijo de tamaño.' })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  storagePath!: string;

  @ApiProperty()
  @IsUrl(IMAGE_URL, { message: 'La URL de la foto no es válida.' })
  @MaxLength(500)
  urlFull!: string;

  @ApiProperty()
  @IsUrl(IMAGE_URL, { message: 'La URL de la foto no es válida.' })
  @MaxLength(500)
  urlCard!: string;

  @ApiProperty()
  @IsUrl(IMAGE_URL, { message: 'La URL de la foto no es válida.' })
  @MaxLength(500)
  urlThumb!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Miniatura borrosa embebida (data URI).' })
  @IsOptional()
  @Matches(/^data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+$/, { message: 'La miniatura no es válida.' })
  @MaxLength(8000)
  lqip?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  alt?: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'uuid', description: 'Color al que corresponde.' })
  @IsOptional()
  @IsUUID(undefined, { message: 'El color no es válido.' })
  colorId?: string | null;
}

export class ReorderProductImagesDto {
  @ApiProperty({
    type: [String],
    description: 'Todas las fotos de la prenda, una vez cada una, en el orden nuevo.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID(undefined, { each: true })
  imageIds!: string[];
}

export class DeleteProductImageResultDto {
  @ApiProperty({
    description: 'Ruta del archivo que quedó sin fila: hay que borrarlo del almacenamiento.',
  })
  storagePath!: string;
}
