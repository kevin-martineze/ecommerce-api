import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client, TokenPayload } from 'google-auth-library';
import { Env } from '@shared/config/env';

/** Lo que importa de una cuenta de Google, ya verificado. */
export interface GoogleProfile {
  /** El `sub` de Google: la identidad estable, aunque cambie el correo. */
  subject: string;
  /** Normalizado como en `login`: sin espacios y en minúsculas. */
  email: string;
  fullName: string | null;
}

/** La petición que hace la API cuando habla con Google. */
export type GoogleFetch = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

/**
 * Con qué habla con Google. En producción es el `fetch` de Node; los e2e lo
 * cambian por un Google de mentira que firma sus propios `id_token`, así la
 * verificación de la firma, la audiencia y el emisor corre de verdad.
 */
export const GOOGLE_FETCH = Symbol('GOOGLE_FETCH');

export const googleFetchProvider = {
  provide: GOOGLE_FETCH,
  useValue: ((...args: Parameters<typeof fetch>) => fetch(...args)) satisfies GoogleFetch,
};

const EXCHANGE_FAILED = {
  message: 'No pudimos confirmar tu cuenta de Google. Vuelve a intentarlo.',
  error: 'google_exchange_failed',
};

/**
 * Habla con Google: canjea el código de autorización y verifica el `id_token`.
 *
 * Flujo Authorization Code con PKCE del lado del servidor. El frontend arma la
 * URL de Google y recibe el `code`; acá se canjea con el `client_secret`, que
 * no sale de la API. El `id_token` llega directo de Google por TLS, pero igual
 * se verifica firma, audiencia, emisor y vencimiento: es lo que hace que el
 * `sub` y el correo signifiquen algo.
 */
@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);
  private client: OAuth2Client | null = null;

  constructor(
    private readonly config: ConfigService<Env, true>,
    @Inject(GOOGLE_FETCH) private readonly googleFetch: GoogleFetch,
  ) {}

  /** Canjea el código y devuelve la cuenta de Google ya verificada. */
  async profileFromCode(
    code: string,
    codeVerifier: string,
    redirectUri: string,
  ): Promise<GoogleProfile> {
    const { client, clientId } = this.requireClient();

    this.assertRedirectAllowed(redirectUri);

    const idToken = await this.exchange(client, code, codeVerifier, redirectUri);

    return this.verify(client, clientId, idToken);
  }

  /** Canjea el `code` por el `id_token`. Un código vencido o ya usado es un 400. */
  private async exchange(
    client: OAuth2Client,
    code: string,
    codeVerifier: string,
    redirectUri: string,
  ): Promise<string> {
    try {
      const { tokens } = await client.getToken({ code, codeVerifier, redirect_uri: redirectUri });

      if (!tokens.id_token) {
        throw new Error('Google respondió sin id_token.');
      }

      return tokens.id_token;
    } catch (error: unknown) {
      // Solo el motivo: el cuerpo de la respuesta de Google puede traer el código.
      this.logger.warn(`Google rechazó el canje del código: ${reasonOf(error)}`);

      throw new BadRequestException(EXCHANGE_FAILED);
    }
  }

  /** Firma, `aud`, `iss` y `exp` los comprueba la librería; el correo, acá. */
  private async verify(
    client: OAuth2Client,
    clientId: string,
    idToken: string,
  ): Promise<GoogleProfile> {
    let payload: TokenPayload | undefined;

    try {
      const ticket = await client.verifyIdToken({ idToken, audience: clientId });

      payload = ticket.getPayload();
    } catch (error: unknown) {
      this.logger.warn(`El id_token de Google no pasó la verificación: ${reasonOf(error)}`);

      throw new BadRequestException(EXCHANGE_FAILED);
    }

    if (!payload?.sub) {
      throw new BadRequestException(EXCHANGE_FAILED);
    }

    // El vínculo automático por correo descansa entero en esto: un correo que
    // Google no confirma no prueba nada.
    if (!payload.email || payload.email_verified !== true) {
      throw new ForbiddenException({
        message:
          'Google no confirma tu correo. Verifícalo en tu cuenta de Google y vuelve a intentarlo.',
        error: 'google_email_unverified',
      });
    }

    const fullName = payload.name?.trim();

    return {
      subject: payload.sub,
      email: payload.email.trim().toLowerCase(),
      fullName: fullName ? fullName.slice(0, 120) : null,
    };
  }

  private assertRedirectAllowed(redirectUri: string): void {
    const allowed = this.config.get('GOOGLE_REDIRECT_URIS', { infer: true });

    if (!allowed.includes(redirectUri)) {
      throw new BadRequestException({
        message: 'La dirección de regreso de Google no está permitida.',
        error: 'google_redirect_uri_not_allowed',
      });
    }
  }

  /**
   * El cliente se arma la primera vez que hace falta: así una API sin Google
   * configurado arranca igual y solo este endpoint responde 503.
   */
  private requireClient(): { client: OAuth2Client; clientId: string } {
    const clientId = this.config.get('GOOGLE_CLIENT_ID', { infer: true });
    const clientSecret = this.config.get('GOOGLE_CLIENT_SECRET', { infer: true });
    const redirectUris = this.config.get('GOOGLE_REDIRECT_URIS', { infer: true });

    if (!clientId || !clientSecret || redirectUris.length === 0) {
      throw new ServiceUnavailableException({
        message: 'Entrar con Google no está disponible por ahora. Usa tu correo y contraseña.',
        error: 'google_not_configured',
      });
    }

    this.client ??= new OAuth2Client({
      clientId,
      clientSecret,
      transporterOptions: { fetchImplementation: this.googleFetch },
    });

    return { client: this.client, clientId };
  }
}

/**
 * El motivo, sin el detalle. `google-auth-library` pega el payload del token
 * después de los dos puntos ("Token used too late, …: {…}"), y el payload trae
 * el correo de la persona: eso no va al log.
 */
function reasonOf(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'motivo desconocido';
  }

  return (error.message.split(':')[0] ?? '').slice(0, 120);
}
