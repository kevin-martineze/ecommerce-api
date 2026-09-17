import 'dotenv/config';

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { Client } from 'pg';

import { validateEnv } from '../src/shared/config/env';
import { IMAGE_SIZES, imageObjectKey } from '../src/shared/media/images';
import { createMediaStorage } from '../src/shared/storage/create-media-storage';

/**
 * Sube al bucket las fotos que una tienda tiene en el disco local y reescribe
 * sus URLs.
 *
 *   STORAGE_DRIVER=s3 … pnpm storage:push-local --slug <tienda> [--dry-run]
 *
 * Para pasar de `STORAGE_DRIVER=local` a R2 sin perder las fotos ya subidas.
 * Las claves no cambian (`stores/<storeId>/…`), solo la URL pública, así que
 * se puede relanzar: lo que ya apunta al bucket se salta. El disco no se toca.
 */

class PushError extends Error {}

function say(line = ''): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: {
      slug: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  });

  if (!values.slug) {
    throw new PushError('Falta --slug <tienda>.');
  }

  const env = validateEnv(process.env);

  if (env.STORAGE_DRIVER !== 's3') {
    throw new PushError('Configura STORAGE_DRIVER=s3 y las variables S3_* del bucket de destino.');
  }

  if (!env.DIRECT_URL) {
    throw new PushError('Falta DIRECT_URL (rol dueño de la base de la API) en el .env.');
  }

  const storage = createMediaStorage(env);
  const mediaDir = resolve(env.MEDIA_DIR);
  const publicBase = `${env.S3_PUBLIC_URL ?? ''}/`;
  const dryRun = values['dry-run'] ?? false;
  const db = new Client({ connectionString: env.DIRECT_URL });

  await db.connect();

  try {
    const store = await db.query<{ id: string }>('select id from stores where slug = $1', [
      values.slug,
    ]);
    const storeId = store.rows[0]?.id;

    if (!storeId) {
      throw new PushError(`No existe una tienda con slug "${values.slug}".`);
    }

    // RLS forzado: también el dueño necesita el contexto para ver las filas.
    const inStore = async <T>(work: () => Promise<T>): Promise<T> => {
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

    const images = await inStore(async () => {
      const { rows } = await db.query<{ id: string; storage_path: string; url_full: string }>(
        `select id, storage_path, url_full from product_images
         where store_id = $1 and storage_path like 'stores/%'`,
        [storeId],
      );

      return rows.filter((row) => !row.url_full.startsWith(publicBase));
    });

    const heroes = await inStore(async () => {
      const { rows } = await db.query<{
        id: string;
        hero_storage_path: string;
        hero_image_url: string;
      }>(
        `select id, hero_storage_path, hero_image_url from collections
         where store_id = $1 and hero_storage_path like 'stores/%'`,
        [storeId],
      );

      return rows.filter((row) => !row.hero_image_url.startsWith(publicBase));
    });

    say(`Tienda ${values.slug}: ${images.length} fotos y ${heroes.length} portadas por subir.`);

    const upload = async (storagePath: string): Promise<void> => {
      const objects = await Promise.all(
        IMAGE_SIZES.map(async (size) => {
          const key = imageObjectKey(storagePath, size.key);

          return { key, body: await readFile(join(mediaDir, key)), contentType: 'image/webp' };
        }),
      );

      if (!dryRun) {
        await storage.put(objects);
      }
    };

    for (const image of images) {
      await upload(image.storage_path);

      if (!dryRun) {
        await inStore(() =>
          db.query(
            `update product_images set url_thumb = $2, url_card = $3, url_full = $4
             where id = $1 and store_id = $5`,
            [
              image.id,
              storage.publicUrl(imageObjectKey(image.storage_path, 'thumb')),
              storage.publicUrl(imageObjectKey(image.storage_path, 'card')),
              storage.publicUrl(imageObjectKey(image.storage_path, 'full')),
              storeId,
            ],
          ),
        );
      }

      say(`  ${dryRun ? 'ok' : 'subida'}  ${image.storage_path}`);
    }

    for (const hero of heroes) {
      await upload(hero.hero_storage_path);

      if (!dryRun) {
        await inStore(() =>
          db.query(`update collections set hero_image_url = $2 where id = $1 and store_id = $3`, [
            hero.id,
            storage.publicUrl(imageObjectKey(hero.hero_storage_path, 'full')),
            storeId,
          ]),
        );
      }

      say(`  ${dryRun ? 'ok' : 'subida'}  ${hero.hero_storage_path}`);
    }

    say(dryRun ? 'SIMULACIÓN: todos los archivos están en disco. No se subió nada.' : 'Listo.');
  } finally {
    await db.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof PushError ? `\n${error.message}\n` : error);
  process.exit(1);
});
