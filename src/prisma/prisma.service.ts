import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Cliente de Prisma dentro de una transacción con el inquilino ya fijado.
 *
 * Es el mismo cliente de siempre menos las operaciones que no tienen sentido
 * anidadas (`$transaction`, `$connect`, `$disconnect`). Que el tipo lo impida
 * es deliberado: abrir una transacción dentro de otra reinicia el `SET LOCAL`
 * en una conexión distinta y el aislamiento se pierde sin ruido.
 */
export type TenantClient = Prisma.TransactionClient;

/** Un UUID v4 canónico. Se valida antes de mandarlo a `set_config`. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('Falta DATABASE_URL. Copia .env.example a .env y complétalo.');
    }

    super({ adapter: new PrismaPg({ connectionString }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Conectado a Postgres');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Ejecuta trabajo con el inquilino fijado en la sesión de base de datos.
   *
   * Todo acceso a datos de una tienda pasa por aquí. Abre una transacción y lo
   * primero que hace dentro es `set_config('app.store_id', …, true)`; las
   * políticas de RLS comparan contra ese valor, así que una consulta a la que
   * se le olvidó el `where storeId` devuelve CERO filas en vez de las de otra
   * tienda.
   *
   * Es una red, no el mecanismo principal. El filtro explícito por `storeId`
   * sigue siendo obligatorio en cada consulta y hay un test de arquitectura que
   * lo verifica; esto existe para el día en que ese test tenga un hueco.
   *
   * Tres detalles que sostienen la garantía:
   *
   * 1. El tercer argumento de `set_config` en `true` lo hace LOCAL a la
   *    transacción. Con `false` el valor sobreviviría en la conexión y, al
   *    volver esa conexión al pool, la siguiente petición —de otra tienda—
   *    heredaría el inquilino anterior. Es exactamente el fallo que este
   *    método existe para impedir.
   *
   * 2. Abrir transacción explícita es lo que garantiza que el `set_config` y
   *    las consultas viajen por la MISMA conexión. Sin transacción, un pooler
   *    en modo transacción puede mandarlas por conexiones distintas y el
   *    `SET LOCAL` no aplicaría a nada.
   *
   * 3. `storeId` se valida como UUID antes de entrar. Va parametrizado, así que
   *    no hay inyección posible, pero un valor con forma rara produciría un
   *    error de casteo dentro de la política —en mitad de una consulta, con un
   *    mensaje que no señala la causa— en vez de un 500 claro aquí.
   *
   * @param storeId Identificador de la tienda YA VERIFICADO por el guard. Nunca
   *                se pasa aquí un valor crudo del path, del header o del body.
   */
  async forStore<T>(storeId: string, work: (tx: TenantClient) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await this.setStoreContext(tx, storeId);

      return work(tx);
    });
  }

  /**
   * Transacción SIN inquilino fijado de entrada.
   *
   * Existe para el único flujo que no puede tenerlo desde el principio: crear
   * una tienda. La fila de `stores` no está bajo RLS —hay que poder resolver
   * una tienda por su slug antes de saber de qué tienda hablamos— pero todo lo
   * que cuelga de ella sí lo está. El registro hace entonces, dentro de UNA
   * sola transacción: inserta la tienda, fija el contexto con
   * `setStoreContext`, y recién ahí crea ajustes, suscripción y catálogos base.
   *
   * Partirlo en dos transacciones dejaría, ante una caída en el medio, una
   * tienda a medio nacer: existe, responde, y no tiene ni número de WhatsApp.
   */
  async withTransaction<T>(work: (tx: TenantClient) => Promise<T>): Promise<T> {
    return this.$transaction(work);
  }

  /**
   * Fija el inquilino dentro de una transacción ya abierta.
   *
   * Es público porque `withTransaction` lo necesita desde fuera, pero la vía
   * normal es `forStore`. Si te encuentras llamando a esto directamente,
   * comprueba que no estés reimplementando `forStore` con menos garantías.
   *
   * @param storeId Identificador YA VERIFICADO por el guard. Nunca un valor
   *                crudo del path, del header o del body.
   */
  async setStoreContext(tx: TenantClient, storeId: string): Promise<void> {
    if (!UUID_PATTERN.test(storeId)) {
      throw new InternalServerErrorException(
        'Se intentó abrir una transacción de tienda con un identificador que no es UUID.',
      );
    }

    await tx.$executeRaw`select set_config('app.store_id', ${storeId}, true)`;
  }
}

/**
 * Códigos de error de Prisma que la API traduce a respuestas HTTP en lugar de
 * dejar escapar como 500.
 *
 * Con el driver adapter (`@prisma/adapter-pg`), `error.code` es el código
 * PROPIO de Prisma (`P2002`, `P2025`…), no el SQLSTATE de Postgres. El SQLSTATE
 * real queda anidado en `error.meta.driverAdapterError.cause.originalCode`.
 */
const PRISMA_ERROR = {
  UNIQUE_CONSTRAINT: 'P2002',
  RECORD_NOT_FOUND: 'P2025',
  FOREIGN_KEY: 'P2003',
} as const;

function prismaCode(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}

/** Choque de un `@@unique`: slug repetido, código de cupón repetido, SKU repetido. */
export function isUniqueViolation(error: unknown): boolean {
  return prismaCode(error) === PRISMA_ERROR.UNIQUE_CONSTRAINT;
}

/** La fila que se iba a actualizar o borrar no existe (o no es de esta tienda). */
export function isRecordNotFound(error: unknown): boolean {
  return prismaCode(error) === PRISMA_ERROR.RECORD_NOT_FOUND;
}

/** Se intentó borrar algo de lo que todavía cuelgan filas: color en uso, talla en uso. */
export function isForeignKeyViolation(error: unknown): boolean {
  return prismaCode(error) === PRISMA_ERROR.FOREIGN_KEY;
}
