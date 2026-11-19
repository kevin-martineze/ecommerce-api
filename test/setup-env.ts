import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FAKE_GOOGLE_CLIENT_ID,
  FAKE_GOOGLE_CLIENT_SECRET,
  FAKE_GOOGLE_REDIRECT_URI,
} from './utils/fake-google';

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

// Con esto puesto, la API solo atiende a quien mande el secreto: el e2e que lo
// prueba lo manda, y `test-app` lo agrega a las demás peticiones.
process.env.API_SHARED_SECRET = 'secreto-de-pruebas-con-largo-suficiente';
process.env.MEDIA_DIR = mkdtempSync(join(tmpdir(), 'tienda-media-'));

// Google nunca es el de verdad: las suites que entran con Google cambian el
// `fetch` por `FakeGoogle` (ver test-app), que firma con estas credenciales.
process.env.GOOGLE_CLIENT_ID = FAKE_GOOGLE_CLIENT_ID;
process.env.GOOGLE_CLIENT_SECRET = FAKE_GOOGLE_CLIENT_SECRET;
process.env.GOOGLE_REDIRECT_URIS = FAKE_GOOGLE_REDIRECT_URI;
