import { ConflictException, NotFoundException } from '@nestjs/common';
import { isRecordNotFound, isUniqueViolation } from '@db/prisma.service';

interface Messages {
  /** P2025: la fila no existe, o es de otra tienda y RLS la oculta. Para afuera es lo mismo. */
  notFound?: string;
  /** P2002: choque de un `@@unique`. */
  conflict?: string;
}

/**
 * Traduce los errores de Prisma que tienen significado de negocio a una
 * excepción HTTP con un mensaje que la dueña de la tienda entiende.
 *
 * El filtro global ya convierte estos códigos en 404 y 409, pero con un texto
 * genérico («Ya existe un registro con ese valor.»). Acá se pone el que sabe
 * de qué se trata. Lo que no esté en `messages` sigue de largo hasta el filtro.
 *
 * Envuelve la transacción entera y no una consulta suelta, a propósito: dentro
 * de una transacción un error de Postgres la deja abortada y cualquier consulta
 * siguiente también falla. Hay que dejar que se deshaga y traducir afuera.
 */
export async function translatePrismaErrors<T>(work: Promise<T>, messages: Messages): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (messages.notFound && isRecordNotFound(error)) {
      throw new NotFoundException(messages.notFound);
    }

    if (messages.conflict && isUniqueViolation(error)) {
      throw new ConflictException(messages.conflict);
    }

    throw error;
  }
}
