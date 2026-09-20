import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductStatus } from '@prisma/client';
import { IsBoolean, IsOptional } from 'class-validator';
import { QueryBoolean } from '@shared/dtos/transforms';

export class InventoryQueryDto {
  @ApiPropertyOptional({ default: false, description: 'Solo variantes con stock bajo.' })
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  lowStock?: boolean;
}

export class InventoryVariantDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true })
  sku!: string | null;

  @ApiProperty()
  stock!: number;

  @ApiProperty()
  active!: boolean;

  @ApiProperty({ example: 'Rojo · M', description: 'Vacío si el producto no tiene ejes.' })
  label!: string;

  @ApiProperty({ nullable: true, description: 'Tono del valor que sea un color, si lo hay.' })
  hex!: string | null;
}

export class InventoryGroupDto {
  @ApiProperty()
  productId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty({ enum: ProductStatus })
  status!: ProductStatus;

  @ApiProperty({ type: [InventoryVariantDto] })
  variants!: InventoryVariantDto[];
}

export class InventoryDto {
  @ApiProperty({
    description: 'Desde cuántas unidades hacia abajo una variante cuenta como stock bajo.',
  })
  lowStockThreshold!: number;

  @ApiProperty({
    type: [InventoryGroupDto],
    description: 'Agrupado por producto; primero las que tienen la variante más escasa.',
  })
  groups!: InventoryGroupDto[];
}
