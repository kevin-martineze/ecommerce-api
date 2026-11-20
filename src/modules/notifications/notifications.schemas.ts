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
