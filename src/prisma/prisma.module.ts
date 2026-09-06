import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';

/**
 * Global porque prácticamente todo módulo de dominio necesita la base y
 * declarar el import en cada uno solo añade ruido sin añadir aislamiento: el
 * aislamiento real entre tiendas lo dan los guards y `forStore`, no el grafo de
 * módulos de Nest.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
