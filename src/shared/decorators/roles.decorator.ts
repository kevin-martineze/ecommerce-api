import { SetMetadata } from '@nestjs/common';
import { MemberRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Roles permitidos en la ruta. `StoreRolesGuard` los cruza con la membresía
 * real, que consulta en la base.
 *
 * Es una restricción ADICIONAL: omitirlo no significa "cualquiera entra", sino
 * "cualquier miembro de esta tienda entra".
 */
export const Roles = (...roles: MemberRole[]) => SetMetadata(ROLES_KEY, roles);
