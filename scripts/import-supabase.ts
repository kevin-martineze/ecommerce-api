import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

import { Client } from 'pg';

import { slugify } from '../src/shared/utils/slug';

/**
 * Copia la tienda de la versión con Supabase a una tienda de esta API.
 *
 * Uso:
 *
 *   pnpm db:import-supabase --dry-run            # valida y simula, no guarda nada
 *   pnpm db:import-supabase                      # importa
 *   pnpm db:import-supabase --replace            # borra la importación anterior y repite
 *
 * Opciones: `--source <url>` (si no, `SUPABASE_DB_URL`), `--name`, `--slug`.
 *
 * El origen tiene que ser el POOLER de Supabase y no la conexión directa: la
 * directa solo tiene IPv6. Formato:
 *   postgresql://postgres.<ref>:<clave>@aws-0-<región>.pooler.supabase.com:5432/postgres
 *
 * Tres garantías, en este orden de importancia:
 *
 * 1. **Supabase no se toca.** La lectura va en una transacción que Postgres
 *    marca como de solo lectura: aunque un bug de este script intentara
 *    escribir, Supabase lo rechazaría. No depende de la disciplina del código.
 * 2. **Todo o nada.** La escritura va en UNA transacción. Si falla cualquier
 *    fila, o si al final los conteos no coinciden con el origen, no queda nada.
 * 3. **Los ids se conservan.** Las fotos, las variantes y los pedidos siguen
 *    apuntando a lo mismo, y repetir la importación da el mismo resultado.
 *
 * Las contraseñas se copian como están (bcrypt de Supabase Auth). La API las
 * acepta y las pasa a argon2id en el primer login: ver PasswordService.
 */

type Row = Record<string, unknown>;

class ImportError extends Error {}

/** Mismo patrón que el CHECK `stores_slug_format`: termina siendo un subdominio. */
const STORE_SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

const INSERT_BATCH = 200;

/**
 * Tablas que se copian tal cual, en orden de dependencias.
 *
 * Las columnas se listan una a una y no con `select *`: si Supabase ganara una
 * columna que la API no tiene, `*` rompería la importación; y si la API exige
 * una que Supabase no tiene, esta lista es donde se ve.
 *
 * `categories.parent_id` va aparte: una categoría puede apuntar a otra que
 * todavía no se insertó.
 */
const COPIED_TABLES: readonly { table: string; columns: readonly string[] }[] = [
  { table: 'colors', columns: ['id', 'slug', 'name', 'hex', 'sort_order', 'active'] },
  { table: 'sizes', columns: ['id', 'label', 'sort_order', 'active'] },
  { table: 'categories', columns: ['id', 'slug', 'name', 'sort_order', 'active'] },
  {
    table: 'products',
    columns: [
      'id',
      'slug',
      'name',
      'description',
      'material',
      'care',
      'category_id',
      'base_price',
      'compare_at_price',
      'status',
      'featured',
      'created_at',
      'updated_at',
    ],
  },
  {
    table: 'product_images',
    columns: [
      'id',
      'product_id',
      'color_id',
      'storage_path',
      'url_full',
      'url_card',
      'url_thumb',
      'lqip',
      'alt',
      'sort_order',
    ],
  },
  {
    table: 'variants',
    columns: [
      'id',
      'product_id',
      'color_id',
      'size_id',
      'sku',
      'stock',
      'price_override',
      'active',
    ],
  },
  {
    table: 'collections',
    columns: [
      'id',
      'slug',
      'name',
      'description',
      'hero_image_url',
      'hero_storage_path',
      'active',
      'sort_order',
      'created_at',
    ],
  },
  {
    table: 'collection_products',
    columns: ['collection_id', 'product_id', 'sort_order', 'hotspot_x', 'hotspot_y'],
  },
  { table: 'home_highlights', columns: ['id', 'eyebrow', 'title', 'body', 'sort_order', 'active'] },
  {
    table: 'coupons',
    columns: [
      'id',
      'code',
      'type',
      'value',
      'min_subtotal',
      'starts_at',
      'ends_at',
      'max_uses',
      'uses',
      'active',
      'created_at',
    ],
  },
  {
    table: 'shipping_zones',
    columns: ['id', 'name', 'cost', 'eta_days', 'active', 'sort_order'],
  },
  {
    table: 'orders',
    columns: [
      'id',
      'number',
      'public_token',
      'status',
      'customer_name',
      'customer_phone',
      'customer_city',
      'customer_address',
      'customer_notes',
      'shipping_zone_id',
      'shipping_zone_name',
      'shipping_cost',
      'coupon_id',
      'coupon_code',
      'subtotal',
      'discount',
      'total',
      'whatsapp_opened_at',
      'admin_notes',
      'stock_restored',
      'created_at',
      'updated_at',
    ],
  },
  {
    table: 'order_items',
    columns: [
      'id',
      'order_id',
      'variant_id',
      'product_id',
      'product_name',
      'product_slug',
      'color_name',
      'size_label',
      'sku',
      'unit_price',
      'qty',
      'line_total',
    ],
  },
  {
    table: 'restock_requests',
    columns: ['id', 'variant_id', 'contact', 'created_at', 'notified_at'],
  },
];

interface SettingsRow {
  store_name: string;
  whatsapp_phone: string;
  instagram_url: string | null;
  announcement: string | null;
  free_shipping_threshold: number | null;
  hero_title: string | null;
  hero_subtitle: string | null;
  hero_collection_id: string | null;
}

interface AccountRow {
  id: string;
  email: string;
  full_name: string | null;
  encrypted_password: string | null;
}

interface SourceData {
  settings: SettingsRow;
  accounts: AccountRow[];
  tables: Record<string, Row[]>;
  categoryParents: { id: string; parent_id: string }[];
}

interface Options {
  source: string;
  name?: string;
  slug?: string;
  dryRun: boolean;
  replace: boolean;
}

function say(line = ''): void {
  process.stdout.write(`${line}\n`);
}

function readOptions(): Options {
  const { values } = parseArgs({
    // pnpm reenvía un `--` literal cuando se escribe `pnpm script -- --flag`.
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: {
      source: { type: 'string' },
      name: { type: 'string' },
      slug: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      replace: { type: 'boolean', default: false },
    },
  });

  const source = values.source ?? process.env.SUPABASE_DB_URL;

  if (!source) {
    throw new ImportError(
      'Falta el origen: pasa --source "postgresql://…" o define SUPABASE_DB_URL.',
    );
  }

  return {
    source,
    name: values.name,
    slug: values.slug,
    dryRun: values['dry-run'] ?? false,
    replace: values.replace ?? false,
  };
}

async function readSource(url: string): Promise<SourceData> {
  // Supabase firma sus certificados con una CA propia que Node no trae. Es una
  // copia puntual lanzada a mano; por eso se cifra sin verificar la cadena.
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const hint = detail.includes('ENETUNREACH')
      ? '\nLa conexión directa de Supabase solo tiene IPv6: usa la URL del pooler (ver la cabecera de este script).'
      : '';

    throw new ImportError(`No se pudo conectar a Supabase: ${detail}${hint}`);
  }

  try {
    await client.query('begin transaction read only');

    const settings = await client.query<SettingsRow>(
      `select store_name, whatsapp_phone, instagram_url, announcement, free_shipping_threshold,
              hero_title, hero_subtitle, hero_collection_id
       from settings`,
    );

    const settingsRow = settings.rows[0];

    if (!settingsRow || settings.rows.length !== 1) {
      throw new ImportError(`Se esperaba una fila en settings y hay ${settings.rows.length}.`);
    }

    const accounts = await client.query<AccountRow>(
      `select p.id, p.email, p.full_name, u.encrypted_password
       from public.profiles p join auth.users u on u.id = p.id
       order by p.created_at`,
    );

    if (accounts.rows.length === 0) {
      throw new ImportError(
        'No hay cuentas en profiles: la tienda quedaría sin nadie que la administre.',
      );
    }

    const tables: Record<string, Row[]> = {};

    for (const { table, columns } of COPIED_TABLES) {
      const result = await client.query<Row>(`select ${columns.join(', ')} from ${table}`);

      tables[table] = result.rows;
    }

    const parents = await client.query<{ id: string; parent_id: string }>(
      'select id, parent_id from categories where parent_id is not null',
    );

    await client.query('rollback');

    return {
      settings: settingsRow,
      accounts: accounts.rows,
      tables,
      categoryParents: parents.rows,
    };
  } finally {
    await client.end();
  }
}

/**
 * Reglas que la API exige con CHECK y Supabase no exigía.
 *
 * Se revisan ANTES de escribir para devolver una lista legible de todo lo que
 * falla, en vez del primer error de Postgres a mitad de la transacción.
 */
function findViolations(data: SourceData): string[] {
  const problems: string[] = [];
  const rows = (table: string): Row[] => data.tables[table] ?? [];

  for (const order of rows('orders')) {
    const label = `Pedido ${String(order.number)}`;
    const subtotal = Number(order.subtotal);
    const discount = Number(order.discount);

    if (Number(order.total) !== subtotal - discount + Number(order.shipping_cost)) {
      problems.push(`${label}: el total no cuadra con subtotal - descuento + envío.`);
    }

    if (discount > subtotal) {
      problems.push(`${label}: el descuento supera el subtotal.`);
    }

    if (Number(order.number) > 2_147_483_647) {
      problems.push(`${label}: el número no cabe en un entero de 32 bits.`);
    }
  }

  for (const item of rows('order_items')) {
    if (Number(item.line_total) !== Number(item.unit_price) * Number(item.qty)) {
      problems.push(`Línea de pedido ${String(item.id)}: line_total no es unit_price × qty.`);
    }
  }

  for (const coupon of rows('coupons')) {
    const { starts_at: startsAt, ends_at: endsAt, code } = coupon;

    if (startsAt instanceof Date && endsAt instanceof Date && startsAt >= endsAt) {
      problems.push(`Cupón ${String(code)}: empieza después de terminar.`);
    }
  }

  for (const color of rows('colors')) {
    if (typeof color.hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color.hex)) {
      problems.push(`Color ${String(color.name)}: el tono no tiene formato #RRGGBB.`);
    }
  }

  return problems;
}

/** Filas de varias tiendas no se mezclan: todo lo que se inserta lleva el `store_id` nuevo. */
async function insertRows(
  client: Client,
  table: string,
  columns: readonly string[],
  rows: Row[],
  storeId: string,
): Promise<void> {
  const allColumns = ['store_id', ...columns];

  for (let start = 0; start < rows.length; start += INSERT_BATCH) {
    const values: unknown[] = [];

    const tuples = rows.slice(start, start + INSERT_BATCH).map((row) => {
      const placeholders = allColumns.map((column) => {
        values.push(column === 'store_id' ? storeId : (row[column] ?? null));

        return `$${values.length}`;
      });

      return `(${placeholders.join(', ')})`;
    });

    await client.query(
      `insert into ${table} (${allColumns.join(', ')}) values ${tuples.join(', ')}`,
      values,
    );
  }
}

/**
 * Deja el terreno libre para importar, o explica por qué no se puede.
 *
 * Sin `--replace` nunca se borra nada: si la tienda o las cuentas ya existen,
 * se aborta. Con `--replace` se borra la tienda de la importación anterior y
 * las cuentas que quedaron sin ninguna tienda, pero JAMÁS una cuenta que
 * administre otra tienda.
 */
async function clearPrevious(
  client: Client,
  data: SourceData,
  slug: string,
  replace: boolean,
): Promise<void> {
  const existing = await client.query<{ id: string }>('select id from stores where slug = $1', [
    slug,
  ]);
  const previousStore = existing.rows[0];

  if (previousStore) {
    if (!replace) {
      throw new ImportError(
        `Ya existe una tienda con el slug "${slug}". Usa --replace para borrarla e importar de nuevo.`,
      );
    }

    await client.query('delete from stores where id = $1', [previousStore.id]);
  }

  const emails = data.accounts.map((account) => account.email.trim().toLowerCase());

  const taken = await client.query<{ email: string; stores: number }>(
    `select u.email, count(m.store_id)::int as stores
     from users u left join store_members m on m.user_id = u.id
     where u.email = any($1::text[])
     group by u.email`,
    [emails],
  );

  for (const account of taken.rows) {
    if (account.stores > 0) {
      throw new ImportError(`La cuenta ${account.email} ya administra otra tienda en la API.`);
    }

    if (!replace) {
      throw new ImportError(
        `Ya existe la cuenta ${account.email} en la API. Usa --replace si es de una importación anterior.`,
      );
    }

    await client.query('delete from users where email = $1', [account.email]);
  }
}

async function writeStore(
  client: Client,
  data: SourceData,
  target: { name: string; slug: string; replace: boolean },
): Promise<{ storeId: string; nextOrderNumber: number }> {
  await clearPrevious(client, data, target.slug, target.replace);

  const storeId = randomUUID();

  // En Supabase los números salían de una secuencia global que empezó en 1000.
  // Acá son por tienda: se sigue desde el último para no repetir un número que
  // una clienta ya tiene en su chat.
  const orderNumbers = (data.tables.orders ?? []).map((order) => Number(order.number));
  const nextOrderNumber = orderNumbers.length > 0 ? Math.max(...orderNumbers) + 1 : 1;

  await client.query(
    `insert into stores (id, name, slug, status, next_order_number, updated_at)
     values ($1, $2, $3, 'ACTIVE', $4, now())`,
    [storeId, target.name, target.slug, nextOrderNumber],
  );

  // Desde acá todo está bajo RLS forzado, también para el rol dueño: sin el
  // contexto, cada insert de abajo chocaría con su propia política.
  await client.query(`select set_config('app.store_id', $1, true)`, [storeId]);

  for (const account of data.accounts) {
    await client.query(
      `insert into users (id, email, full_name, password_hash, updated_at)
       values ($1, $2, $3, $4, now())`,
      [
        account.id,
        account.email.trim().toLowerCase(),
        account.full_name,
        account.encrypted_password || null,
      ],
    );

    // En Supabase toda cuenta de `profiles` tenía acceso completo: OWNER es lo
    // que conserva ese acceso.
    await client.query(
      `insert into store_members (store_id, user_id, role) values ($1, $2, 'OWNER')`,
      [storeId, account.id],
    );
  }

  const today = new Date();
  const periodEnd = new Date(today.getTime() + 30 * 86_400_000);

  await client.query(
    `insert into subscriptions (id, store_id, plan_code, status, current_period_end, notes, updated_at)
     values ($1, $2, 'basico', 'ACTIVE', $3, $4, now())`,
    [
      randomUUID(),
      storeId,
      periodEnd,
      `Tienda migrada desde Supabase el ${today.toISOString().slice(0, 10)}.`,
    ],
  );

  for (const { table, columns } of COPIED_TABLES) {
    await insertRows(client, table, columns, data.tables[table] ?? [], storeId);
  }

  for (const { id, parent_id: parentId } of data.categoryParents) {
    await client.query('update categories set parent_id = $1 where id = $2 and store_id = $3', [
      parentId,
      id,
      storeId,
    ]);
  }

  // Al final porque `hero_collection_id` apunta a una colección.
  const { settings } = data;

  await client.query(
    `insert into store_settings (store_id, whatsapp_phone, instagram_url, announcement,
       free_shipping_threshold, hero_title, hero_subtitle, hero_collection_id, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
    [
      storeId,
      settings.whatsapp_phone,
      settings.instagram_url,
      settings.announcement,
      settings.free_shipping_threshold,
      settings.hero_title,
      settings.hero_subtitle,
      settings.hero_collection_id,
    ],
  );

  return { storeId, nextOrderNumber };
}

/** La última red: si algo no llegó, no se confirma. */
async function verifyCounts(client: Client, storeId: string, data: SourceData): Promise<void> {
  for (const { table } of COPIED_TABLES) {
    const expected = (data.tables[table] ?? []).length;
    const { rows } = await client.query<{ n: number }>(
      `select count(*)::int as n from ${table} where store_id = $1`,
      [storeId],
    );
    const actual = rows[0]?.n ?? 0;

    if (actual !== expected) {
      throw new ImportError(`${table}: se esperaban ${expected} filas y quedaron ${actual}.`);
    }
  }
}

async function main(): Promise<void> {
  const options = readOptions();

  say('Leyendo Supabase (solo lectura)…');

  const data = await readSource(options.source);
  const violations = findViolations(data);

  if (violations.length > 0) {
    throw new ImportError(
      `Hay datos que la API no acepta. Corrígelos en Supabase y vuelve a intentar:\n${violations
        .map((problem) => `  - ${problem}`)
        .join('\n')}`,
    );
  }

  const name = options.name ?? data.settings.store_name;
  const slug = options.slug ?? slugify(name);

  if (!STORE_SLUG.test(slug)) {
    throw new ImportError(
      `El slug "${slug}" no sirve como subdominio. Pasa --slug con minúsculas, números y guiones (3 a 40).`,
    );
  }

  const directUrl = process.env.DIRECT_URL;

  if (!directUrl) {
    throw new ImportError('Falta DIRECT_URL (rol dueño de la base de la API) en el .env.');
  }

  const target = new Client({ connectionString: directUrl });

  await target.connect();

  try {
    await target.query('begin');

    const { storeId, nextOrderNumber } = await writeStore(target, data, {
      name,
      slug,
      replace: options.replace,
    });

    await verifyCounts(target, storeId, data);

    await target.query(options.dryRun ? 'rollback' : 'commit');

    say();
    say(options.dryRun ? 'SIMULACIÓN: todo validó y no se guardó nada.' : 'Importación completa.');
    say();
    say(`  Tienda          ${name}`);
    say(`  Slug            ${slug}`);
    say(`  Id              ${storeId}${options.dryRun ? ' (se descarta)' : ''}`);
    say(`  Próximo pedido  ${nextOrderNumber}`);
    say();

    for (const { table } of COPIED_TABLES) {
      say(`  ${table.padEnd(20)} ${(data.tables[table] ?? []).length}`);
    }

    say();

    for (const account of data.accounts) {
      const access = account.encrypted_password
        ? 'entra con su contraseña de siempre'
        : 'SIN contraseña: no podrá entrar';

      say(`  Cuenta ${account.email.trim().toLowerCase()} (OWNER): ${access}`);
    }
  } catch (error) {
    await target.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    await target.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof ImportError ? `\nNo se importó nada.\n${error.message}\n` : error);
  process.exit(1);
});
