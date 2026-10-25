/**
 * SYSTEM DJ — Document scroll mode
 * La consola es un shell de escritorio: #root ocupa la ventana y no desplaza.
 * Las páginas largas (la Home) piden que desplace el documento mientras están montadas,
 * para que useScroll, whileInView, la restauración del scroll y la barra del navegador
 * funcionen con la ventana. Al desmontarse, el shell recupera su comportamiento.
 */

import { useLayoutEffect } from 'react';

const ATTRIBUTE = 'data-scroll-mode';

export function useDocumentScroll(): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute(ATTRIBUTE, 'document');
    return () => root.removeAttribute(ATTRIBUTE);
  }, []);
}

/** El efecto magnético solo tiene sentido con un puntero fino (ratón o trackpad). */
export function prefersFinePointer(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}
