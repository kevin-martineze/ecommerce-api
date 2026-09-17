import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MemberRole } from '@prisma/client';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Trim } from '@shared/dtos/transforms';

/** Mismas reglas que al registrarse: doce caracteres, sin más (ver RegisterStoreDto). */
const PASSWORD_MIN = 12;
const PASSWORD_MESSAGE = `La contraseña necesita al menos ${PASSWORD_MIN} caracteres.`;

export class ForgotPasswordDto {
  @ApiProperty({ example: 'dueña@mitienda.com' })
  @Trim()
  @IsEmail({}, { message: 'El correo no tiene un formato válido.' })
  @MaxLength(255)
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'El secreto del enlace que llegó por correo.' })
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token!: string;

  @ApiProperty({ minLength: PASSWORD_MIN })
  @IsString()
  @MinLength(PASSWORD_MIN, { message: PASSWORD_MESSAGE })
  @MaxLength(200)
  password!: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  currentPassword!: string;

  @ApiProperty({ minLength: PASSWORD_MIN })
  @IsString()
  @MinLength(PASSWORD_MIN, { message: PASSWORD_MESSAGE })
  @MaxLength(200)
  newPassword!: string;

  @ApiProperty({
    description: 'Refresh token de ESTA sesión: sigue viva, las demás de la cuenta se cierran.',
  })
  @IsString()
  @MaxLength(200)
  refreshToken!: string;
}

/** Una invitación vista desde el enlace, antes de aceptarla. */
export class InvitationPreviewDto {
  @ApiProperty()
  storeName!: string;

  @ApiProperty()
  storeSlug!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ enum: MemberRole })
  role!: MemberRole;

  @ApiProperty({
    description: 'Si ya hay una cuenta con ese correo: se acepta con su contraseña actual.',
  })
  accountExists!: boolean;

  @ApiProperty()
  expiresAt!: Date;
}

export class AcceptInvitationDto {
  @ApiProperty({ description: 'El enlace completo: `<storeId>.<secreto>`.' })
  @IsString()
  @Matches(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{20,}$/, { message: 'La invitación no es válida.' })
  @MaxLength(200)
  token!: string;

  @ApiProperty({ description: 'Si la cuenta existe, su contraseña; si no, la nueva.' })
  @IsString()
  @MaxLength(200)
  password!: string;

  @ApiPropertyOptional({ description: 'Obligatorio solo si la cuenta no existe todavía.' })
  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(2, { message: 'Escribe tu nombre.' })
  @MaxLength(120)
  fullName?: string;
}
