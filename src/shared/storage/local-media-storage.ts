import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { MediaStorage, StoredObject } from './media-storage';

/**
 * Fotos en disco, servidas por la propia API bajo `MEDIA_PUBLIC_URL`.
 *
 * Para desarrollo y para un despliegue de un solo servidor. Con varias
 * instancias cada una tendría su disco y las fotos aparecerían y
 * desaparecerían según qué instancia responda: ahí toca `s3`.
 */
export class LocalMediaStorage extends MediaStorage {
  private readonly root: string;

  constructor(
    rootDir: string,
    private readonly publicBase: string,
  ) {
    super();
    this.root = resolve(rootDir);
  }

  async put(objects: StoredObject[]): Promise<void> {
    for (const object of objects) {
      const path = this.pathFor(object.key);

      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, object.body);
    }
  }

  async remove(keys: string[]): Promise<void> {
    for (const key of keys) {
      await rm(this.pathFor(key), { force: true });
    }
  }

  publicUrl(key: string): string {
    this.assertKey(key);

    return `${this.publicBase}/${key}`;
  }

  private pathFor(key: string): string {
    this.assertKey(key);

    const path = resolve(join(this.root, key));

    // `assertKey` ya rechaza `..`, pero esta es la garantía que no depende de
    // una expresión regular: el archivo queda dentro del directorio o no se toca.
    if (!path.startsWith(`${this.root}/`)) {
      throw new Error(`La clave ${key} sale del directorio de medios.`);
    }

    return path;
  }
}
