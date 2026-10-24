/**
 * Convenciones de iconografía de SYSTEM DJ.
 * Una sola familia: lucide-react (trazo de contorno, terminaciones redondeadas).
 * El trazo se mantiene en el valor por defecto de lucide (2 en una rejilla de 24)
 * para coincidir con los iconos ya usados en Home, Login y Sign Up.
 */

/** Escala de tamaños en píxeles. xs: dentro de etiquetas · sm: botones compactos y filas · md: navegación y botones · lg: estados vacíos */
export const ICON_SIZE = {
  xs: 14,
  sm: 16,
  md: 20,
  lg: 24,
} as const;

export type IconSize = keyof typeof ICON_SIZE;

export const ICON_STROKE = 2;
