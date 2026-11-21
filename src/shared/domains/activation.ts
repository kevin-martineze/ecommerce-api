/**
 * Etapas del embudo de activación de una tienda, en orden. Lineales y
 * acumulativas: una tienda está en la más alta que alcanzó.
 *
 * Viven aquí y no junto al cálculo porque el DTO de la consola las valida.
 */
export const ACTIVATION_STAGES = [
  'created',
  'catalog',
  'first_order',
  'first_sale',
  'paying',
] as const;

export type ActivationStage = (typeof ACTIVATION_STAGES)[number];
