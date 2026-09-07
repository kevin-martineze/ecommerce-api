import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Env } from '@shared/config/env';
import { StoreRolesGuard } from '@shared/guards/store-roles.guard';

import { AuthController } from './controllers/auth.controller';
import { AuthService } from './providers/auth.service';
import { PasswordService } from './providers/password.service';
import { TokenService } from './providers/token.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: { expiresIn: config.get('JWT_ACCESS_TTL', { infer: true }) },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService, JwtStrategy, StoreRolesGuard],
  // Los guards se exportan para que cualquier módulo de dominio pueda proteger
  // sus rutas sin volver a declararlos.
  exports: [StoreRolesGuard, TokenService],
})
export class AuthModule {}
