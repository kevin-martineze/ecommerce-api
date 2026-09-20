import { randomBytes } from 'node:crypto';

import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { StoredObject } from '@shared/storage/media-storage';

/**
 * Los tres anchos que sirve la tienda, en WebP. Son los mismos que generaba el
 * frontend: las fotos migradas y las nuevas tienen que verse igual.
 */
export const IMAGE_SIZES = [
  { key: 'thumb', width: 400, quality: 70 },
  { key: 'card', width: 800, quality: 80 },
  { key: 'full', width: 1600, quality: 80 },
] as const;

export type ImageSize = (typeof IMAGE_SIZES)[number]['key'];

export interface ProcessedImage {
  thumb: Buffer;
  card: Buffer;
  full: Buffer;
  /** Miniatura diminuta embebida en base64, para pintar algo antes de que cargue la foto real. */
  lqip: string;
}

/**
 * Convierte la foto original a los tres anchos y genera el LQIP.
 *
 * `rotate()` sin argumentos aplica la orientación EXIF: sin eso, una foto
 * tomada con el celular en vertical se ve acostada. `withoutEnlargement` deja
 * una foto pequeña en su tamaño en vez de inventarle píxeles.
 */
export async function processImage(original: Buffer): Promise<ProcessedImage> {
  try {
    // Falla acá, con un mensaje claro, si el archivo no es una imagen.
    await sharp(original).metadata();
  } catch {
    throw new BadRequestException('El archivo no es una imagen.');
  }

  const [thumb, card, full] = await Promise.all(
    IMAGE_SIZES.map((size) =>
      sharp(original)
        .rotate()
        .resize({ width: size.width, withoutEnlargement: true })
        .webp({ quality: size.quality })
        .toBuffer(),
    ),
  );

  const lqip = await sharp(original)
    .rotate()
    .resize({ width: 24 })
    .blur(1)
    .webp({ quality: 30 })
    .toBuffer();

  return {
    thumb: thumb ?? Buffer.alloc(0),
    card: card ?? Buffer.alloc(0),
    full: full ?? Buffer.alloc(0),
    lqip: `data:image/webp;base64,${lqip.toString('base64')}`,
  };
}

/**
 * Ruta base de una foto nueva. Los tres archivos cuelgan de ella con el
 * sufijo del tamaño, igual que las fotos que vienen de Supabase.
 *
 * Empieza por la tienda para que un bucket compartido quede ordenado por
 * inquilino, y la marca de tiempo hace que una clave nunca se reutilice: el
 * caché de las fotos puede ser inmutable.
 */
export function newStoragePath(storeId: string, folder: string, slug: string): string {
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;

  return `stores/${storeId}/${folder}/${slug}/${stamp}`;
}

export function imageObjectKey(storagePath: string, size: ImageSize): string {
  return `${storagePath}-${size}.webp`;
}

/** Las tres claves de una foto, para borrarlas juntas. */
export function imageObjectKeys(storagePath: string): string[] {
  return IMAGE_SIZES.map((size) => imageObjectKey(storagePath, size.key));
}

export function imageObjects(storagePath: string, processed: ProcessedImage): StoredObject[] {
  return IMAGE_SIZES.map((size) => ({
    key: imageObjectKey(storagePath, size.key),
    body: processed[size.key],
    contentType: 'image/webp',
  }));
}
