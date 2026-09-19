import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Guardar secretos ajenos.
 *
 * Las llaves con las que cada tienda cobra son de ELLA, no nuestras: quien las
 * tenga puede consultar sus ventas y, con la privada, mover su plata. En la
 * base van cifradas, no en claro, para que un volcado robado —o un respaldo
 * que termina donde no debe— no sea también el robo de todas las cuentas de
 * comercio de las tiendas.
 *
 * AES-256-GCM: cifra y autentica a la vez, así que un valor manipulado no se
 * descifra «raro», falla. El IV va delante de cada valor y es distinto cada
 * vez, que es lo que impide reconocer dos llaves iguales por su cifrado.
 */

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Hashear da exactamente los 32 bytes que pide AES-256, sea cual sea el largo del secreto. */
function keyFrom(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

export function seal(value: string, secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const cifrado = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);

  return Buffer.concat([iv, cipher.getAuthTag(), cifrado]).toString('base64url');
}

/** `null` si el valor fue manipulado o si el secreto cambió: nunca a medias. */
export function open(sealed: string, secret: string): string | null {
  try {
    const raw = Buffer.from(sealed, 'base64url');

    if (raw.length <= IV_BYTES + TAG_BYTES) return null;

    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const cifrado = raw.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), iv);

    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(cifrado), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Lo que se le enseña a la dueña de una llave que ya guardamos: el final, nada más. */
export function maskKey(value: string): string {
  return value.length <= 8 ? '••••' : `••••${value.slice(-4)}`;
}
