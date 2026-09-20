import 'dotenv/config';

import { parseArgs } from 'node:util';

import { Client } from 'pg';

import { validateEnv } from '../src/shared/config/env';
import { IMAGE_SIZES, imageObjectKey } from '../src/shared/media/images';
import { createMediaStorage } from '../src/shared/storage/create-media-storage';

/**
 * Copia las fotos de una tienda importada desde Supabase Storage al
 * almacenamiento de esta API, y reescribe las URLs en la base.
 *
 * Uso:
 *
 *   pnpm db:import-supabase-media --slug <tienda> --dry-run   # lista y comprueba, no escribe
 *   pnpm db:import-supabase-media --slug <tienda>             # copia
 *
 * Corre DESPUÉS de `db:import-supabase`, que deja las filas con las URLs de
 * Supabase tal cual. Este script:
 *
 * - Descarga cada tamaño desde su URL pública (Supabase sigue sirviéndolas).
 * - Lo guarda bajo `stores/<storeId>/<ruta vieja>`, el mismo esquema que usan
 *   las fotos nuevas.
 * - Reescribe `storage_path` y las URLs de la fila, en su propia transacción.
 *
 * Es idempotente: una fila cuya ruta ya empieza por `stores/` se salta, así
 * que se puede relanzar tras un corte. Supabase no se toca.
 */

class MediaImportError extends Error {}

interface Options {
  slug: string;
  dryRun: boolean;
}

interface ImageRow {
  id: string;
  storage_path: string;
  url_thumb: string;
  url_card: string;
  url_full: string;
}

interface CollectionRow {
  id: string;
  hero_storage_path: string;
  hero_image_url: string;
}

function say(line = ''): void {
  process.stdout.write(`${line}\n`);
}

function readOptions(): Options {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: {
      slug: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  });

  if (!values.slug) {
    throw new MediaImportError('Falta --slug <tienda>.');
  }

  return { slug: values.slug, dryRun: values['dry-run'] ?? false };
}

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new MediaImportError(`No se pudo descargar ${url} (HTTP ${response.status}).`);
  }

  return Buffer.from(await response.arrayBuffer());
}

/** Las rutas de Supabase no llevan tienda; las nuevas sí. Así se distingue lo ya migrado. */
function alreadyMigrated(storagePath: string): boolean {
  return storagePath.startsWith('stores/');
}

async function main(): Promise<void> {
  const options = readOptions();
  const env = validateEnv(process.env);
  const storage = createMediaStorage(env);

  if (!env.DIRECT_URL) {
    throw new MediaImportError('Falta DIRECT_URL (rol dueño de la base de la API) en el .env.');
  }

  const db = new Client({ connectionString: env.DIRECT_URL });

  await db.connect();

  try {
    const store = await db.query<{ id: string }>('select id from stores where slug = $1', [
      options.slug,
    ]);
    const storeId = store.rows[0]?.id;

    if (!storeId) {
      throw new MediaImportError(`No existe una tienda con slug "${options.slug}".`);
    }

    // RLS forzado: también el dueño necesita el contexto para ver las filas.
    const withStore = async <T>(work: () => Promise<T>): Promise<T> => {
      await db.query('begin');
      await db.query(`select set_config('app.store_id', $1, true)`, [storeId]);

      try {
        const result = await work();

        await db.query('commit');

        return result;
      } catch (error) {
        await db.query('rollback');
        throw error;
      }
    };

    const images = await withStore(async () => {
      const { rows } = await db.query<ImageRow>(
        `select id, storage_path, url_thumb, url_card, url_full
         from product_images where store_id = $1 order by product_id, sort_order`,
        [storeId],
      );

      return rows.filter((row) => !alreadyMigrated(row.storage_path));
    });

    const collections = await withStore(async () => {
      const { rows } = await db.query<CollectionRow>(
        `select id, hero_storage_path, hero_image_url
         from collections where store_id = $1 and hero_storage_path is not null`,
        [storeId],
      );

      return rows.filter((row) => !alreadyMigrated(row.hero_storage_path));
    });

    say(
      `Tienda ${options.slug}: ${images.length} fotos de prenda y ${collections.length} portadas por copiar.`,
    );

    if (options.dryRun) {
      say('SIMULACIÓN: se comprueba que cada URL responda, no se copia nada.');
    }

    let copied = 0;

    for (const image of images) {
      const newPath = `stores/${storeId}/${image.storage_path}`;
      const sources = { thumb: image.url_thumb, card: image.url_card, full: image.url_full };

      if (options.dryRun) {
        for (const url of Object.values(sources)) {
          const head = await fetch(url, { method: 'HEAD' });

          if (!head.ok) {
            throw new MediaImportError(`${url} responde HTTP ${head.status}.`);
          }
        }

        say(`  ok  ${image.storage_path}`);
        continue;
      }

      await storage.put(
        await Promise.all(
          IMAGE_SIZES.map(async (size) => ({
            key: imageObjectKey(newPath, size.key),
            body: await download(sources[size.key]),
            contentType: 'image/webp',
          })),
        ),
      );

      await withStore(() =>
        db.query(
          `update product_images
           set storage_path = $2, url_thumb = $3, url_card = $4, url_full = $5
           where id = $1 and store_id = $6`,
          [
            image.id,
            newPath,
            storage.publicUrl(imageObjectKey(newPath, 'thumb')),
            storage.publicUrl(imageObjectKey(newPath, 'card')),
            storage.publicUrl(imageObjectKey(newPath, 'full')),
            storeId,
          ],
        ),
      );

      copied += 1;
      say(`  copiada  ${image.storage_path}`);
    }

    for (const collection of collections) {
      const newPath = `stores/${storeId}/${collection.hero_storage_path}`;

      // La portada solo se usa en tamaño completo, pero Supabase guardó los
      // tres; se copian todos para que borrar la foto después no deje restos.
      const sources = IMAGE_SIZES.map((size) => ({
        size: size.key,
        url: collection.hero_image_url.replace(/-full\.webp$/, `-${size.key}.webp`),
      }));

      if (options.dryRun) {
        for (const { url } of sources) {
          const head = await fetch(url, { method: 'HEAD' });

          if (!head.ok) {
            throw new MediaImportError(`${url} responde HTTP ${head.status}.`);
          }
        }

        say(`  ok  ${collection.hero_storage_path}`);
        continue;
      }

      await storage.put(
        await Promise.all(
          sources.map(async ({ size, url }) => ({
            key: imageObjectKey(newPath, size),
            body: await download(url),
            contentType: 'image/webp',
          })),
        ),
      );

      await withStore(() =>
        db.query(
          `update collections set hero_storage_path = $2, hero_image_url = $3
           where id = $1 and store_id = $4`,
          [collection.id, newPath, storage.publicUrl(imageObjectKey(newPath, 'full')), storeId],
        ),
      );

      copied += 1;
      say(`  copiada  ${collection.hero_storage_path}`);
    }

    say();
    say(
      options.dryRun
        ? 'SIMULACIÓN: todas las URLs responden. No se copió nada.'
        : `Listo: ${copied} fotos copiadas a ${env.STORAGE_DRIVER === 's3' ? `s3://${env.S3_BUCKET}` : env.MEDIA_DIR}.`,
    );
  } finally {
    await db.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof MediaImportError ? `\n${error.message}\n` : error);
  process.exit(1);
});
