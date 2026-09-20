import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Trim } from '@shared/dtos/transforms';

export class CreateColorDto {
  @ApiProperty({ example: 'Verde oliva' })
  @Trim()
  @IsString()
  @MinLength(2, { message: 'Ponle nombre al color.' })
  @MaxLength(40)
  name!: string;

  /** Mismo patrón que el CHECK `colors_hex_format` de la base. */
  @ApiProperty({ example: '#6B7A3A', description: 'Formato #RRGGBB. Se guarda en mayúsculas.' })
  @Trim()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'El tono debe ser un color en formato #RRGGBB.' })
  hex!: string;

  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 999 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/**
 * Todo opcional: se cambia solo lo que viene.
 *
 * El slug no se edita: nace del nombre al crear y queda fijo, porque la tienda
 * pública filtra por él y ya puede estar en enlaces compartidos.
 */
export class UpdateColorDto extends PartialType(CreateColorDto) {}

export class ColorDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  hex!: string;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty()
  active!: boolean;

  @ApiProperty({
    description: 'Variantes que lo usan. Con más de cero, quitarlo lo oculta en vez de borrarlo.',
  })
  usageCount!: number;
}
