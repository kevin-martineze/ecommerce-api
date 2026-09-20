import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Secretos de un solo uso que viajan en un enlace (recuperar contraseña,
 * invitación).
 *
 * 32 bytes aleatorios en base64url: caben en una URL sin escapar nada. En la
 * base se guarda solo el SHA-256, por la misma razón que en `refresh_tokens`:
 * un valor de alta entropía no necesita argon2, y quien se lleve una copia de
 * la tabla no tiene un enlace usable.
 */
export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * Compara dos secretos en tiempo constante.
 *
 * Con `===`, el tiempo de respuesta depende de cuántos caracteres iniciales
 * coinciden, y con suficientes intentos eso deja adivinar el secreto carácter
 * a carácter. Los largos distintos se comparan igual contra un valor del mismo
 * tamaño, para no filtrar el largo.
 */
export function timingSafeEqualString(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);

  if (a.length !== b.length) {
    timingSafeEqual(b, b);

    return false;
  }

  return timingSafeEqual(a, b);
}
