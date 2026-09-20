import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { compare as bcryptCompare } from 'bcryptjs';

/** `$2a$`, `$2b$` o `$2y$`: las variantes de bcrypt. Supabase Auth guarda `$2a$`. */
const BCRYPT_PREFIX = /^\$2[aby]\$/;

/**
 * Hash y verificación de contraseñas.
 *
 * argon2id y no bcrypt: bcrypt está limitado a 72 bytes de entrada —los
 * caracteres que sobran se ignoran en silencio, así que dos contraseñas largas
 * distintas pueden dar el mismo hash— y no ofrece resistencia a ataques por
 * memoria. argon2id es el que recomienda OWASP desde 2021.
 *
 * Los parámetros son los mínimos que sugiere OWASP para argon2id: 19 MiB de
 * memoria, dos pasadas, un hilo. Subirlos endurece el hash pero también
 * encarece cada login legítimo; estos valores tardan decenas de milisegundos en
 * hardware modesto, que es el punto de equilibrio razonable.
 *
 * **bcrypt se sigue LEYENDO, nunca escribiendo.** Las cuentas que vienen de la
 * tienda con Supabase traen el hash de Supabase Auth, que es bcrypt. Obligarlas
 * a crear contraseña nueva exigiría un flujo de recuperación que todavía no
 * existe. En cambio se verifican con bcrypt una vez y, en ese mismo login —el
 * único momento en que se tiene la contraseña en claro—, se reemplazan por
 * argon2id. Ver `needsRehash` y `AuthService.login`.
 */
@Injectable()
export class PasswordService {
  private readonly options: argon2.Options = {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  };

  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, this.options);
  }

  /**
   * Devuelve false ante cualquier fallo en lugar de propagar la excepción.
   *
   * argon2 lanza si el hash almacenado está corrupto o viene de otro algoritmo.
   * Dejar escapar ese error convertiría un dato malo en un 500 y, peor, en una
   * señal distinta a la de "contraseña incorrecta" — que es exactamente la
   * diferencia que un atacante usa para enumerar cuentas.
   */
  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      if (BCRYPT_PREFIX.test(hash)) {
        return await bcryptCompare(plain, hash);
      }

      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  /**
   * true si el hash no es argon2id con los parámetros actuales y conviene
   * rehacerlo en el próximo login correcto: un bcrypt migrado, o un argon2 de
   * cuando los parámetros eran otros.
   */
  needsRehash(hash: string): boolean {
    if (BCRYPT_PREFIX.test(hash)) {
      return true;
    }

    try {
      return argon2.needsRehash(hash, this.options);
    } catch {
      return true;
    }
  }

  /**
   * Consume tiempo comparable al de una verificación real.
   *
   * Se usa cuando el correo no existe. Sin esto, un "no existe" responde en
   * microsegundos y un "contraseña incorrecta" en decenas de milisegundos, y
   * esa diferencia deja enumerar qué correos tienen cuenta con solo cronometrar
   * las respuestas.
   */
  async burnTime(): Promise<void> {
    await argon2.hash('contraseña que no le pertenece a nadie', this.options);
  }
}
