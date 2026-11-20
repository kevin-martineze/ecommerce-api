import { sendNotification, WebPushError } from 'web-push';

/** Lo que guarda un navegador suscrito: a dónde mandar y con qué cifrar. */
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Cómo terminó un envío:
 *
 * - `sent`: el servicio push lo aceptó.
 * - `gone`: el navegador ya no existe o quitó el permiso (404/410). La
 *   suscripción se borra.
 * - `failed`: cualquier otra cosa. Se deja la suscripción y se sigue.
 */
export type PushOutcome = 'sent' | 'gone' | 'failed';

/**
 * Avisos push salientes.
 *
 * Clase abstracta para usarla como token de inyección, igual que `Mailer`: sin
 * llaves VAPID el entorno pone `DisabledPushSender` y nada sale. `publicKey`
 * es lo que el navegador necesita para suscribirse; null si no hay push.
 */
export abstract class PushSender {
  abstract readonly publicKey: string | null;
  abstract send(target: PushTarget, payload: string): Promise<PushOutcome>;
}

export class DisabledPushSender extends PushSender {
  readonly publicKey = null;

  send(): Promise<PushOutcome> {
    return Promise.resolve('failed');
  }
}

/** Cuánto guarda el servicio push un aviso si el navegador está apagado. */
const PUSH_TTL_SECONDS = 24 * 60 * 60;

export class WebPushSender extends PushSender {
  constructor(
    readonly publicKey: string,
    private readonly privateKey: string,
    private readonly subject: string,
  ) {
    super();
  }

  async send(target: PushTarget, payload: string): Promise<PushOutcome> {
    try {
      await sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        payload,
        {
          TTL: PUSH_TTL_SECONDS,
          urgency: 'high',
          timeout: 10_000,
          vapidDetails: {
            subject: this.subject,
            publicKey: this.publicKey,
            privateKey: this.privateKey,
          },
        },
      );

      return 'sent';
    } catch (error) {
      if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
        return 'gone';
      }

      return 'failed';
    }
  }
}

/**
 * Los servicios push a los que la API acepta mandar.
 *
 * El `endpoint` lo manda el navegador, y la API le hace un POST: sin esta lista,
 * cualquiera con sesión podría poner una dirección interna (la de metadatos
 * de EC2, una base de datos) y usar la API para tocarla. Son los de Chrome y
 * Edge (FCM), Firefox (Mozilla), Safari (Apple) y Windows (WNS).
 */
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com'];
const PUSH_HOST_SUFFIXES = ['.push.services.mozilla.com', '.push.apple.com', '.notify.windows.com'];

export function isKnownPushEndpoint(endpoint: string): boolean {
  let url: URL;

  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) {
    return false;
  }

  const host = url.hostname.toLowerCase();

  return PUSH_HOSTS.includes(host) || PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}
