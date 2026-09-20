import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { stat } from 'node:fs/promises';

import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/**
 * Sube una copia de la base al almacenamiento externo.
 *
 *   docker compose exec -T api node dist/tasks/upload-backup /backups/x.sql.gz
 *
 * Las variables salen del `env_file` de compose, no de `dotenv`: esa es
 * dependencia de desarrollo y no está en la imagen de producción.
 *
 * La llama `scripts/backup-db.sh`, que es quien hace el `pg_dump`. Va por acá
 * y no por el AWS CLI porque el SDK ya está en la imagen: una copia de
 * seguridad que depende de instalar algo en el servidor es una copia que
 * alguien, algún día, no va a poder restaurar.
 *
 * El bucket es OTRO, distinto del de las fotos, y privado: el de las fotos se
 * sirve público, y ahí un volcado de la base sería un volcado de la base
 * público. Si no existe se crea; si el token no tiene permiso para crearlo, se
 * dice con todas las letras en vez de dejar el respaldo a medias.
 */

/** Copias que se conservan afuera. Una diaria: un mes de historia. */
const KEEP = Number(process.env.BACKUP_KEEP ?? '30');

function required(name: string): string {
  const value = process.env[name];

  if (!value) throw new Error(`Falta ${name} en el entorno del contenedor.`);

  return value;
}

async function main(): Promise<void> {
  const file = process.argv[2];

  if (!file) throw new Error('Uso: node dist/tasks/upload-backup <archivo>');

  const bucket = process.env.BACKUP_S3_BUCKET ?? 'globerce-backups';
  const client = new S3Client({
    region: process.env.S3_REGION ?? 'auto',
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: {
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
    // R2 rechaza el checksum que el SDK agrega por defecto.
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });

  await ensureBucket(client, bucket);

  const key = `postgres/${basename(file)}`;
  const { size } = await stat(file);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(file),
      ContentLength: size,
      ContentType: 'application/gzip',
    }),
  );

  process.stdout.write(`Subida ${key} (${(size / 1024 / 1024).toFixed(1)} MB).\n`);

  await prune(client, bucket);
}

async function ensureBucket(client: S3Client, bucket: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));

    return;
  } catch {
    // No existe, o el token no puede mirarlo: se intenta crear y el error de
    // ahí es el que sirve para saber qué pasa.
  }

  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    process.stdout.write(`Bucket ${bucket} creado.\n`);
  } catch (cause) {
    throw new Error(
      `No se pudo usar ni crear el bucket "${bucket}". Créalo a mano (privado) ` +
        `o dale permiso al token. Causa: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

/** Deja solo las `KEEP` copias más nuevas: el respaldo no puede crecer para siempre. */
async function prune(client: S3Client, bucket: string): Promise<void> {
  const listed = await client.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: 'postgres/' }),
  );
  const objects = (listed.Contents ?? [])
    .filter((object) => object.Key)
    .sort((a, b) => (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0));

  const sobran = objects.slice(KEEP);

  if (sobran.length === 0) return;

  await client.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: sobran.map((object) => ({ Key: object.Key ?? '' })) },
    }),
  );

  process.stdout.write(`Borradas ${sobran.length} copias viejas.\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
