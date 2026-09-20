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

  /**
   * Dónde viven las fotos.
   *
   * `local` escribe en disco y la propia API las sirve bajo `/media`: sirve
   * para desarrollo y para un solo servidor. `s3` es cualquier almacenamiento
   * compatible (R2, S3, MinIO), que es lo que hace falta con varias
   * instancias o un CDN delante.
   */
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  MEDIA_DIR: z.string().min(1).default('media'),
  MEDIA_PUBLIC_URL: z
    .string()
    .url()
    .default('http://127.0.0.1:3000/media')
    .transform(stripTrailingSlash),

  /** Solo con `STORAGE_DRIVER=s3`. Sin `S3_ENDPOINT` se usa AWS con la región. */
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().min(1).default('auto'),
  S3_BUCKET: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  /** Base pública desde la que el navegador lee el bucket (dominio de R2, CDN…). */
  S3_PUBLIC_URL: z.string().url().optional().transform(optionalStripTrailingSlash),
  /** MinIO y algunos S3 compatibles exigen `bucket` en la ruta y no como subdominio. */
  S3_FORCE_PATH_STYLE: z
    .string()
    .default('false')
    .transform((value) => value === 'true' || value === '1'),

  /**
   * Correo saliente.
   *
   * `log` escribe el mensaje en el log (con el enlace) y guarda los últimos en
   * memoria para los tests: sirve en desarrollo, donde nadie quiere un SMTP.
   * `smtp` es cualquier proveedor que hable SMTP (Resend, SES, Postmark…).
   */
  MAIL_DRIVER: z.enum(['log', 'smtp']).default('log'),
  /** `smtp://usuario:clave@host:587` o `smtps://…:465`. Solo con `MAIL_DRIVER=smtp`. */
  SMTP_URL: z.string().url().optional(),
  MAIL_FROM: z.string().min(3).default('Globerce <no-responder@globerce.local>'),

  /**
   * Asistente de la tienda. `none`: apagado en toda la plataforma, el chat ni
   * siquiera aparece. `anthropic`: responde de verdad, y cuesta plata por
   * conversación, así que enciéndelo sabiendo que los topes por plan están
   * puestos.
   */
  AI_DRIVER: z.enum(['none', 'anthropic']).default('none'),
  /** Solo con `AI_DRIVER=anthropic`. */
  ANTHROPIC_API_KEY: z.string().min(10).optional(),
  /**
   * El modelo que contesta. Por defecto el pequeño: en este diseño el modelo
   * no tiene que SABER de la tienda, sino leer lo que le devuelven las
   * consultas y redactar. Cambiarlo es una variable, no un despliegue.
   */
  AI_MODEL: z.string().min(3).default('claude-haiku-4-5-20251001'),
  /** Techo de la respuesta. Es un chat de tienda, no un ensayo. */
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(100).max(2000).default(400),

  /**
   * Base de los enlaces que viajan por correo (recuperar contraseña, aceptar
   * invitación). Sale del entorno y nunca de la petición: armar el enlace con
   * el `Host` que manda el cliente deja que un atacante se envíe a sí mismo el
   * enlace de otra cuenta.
   */
  FRONTEND_URL: z.string().url().default('http://localhost:5173').transform(stripTrailingSlash),

  /**
   * Con qué se cobra: la mensualidad de las tiendas y, con las llaves de cada
   * una, los pedidos de sus clientas.
   *
   * `none` es lo de siempre: los pagos los registra la plataforma desde su
   * consola cuando la tienda transfiere. `simulated` abre una pantalla de pago
   * de mentira que aprueba sin cobrar —sirve para probar el flujo entero y
   * para enseñar el producto—. `wompi` cobra de verdad.
   *
   * Por defecto `none`, a propósito. Una pantalla que regala suscripciones no
   * puede quedar encendida en producción porque alguien olvidó apagarla.
   */
  PAYMENTS_DRIVER: z.enum(['none', 'simulated', 'wompi']).default('none'),

  /** El Checkout Web de Wompi. Cambia a `sandbox` para probar con llaves de prueba. */
  WOMPI_CHECKOUT_URL: z.string().url().default('https://checkout.wompi.co/p/'),

  /**
   * Las llaves de la PLATAFORMA: con ellas se cobra la mensualidad de las
   * tiendas. Las de cada tienda, con las que cobra sus propios pedidos, viven
   * cifradas en la base y no acá.
   */
  WOMPI_PUBLIC_KEY: z.string().min(10).optional(),
  WOMPI_PRIVATE_KEY: z.string().min(10).optional(),
  /** Firma el enlace de pago: sin esto, el monto se podría cambiar en la URL. */
  WOMPI_INTEGRITY_SECRET: z.string().min(10).optional(),
  /** Firma los eventos que llegan: es lo que distingue a Wompi de cualquiera. */
  WOMPI_EVENTS_SECRET: z.string().min(10).optional(),

  /**
   * Dirección pública de esta API, con su prefijo.
   *
   * Es la que cada tienda pega en su panel de la pasarela para que le avise de
   * los pagos, así que tiene que ser alcanzable desde internet. Sale del
   * entorno y no del `Host` de la petición: el `Host` lo pone quien llama.
   */
  PUBLIC_API_URL: z
    .string()
    .url()
    .default('http://localhost:3000/v1')
    .transform(stripTrailingSlash),

  /**
   * Con esto se cifran las llaves de cobro de CADA tienda antes de guardarlas.
   * Son secretos ajenos: quien los tenga puede mover la plata de esa tienda.
   * Cambiarlo deja ilegibles las llaves ya guardadas y cada tienda tendrá que
   * volver a conectarse.
   */
  PAYMENTS_SECRET: z.string().min(32).optional(),

  /**
   * Secreto que el frontend manda en `x-globerce-key`. Con él puesto, la API
   * solo atiende a quien lo conozca (ver FrontSecretGuard). Vacío en
   * desarrollo y en los tests; obligatorio en cuanto la API tenga IP pública.
   */
  API_SHARED_SECRET: z
    .string()
    .min(32, 'API_SHARED_SECRET necesita al menos 32 caracteres.')
    .optional()
    .transform((value) => value || undefined),
});

/**
 * Lo que zod no puede expresar campo a campo: las variables de S3 y SMTP son
 * opcionales, salvo que su driver esté elegido.
 */
const envSchemaWithRules = envSchema.superRefine((env, ctx) => {
  if (env.MAIL_DRIVER === 'smtp' && !env.SMTP_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SMTP_URL'],
      message: 'Obligatoria cuando MAIL_DRIVER=smtp.',
    });
  }

  if (env.PAYMENTS_DRIVER === 'wompi') {
    for (const key of [
      'WOMPI_PUBLIC_KEY',
      'WOMPI_PRIVATE_KEY',
      'WOMPI_INTEGRITY_SECRET',
      'WOMPI_EVENTS_SECRET',
    ] as const) {
      if (!env[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: 'Obligatoria cuando PAYMENTS_DRIVER=wompi.',
        });
      }
    }
  }

  if (env.AI_DRIVER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ANTHROPIC_API_KEY'],
      message: 'Obligatoria cuando AI_DRIVER=anthropic.',
    });
  }

  if (env.STORAGE_DRIVER !== 's3') {
    return;
  }

  for (const key of [
    'S3_BUCKET',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'S3_PUBLIC_URL',
  ] as const) {
    if (!env[key]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `Obligatoria cuando STORAGE_DRIVER=s3.`,
      });
    }
  }
});

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function optionalStripTrailingSlash(value: string | undefined): string | undefined {
  return value === undefined ? undefined : stripTrailingSlash(value);
}

export type Env = z.infer<typeof envSchema>;

/**
 * Valida el entorno y devuelve la versión tipada.
 *
 * Se pasa como `validate` a `ConfigModule.forRoot`, así que Nest la llama antes
 * de instanciar cualquier provider: si algo falta, nada llega a conectarse.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchemaWithRules.safeParse(raw);

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
