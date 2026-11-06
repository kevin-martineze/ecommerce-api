import { Logger } from '@nestjs/common';

import { DomainInspection, DomainProvider } from './domain-provider';
import { hasOwnershipRecord, ownershipValue, TxtResolver } from './ownership';
import { splitHost } from './host';

/** Destino de ejemplo del CNAME de un subdominio. No es una IP ni un host real del proveedor. */
const CNAME_TARGET = 'cname.vercel-dns.com';
/** IP de ejemplo para la raíz (`A @`). */
const APEX_ADDRESS = '76.76.21.21';

/** Los hosts que empiezan por `pendiente.` no se verifican: sirve para probar el camino de error sin DNS. */
const PENDING_PREFIX = 'pendiente.';

/**
 * Driver de desarrollo y de tests: no llama a ningún proveedor.
 *
 * Los registros son de ejemplo y la verificación se simula. Así el frontend
 * puede probar el flujo entero sin tocar un DNS real: cualquier host queda
 * activo al verificar, salvo los que empiezan por `pendiente.`.
 */
export class LogDomainProvider extends DomainProvider {
  private readonly logger = new Logger('DomainProvider');

  add(host: string): Promise<void> {
    this.logger.log(`Registrar dominio ${host}`);

    return Promise.resolve();
  }

  inspect(host: string): Promise<DomainInspection> {
    const configured = !host.startsWith(PENDING_PREFIX);
    const { label, apex } = splitHost(host);

    const records = apex
      ? [{ type: 'A' as const, name: '@', value: APEX_ADDRESS }]
      : [{ type: 'CNAME' as const, name: label, value: CNAME_TARGET }];

    return Promise.resolve({
      configured,
      records,
      error: configured ? null : 'El registro de enrutamiento todavía no apunta a Globerce.',
    });
  }

  verifyOwnership(host: string, token: string): Promise<boolean> {
    // Mismo código que con Vercel, con un DNS simulado: el TXT "existe" con el
    // token de la tienda, salvo en los hosts pendientes.
    const simulated: TxtResolver = {
      resolveTxt: () =>
        host.startsWith(PENDING_PREFIX)
          ? Promise.reject(new Error('ENODATA'))
          : Promise.resolve([[ownershipValue(token)]]),
    };

    return hasOwnershipRecord(simulated, host, token);
  }

  remove(host: string): Promise<void> {
    this.logger.log(`Quitar dominio ${host}`);

    return Promise.resolve();
  }
}
