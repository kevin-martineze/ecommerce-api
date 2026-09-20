import { hashSync } from 'bcryptjs';

import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  /** Supabase Auth guarda `$2a$`; bcryptjs genera `$2b$`. Para contraseñas normales calculan igual. */
  const supabaseHash = (plain: string) => hashSync(plain, 4).replace(/^\$2b\$/, '$2a$');

  it('verifica un hash bcrypt migrado desde Supabase y pide rehacerlo', async () => {
    const legacy = supabaseHash('contraseña de la tienda vieja');

    await expect(service.verify(legacy, 'contraseña de la tienda vieja')).resolves.toBe(true);
    await expect(service.verify(legacy, 'otra contraseña')).resolves.toBe(false);
    expect(service.needsRehash(legacy)).toBe(true);
  });

  it('un argon2id con los parámetros actuales no necesita rehacerse', async () => {
    const current = await service.hash('contraseña nueva y larga');

    await expect(service.verify(current, 'contraseña nueva y larga')).resolves.toBe(true);
    expect(service.needsRehash(current)).toBe(false);
  });

  it('un hash corrupto responde false, sin lanzar', async () => {
    await expect(service.verify('esto-no-es-un-hash', 'lo que sea')).resolves.toBe(false);
    expect(service.needsRehash('esto-no-es-un-hash')).toBe(true);
  });
});
