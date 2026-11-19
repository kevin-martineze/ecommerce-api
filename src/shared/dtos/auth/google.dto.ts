import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Trim } from '@shared/dtos/transforms';

import { RegisterStoreDto } from './register-store.dto';
import { SessionResponseDto } from './session-response.dto';

/** Lo que trae el frontend del callback de Google para canjearlo acá. */
export class GoogleSignInDto {
  @ApiProperty({ description: 'El `code` que Google dejó en el callback.' })
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  code!: string;

  /** RFC 7636: entre 43 y 128 caracteres "sin reservar". */
  @ApiProperty({ description: 'El `code_verifier` de PKCE que guardó el frontend.' })
  @IsString()
  @Matches(/^[A-Za-z0-9\-._~]{43,128}$/, { message: 'El verificador de PKCE no es válido.' })
  codeVerifier!: string;

  @ApiProperty({
    example: 'https://globerce.com/auth/google/callback',
    description: 'La misma que usó la URL de Google. Tiene que estar en GOOGLE_REDIRECT_URIS.',
  })
  @IsString()
  @MaxLength(500)
  redirectUri!: string;
}

/** Google probó la identidad y la cuenta ya existe (o se acaba de vincular). */
export class GoogleSessionResultDto {
  @ApiProperty({ enum: ['session'] })
  status!: 'session';

  @ApiProperty({ type: SessionResponseDto })
  session!: SessionResponseDto;
}

/** Google probó la identidad pero no hay cuenta: falta el segundo paso del registro. */
export class GoogleSignupRequiredDto {
  @ApiProperty({ enum: ['signup_required'] })
  status!: 'signup_required';

  @ApiProperty({
    description:
      'JWT de 15 minutos. Se manda tal cual a /auth/google/register con los datos de la tienda.',
  })
  signupToken!: string;

  @ApiProperty({ description: 'El correo que confirmó Google.' })
  email!: string;

  @ApiProperty({ nullable: true, type: String, description: 'El nombre que dio Google, si dio.' })
  fullName!: string | null;
}

export type GoogleSignInResultDto = GoogleSessionResultDto | GoogleSignupRequiredDto;

/**
 * Segundo paso del registro con Google: los datos de la tienda.
 *
 * El correo y el nombre no se piden: vienen firmados dentro del `signupToken`.
 * `fullName` es solo por si Google no dio nombre o la dueña quiere otro.
 */
export class GoogleRegisterDto extends PickType(RegisterStoreDto, [
  'storeName',
  'storeSlug',
  'whatsappPhone',
  'planCode',
] as const) {
  @ApiProperty({ description: 'El que devolvió /auth/google con `signup_required`.' })
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  signupToken!: string;

  @ApiPropertyOptional({
    example: 'María Restrepo',
    description: 'Reemplaza el nombre que dio Google.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName?: string;
}
