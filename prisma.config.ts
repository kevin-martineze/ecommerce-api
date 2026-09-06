import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

/**
 * Configuración de las herramientas de Prisma (migrate, studio, introspect).
 *
 * Apunta a `DIRECT_URL` por dos razones que se acumulan:
 *
 * 1. Es la conexión SIN pooler. Un pooler en modo transacción no soporta las
 *    sentencias que usa `migrate`, y el error que devuelve no señala la causa.
 *
 * 2. Es el rol DUEÑO de las tablas. La aplicación se conecta con `tienda_app`,
 *    que no puede crear ni alterar nada — justamente para que las políticas de
 *    RLS le apliquen. Migrar con ese rol fallaría por permisos.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DIRECT_URL'),
  },
  migrations: {
    path: 'prisma/migrations',
  },
});
