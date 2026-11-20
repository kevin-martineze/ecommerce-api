import { isKnownPushEndpoint } from '@shared/notifications/push-sender';
import { z } from 'zod';

/** Página de la bandeja: de la más nueva hacia atrás, por cursor. */
export const notificationListQuerySchema = z.object({
  before: z.string().uuid('Ese aviso no existe.').optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** Sin `ids` se marcan todos los avisos de la bandeja. */
export const markNotificationsReadSchema = z.object({
  ids: z
    .array(z.string().uuid('Ese aviso no existe.'))
    .min(1, 'Elige al menos un aviso.')
    .max(100, 'Se pueden marcar hasta 100 avisos a la vez.')
    .optional(),
});

export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;
export type MarkNotificationsReadInput = z.infer<typeof markNotificationsReadSchema>;

/**
 * Lo que trae la URL del stream. Un `after` mal formado se ignora en vez de
 * responder 400: `EventSource` reintentaría la misma URL para siempre.
 */
export const streamQuerySchema = z.object({
  ticket: z.string().min(1).max(4096).optional(),
  after: z.string().uuid().optional().catch(undefined),
});

export type StreamQuery = z.infer<typeof streamQuerySchema>;

/**
 * Lo que da `PushSubscription.toJSON()` en el navegador. El endpoint solo
 * puede ser de un servicio push conocido: la API le hace un POST.
 */
export const pushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .max(1000)
    .refine(isKnownPushEndpoint, 'Este navegador no tiene un servicio de avisos compatible.'),
  keys: z.object({
    p256dh: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9_-]+=*$/),
    auth: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9_-]+=*$/),
  }),
});

export const removePushSubscriptionSchema = z.object({
  endpoint: z.string().min(1).max(1000),
});

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;
export type RemovePushSubscriptionInput = z.infer<typeof removePushSubscriptionSchema>;
