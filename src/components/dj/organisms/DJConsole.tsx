import React, { useLayoutEffect, useRef, useState } from 'react';
import { Deck } from './Deck';
import { MixerConsole } from './MixerConsole';
import { DigitalScreen } from './DigitalScreen';
import { DownbeatPanel } from './DownbeatPanel';
import { computeConsoleScale, type ConsoleScale } from '../../../services/console/consoleScale';
import '../consoleTheme.css';
import './DJConsole.css';

/**
 * Mide el hueco y la consola y devuelve cómo dibujarla: la consola se reduce entera, sin
 * reorganizarse, hasta caber en el ancho y el alto del hueco (sin barras de desplazamiento). Solo
 * se recalcula cuando cambia el hueco (la ventana), nunca por el contenido: cargar una pista no
 * debe hacer zoom. `transform` no cambia `offsetHeight`, así que el alto natural se lee sin reducir.
 */
function useConsoleScale(
  frameRef: React.RefObject<HTMLDivElement | null>,
  consoleRef: React.RefObject<HTMLDivElement | null>,
): ConsoleScale {
  const [layout, setLayout] = useState<ConsoleScale>({ width: 0, scale: 1, offsetX: 0 });

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const consoleEl = consoleRef.current;
    if (!frame || !consoleEl) return;
    const measure = () => {
      const frameWidth = frame.clientWidth;
      // El alto natural depende del ancho de dibujo: se fija ese ancho antes de leerlo
      consoleEl.style.width = `${computeConsoleScale({ frameWidth, naturalHeight: 0 }).width}px`;
      const next = computeConsoleScale({
        frameWidth,
        frameHeight: frame.clientHeight,
        naturalHeight: consoleEl.offsetHeight,
      });
      setLayout((prev) =>
        prev.width === next.width && prev.scale === next.scale && prev.offsetX === next.offsetX ? prev : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [frameRef, consoleRef]);

  return layout;
}

/**
 * Carcasa única de la consola: arriba, DOWNBEAT & COMPÁS A, la pantalla digital (sobresale del
 * borde superior) y DOWNBEAT & COMPÁS B; debajo, Deck A, el
 * mixer y Deck B. Todo se percibe como una sola pieza de hardware.
 */
export const DJConsole: React.FC = () => {
  const frameRef = useRef<HTMLDivElement>(null);
  const consoleRef = useRef<HTMLDivElement>(null);
  const { width, scale, offsetX } = useConsoleScale(frameRef, consoleRef);

  return (
    <div ref={frameRef} className="dj-console-frame">
      <div
        ref={consoleRef}
        className="dj-console"
        data-testid="dj-console"
        style={
          width > 0
            ? { width, transform: scale < 1 || offsetX > 0 ? `translateX(${offsetX}px) scale(${scale})` : undefined }
            : undefined
        }
      >
        <div className="dj-console__housing">
          <div className="dj-console__top">
            <div className="dj-console__downbeat dj-console__downbeat--a downbeat-panel-host">
              <DownbeatPanel deckName="A" />
            </div>
            <div className="dj-console__screen">
              <DigitalScreen />
            </div>
            <div className="dj-console__downbeat dj-console__downbeat--b downbeat-panel-host">
              <DownbeatPanel deckName="B" />
            </div>
          </div>
          <div className="dj-console__deck dj-console__deck--a">
            <Deck deckName="A" />
          </div>
          <div className="dj-console__mixer">
            <MixerConsole />
          </div>
          <div className="dj-console__deck dj-console__deck--b">
            <Deck deckName="B" />
          </div>
        </div>
      </div>
    </div>
  );
};
