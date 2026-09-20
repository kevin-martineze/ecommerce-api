import { ValidationPipe } from '@nestjs/common';

/**
 * El pipe de validación global.
 *
 * Vive fuera de `main.ts` para que los tests e2e levanten la app con EXACTAMENTE
 * las mismas reglas que producción. Copiarlas a mano en el test es la forma
 * clásica de que un test pase contra una configuración que ya nadie usa.
 */
export function buildValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    // `whitelist` descarta lo que no está en el DTO; `forbidNonWhitelisted`
    // además lo rechaza con 400. Es la diferencia entre ignorar en silencio
    // un campo que el cliente creía estar mandando y decírselo.
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
  });
}
