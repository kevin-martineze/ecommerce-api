import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Env } from '@shared/config/env';
import { IS_OPEN_ROUTE } from '@shared/decorators/open-route.decorator';
import { timingSafeEqualString } from '@shared/utils/secrets';

/** Cabecera donde el frontend manda el secreto compartido. */
export const FRONT_SECRET_HEADER = 'x-globerce-key';

/**
 * Deja entrar solo al frontend de Globerce.
 *
 * La API no tiene por qué ser alcanzable desde internet: el navegador nunca le
 * habla, lo hace el servidor de SvelteKit. Pero en un despliegue simple (una
 * instancia con su IP pública) no hay red privada donde esconderla, y sin
 * puerta cualquiera puede llamarla directo. Eso importa por dos cosas:
 *
 * - las rutas públicas de las tiendas no llevan límite por IP, porque confían
 *   en que quien llama es el frontend (ver ARCHITECTURE § 3);
 * - ese mismo frontend es quien dice en `X-Forwarded-For` cuál es la IP de la
 *   visitante, y se le cree.
 *
 * Con `API_SHARED_SECRET` puesto, toda petición tiene que traer el secreto en
 * la cabecera. Es un guard global: proteger ruta por ruta es la forma de que
 * una ruta nueva nazca abierta. Sin la variable, el guard no hace nada, que es
 * lo que hace falta en desarrollo y en los tests.
 */
@Injectable()
export class FrontSecretGuard implements CanActivate {
  private readonly secret: string | undefined;

  constructor(
    config: ConfigService<Env, true>,
    private readonly reflector: Reflector,
  ) {
    this.secret = config.get('API_SHARED_SECRET', { infer: true });
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.secret) {
      return true;
    }

    const isOpen = this.reflector.getAllAndOverride<boolean | undefined>(IS_OPEN_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isOpen) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>();
    const presented = request.headers[FRONT_SECRET_HEADER];

    if (typeof presented !== 'string' || !timingSafeEqualString(presented, this.secret)) {
      // Sin detalle: a quien llega por fuera no se le dice qué le falta.
      throw new ForbiddenException('No autorizado.');
    }

    return true;
  }
}
