import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  Controller,
  Get,
  Logger,
  OnModuleDestroy,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OpenRoute } from '@shared/decorators/open-route.decorator';
import { NotificationDto } from '@shared/dtos/notifications/notifications.dto';
import { NotificationBus } from '@shared/notifications/notification-bus';
import { ZodPipe } from '@shared/validation/zod-pipe';

import { StreamQuery, streamQuerySchema } from '../notifications.schemas';
import { NotificationStreamService } from '../providers/notification-stream.service';
import { StreamTicketsService } from '../providers/stream-tickets.service';

/** Cuánto espera el navegador antes de reconectar solo. */
const RETRY_MS = 5_000;

/**
 * Un comentario cada tanto para que ningún proxy dé la conexión por muerta.
 * Caddy, Cloudflare y los balanceadores cortan entre 60 y 100 s de silencio.
 */
const HEARTBEAT_MS = 25_000;

/**
 * Vida máxima de una conexión. Al cerrarla, el navegador reconecta con un
 * ticket nuevo: así una membresía revocada no queda escuchando para siempre
 * con un ticket que se emitió cuando todavía valía.
 */
const MAX_LIFETIME_MS = 30 * 60_000;

/**
 * El stream de avisos en vivo (SSE).
 *
 * Es la única ruta que el NAVEGADOR llama directo (ver `StreamTicketsService`
 * para el porqué). Por eso:
 *
 * - `@OpenRoute`: el navegador no tiene el secreto compartido del frontend.
 *   La puerta es el ticket, que solo emite el panel con una sesión válida.
 * - `Access-Control-Allow-Origin: *`, sin credenciales: no hay cookies que
 *   proteger, y el panel corre en subdominios y dominios propios que no están
 *   en `CORS_ORIGINS`.
 * - La respuesta se escribe a mano (`hijack`): los hooks de Fastify
 *   comprimirían el stream, y comprimido no sale nada hasta llenar un bloque.
 *
 * Al conectar con `after` (el último aviso que vio), primero reenvía lo que se
 * perdió (`event: missed`) y después lo nuevo (`event: notification`), sin
 * repetir: lo que llega en vivo mientras se lee la base espera en una cola.
 */
@ApiTags('avisos')
@OpenRoute()
@Controller('notifications')
export class NotificationStreamController implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationStreamController.name);

  /** Cómo cerrar cada conexión abierta, para no colgar el apagado de la API. */
  private readonly open = new Set<() => void>();

  constructor(
    private readonly tickets: StreamTicketsService,
    private readonly stream: NotificationStreamService,
    private readonly bus: NotificationBus,
  ) {}

  @Get('stream')
  @ApiOperation({
    summary: 'Avisos en vivo (text/event-stream). Se abre con el ticket de `stream-ticket`.',
  })
  async connect(
    @Query(new ZodPipe(streamQuerySchema)) query: StreamQuery,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const claims = query.ticket ? await this.tickets.verify(query.ticket) : null;

    if (!claims) {
      throw new UnauthorizedException('La conexión de avisos venció. Vuelve a conectar.');
    }

    // Antes de tomar la respuesta: un 403 todavía sale como cualquier error.
    const channel = await this.stream.authorize(claims);

    reply.hijack();

    const raw = reply.raw;

    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // nginx y algunos proxies bufferizan sin esto.
      'x-accel-buffering': 'no',
      'access-control-allow-origin': '*',
    });
    raw.write(`retry: ${RETRY_MS}\n\n`);

    const sent = new Set<string>();
    const queued: NotificationDto[] = [];
    let replaying = true;

    // `missed`: lo reenviado al reconectar, que el panel agrega sin anunciar.
    // `notification`: lo que llega en vivo, que el panel anuncia con un toast.
    const send = (notification: NotificationDto, event: 'notification' | 'missed'): void => {
      if (raw.writableEnded || raw.destroyed || sent.has(notification.id)) {
        return;
      }

      sent.add(notification.id);
      raw.write(
        `id: ${notification.id}\nevent: ${event}\ndata: ${JSON.stringify(notification)}\n\n`,
      );
    };

    const unsubscribe = this.bus.subscribe(channel, (notification) => {
      if (replaying) {
        queued.push(notification);
      } else {
        send(notification, 'notification');
      }
    });

    const heartbeat = setInterval(() => {
      if (!raw.writableEnded) {
        raw.write(': ping\n\n');
      }
    }, HEARTBEAT_MS);

    const close = (): void => {
      clearInterval(heartbeat);
      clearTimeout(lifetime);
      unsubscribe();
      this.open.delete(close);

      if (!raw.writableEnded) {
        raw.end();
      }
    };

    const lifetime = setTimeout(close, MAX_LIFETIME_MS);

    this.open.add(close);
    request.raw.on('close', close);
    raw.on('close', close);

    if (query.after) {
      try {
        for (const notification of await this.stream.missedSince(claims, query.after)) {
          send(notification, 'missed');
        }
      } catch {
        // La respuesta ya es nuestra: un error acá no puede subir al filtro.
        // Lo perdido se ve igual al abrir la bandeja.
        this.logger.warn('No se pudieron reenviar los avisos perdidos de una conexión.');
      }
    }

    replaying = false;

    for (const notification of queued) {
      send(notification, 'notification');
    }
  }

  onModuleDestroy(): void {
    for (const close of [...this.open]) {
      close();
    }
  }
}
