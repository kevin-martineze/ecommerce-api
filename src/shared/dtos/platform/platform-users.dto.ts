import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MemberRole, StoreStatus } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Trim } from '@shared/dtos/transforms';

// ---------------------------------------------------------------------------
// Cuentas de la plataforma
// ---------------------------------------------------------------------------

export const USER_STATUSES = ['active', 'disabled'] as const;

export type UserStatusFilter = (typeof USER_STATUSES)[number];

export class PlatformUserListQueryDto {
  @ApiPropertyOptional({
    description: 'Correo o nombre de la cuenta, o nombre o slug de su tienda.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ enum: USER_STATUSES })
  @IsOptional()
  @IsIn(USER_STATUSES, { message: 'El estado es activa o deshabilitada.' })
  status?: UserStatusFilter;
}

export class PlatformUserMembershipDto {
  @ApiProperty()
  storeId!: string;

  @ApiProperty()
  storeName!: string;

  @ApiProperty()
  storeSlug!: string;

  @ApiProperty({ enum: StoreStatus })
  storeStatus!: StoreStatus;

  @ApiProperty({ enum: MemberRole })
  role!: MemberRole;
}

export class PlatformUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ nullable: true })
  fullName!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ nullable: true, description: 'Null: la cuenta está activa.' })
  disabledAt!: Date | null;

  @ApiProperty({ nullable: true, description: 'Última sesión abierta o renovada. Null: nunca.' })
  lastSignInAt!: Date | null;

  @ApiProperty()
  hasPassword!: boolean;

  @ApiProperty()
  hasGoogle!: boolean;

  @ApiProperty({
    description: 'Administra la plataforma: no se deshabilita ni se elimina desde aquí.',
  })
  isPlatformAdmin!: boolean;

  @ApiProperty({ type: [PlatformUserMembershipDto] })
  memberships!: PlatformUserMembershipDto[];
}

export class PlatformStoreRefDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;
}

export class PlatformUserDetailDto extends PlatformUserDto {
  @ApiProperty({
    type: [PlatformStoreRefDto],
    description: 'Tiendas donde es la única dueña: se eliminan junto con la cuenta.',
  })
  soleOwnerStores!: PlatformStoreRefDto[];
}

export class UpdateUserStatusDto {
  @ApiProperty({ description: 'true deshabilita y cierra todas sus sesiones; false la reactiva.' })
  @IsBoolean({ message: 'Indica si la cuenta queda deshabilitada.' })
  disabled!: boolean;
}

export class DeleteUserDto {
  @ApiProperty({ description: 'El correo de la cuenta, escrito a mano para confirmar.' })
  @Trim()
  @IsString()
  @MinLength(1, { message: 'Escribe el correo de la cuenta para confirmar.' })
  @MaxLength(320)
  confirmEmail!: string;

  @ApiProperty({
    type: [String],
    description:
      'Las tiendas que se eliminan con ella, tal como las mostró la ficha. Si no coinciden con `soleOwnerStores`, 409.',
  })
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true, message: 'Una de las tiendas no es válida.' })
  deleteStoreIds!: string[];
}

export class DeleteStoreDto {
  @ApiProperty({ description: 'El slug de la tienda, escrito a mano para confirmar.' })
  @Trim()
  @IsString()
  @MinLength(1, { message: 'Escribe el nombre corto de la tienda para confirmar.' })
  @MaxLength(63)
  confirmSlug!: string;
}
