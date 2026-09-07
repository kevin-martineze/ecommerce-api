import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Alta de una tienda nueva junto con la cuenta de su dueña.
 *
 * Van juntas y no en dos pasos porque una tienda sin dueña no le sirve a nadie
 * y una cuenta sin tienda tampoco: separarlas solo abre la posibilidad de que
 * algo quede a medias.
 */
export class RegisterStoreDto {
  @ApiProperty({ example: 'dueña@mitienda.com' })
  @IsEmail({}, { message: 'El correo no tiene un formato válido.' })
  @MaxLength(255)
  email!: string;

  /**
   * Doce caracteres y sin más reglas, a propósito.
   *
   * Obligar a mayúscula, número y símbolo produce contraseñas más cortas, más
   * predecibles y anotadas en un papel. El largo es lo que de verdad mueve la
   * aguja contra la fuerza bruta.
   */
  @ApiProperty({ example: 'mi tienda de ropa 2026', minLength: 12 })
  @IsString()
  @MinLength(12, { message: 'La contraseña necesita al menos 12 caracteres.' })
  @MaxLength(200)
  password!: string;

  @ApiProperty({ example: 'María Restrepo' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  @ApiProperty({ example: 'Boutique Mariposa' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  storeName!: string;

  /**
   * Termina siendo un subdominio, así que el formato no es cosmético: un punto
   * o una mayúscula acá es un host que no resuelve. La misma expresión está
   * como CHECK en la base, para que ningún otro camino pueda saltársela.
   */
  @ApiProperty({ example: 'boutique-mariposa', pattern: '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' })
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, {
    message:
      'El identificador solo admite minúsculas, números y guiones, y debe empezar y terminar con letra o número.',
  })
  storeSlug!: string;

  @ApiProperty({
    example: '573001234567',
    description: 'Número de WhatsApp donde se cierran las ventas.',
  })
  @IsString()
  @Matches(/^[0-9]{10,15}$/, { message: 'El número de WhatsApp debe tener entre 10 y 15 dígitos.' })
  whatsappPhone!: string;
}
