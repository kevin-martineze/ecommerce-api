import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

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
      return await argon2.verify(hash, plain);
    } catch {
      return false;
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
