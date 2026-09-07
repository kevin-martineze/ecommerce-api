import { ApiProperty } from '@nestjs/swagger';

export class SessionStoreDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty({ enum: ['OWNER', 'STAFF'] })
  role!: string;
}

export class SessionUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ nullable: true })
  fullName!: string | null;
}

/**
 * Lo que devuelve iniciar sesión, refrescar o cambiar de tienda.
 *
 * Los tokens viajan en el CUERPO, no en una cookie que ponga esta API.
 *
 * La razón es que el navegador de la clienta nunca habla con este servicio: el
 * frontend SvelteKit lo consume desde `+page.server.ts`, servidor contra
 * servidor. Una cookie emitida acá pertenecería al dominio de la API y jamás
 * llegaría al navegador, que está en otro dominio. Quien sí pone la cookie de
 * sesión —httpOnly, en su propio dominio— es SvelteKit, con lo que recibe acá.
 */
export class SessionResponseDto {
  @ApiProperty({ description: 'JWT de vida corta. Va en el header Authorization.' })
  accessToken!: string;

  @ApiProperty({ description: 'Se canjea por uno nuevo en /auth/refresh. Rota en cada uso.' })
  refreshToken!: string;

  @ApiProperty({ description: 'Segundos de validez del access token.' })
  expiresIn!: number;

  @ApiProperty({ type: SessionUserDto })
  user!: SessionUserDto;

  @ApiProperty({ type: [SessionStoreDto], description: 'Tiendas donde esta cuenta es miembro.' })
  stores!: SessionStoreDto[];

  @ApiProperty({
    nullable: true,
    description:
      'Tienda a la que está atado el access token. Null si la cuenta no es miembro de ninguna.',
  })
  activeStoreId!: string | null;
}
