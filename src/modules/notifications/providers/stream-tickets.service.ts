import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { z } from 'zod';
import { Env } from '@shared/config/env';
import { StreamTicketDto } from '@shared/dtos/notifications/notifications.dto';

/**
 * El `aud` que distingue un ticket de cualquier otro JWT firmado con el mismo
 * secreto. La estrategia de sesión rechaza todo token con `aud`, así que un
 * ticket no abre el panel; y el stream exige este `aud`, así que un access
 * token no abre el stream.
 */
export const STREAM_TICKET_AUDIENCE = 'notifications-stream';

/**
 * Cuánto vive un ticket. Va en la URL (`EventSource` no manda cabeceras), y
 * una URL termina en historiales y logs de proxies: corto, para que copiarla
 * después no sirva de nada.
 */
const TICKET_TTL_SECONDS = 60;

/** De qué bandeja es el stream: la de una tienda o la de la consola. */
export type StreamScope = { kind: 'store'; storeId: string } | { kind: 'platform' };

export interface StreamClaims {
  userId: string;
  scope: StreamScope;
}

const claimsSchema = z.object({
  sub: z.string().uuid(),
  scope: z.union([z.literal('platform'), z.string().regex(/^store:[0-9a-f-]{36}$/i)]),
});

/**
 * Emite y lee los tickets del stream de avisos.
 *
 * Existe porque el navegador abre el stream directo contra la API (el front va
 * a Vercel, donde una conexión larga por pestaña ocupa una función todo el
 * rato), y `EventSource` no puede mandar el access token en una cabecera. El
 * frontend pide el ticket desde su servidor, con la sesión, y se lo pasa al
 * navegador.
 */
@Injectable()
export class StreamTicketsService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async issue(userId: string, scope: StreamScope): Promise<StreamTicketDto> {
    const ticket = await this.jwt.signAsync(
      { sub: userId, scope: scope.kind === 'platform' ? 'platform' : `store:${scope.storeId}` },
      { audience: STREAM_TICKET_AUDIENCE, expiresIn: TICKET_TTL_SECONDS },
    );

    return {
      url: `${this.config.get('PUBLIC_API_URL', { infer: true })}/notifications/stream`,
      ticket,
      expiresAt: new Date(Date.now() + TICKET_TTL_SECONDS * 1000).toISOString(),
    };
  }

  /** Null si no es un ticket vigente de este tipo. Nunca lanza. */
  async verify(ticket: string): Promise<StreamClaims | null> {
    let payload: unknown;

    try {
      payload = await this.jwt.verifyAsync(ticket, { audience: STREAM_TICKET_AUDIENCE });
    } catch {
      return null;
    }

    const parsed = claimsSchema.safeParse(payload);

    if (!parsed.success) {
      return null;
    }

    const { sub, scope } = parsed.data;

    return {
      userId: sub,
      scope:
        scope === 'platform' ? { kind: 'platform' } : { kind: 'store', storeId: scope.slice(6) },
    };
  }
}
