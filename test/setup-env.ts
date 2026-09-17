import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Corre antes de cargar cualquier módulo de cada archivo de prueba.
 *
 * Tiene que ser aquí y no en `startTestApp`: `ConfigModule.forRoot` lee y
 * valida el entorno en el momento en que se importa `AppModule`, así que
 * cualquier variable fijada después llega tarde.
 *
 * Las fotos van a un directorio temporal propio de cada archivo, nunca al
 * bucket ni al `media/` de desarrollo, y el correo nunca sale: se lee de la
 * memoria del `LogMailer`. Sea cual sea el `.env`.
 */
process.env.STORAGE_DRIVER = 'local';
process.env.MAIL_DRIVER = 'log';
process.env.MEDIA_DIR = mkdtempSync(join(tmpdir(), 'tienda-media-'));
