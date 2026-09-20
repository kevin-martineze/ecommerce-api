import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@db/prisma.service';

export interface PublicStore {
  id: string;
  name: string;
  slug: string;
}

/**
 * Resuelve la tienda pública por su slug.
 *
 * Vive en `shared/` porque lo usan la tienda pública y el checkout, y un módulo
 * de dominio no importa de otro. Cada módulo lo declara en sus `providers`.
 */
@Injectable()
export class PublicStoreResolver {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `stores` no está bajo RLS a propósito (ver migración de integridad § 3):
   * este es justamente el paso que decide de qué tienda se habla. Todo lo que
   * viene después va por `forStore` con el id que devuelve esto, nunca con el
   * slug que llegó en la URL.
   *
   * Una tienda suspendida responde 404 y no 403: para una visitante la tienda
   * simplemente no está, y un 403 confirmaría que el slug existe.
   */
  async resolve(slug: string): Promise<PublicStore> {
    const store = await this.prisma.store.findUnique({
      where: { slug },
      select: { id: true, name: true, slug: true, status: true },
    });

    if (!store || store.status === 'SUSPENDED') {
      throw new NotFoundException('Esta tienda no existe.');
    }

    return { id: store.id, name: store.name, slug: store.slug };
  }
}
