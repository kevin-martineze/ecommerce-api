import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class RefreshDto {
  @ApiProperty({ description: 'El refresh token entregado en el login o en el refresh anterior.' })
  @IsString()
  @MinLength(20)
  @MaxLength(500)
  refreshToken!: string;
}

export class SwitchStoreDto {
  @ApiProperty({ description: 'Tienda a la que se quiere cambiar. Hay que ser miembro.' })
  @IsUUID()
  storeId!: string;
}
