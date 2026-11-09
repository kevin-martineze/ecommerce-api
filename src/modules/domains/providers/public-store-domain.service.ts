import { Injectable, NotFoundException } from '@nestjs/common';
import { PublicStoreDomainDto } from '@shared/dtos/domains/domain.dto';
import { domainStatusView } from '@shared/domains/domain-status';
import { normalizeHost } from '@shared/domains/host';
import { planAllowsCustomDomain } from '@shared/tenancy/custom-domain-plan';
import { PrismaService } from '@db/prisma.service';

/**
 * Qué tienda sirve un dominio propio, para el frontend. Va sin autenticación:
 * es lo que decide de qué tienda habla la tienda pública en ese host.
 */
@Injectable()
export class PublicStoreDomainService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `stores` no está bajo RLS a propósito (igual que el slug): es el paso que
   * decide la tienda. Una tienda suspendida responde 404, no 403, para no
   * confirmar que el dominio existe.
   */
  async resolve(rawHost: string): Promise<PublicStoreDomainDto> {
    const host = normalizeHost(rawHost);

    const store = await this.prisma.store.findUnique({
      where: { customDomain: host },
      select: { id: true, slug: true, status: true, customDomainStatus: true },
    });

    if (!store || store.status === 'SUSPENDED' || !store.customDomainStatus) {
      throw new NotFoundException('Esta tienda no existe.');
    }

    const allowed = await this.prisma.forStore(store.id, (tx) =>
      planAllowsCustomDomain(tx, store.id),
    );

    return {
      slug: store.slug,
      status: domainStatusView(store.customDomainStatus, allowed),
    };
  }
}
