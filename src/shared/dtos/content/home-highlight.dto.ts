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
import { Trim } from '@shared/dtos/transforms';

export class CreateHomeHighlightDto {
  @ApiProperty({ example: 'Envíos' })
  @Trim()
  @IsString()
  @MinLength(2, { message: 'Escribe la etiqueta.' })
  @MaxLength(40)
  eyebrow!: string;

  @ApiProperty({ example: 'A todo el país' })
  @Trim()
  @IsString()
  @MinLength(2, { message: 'Escribe el título.' })
  @MaxLength(80)
  title!: string;

  @ApiProperty({ example: 'Calculamos el costo según tu ciudad antes de confirmar.' })
  @Trim()
  @IsString()
  @MinLength(2, { message: 'Escribe el texto.' })
  @MaxLength(300)
  body!: string;

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

export class UpdateHomeHighlightDto extends PartialType(CreateHomeHighlightDto) {}

export class HomeHighlightAdminDto {
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

  @ApiProperty()
  active!: boolean;
}
