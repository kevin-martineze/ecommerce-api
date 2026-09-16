import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

// Registra `request.file()` en el tipo de FastifyRequest.
import '@fastify/multipart';

/** Mismo techo que tenía el panel. Una foto de celular pesa 3-5 MB. */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/** Opciones con las que se registra `@fastify/multipart` en la app y en los tests. */
export const MULTIPART_OPTIONS = {
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10, fieldSize: 1024 },
};

export interface Upload {
  buffer: Buffer;
  mimetype: string;
  /** Los demás campos del formulario, ya como texto. */
  fields: Record<string, string>;
}

/**
 * Lee el único archivo de una petición multipart y sus campos.
 *
 * El archivo se carga entero en memoria porque `sharp` lo necesita así de
 * todos modos, y 12 MB es un techo que una petición a la vez soporta sin
 * problema.
 */
export async function readUpload(request: FastifyRequest): Promise<Upload> {
  if (!request.isMultipart()) {
    throw new BadRequestException('Envía la foto como multipart/form-data.');
  }

  const part = await request.file();

  if (!part) {
    throw new BadRequestException('Elige una imagen.');
  }

  if (!part.mimetype.startsWith('image/')) {
    throw new BadRequestException('El archivo no es una imagen.');
  }

  let buffer: Buffer;

  try {
    buffer = await part.toBuffer();
  } catch {
    // `toBuffer` falla cuando el archivo superó `fileSize`.
    throw new PayloadTooLargeException(
      `La imagen pesa más de ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`,
    );
  }

  if (buffer.length === 0) {
    throw new BadRequestException('Elige una imagen.');
  }

  const fields: Record<string, string> = {};

  for (const [name, field] of Object.entries(part.fields)) {
    if (
      field &&
      !Array.isArray(field) &&
      field.type === 'field' &&
      typeof field.value === 'string'
    ) {
      fields[name] = field.value;
    }
  }

  return { buffer, mimetype: part.mimetype, fields };
}
