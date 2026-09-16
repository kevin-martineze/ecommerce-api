import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '@shared/config/env';

import { LocalMediaStorage } from './local-media-storage';
import { MediaStorage } from './media-storage';
import { S3MediaStorage } from './s3-media-storage';

/**
 * Global como `PrismaModule`: las fotos las tocan catálogo y contenido, y la
 * elección de driver es una decisión del entorno, no de cada módulo.
 */
@Global()
@Module({
  providers: [
    {
      provide: MediaStorage,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): MediaStorage => {
        if (config.get('STORAGE_DRIVER', { infer: true }) === 's3') {
          // La validación del entorno ya exigió estas variables con el driver s3.
          return new S3MediaStorage({
            bucket: config.get('S3_BUCKET', { infer: true }) ?? '',
            region: config.get('S3_REGION', { infer: true }),
            endpoint: config.get('S3_ENDPOINT', { infer: true }),
            accessKeyId: config.get('S3_ACCESS_KEY_ID', { infer: true }) ?? '',
            secretAccessKey: config.get('S3_SECRET_ACCESS_KEY', { infer: true }) ?? '',
            publicUrl: config.get('S3_PUBLIC_URL', { infer: true }) ?? '',
            forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
          });
        }

        return new LocalMediaStorage(
          config.get('MEDIA_DIR', { infer: true }),
          config.get('MEDIA_PUBLIC_URL', { infer: true }),
        );
      },
    },
  ],
  exports: [MediaStorage],
})
export class StorageModule {}
