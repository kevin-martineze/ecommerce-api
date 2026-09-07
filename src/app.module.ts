import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from '@shared/config/env';
import { AllExceptionsFilter } from '@shared/filters/all-exceptions.filter';
import { AuthModule } from '@modules/auth/auth.module';
import { HealthModule } from '@modules/health/health.module';
import { PrismaModule } from '@db/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Sin esto, un typo en una variable se descubre en la primera petición
      // que la usa, no al arrancar.
      validate: validateEnv,
    }),

    /**
     * Límite por IP.
     *
     * El techo global es holgado a propósito: lo que de verdad hay que acotar
     * son los endpoints públicos —crear pedido, validar cupón, pedir aviso de
     * reposición— y cada uno declara su propio `@Throttle`. Un techo global
     * agresivo estorbaría al panel, donde la dueña de la tienda dispara muchas
     * peticiones desde una sola IP en pocos segundos.
     */
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),

    PrismaModule,
    AuthModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
