import { isCustomDomainLive, PublicAddressSource } from '@shared/tenancy/public-url';

/**
 * La vuelta de la pasarela tiene que caer en una dirección nuestra, o en el
 * dominio propio de ESA tienda.
 *
 * Sin esto, quien arma el cobro elige a dónde va la clienta después de pagar,
 * que es un sitio de phishing esperando a alguien que acaba de escribir los
 * datos de su tarjeta. Dos caminos aceptados:
 * - el host de `FRONTEND_URL` y sus subdominios, como siempre;
 * - el dominio propio de la tienda, solo si está vivo (la misma regla que
 *   `publicUrl`) y solo por https. Un dominio de otra tienda o uno pendiente se
 *   rechaza.
 *
 * Devuelve la URL normalizada, o null si no es de esta tienda.
 */
export function safeReturnUrl(
  url: string,
  policy: { frontendHost: string; store: PublicAddressSource },
): string | null {
  let destino: URL;

  try {
    destino = new URL(url);
  } catch {
    return null;
  }

  const { frontendHost, store } = policy;
  const esNuestro =
    destino.hostname === frontendHost || destino.hostname.endsWith(`.${frontendHost}`);

  if (esNuestro) return destino.toString();

  const esDominioPropio =
    store.customDomain !== null &&
    isCustomDomainLive(store) &&
    destino.protocol === 'https:' &&
    destino.hostname === store.customDomain;

  return esDominioPropio ? destino.toString() : null;
}
