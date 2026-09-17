import { Env } from '@shared/config/env';

import { LocalMediaStorage } from './local-media-storage';
import { MediaStorage } from './media-storage';
import { S3MediaStorage } from './s3-media-storage';

type StorageEnv = Pick<
  Env,
  | 'STORAGE_DRIVER'
  | 'MEDIA_DIR'
  | 'MEDIA_PUBLIC_URL'
  | 'S3_ENDPOINT'
  | 'S3_REGION'
  | 'S3_BUCKET'
  | 'S3_ACCESS_KEY_ID'
  | 'S3_SECRET_ACCESS_KEY'
  | 'S3_PUBLIC_URL'
  | 'S3_FORCE_PATH_STYLE'
>;

/**
 * El almacenamiento que pide el entorno. Un solo lugar para la API y los
 * scripts: si uno armara el cliente distinto, subiría las fotos a un bucket y
 * la API las buscaría en otro.
 */
export function createMediaStorage(env: StorageEnv): MediaStorage {
  if (env.STORAGE_DRIVER === 's3') {
    // La validación del entorno ya exigió estas variables con el driver s3.
    return new S3MediaStorage({
      bucket: env.S3_BUCKET ?? '',
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
      publicUrl: env.S3_PUBLIC_URL ?? '',
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
  }

  return new LocalMediaStorage(env.MEDIA_DIR, env.MEDIA_PUBLIC_URL);
}
