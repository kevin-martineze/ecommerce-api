import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MemberRole } from '@prisma/client';
import { AuthenticatedUser } from '@shared/decorators/current-user.decorator';
import { ROLES_KEY } from '@shared/decorators/roles.decorator';
import { PrismaService } from '@db/prisma.service';

/**
 * Autoriza el acceso a una tienda, y opcionalmente por rol dentro de ella.
 *
 * Aplica las capas 2 y 3 del aislamiento (ver docs/ARCHITECTURE.md § 4):
 *
 * 1. El `storeId` del token tiene que coincidir con el `:storeId` del path. Un
 *    token de la tienda A no puede nombrar a la tienda B: el ataque no se
 *    rechaza, deja de ser expresable.
 *
 * 2. La membresía se consulta EN CADA PETICIÓN, no se lee de un claim. Así,
 *    quitarle acceso a alguien surte efecto en la siguiente request y no en la
 *    próxima vez que vuelva a entrar — que con tokens de 30 días puede ser
 *    nunca.
 *
 * La verificación de membresía corre SIEMPRE que se aplica este guard, tenga o
 * no `@Roles(...)` la ruta. `@Roles` agrega una restricción encima, nunca la
 * reemplaza: una ruta de solo lectura sin `@Roles` que no verificara membresía
 * dejaría entrar a cualquier usuario autenticado de CUALQUIER tienda.
 *
 * Requiere correr después de `JwtAuthGuard` —necesita `request.user`— y que la
 * ruta tenga un parámetro `:storeId`.
 */
@Injectable()
export class StoreRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user: AuthenticatedUser;
      params: Record<string, string | undefined>;
    }>();

    const storeId = request.params.storeId;

    if (!storeId) {
      // Es un error de programación, no del cliente: alguien puso este guard en
      // una ruta sin `:storeId`. Se corta igual, porque dejar pasar sería peor.
      throw new ForbiddenException('La ruta no declara una tienda.');
    }

    if (request.user.storeId !== storeId) {
      throw new ForbiddenException(
        'Tu sesión pertenece a otra tienda. Cambia de tienda para operar aquí.',
      );
    }

    const membership = await this.prisma.storeMember.findUnique({
      where: { storeId_userId: { storeId, userId: request.user.id } },
      select: { role: true },
    });

    if (!membership) {
      throw new ForbiddenException('No tienes acceso a esta tienda.');
    }

    const requiredRoles = this.reflector.getAllAndOverride<MemberRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (requiredRoles && requiredRoles.length > 0 && !requiredRoles.includes(membership.role)) {
      throw new ForbiddenException('Tu rol no permite esta acción.');
    }

    return true;
  }
}
