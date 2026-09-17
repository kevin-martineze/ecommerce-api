import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '@shared/config/env';

import { createMediaStorage } from './create-media-storage';
import { MediaStorage } from './media-storage';

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
      useFactory: (config: ConfigService<Env, true>): MediaStorage =>
        createMediaStorage({
          STORAGE_DRIVER: config.get('STORAGE_DRIVER', { infer: true }),
          MEDIA_DIR: config.get('MEDIA_DIR', { infer: true }),
          MEDIA_PUBLIC_URL: config.get('MEDIA_PUBLIC_URL', { infer: true }),
          S3_ENDPOINT: config.get('S3_ENDPOINT', { infer: true }),
          S3_REGION: config.get('S3_REGION', { infer: true }),
          S3_BUCKET: config.get('S3_BUCKET', { infer: true }),
          S3_ACCESS_KEY_ID: config.get('S3_ACCESS_KEY_ID', { infer: true }),
          S3_SECRET_ACCESS_KEY: config.get('S3_SECRET_ACCESS_KEY', { infer: true }),
          S3_PUBLIC_URL: config.get('S3_PUBLIC_URL', { infer: true }),
          S3_FORCE_PATH_STYLE: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
        }),
    },
  ],
  exports: [MediaStorage],
})
export class StorageModule {}
