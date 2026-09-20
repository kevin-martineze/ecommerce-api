import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

/**
 * Solo documenta el multipart en Swagger: los campos llegan junto al archivo y
 * se leen a mano en `readUpload`, no por el pipe de validación.
 */
export class UploadProductImageDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'La foto. Hasta 12 MB.' })
  file!: unknown;

  @ApiPropertyOptional({ format: 'uuid', description: 'Color al que corresponde la foto.' })
  optionValueId?: string;

  @ApiPropertyOptional({ description: 'Texto alternativo. Si no viene, el nombre de la prenda.' })
  alt?: string;
}

export class UploadHeroImageDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'La foto de portada. Hasta 12 MB.',
  })
  file!: unknown;
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
