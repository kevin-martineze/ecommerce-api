/**
 * Parámetros de URL que son credenciales y no pueden quedar en un log.
 *
 * `ticket` abre el stream de avisos (`EventSource` no manda cabeceras, así que
 * viaja en la URL). Vive 60 s, pero un log vive meses.
 */
const SECRET_PARAMS = ['ticket'];

const PATTERN = new RegExp(`([?&](?:${SECRET_PARAMS.join('|')})=)[^&#]*`, 'gi');

/** La URL con el valor de cada parámetro secreto reemplazado. */
export function redactUrl(url: string): string {
  return url.replace(PATTERN, '$1[oculto]');
}
