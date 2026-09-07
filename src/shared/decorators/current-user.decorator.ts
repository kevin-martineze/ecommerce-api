import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Lo que la estrategia JWT deja en `request.user`. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  /**
   * Tienda a la que está atado el token con el que llegó esta petición.
   *
   * `StoreRolesGuard` lo compara contra el `:storeId` del path. Null significa
   * que la cuenta no es miembro de ninguna tienda todavía.
   */
  storeId: string | null;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    return ctx.switchToHttp().getRequest<{ user: AuthenticatedUser }>().user;
  },
);
