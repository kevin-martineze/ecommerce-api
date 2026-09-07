import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Env } from '@shared/config/env';
import { AuthenticatedUser } from '@shared/decorators/current-user.decorator';

import { AccessTokenPayload } from '../providers/token.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService<Env, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // Sin esto un token vencido seguiría entrando: passport-jwt no verifica
      // la expiración salvo que se le pida.
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET', { infer: true }),
    });
  }

  /**
   * Lo que devuelve esto es lo que queda en `request.user`.
   *
   * No se consulta la base acá, a propósito: esta función corre en CADA
   * petición autenticada y una consulta más por request se paga en todas. Lo
   * que sí exige base —comprobar que la membresía siga viva— lo hace
   * `StoreRolesGuard`, y solo en las rutas que operan sobre una tienda.
   */
  validate(payload: AccessTokenPayload): AuthenticatedUser {
    if (!payload.sub || !payload.email) {
      throw new UnauthorizedException('La sesión no es válida. Vuelve a entrar.');
    }

    return {
      id: payload.sub,
      email: payload.email,
      storeId: payload.storeId ?? null,
    };
  }
}
