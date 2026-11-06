import type { CustomDomainStatus, StoreStatus } from '@prisma/client';

/** Lo que hace falta para saber dónde vive una tienda: su slug, su estado y su dominio. */
export interface PublicAddressSource {
  slug: string;
  status: StoreStatus;
  customDomain: string | null;
  customDomainStatus: CustomDomainStatus | null;
  /** Si el plan vigente incluye dominio propio. Se pregunta en cada lectura, no se guarda. */
  planAllowsCustomDomain: boolean;
}

/**
 * ¿La tienda sirve en su dominio propio? Hace falta que el dominio esté activo,
 * que el plan lo incluya y que la tienda no esté suspendida.
 */
export function isCustomDomainLive(source: PublicAddressSource): boolean {
  return (
    source.customDomain !== null &&
    source.customDomainStatus === 'ACTIVE' &&
    source.planAllowsCustomDomain &&
    source.status !== 'SUSPENDED'
  );
}

/**
 * La dirección pública de una tienda. Es la única función que la arma: nadie
 * más concatena el slug con el host de `FRONTEND_URL`.
 *
 * `https://<dominio propio>` si está vivo; si no, el subdominio, con el
 * protocolo y el host de `FRONTEND_URL`. En desarrollo da
 * `http://slug.localhost:5173`.
 */
export function publicUrl(source: PublicAddressSource, frontendUrl: string): string {
  if (isCustomDomainLive(source)) {
    return `https://${source.customDomain}`;
  }

  const front = new URL(frontendUrl);

  return `${front.protocol}//${source.slug}.${front.host}`;
}
