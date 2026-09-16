import { DeleteObjectsCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { MediaStorage, StoredObject } from './media-storage';

export interface S3Options {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrl: string;
  forcePathStyle: boolean;
}

/** `DeleteObjects` admite hasta mil claves por llamada. */
const DELETE_BATCH = 1000;

/**
 * Fotos en un bucket compatible con S3: R2, S3, MinIO.
 *
 * Las fotos se sirven desde `publicUrl` (el dominio público del bucket o un
 * CDN delante), nunca a través de la API. Las claves llevan una marca de tiempo
 * y no se reutilizan, así que el caché puede ser inmutable.
 */
export class S3MediaStorage extends MediaStorage {
  private readonly client: S3Client;

  constructor(private readonly options: S3Options) {
    super();
    this.client = new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  async put(objects: StoredObject[]): Promise<void> {
    for (const object of objects) {
      this.assertKey(object.key);

      await this.client.send(
        new PutObjectCommand({
          Bucket: this.options.bucket,
          Key: object.key,
          Body: object.body,
          ContentType: object.contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    }
  }

  async remove(keys: string[]): Promise<void> {
    for (let start = 0; start < keys.length; start += DELETE_BATCH) {
      const batch = keys.slice(start, start + DELETE_BATCH);

      batch.forEach((key) => this.assertKey(key));

      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.options.bucket,
          Delete: { Objects: batch.map((key) => ({ Key: key })), Quiet: true },
        }),
      );
    }
  }

  publicUrl(key: string): string {
    this.assertKey(key);

    return `${this.options.publicUrl}/${key}`;
  }
}
