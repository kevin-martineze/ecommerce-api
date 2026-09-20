import { ApiProperty } from '@nestjs/swagger';
import { MemberRole } from '@prisma/client';
import { IsEmail, IsIn, MaxLength } from 'class-validator';
import { Trim } from '@shared/dtos/transforms';

export class MemberDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ nullable: true })
  fullName!: string | null;

  @ApiProperty({ enum: MemberRole })
  role!: MemberRole;

  @ApiProperty()
  joinedAt!: Date;
}

export class UpdateMemberRoleDto {
  @ApiProperty({ enum: MemberRole })
  @IsIn(Object.values(MemberRole), { message: 'El rol no es válido.' })
  role!: MemberRole;
}

export class CreateInvitationDto {
  @ApiProperty({ example: 'ayudante@mitienda.com' })
  @Trim()
  @IsEmail({}, { message: 'El correo no tiene un formato válido.' })
  @MaxLength(255)
  email!: string;

  @ApiProperty({ enum: MemberRole, default: MemberRole.STAFF })
  @IsIn(Object.values(MemberRole), { message: 'El rol no es válido.' })
  role!: MemberRole;
}

export class InvitationDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ enum: MemberRole })
  role!: MemberRole;

  @ApiProperty({ nullable: true, description: 'Correo de quien invitó.' })
  invitedBy!: string | null;

  @ApiProperty()
  expiresAt!: Date;

  @ApiProperty()
  createdAt!: Date;
}
