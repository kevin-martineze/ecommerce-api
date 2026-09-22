/**
 * Plantillas de tienda.
 *
 * Una plantilla es una decisión de diseño de la vitrina —paleta, tipografía y
 * cómo se arma la portada—, no de datos: el catálogo, los pedidos y los ajustes
 * son los mismos en todas. Por eso la API solo guarda y valida el código; cómo
 * se ve cada una vive en el frontend, que es quien la pinta.
 *
 * Agregar una plantilla es agregarla acá y en el frontend. La columna es texto
 * y no un enum de Postgres a propósito: así estrenar una no obliga a una
 * migración de esquema, y una tienda que quedó con un código retirado sigue
 * abriendo (el frontend cae en la de por defecto).
 */
export const STOREFRONT_TEMPLATES = [
  'editorial',
  'boutique',
  'galeria',
  'noche',
  'vibrante',
  'atelier',
] as const;

export type StorefrontTemplate = (typeof STOREFRONT_TEMPLATES)[number];

/** Con la que nace toda tienda, hasta que elija otra en el onboarding. */
export const DEFAULT_TEMPLATE: StorefrontTemplate = 'editorial';
