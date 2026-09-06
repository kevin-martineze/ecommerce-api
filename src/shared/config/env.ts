import { z } from 'zod';

/**
 * Contrato de variables de entorno.
 *
 * Se valida UNA vez, al arrancar, y el proceso muere si falta algo. La
 * alternativa —leer `process.env.X` donde haga falta— convierte un error de
 * configuración en un fallo intermitente en producción, tres semanas después
 * del despliegue, en la única ruta que nadie probó.
 *
 * Los secretos NO tienen valor por defecto a propósito. Un default para
 * `JWT_SECRET` es la forma clásica de terminar firmando tokens de producción
 * con `change-me`: nadie ve un error, así que nadie lo cambia.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  /** Prefijo de todas las rutas HTTP. Versionar desde el día 1 sale gratis; añadirlo después, no. */
  API_PREFIX: z.string().min(1).default('v1'),

  /**
   * Conexión de runtime. Debe apuntar al rol restringido (`tienda_app`), no al
   * dueño de las tablas: el dueño se salta RLS y dejaría la defensa en
   * profundidad multi-tienda como decoración. Ver docker/postgres-init/01-roles.sql.
   */
  DATABASE_URL: z.string().url(),

  /** Conexión de migraciones (rol dueño, sin pooler). La lee prisma.config.ts, no la app. */
  DIRECT_URL: z.string().url().optional(),

  /**
   * 32 caracteres es el mínimo razonable para HS256: por debajo, la clave tiene
   * menos entropía que la salida del propio HMAC.
   */
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().min(1).default('15m'),
  JWT_REFRESH_TTL: z.string().min(1).default('30d'),
  COOKIE_SECRET: z.string().min(32),

  /**
   * Orígenes permitidos, separados por coma. Se normaliza a array acá para que
   * ningún módulo tenga que volver a partir el string y equivocarse con los
   * espacios.
   */
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Valida el entorno y devuelve la versión tipada.
 *
 * Se pasa como `validate` a `ConfigModule.forRoot`, así que Nest la llama antes
 * de instanciar cualquier provider: si algo falta, nada llega a conectarse.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Configuración de entorno inválida. Copia .env.example a .env y completa:\n${detail}`,
    );
  }

  return parsed.data;
}
