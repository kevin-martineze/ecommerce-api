/**
 * Desde cuántas unidades hacia abajo una variante cuenta como stock bajo.
 *
 * Vive en `shared/` porque lo usan el inventario del catálogo y el resumen del
 * panel, y los dos tienen que estar de acuerdo en qué es "poco".
 */
export const LOW_STOCK_THRESHOLD = 3;
