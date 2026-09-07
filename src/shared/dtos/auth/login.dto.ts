import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'dueña@mitienda.com' })
  @IsEmail({}, { message: 'El correo no tiene un formato válido.' })
  @MaxLength(255)
  email!: string;

  /**
   * No se valida el formato de la contraseña al entrar, solo que exista.
   *
   * Exigir aquí las mismas reglas que al registrarse le diría a un atacante
   * cuáles son esas reglas, y además dejaría fuera a cuentas antiguas creadas
   * bajo una política más laxa. El largo máximo sí está: argon2 no tiene un
   * límite propio, pero aceptar cadenas ilimitadas es regalar una forma barata
   * de consumir CPU.
   */
  @ApiProperty({ example: 'una contraseña larga y difícil' })
  @IsString()
  @MinLength(1, { message: 'Escribe tu contraseña.' })
  @MaxLength(200)
  password!: string;
}
