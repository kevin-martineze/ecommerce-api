import { createHash, randomBytes } from 'node:crypto';

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
