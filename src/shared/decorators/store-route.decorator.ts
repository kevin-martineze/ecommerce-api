import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '@shared/guards/jwt-auth.guard';
import { StoreRolesGuard } from '@shared/guards/store-roles.guard';

/**
 * Marca un controlador como parte del panel: la superficie `/stores/:storeId/*`.
 *
 * Junta lo que esa superficie exige siempre, en el orden en que tiene que
 * correr: primero identidad (`JwtAuthGuard`) y después tienda y rol
 * (`StoreRolesGuard`, que lee el `request.user` que deja el primero). Escribir
 * los dos guards a mano en cada controlador es invitar a que alguno quede con
 * uno solo, o con los dos al revés.
 *
 * Los roles se siguen pidiendo con `@Roles(...)` en la ruta que lo necesite.
 */
export function StoreRoute() {
  return applyDecorators(
    UseGuards(JwtAuthGuard, StoreRolesGuard),
    ApiBearerAuth(),
    ApiParam({ name: 'storeId', description: 'Tienda activa del token. Si no coincide, 403.' }),
  );
}
