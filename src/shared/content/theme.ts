/**
 * Los ajustes que una tienda le hace a su plantilla.
 *
 * Una plantilla es un vestido entero; esto es meterle el dobladillo: el color
 * de la marca, la pareja de letras, cuánto se redondean las esquinas y cómo se
 * arma la portada. Cada ajuste es opcional y `null` significa «lo que diga la
 * plantilla», así cambiar de plantilla nunca deja una tienda a medio vestir.
 *
 * Igual que con las plantillas, la API solo guarda y valida códigos: qué letra
 * es `serif` o cuánto redondea `soft` lo decide el frontend, que es quien
 * pinta. Por eso son listas cerradas y no valores libres: un tamaño de esquina
 * o una fuente arbitraria no se pueden garantizar legibles.
 *
 * Se guarda en una columna `jsonb` (`store_settings.theme`) y se lee con
 * `readTheme`, que descarta lo que no reconozca: un ajuste retirado no tumba
 * la tienda, vuelve a ser el de la plantilla.
 */
export const THEME_FONTS = ['serif', 'sans', 'tight'] as const;
export const THEME_CORNERS = ['square', 'soft', 'round'] as const;
export const THEME_HEROES = ['cover', 'split', 'typographic', 'centered', 'block'] as const;

export type ThemeFont = (typeof THEME_FONTS)[number];
export type ThemeCorners = (typeof THEME_CORNERS)[number];
export type ThemeHero = (typeof THEME_HEROES)[number];

/** Un color en `#RRGGBB`. Sin alfa ni nombres: el frontend calcula contraste con él. */
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export interface StoreTheme {
  accent: string | null;
  fonts: ThemeFont | null;
  corners: ThemeCorners | null;
  hero: ThemeHero | null;
}

export const EMPTY_THEME: StoreTheme = { accent: null, fonts: null, corners: null, hero: null };

function oneOf<T extends string>(list: readonly T[], value: unknown): T | null {
  return list.find((item) => item === value) ?? null;
}

/** Lee la columna tal como esté; lo que no se reconozca vuelve a ser `null`. */
export function readTheme(json: unknown): StoreTheme {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return EMPTY_THEME;

  const record = new Map(Object.entries(json));
  const accent = record.get('accent');

  return {
    accent: typeof accent === 'string' && HEX_COLOR.test(accent) ? accent.toUpperCase() : null,
    fonts: oneOf(THEME_FONTS, record.get('fonts')),
    corners: oneOf(THEME_CORNERS, record.get('corners')),
    hero: oneOf(THEME_HEROES, record.get('hero')),
  };
}

/** Si no queda ningún ajuste, la tienda es la plantilla tal cual. */
export function isEmptyTheme(theme: StoreTheme): boolean {
  return Object.values(theme).every((value) => value === null);
}
