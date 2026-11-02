import { BadRequestException, PipeTransform } from '@nestjs/common';
import { z } from 'zod';

/**
 * Valida la entrada con un esquema zod y devuelve el valor ya tipado.
 *
 * Lo que llega del cliente es `unknown`: el pipe no confía en la forma y no
 * castea. Si no pasa el esquema, responde 400 con el primer mensaje, que ya
 * viene en español para la persona que escribe.
 */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: z.ZodType<T, z.ZodTypeDef, unknown>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);

    if (!parsed.success) {
      const first = parsed.error.issues[0];

      throw new BadRequestException(first?.message ?? 'Los datos no son válidos.');
    }

    return parsed.data;
  }
}
