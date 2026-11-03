import { z } from 'zod';

/**
 * Consulta de la cuenta de comercio en Wompi, con la llave pública.
 *
 * Wompi tiene dos mundos, pruebas y producción, y cada uno vive en su propia
 * API. La llave dice a cuál pertenece: `pub_test_` va al sandbox y `pub_prod_`
 * a producción. Esta función es la única que pide `GET /merchants/info`: la usan
 * tanto el acceptance token del cobro (`WompiGateway.setup`) como la
 * verificación al conectar una tienda.
 *
 * La ruta vieja `GET /merchants/:public_key` está deprecada: no se usa.
 */

export type WompiMode = 'test' | 'prod';

const BASE_URL: Record<WompiMode, string> = {
  test: 'https://sandbox.wompi.co/v1',
  prod: 'https://production.wompi.co/v1',
};

const TIMEOUT_MS = 10_000;

/** En qué mundo vive una llave, por su prefijo. `null` si no es de ninguno. */
export function wompiModeOf(key: string): WompiMode | null {
  if (/^(pub|prv)_test_/.test(key)) return 'test';
  if (/^(pub|prv)_prod_/.test(key)) return 'prod';

  return null;
}

/**
 * La API de Wompi que corresponde a una llave: sandbox o producción, según su
 * prefijo. `null` si la llave no es de ningún mundo.
 *
 * Es la única fuente de esa decisión: la consulta del merchant y la URL que el
 * navegador usa para tokenizar salen de aquí, así que apuntan siempre al mismo
 * entorno.
 */
export function wompiBaseUrlOf(key: string): string | null {
  const mode = wompiModeOf(key);

  return mode ? BASE_URL[mode] : null;
}

/**
 * Solo los campos que usamos. La respuesta trae más datos del comercio
 * (correo, teléfono, documento, contacto): no se leen, no se guardan.
 */
const merchantSchema = z.object({
  data: z
    .object({
      name: z.string().nullish(),
      presigned_acceptance: z
        .object({
          acceptance_token: z.string().nullish(),
          permalink: z.string().nullish(),
        })
        .nullish(),
    })
    .nullish(),
});

export interface WompiMerchant {
  /** El nombre comercial de la cuenta (`data.name`). */
  name: string | null;
  /** El token de aceptación de los términos, firmado por Wompi. Caduca. */
  acceptanceToken: string | null;
  /** Dónde se leen los términos. */
  termsUrl: string | null;
}

export type MerchantResult =
  { ok: true; merchant: WompiMerchant } | { ok: false; reason: 'rejected' | 'unreachable' };

/**
 * Pide la cuenta de comercio de la llave pública. Nunca lanza: un fallo de red
 * sale como `unreachable`, y una llave que Wompi no reconoce como `rejected`.
 */
export async function fetchMerchant(publicKey: string): Promise<MerchantResult> {
  const base = wompiBaseUrlOf(publicKey);

  if (!base) return { ok: false, reason: 'rejected' };

  let response: Response;

  try {
    response = await fetch(`${base}/merchants/info`, {
      headers: { 'x-merchant-public-key': publicKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }

  if (!response.ok) return { ok: false, reason: 'rejected' };

  const parsed = merchantSchema.safeParse(await readJson(response));
  const data = parsed.success ? parsed.data.data : null;

  return {
    ok: true,
    merchant: {
      name: data?.name ?? null,
      acceptanceToken: data?.presigned_acceptance?.acceptance_token ?? null,
      termsUrl: data?.presigned_acceptance?.permalink ?? null,
    },
  };
}

export type WompiKeyCheck =
  | { ok: true; mode: WompiMode; merchantName: string | null }
  | { ok: false; reason: 'mixed' | 'rejected' | 'unreachable' };

/**
 * Comprueba que la llave pública sea de Wompi y que las dos llaves sean del
 * mismo mundo. La privada no se valida contra Wompi: no hay una llamada barata
 * que la compruebe sin efectos.
 */
export async function checkWompiKeys(
  publicKey: string,
  privateKey: string,
): Promise<WompiKeyCheck> {
  const mode = wompiModeOf(publicKey);
  const privateMode = wompiModeOf(privateKey);

  if (mode && privateMode && mode !== privateMode) return { ok: false, reason: 'mixed' };

  const result = await fetchMerchant(publicKey);

  if (!result.ok) return result;

  return { ok: true, mode: mode ?? 'test', merchantName: result.merchant.name };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
