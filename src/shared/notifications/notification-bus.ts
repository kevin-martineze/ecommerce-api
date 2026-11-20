import { EventEmitter } from 'node:events';

import { Logger } from '@nestjs/common';
import { NotificationDto } from '@shared/dtos/notifications/notifications.dto';

/**
 * Canal de una persona en una superficie: su bandeja en una tienda o su
 * bandeja en la consola. Una misma cuenta que trabaja en dos tiendas tiene dos
 * canales, y el stream de una tienda nunca recibe avisos de la otra.
 */
export type NotificationChannel = `store:${string}:${string}` | `platform:${string}`;

export function storeChannel(storeId: string, userId: string): NotificationChannel {
  return `store:${storeId}:${userId}`;
}

export function platformChannel(userId: string): NotificationChannel {
  return `platform:${userId}`;
}

export type NotificationHandler = (notification: NotificationDto) => void;

/**
 * Reparte los avisos ya guardados a las conexiones abiertas.
 *
 * No guarda nada: la bandeja en la base es la fuente. Si una conexión se pierde
 * un aviso, lo recupera al reconectar leyendo la base. Por eso publicar nunca
 * falla hacia quien publica.
 *
 * Es abstracto para poder cambiar de implementación sin tocar a nadie: hoy la
 * API corre en una sola instancia y basta la memoria. Con dos instancias, una
 * conexión abierta en la A no se enteraría de un pedido creado en la B; ahí se
 * cambia por una implementación sobre `LISTEN/NOTIFY` de Postgres.
 */
export abstract class NotificationBus {
  abstract publish(channel: NotificationChannel, notification: NotificationDto): void;

  /** Devuelve la función que cancela la suscripción. Llamarla dos veces no hace nada. */
  abstract subscribe(channel: NotificationChannel, handler: NotificationHandler): () => void;
}

const EVENT = 'notification';

/** Una sola instancia de la API: un `EventEmitter` por canal. */
export class InMemoryNotificationBus extends NotificationBus {
  private readonly logger = new Logger(InMemoryNotificationBus.name);
  private readonly channels = new Map<NotificationChannel, EventEmitter>();

  publish(channel: NotificationChannel, notification: NotificationDto): void {
    this.channels.get(channel)?.emit(EVENT, notification);
  }

  subscribe(channel: NotificationChannel, handler: NotificationHandler): () => void {
    let emitter = this.channels.get(channel);

    if (!emitter) {
      emitter = new EventEmitter();
      // Una persona puede tener muchas pestañas abiertas; el tope por defecto
      // (10) solo serviría para llenar el log de advertencias.
      emitter.setMaxListeners(0);
      this.channels.set(channel, emitter);
    }

    // Una conexión que falla al escribir no puede impedir que las demás
    // pestañas de la misma persona reciban el aviso.
    const safe = (notification: NotificationDto): void => {
      try {
        handler(notification);
      } catch {
        this.logger.warn(`Una conexión no pudo recibir el aviso ${notification.id}.`);
      }
    };

    emitter.on(EVENT, safe);

    let active = true;

    return () => {
      if (!active || !emitter) {
        return;
      }

      active = false;
      emitter.off(EVENT, safe);

      if (emitter.listenerCount(EVENT) === 0) {
        this.channels.delete(channel);
      }
    };
  }

  /** Canales con al menos una conexión. Solo para pruebas y métricas. */
  get openChannels(): number {
    return this.channels.size;
  }
}
