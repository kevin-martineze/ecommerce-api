import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { isForeignKeyViolation, isRecordNotFound, isUniqueViolation } from '@db/prisma.service';

/** Forma única de todo error que sale de la API. El frontend narrowa contra esto. */
interface ErrorBody {
  statusCode: number;
  message: string;
  /** Código estable para que el cliente decida sin parsear el mensaje. */
  error: string;
  /** Detalles de validación, cuando los hay. */
  details?: unknown;
  path: string;
  timestamp: string;
}

/**
 * Traduce cualquier excepción a una respuesta con forma predecible.
 *
 * Dos objetivos, en este orden:
 *
 * 1. **No filtrar nada.** Un error de Prisma sin envolver lleva en el mensaje
 *    el nombre de la tabla, el de la restricción y a veces el valor que chocó
 *    —que en esta API puede ser el teléfono de una clienta—. Fuera de
 *    desarrollo, un 500 dice solo que fue un 500; el detalle va al log.
 *
 * 2. **Dar al frontend algo contra qué narrowar.** `error` es un código estable
 *    que no cambia si alguien reescribe el texto en español.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const body = this.toErrorBody(exception, request.url);

    // El 5xx se loguea entero —con stack— porque es un fallo nuestro. El 4xx no
    // ensucia el log: es el cliente mandando algo inválido, y a volumen de
    // tienda pública eso es ruido constante.
    if (body.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${body.statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    void reply.status(body.statusCode).send(body);
  }

  private toErrorBody(exception: unknown, path: string): ErrorBody {
    const timestamp = new Date().toISOString();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();

      // `ValidationPipe` responde con un objeto { message: string[], error }.
      // Se conserva el detalle porque el frontend lo pinta campo por campo.
      if (typeof response === 'object' && response !== null) {
        const shape = response as { message?: unknown; error?: unknown };

        return {
          statusCode: status,
          message: Array.isArray(shape.message)
            ? 'La información enviada no es válida.'
            : String(shape.message ?? exception.message),
          error: typeof shape.error === 'string' ? shape.error : 'http_exception',
          details: Array.isArray(shape.message) ? shape.message : undefined,
          path,
          timestamp,
        };
      }

      return {
        statusCode: status,
        message: exception.message,
        error: 'http_exception',
        path,
        timestamp,
      };
    }

    if (isUniqueViolation(exception)) {
      return {
        statusCode: HttpStatus.CONFLICT,
        message: 'Ya existe un registro con ese valor.',
        error: 'unique_violation',
        path,
        timestamp,
      };
    }

    if (isRecordNotFound(exception)) {
      return {
        statusCode: HttpStatus.NOT_FOUND,
        message: 'No encontramos lo que buscas.',
        error: 'not_found',
        path,
        timestamp,
      };
    }

    if (isForeignKeyViolation(exception)) {
      return {
        statusCode: HttpStatus.CONFLICT,
        message: 'No se puede completar: hay otros registros que dependen de este.',
        error: 'foreign_key_violation',
        path,
        timestamp,
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Algo falló de nuestro lado. Ya quedó registrado.',
      error: 'internal_error',
      path,
      timestamp,
    };
  }
}
