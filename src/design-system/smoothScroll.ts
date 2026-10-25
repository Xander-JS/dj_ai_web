/**
 * SYSTEM DJ — Smooth wheel scroll
 * Desplazamiento con rueda suavizado para las zonas desplazables de la consola: cada giro mueve
 * un objetivo y el contenido lo alcanza con la misma desaceleración exponencial de EASE_OUT,
 * sin rebote. Teclado, barra y gestos táctiles conservan el desplazamiento nativo.
 */

import { useCallback } from 'react';
import { useAnimationsEnabled } from './motionPreference';

const LINE_HEIGHT_PX = 16;
/** Fracción de la distancia restante recorrida en un fotograma de 60 Hz (~200 ms hasta asentarse). */
const SMOOTH_SCROLL_EASE = 0.18;
const FRAME_MS = 1000 / 60;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// Un desplazable anidado (desplegable, panel) que aún puede moverse en esa dirección gestiona su rueda
function nestedScrollerHandles(target: EventTarget | null, root: HTMLElement, deltaY: number): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== root; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
      if (deltaY < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
    }
  }
  return false;
}

/** Suaviza la rueda vertical sobre `element`; devuelve la función que lo desactiva. */
export function attachSmoothScroll(element: HTMLElement): () => void {
  let current = element.scrollTop;
  let target = current;
  let frame = 0;
  let lastTime = 0;

  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };

  const step = (time: number) => {
    const max = element.scrollHeight - element.clientHeight;
    target = clamp(target, 0, Math.max(0, max));
    const elapsed = lastTime ? time - lastTime : FRAME_MS;
    lastTime = time;
    current += (target - current) * (1 - Math.pow(1 - SMOOTH_SCROLL_EASE, elapsed / FRAME_MS));
    if (Math.abs(target - current) < 0.5) {
      element.scrollTop = target;
      frame = 0;
      return;
    }
    element.scrollTop = current;
    frame = requestAnimationFrame(step);
  };

  const handleWheel = (event: WheelEvent) => {
    if (event.defaultPrevented || event.ctrlKey || event.shiftKey) return;
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    if (element.scrollHeight <= element.clientHeight) return;
    if (nestedScrollerHandles(event.target, element, event.deltaY)) return;

    const unit = event.deltaMode === 1 ? LINE_HEIGHT_PX : event.deltaMode === 2 ? element.clientHeight : 1;
    if (!frame) {
      current = element.scrollTop;
      target = current;
      lastTime = 0;
    }
    const max = element.scrollHeight - element.clientHeight;
    const next = clamp(target + event.deltaY * unit, 0, max);
    if (next === target && !frame) return;

    event.preventDefault();
    target = next;
    if (!frame) frame = requestAnimationFrame(step);
  };

  // Teclado o arrastre de la barra toman el control: la animación cede al desplazamiento nativo
  element.addEventListener('wheel', handleWheel, { passive: false });
  element.addEventListener('pointerdown', stop);
  element.addEventListener('keydown', stop);

  return () => {
    stop();
    element.removeEventListener('wheel', handleWheel);
    element.removeEventListener('pointerdown', stop);
    element.removeEventListener('keydown', stop);
  };
}

/** Ref de callback que activa el desplazamiento suave mientras las animaciones estén permitidas. */
export function useSmoothScroll<T extends HTMLElement>(): (element: T | null) => (() => void) | undefined {
  const animationsEnabled = useAnimationsEnabled();
  return useCallback(
    (element: T | null) => (element && animationsEnabled ? attachSmoothScroll(element) : undefined),
    [animationsEnabled],
  );
}
