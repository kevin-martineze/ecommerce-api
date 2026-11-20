import { z } from 'zod';

/**
 * Qué puede decir un aviso, por tipo.
 *
 * Es la única puerta de `data`: se valida al escribir (un disparador que manda
 * un campo de más falla en el test, no en producción) y al leer (una fila vieja
 * con otra forma se descarta con un aviso en el log, en vez de romper la
 * bandeja entera).
 *
 * Regla que no se negocia: nada de datos de una clienta. Ni nombre, ni
 * teléfono, ni correo, ni dirección. Un aviso se muestra en un toast, se puede
 * reenviar por push y queda en la bandeja de cada miembro; el detalle se ve al
 * abrir el enlace, dentro de la sesión. `.strict()` hace que un campo extra
 * sea un error y no un descuido silencioso.
 */

const id = z.string().uuid();
const money = z.number().int().nonnegative();
const storeName = z.string().min(1).max(200);

const orderPlaced = z.object({
  type: z.literal('ORDER_PLACED'),
  data: z
    .object({
      orderId: id,
      number: z.number().int().positive(),
      total: money,
      itemCount: z.number().int().positive(),
      /** Si el pedido ya llegó pagado (pago en línea aprobado al crearlo). */
      paid: z.boolean(),
    })
    .strict(),
});

const orderPaid = z.object({
  type: z.literal('ORDER_PAID'),
  data: z
    .object({
      orderId: id,
      number: z.number().int().positive(),
      total: money,
    })
    .strict(),
});

export const storeNotificationEventSchema = z.discriminatedUnion('type', [orderPlaced, orderPaid]);

const storeCreated = z.object({
  type: z.literal('STORE_CREATED'),
  data: z
    .object({
      storeId: id,
      storeName,
      slug: z.string().min(1).max(100),
      userId: id,
      /** La cuenta se creó junto con la tienda. */
      newAccount: z.boolean(),
    })
    .strict(),
});

const userRegistered = z.object({
  type: z.literal('USER_REGISTERED'),
  data: z.object({ userId: id }).strict(),
});

const subscriptionData = z
  .object({
    storeId: id,
    storeName,
    amountCop: money,
    planCode: z.string().min(1).max(50),
  })
  .strict();

const subscriptionPaid = z.object({
  type: z.literal('SUBSCRIPTION_PAID'),
  data: subscriptionData,
});

const subscriptionFailed = z.object({
  type: z.literal('SUBSCRIPTION_FAILED'),
  data: subscriptionData,
});

/** Sin el asunto ni el texto: el caso se lee dentro de la consola. */
const supportData = z.object({ ticketId: id, storeId: id, storeName }).strict();

const supportTicketOpened = z.object({
  type: z.literal('SUPPORT_TICKET_OPENED'),
  data: supportData,
});

const supportOwnerReplied = z.object({
  type: z.literal('SUPPORT_OWNER_REPLIED'),
  data: supportData,
});

export const platformNotificationEventSchema = z.discriminatedUnion('type', [
  storeCreated,
  userRegistered,
  subscriptionPaid,
  subscriptionFailed,
  supportTicketOpened,
  supportOwnerReplied,
]);

export type StoreNotificationEvent = z.infer<typeof storeNotificationEventSchema>;
export type PlatformNotificationEvent = z.infer<typeof platformNotificationEventSchema>;
