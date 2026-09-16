import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { TrimUpperCase } from '@shared/dtos/transforms';

export class CreateSizeDto {
  @ApiProperty({ example: 'XL', description: 'Se guarda en mayúsculas. Única por tienda.' })
  @TrimUpperCase()
  @IsString()
  @MinLength(1, { message: 'Escribe la talla.' })
  @MaxLength(12, { message: 'Máximo 12 caracteres.' })
  label!: string;

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

export class UpdateSizeDto extends PartialType(CreateSizeDto) {}

export class SizeDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty()
  sortOrder!: number;

  @ApiProperty()
  active!: boolean;

  @ApiProperty({
    description: 'Variantes que la usan. Con más de cero, quitarla la oculta en vez de borrarla.',
  })
  usageCount!: number;
}
