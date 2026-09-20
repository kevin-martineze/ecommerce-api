import 'dotenv/config';

import { parseArgs } from 'node:util';

import { Client } from 'pg';

/**
 * Convierte una cuenta en administradora de la plataforma.
 *
 *   pnpm platform:grant-admin --email dueña@empresa.com
 *   pnpm platform:grant-admin --email dueña@empresa.com --revoke
 *
 * No hay endpoint que haga esto, a propósito: `platform_admins` es la tabla
 * que decide quién ve todas las tiendas, y la única forma de entrar en ella es
 * con acceso a la base. La cuenta tiene que existir (se crea registrando una
 * tienda o siendo invitada a una).
 */

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: { email: { type: 'string' }, revoke: { type: 'boolean', default: false } },
  });

  if (!values.email) {
    throw new Error('Falta --email.');
  }

  if (!process.env.DIRECT_URL) {
    throw new Error('Falta DIRECT_URL (rol dueño de la base) en el .env.');
  }

  const db = new Client({ connectionString: process.env.DIRECT_URL });

  await db.connect();

  try {
    const email = values.email.trim().toLowerCase();
    const user = await db.query<{ id: string }>('select id from users where email = $1', [email]);
    const userId = user.rows[0]?.id;

    if (!userId) {
      throw new Error(`No existe una cuenta con el correo ${email}.`);
    }

    if (values.revoke) {
      await db.query('delete from platform_admins where user_id = $1', [userId]);
      process.stdout.write(`${email} ya no administra la plataforma.\n`);

      return;
    }

    await db.query(
      'insert into platform_admins (user_id) values ($1) on conflict (user_id) do nothing',
      [userId],
    );
    process.stdout.write(`${email} administra la plataforma.\n`);
  } finally {
    await db.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `\n${error.message}\n` : error);
  process.exit(1);
});
