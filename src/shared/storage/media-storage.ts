/** Un archivo listo para guardar. La clave es la ruta dentro del almacenamiento. */
export interface StoredObject {
  key: string;
  body: Buffer;
  contentType: string;
}

/** Claves permitidas: las genera la API, pero el filtro impide que una clave rara salga del bucket o del directorio. */
const KEY_PATTERN = /^[a-z0-9](?:[a-z0-9._-]|\/(?!\/))*$/i;

/**
 * Dónde viven las fotos.
 *
 * Es una clase abstracta y no una interfaz para poder usarla como token de
 * inyección: los servicios piden `MediaStorage` y el módulo decide, según el
 * entorno, si detrás hay un disco o un bucket. Ningún servicio sabe cuál.
 *
 * `put` y `remove` reciben listas porque cada foto son tres archivos (y el
 * LQIP embebido): así una foto se guarda o se borra de una vez.
 */
export abstract class MediaStorage {
  abstract put(objects: StoredObject[]): Promise<void>;

  /** Borrar una clave que no existe no es un error: la foto ya no está, que era el objetivo. */
  abstract remove(keys: string[]): Promise<void>;

  abstract publicUrl(key: string): string;

  protected assertKey(key: string): void {
    if (!KEY_PATTERN.test(key) || key.includes('..')) {
      throw new Error(`Clave de almacenamiento inválida: ${key}`);
    }
  }
}
