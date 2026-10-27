/**
 * SYSTEM DJ — Escalado de la consola (REFACTOR_PROMPT §7)
 *
 * La consola conserva sus proporciones y la disposición de sus controles en cualquier pantalla:
 * por debajo de su ancho de diseño no se reorganiza, se dibuja a ese ancho y se reduce entera.
 * Con un alto disponible, también se reduce hasta caber en él.
 */

/** Ancho mínimo (px CSS) al que la consola se dibuja sin reducir. */
export const CONSOLE_MIN_WIDTH = 1400;

export interface ConsoleScaleInput {
  /** Ancho disponible para la consola. */
  frameWidth: number;
  /** Alto disponible; si se indica, la consola cabe también en alto. */
  frameHeight?: number;
  /** Alto de la consola dibujada a `width`, sin reducir. */
  naturalHeight: number;
  minWidth?: number;
}

export interface ConsoleScale {
  /** Ancho al que se dibuja la consola antes de reducirla. */
  width: number;
  /** Factor de reducción (≤ 1). */
  scale: number;
  /** Desplazamiento horizontal para centrarla en el hueco. */
  offsetX: number;
}

export function computeConsoleScale({
  frameWidth,
  frameHeight,
  naturalHeight,
  minWidth = CONSOLE_MIN_WIDTH,
}: ConsoleScaleInput): ConsoleScale {
  if (!(frameWidth > 0)) return { width: minWidth, scale: 1, offsetX: 0 };
  const width = Math.max(frameWidth, minWidth);
  let scale = Math.min(1, frameWidth / width);
  if (frameHeight !== undefined && frameHeight > 0 && naturalHeight > 0) {
    scale = Math.min(scale, frameHeight / naturalHeight);
  }
  return { width, scale, offsetX: Math.max(0, (frameWidth - width * scale) / 2) };
}
