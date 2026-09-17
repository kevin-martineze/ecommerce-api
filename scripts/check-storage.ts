import 'dotenv/config';

import { validateEnv } from '../src/shared/config/env';
import { createMediaStorage } from '../src/shared/storage/create-media-storage';

/**
 * Comprueba el almacenamiento configurado de punta a punta.
 *
 *   pnpm storage:check
 *
 * Sube un archivo pequeño, lo pide por su URL pública como lo haría un
 * navegador, revisa las cabeceras y lo borra. Sirve para validar las
 * credenciales de R2 y el dominio público antes de subir una foto de verdad.
 */

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<void> {
  const env = validateEnv(process.env);
  const storage = createMediaStorage(env);
  const key = `checks/storage-${Date.now().toString(36)}.txt`;
  const body = Buffer.from(`comprobación ${new Date().toISOString()}`, 'utf8');

  say(`Driver: ${env.STORAGE_DRIVER}`);

  await storage.put([{ key, body, contentType: 'text/plain; charset=utf-8' }]);
  say('ok   subir');

  const url = storage.publicUrl(key);
  let failed = false;

  try {
    const response = await fetch(url);
    const served = Buffer.from(await response.arrayBuffer());

    if (!response.ok || !served.equals(body)) {
      failed = true;
      say(`FALLA leer ${url} → HTTP ${response.status}`);
      say('     Revisa S3_PUBLIC_URL y que el bucket tenga acceso público por ese dominio.');
    } else {
      say(`ok   leer ${url}`);
      say(`     cache-control: ${response.headers.get('cache-control') ?? '(ninguno)'}`);
    }
  } finally {
    await storage.remove([key]);
    say('ok   borrar');
  }

  if (failed) {
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `\n${error.message}\n` : error);
  process.exit(1);
});
