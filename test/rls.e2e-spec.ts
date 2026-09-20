import 'dotenv/config';

import { Client } from 'pg';

/**
 * RLS verificado contra la base de verdad (ARCHITECTURE.md § 9).
 *
 * La comprobación de § 9 se hizo a mano una vez. Esto la vuelve permanente y le
 * suma lo que a mano no se puede sostener: que ninguna tabla nueva con
 * `store_id` llegue a producción sin su política. Declarar el modelo en
 * schema.prisma no alcanza —la tabla hereda los permisos sola pero no la
 * política—, y sin este test ese olvido funciona perfecto en las pruebas.
 */

/** Tablas con `store_id` fuera de RLS a propósito. Ver migración `integridad_triggers_y_rls` § 3. */
const EXEMPT_TABLES = new Set(['store_members', 'refresh_tokens']);

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Falta ${name} en el entorno. Copia .env.example a .env.`);
  }

  return value;
}

describe('RLS (contra la base)', () => {
  let owner: Client;

  beforeAll(async () => {
    owner = new Client({ connectionString: requireEnv('DIRECT_URL') });
    await owner.connect();
  });

  afterAll(async () => {
    await owner.end();
  });

  it('la aplicación se conecta con un rol que no se salta RLS', async () => {
    const app = new Client({ connectionString: requireEnv('DATABASE_URL') });

    await app.connect();

    try {
      const { rows } = await app.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
        'select rolbypassrls, rolsuper from pg_roles where rolname = current_user',
      );

      expect(rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
    } finally {
      await app.end();
    }
  });

  it('toda tabla con store_id tiene RLS activado, forzado y con política', async () => {
    const { rows } = await owner.query<{
      table_name: string;
      enabled: boolean;
      forced: boolean;
      policies: number;
    }>(`
      select c.relname as table_name,
             c.relrowsecurity as enabled,
             c.relforcerowsecurity as forced,
             (select count(*)::int from pg_policies p
               where p.schemaname = 'public' and p.tablename = c.relname) as policies
      from information_schema.columns col
      join pg_namespace n on n.nspname = col.table_schema
      join pg_class c on c.relnamespace = n.oid and c.relname = col.table_name
      where col.table_schema = 'public' and col.column_name = 'store_id' and c.relkind = 'r'
      order by c.relname
    `);

    const tenantTables = rows.filter((row) => !EXEMPT_TABLES.has(row.table_name));

    // Si la consulta dejara de encontrar tablas, el chequeo de abajo pasaría vacío.
    expect(tenantTables.length).toBeGreaterThan(10);

    expect(
      tenantTables
        .filter((row) => !row.enabled || !row.forced || row.policies === 0)
        .map((row) => row.table_name),
    ).toEqual([]);
  });

  it('sin contexto de tienda la aplicación ve cero filas; con contexto, solo las suyas', async () => {
    const slug = `rls-${Date.now().toString(36)}`;

    const inserted = await owner.query<{ id: string }>(
      `insert into stores (id, name, slug, updated_at)
       values (gen_random_uuid(), 'RLS', $1, now()) returning id`,
      [slug],
    );
    const storeId = inserted.rows[0]?.id;

    if (!storeId) {
      throw new Error('No se pudo sembrar la tienda de prueba.');
    }

    const app = new Client({ connectionString: requireEnv('DATABASE_URL') });

    try {
      // El dueño también está bajo `force row level security`: sin el contexto
      // puesto, ni siquiera él podría sembrar la categoría.
      await owner.query('begin');
      await owner.query(`select set_config('app.store_id', $1, true)`, [storeId]);
      await owner.query(
        `insert into categories (id, store_id, slug, name) values (gen_random_uuid(), $1, 'rls', 'RLS')`,
        [storeId],
      );
      await owner.query('commit');

      await app.connect();

      const countSql = 'select count(*)::int as count from categories where store_id = $1';

      const withoutContext = await app.query<{ count: number }>(countSql, [storeId]);

      expect(withoutContext.rows[0]?.count).toBe(0);

      await app.query('begin');
      await app.query(`select set_config('app.store_id', $1, true)`, [storeId]);

      const withContext = await app.query<{ count: number }>(countSql, [storeId]);

      await app.query('commit');

      expect(withContext.rows[0]?.count).toBe(1);

      // El contexto es local a la transacción: al cerrarla no queda pegado a
      // la conexión, que es lo que evita heredar el inquilino en el pool.
      const afterCommit = await app.query<{ count: number }>(countSql, [storeId]);

      expect(afterCommit.rows[0]?.count).toBe(0);
    } finally {
      await app.end();
      // Borrar la tienda arrastra la categoría: la cascada de la clave foránea
      // corre por fuera de RLS.
      await owner.query('delete from stores where id = $1', [storeId]);
    }
  });
});
