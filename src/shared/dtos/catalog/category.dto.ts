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

export class CreateCategoryDto {
  @ApiProperty({ example: 'Vestidos' })
  @Trim()
  @IsString()
  @MinLength(2, { message: 'Ponle nombre a la categoría.' })
  @MaxLength(60)
  name!: string;

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

/** El slug queda fijo al crear, igual que en colores: es la URL de la categoría. */
export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}

export class CategoryDto {
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

  @ApiProperty()
  active!: boolean;

  @ApiProperty({ description: 'Prendas asignadas a la categoría.' })
  usageCount!: number;
}
