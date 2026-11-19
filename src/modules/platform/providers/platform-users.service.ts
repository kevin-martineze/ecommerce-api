import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  DeleteStoreDto,
  DeleteUserDto,
  PlatformStoreRefDto,
  PlatformUserDetailDto,
  PlatformUserDto,
  PlatformUserListQueryDto,
} from '@shared/dtos/platform/platform-users.dto';
import { PrismaService, TenantClient } from '@db/prisma.service';

import { StoreDeletionService } from './store-deletion.service';

const GOOGLE = 'google';

/** Hasta cuántas cuentas devuelve el listado. Igual que el de tiendas. */
const LIST_LIMIT = 200;

const USER_NOT_FOUND = 'Esa cuenta no existe.';
const STORE_NOT_FOUND = 'Esa tienda no existe.';

const USER_INCLUDE = {
  memberships: {
    include: { store: { select: { id: true, name: true, slug: true, status: true } } },
    orderBy: { createdAt: 'asc' },
  },
  platformAdmin: { select: { userId: true } },
  identities: { where: { provider: GOOGLE }, select: { id: true }, take: 1 },
  refreshTokens: { orderBy: { createdAt: 'desc' }, select: { createdAt: true }, take: 1 },
} satisfies Prisma.UserInclude;

type UserRow = Prisma.UserGetPayload<{ include: typeof USER_INCLUDE }>;

/**
 * Cuentas de la plataforma: verlas, deshabilitarlas y eliminarlas, y el
 * borrado definitivo de una tienda.
 *
 * `users`, `store_members`, `user_identities` y `refresh_tokens` no están bajo
 * RLS: se leen sin contexto de tienda. Lo que cuelga de una tienda se borra
 * por `StoreDeletionService`, que sí fija el contexto de cada una.
 *
 * Nadie se deshabilita ni se elimina a sí mismo, ni a otra cuenta de
 * `platform_admins`: ese acceso se quita a mano con el script, a propósito, y
 * una consola que pudiera dejar a la plataforma sin administradores no es
 * algo que se quiera a un clic.
 */
@Injectable()
export class PlatformUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deletion: StoreDeletionService,
  ) {}

  async listUsers(query: PlatformUserListQueryDto): Promise<PlatformUserDto[]> {
    const search = query.q?.trim();
    const contains = (value: string) => ({ contains: value, mode: Prisma.QueryMode.insensitive });

    const users = await this.prisma.user.findMany({
      where: {
        ...(query.status === 'active' ? { disabledAt: null } : {}),
        ...(query.status === 'disabled' ? { disabledAt: { not: null } } : {}),
        ...(search
          ? {
              OR: [
                { email: contains(search) },
                { fullName: contains(search) },
                {
                  memberships: {
                    some: {
                      store: { OR: [{ name: contains(search) }, { slug: contains(search) }] },
                    },
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: LIST_LIMIT,
      include: USER_INCLUDE,
    });

    return users.map(toUserDto);
  }

  async getUser(userId: string): Promise<PlatformUserDetailDto> {
    const user = await this.requireUser(userId);

    return {
      ...toUserDto(user),
      soleOwnerStores: await soleOwnerStores(this.prisma, userId),
    };
  }

  /**
   * Deshabilitar cierra todas sus sesiones en la misma transacción: el refresh
   * token deja de servir ya, y el access token —que vive hasta 15 minutos— lo
   * cortan los guards en la siguiente petición.
   */
  async setDisabled(
    actorId: string,
    userId: string,
    disabled: boolean,
  ): Promise<PlatformUserDetailDto> {
    const user = await this.requireUser(userId);

    assertCanManage(actorId, user, disabled ? 'deshabilitar' : 'reactivar');

    await this.prisma.withTransaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        // Volver a deshabilitar una ya deshabilitada conserva la fecha original.
        data: { disabledAt: disabled ? (user.disabledAt ?? new Date()) : null },
      });

      if (disabled) {
        await tx.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    });

    return this.getUser(userId);
  }

  /**
   * Elimina la cuenta y las tiendas donde era la única dueña.
   *
   * `deleteStoreIds` es lo que la ficha le mostró a quien confirma. Se vuelve
   * a calcular dentro de la transacción, con las filas de dueñas bloqueadas:
   * si alguien cambió roles entre ver y confirmar, las listas no coinciden y
   * no se borra nada. Nunca se elimina una tienda que no se vio en pantalla.
   */
  async deleteUser(actorId: string, userId: string, dto: DeleteUserDto): Promise<void> {
    const user = await this.requireUser(userId);

    assertCanManage(actorId, user, 'eliminar');

    if (dto.confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
      throw new BadRequestException('El correo no coincide con el de la cuenta.');
    }

    const leftovers = await this.prisma.withTransaction(async (tx) => {
      const stores = await soleOwnerStores(tx, userId, { lock: true });

      if (
        !sameIds(
          stores.map((store) => store.id),
          dto.deleteStoreIds,
        )
      ) {
        throw new ConflictException(
          'Las tiendas de esta cuenta cambiaron. Vuelve a cargar la ficha y confirma de nuevo.',
        );
      }

      const deleted = await this.deletion.deleteRows(
        tx,
        stores.map((store) => store.id),
      );

      await tx.user.delete({ where: { id: userId } });

      return deleted;
    });

    await this.deletion.cleanUp(leftovers);
  }

  /**
   * Borrado definitivo. Solo con la tienda ya suspendida: suspender es
   * reversible y deja ver qué se pierde; borrar no tiene vuelta atrás, y se
   * lleva el historial de pagos de la suscripción.
   */
  async deleteStore(storeId: string, dto: DeleteStoreDto): Promise<void> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { slug: true, status: true },
    });

    if (!store) {
      throw new NotFoundException(STORE_NOT_FOUND);
    }

    if (store.status !== 'SUSPENDED') {
      throw new ConflictException('Suspende la tienda antes de eliminarla.');
    }

    if (dto.confirmSlug.trim().toLowerCase() !== store.slug) {
      throw new BadRequestException('El nombre corto no coincide con el de la tienda.');
    }

    const leftovers = await this.prisma.withTransaction(async (tx) => {
      // Se relee bloqueada: una reactivación que llegue a la vez gana o espera,
      // pero no deja borrar una tienda que ya volvió a vender.
      const rows = await tx.$queryRaw<{ status: string }[]>`
        select status from stores where id = ${storeId}::uuid for update`;

      if (rows[0]?.status !== 'SUSPENDED') {
        throw new ConflictException('Suspende la tienda antes de eliminarla.');
      }

      return this.deletion.deleteRows(tx, [storeId]);
    });

    await this.deletion.cleanUp(leftovers);
  }

  private async requireUser(userId: string): Promise<UserRow> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: USER_INCLUDE,
    });

    if (!user) {
      throw new NotFoundException(USER_NOT_FOUND);
    }

    return user;
  }
}

function assertCanManage(actorId: string, user: UserRow, verb: string): void {
  if (user.id === actorId) {
    throw new ForbiddenException(`No puedes ${verb} tu propia cuenta.`);
  }

  if (user.platformAdmin) {
    throw new ForbiddenException(
      `Esa cuenta administra la plataforma. Quítale ese acceso antes de ${verb}la.`,
    );
  }
}

/**
 * Tiendas donde la cuenta es dueña y no hay otra. Con `lock`, bloquea las filas
 * de dueñas de esas tiendas hasta el fin de la transacción, igual que
 * `TeamService` al quitar una dueña.
 */
async function soleOwnerStores(
  db: TenantClient | PrismaService,
  userId: string,
  options: { lock?: boolean } = {},
): Promise<PlatformStoreRefDto[]> {
  const rows = options.lock
    ? await db.$queryRaw<{ store_id: string }[]>`
        select store_id from store_members
        where store_id in (
          select store_id from store_members where user_id = ${userId}::uuid and role = 'OWNER'
        ) and role = 'OWNER'
        order by store_id, user_id
        for update`
    : await db.$queryRaw<{ store_id: string }[]>`
        select store_id from store_members
        where store_id in (
          select store_id from store_members where user_id = ${userId}::uuid and role = 'OWNER'
        ) and role = 'OWNER'`;

  const owners = new Map<string, number>();

  for (const row of rows) {
    owners.set(row.store_id, (owners.get(row.store_id) ?? 0) + 1);
  }

  const ids = [...owners].filter(([, count]) => count === 1).map(([storeId]) => storeId);

  if (ids.length === 0) {
    return [];
  }

  return db.store.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, slug: true },
    orderBy: { name: 'asc' },
  });
}

function sameIds(expected: string[], received: string[]): boolean {
  const left = new Set(expected.map((id) => id.toLowerCase()));
  const right = new Set(received.map((id) => id.toLowerCase()));

  return left.size === right.size && [...left].every((id) => right.has(id));
}

function toUserDto(user: UserRow): PlatformUserDto {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    createdAt: user.createdAt,
    disabledAt: user.disabledAt,
    lastSignInAt: user.refreshTokens[0]?.createdAt ?? null,
    hasPassword: user.passwordHash !== null,
    hasGoogle: user.identities.length > 0,
    isPlatformAdmin: user.platformAdmin !== null,
    memberships: user.memberships.map((membership) => ({
      storeId: membership.store.id,
      storeName: membership.store.name,
      storeSlug: membership.store.slug,
      storeStatus: membership.store.status,
      role: membership.role,
    })),
  };
}
