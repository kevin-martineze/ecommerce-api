import { z } from 'zod';

/** Las categorías que la dueña puede elegir. Mismas claves que el enum de Prisma. */
export const SUPPORT_CATEGORY_VALUES = [
  'CONFIGURATION',
  'DOMAIN',
  'PAYMENTS',
  'PLAN',
  'PRODUCTS_ORDERS',
  'ERROR',
  'OTHER',
] as const;

export const SUPPORT_STATUS_VALUES = ['OPEN', 'ANSWERED', 'CLOSED'] as const;

/** Un mensaje del hilo: texto libre, sin espacios sobrantes, con tope de tamaño. */
const bodyField = z
  .string({ required_error: 'Escribe tu mensaje.' })
  .trim()
  .min(1, 'Escribe tu mensaje.')
  .max(5000, 'El mensaje no puede tener más de 5000 caracteres.');

export const createSupportTicketSchema = z.object({
  subject: z
    .string({ required_error: 'Escribe un asunto.' })
    .trim()
    .min(3, 'El asunto tiene que tener al menos 3 letras.')
    .max(160, 'El asunto no puede tener más de 160 caracteres.'),
  category: z.enum(SUPPORT_CATEGORY_VALUES, {
    errorMap: () => ({ message: 'Elige un motivo de la lista.' }),
  }),
  body: bodyField.min(10, 'Cuéntanos un poco más, con al menos 10 letras.'),
});

export const replySupportSchema = z.object({
  body: bodyField,
});

export const updateSupportStatusSchema = z.object({
  status: z.enum(SUPPORT_STATUS_VALUES, {
    errorMap: () => ({ message: 'Ese estado no existe.' }),
  }),
});

export const platformSupportQuerySchema = z.object({
  status: z.enum(SUPPORT_STATUS_VALUES).optional(),
  q: z
    .string()
    .trim()
    .max(100, 'La búsqueda no puede tener más de 100 caracteres.')
    .optional()
    .transform((value) => (value ? value : undefined)),
  page: z.coerce.number().int().min(1).default(1),
});

export type CreateSupportTicketInput = z.infer<typeof createSupportTicketSchema>;
export type ReplySupportInput = z.infer<typeof replySupportSchema>;
export type UpdateSupportStatusInput = z.infer<typeof updateSupportStatusSchema>;
export type PlatformSupportQuery = z.infer<typeof platformSupportQuerySchema>;
