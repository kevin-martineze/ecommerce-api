import { getDomain, getSubdomain } from 'tldts';

/**
 * Hosts de dominio propio: normalizarlos, validarlos y partirlos en zona y
 * etiqueta. Funciones puras; las usan el servicio y los proveedores.
 */

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const MAX_LENGTH = 253;

/** Minúsculas, sin espacios, sin puerto y sin punto final. `WWW.X.com:443.` → `www.x.com`. */
export function normalizeHost(raw: string): string {
  let host = raw.trim().toLowerCase();
  let previous: string;

  // Puerto y punto final pueden venir en cualquier orden: se quita hasta que no cambie.
  do {
    previous = host;
    host = host.replace(/:\d+$/, '').replace(/\.$/, '');
  } while (host !== previous);

  return host;
}

export interface SplitHost {
  /** La zona registrable: la parte que compra la dueña. `tienda.com.co` para `www.tienda.com.co`. */
  zone: string;
  /** Lo que va antes de la zona. Vacío si el host es la raíz. */
  label: string;
  /** Si el host es la raíz de la zona (`tienda.com`), y no un subdominio. */
  apex: boolean;
}

/** Parte un host ya validado. Lanza si no tiene zona registrable: no debería pasar después de `checkCustomHost`. */
export function splitHost(host: string): SplitHost {
  const zone = getDomain(host);

  if (!zone) {
    throw new Error(`Sin zona registrable: ${host}`);
  }

  const label = getSubdomain(host) ?? '';

  return { zone, label, apex: label === '' };
}

export type HostCheck =
  | { ok: true; host: string; zone: string; label: string; apex: boolean }
  | { ok: false; message: string };

/**
 * Valida un dominio propio que pidió una dueña. Los mensajes son para ella.
 *
 * `frontendHost` es el host de `FRONTEND_URL`: ni él ni sus subdominios se
 * pueden registrar, porque el panel y el propio sitio viven ahí.
 */
export function checkCustomHost(raw: string, frontendHost: string): HostCheck {
  const host = normalizeHost(raw);

  if (host === '') return fail('Escribe el dominio, por ejemplo www.mitienda.com.');
  if (host.length > MAX_LENGTH) return fail('Ese dominio es demasiado largo.');
  if (IPV4.test(host)) return fail('Usa un nombre de dominio, no una dirección IP.');

  if (host === 'localhost' || host.endsWith('.localhost')) {
    return fail('Ese dominio no se puede usar.');
  }

  if (host === 'vercel.app' || host.endsWith('.vercel.app')) {
    return fail('Ese dominio no se puede usar.');
  }

  if (frontendHost && (host === frontendHost || host.endsWith(`.${frontendHost}`))) {
    return fail('Ese dominio es de Globerce. Usa uno tuyo, por ejemplo www.mitienda.com.');
  }

  const labels = host.split('.');

  if (labels.length < 2) return fail('Falta la extensión, por ejemplo .com.');

  if (!labels.every((label) => LABEL.test(label))) {
    return fail(
      'Ese dominio tiene caracteres que no se aceptan. Usa letras, números y guiones; los acentos van en su forma punycode.',
    );
  }

  const parts = getDomain(host) ? splitHost(host) : null;

  if (!parts) return fail('Ese dominio no es válido. Revísalo y vuelve a intentar.');

  return { ok: true, host, zone: parts.zone, label: parts.label, apex: parts.apex };
}

function fail(message: string): { ok: false; message: string } {
  return { ok: false, message };
}

/**
 * El host de `FRONTEND_URL`, sin puerto. Lo usa `checkCustomHost` para
 * proteger la plataforma.
 */
export function hostOf(url: string): string {
  return normalizeHost(new URL(url).host);
}
