import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '@shared/decorators/current-user.decorator';
import { PrismaService } from '@db/prisma.service';

/**
 * Autoriza la superficie `/platform/*`: solo administradores de la plataforma.
 *
 * Consulta `platform_admins` EN CADA PETICIÓN, igual que `StoreRolesGuard` con
 * la membresía: quitarle el acceso a alguien surte efecto en la siguiente
 * request. La tabla no tiene API que la escriba; se entra con
 * `scripts/grant-platform-admin.ts`, a mano, a propósito.
 *
 * Requiere correr después de `JwtAuthGuard`.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user: AuthenticatedUser }>();

    const admin = await this.prisma.platformAdmin.findUnique({
      where: { userId: request.user.id },
      select: { userId: true },
    });

    if (!admin) {
      throw new ForbiddenException('Esta cuenta no administra la plataforma.');
    }

    return true;
  }
}
