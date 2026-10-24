import React, { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { clsx } from 'clsx';
import type { SpeakerSceneHandle, SpeakerTheme } from './speakerScene';
import './Speaker3D.css';

export interface Speaker3DProps {
  theme: SpeakerTheme;
  /** Imagen fija que sustituye a la escena si no hay WebGL o el modelo no carga */
  fallback: { src: string; webp?: string; width: number; height: number };
  className?: string;
}

type Status = 'idle' | 'ready' | 'failed';

/**
 * Altavoz 3D decorativo con el cono vibrando en bucle.
 * three.js y el GLB se cargan solo cuando el contenedor entra en pantalla; la animación
 * se pausa fuera de pantalla y con la pestaña oculta, y queda quieta con movimiento reducido.
 * Nunca captura el puntero ni llega a los lectores de pantalla.
 */
export const Speaker3D: React.FC<Speaker3DProps> = ({ theme, fallback, className }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<SpeakerSceneHandle | null>(null);
  const themeRef = useRef(theme);
  const reduceMotion = useReducedMotion() ?? false;
  const [status, setStatus] = useState<Status>('idle');

  useEffect(() => {
    themeRef.current = theme;
    sceneRef.current?.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    let cancelled = false;
    let inView = false;
    let loading = false;

    const syncRunning = () => sceneRef.current?.setRunning(inView && document.visibilityState === 'visible');

    const load = () => {
      if (loading) return;
      loading = true;
      import('./speakerScene')
        .then(({ createSpeakerScene }) => createSpeakerScene({ canvas, reduceMotion, theme: themeRef.current }))
        .then((handle) => {
          if (cancelled) {
            handle.dispose();
            return;
          }
          sceneRef.current = handle;
          handle.resize(container.clientWidth, container.clientHeight);
          syncRunning();
          setStatus('ready');
        })
        .catch(() => {
          if (!cancelled) setStatus('failed');
        });
    };

    const visibility = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      if (inView) load();
      syncRunning();
    });
    visibility.observe(container);

    const size = new ResizeObserver(() => sceneRef.current?.resize(container.clientWidth, container.clientHeight));
    size.observe(container);

    document.addEventListener('visibilitychange', syncRunning);

    return () => {
      cancelled = true;
      visibility.disconnect();
      size.disconnect();
      document.removeEventListener('visibilitychange', syncRunning);
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [reduceMotion]);

  return (
    <div ref={containerRef} className={clsx('sd-speaker-3d', `sd-speaker-3d--${status}`, className)} aria-hidden="true">
      <canvas ref={canvasRef} className="sd-speaker-3d__canvas" />
      {status === 'failed' && (
        <picture className="sd-speaker-3d__fallback">
          {fallback.webp && <source srcSet={fallback.webp} type="image/webp" />}
          <img src={fallback.src} alt="" width={fallback.width} height={fallback.height} decoding="async" draggable={false} />
        </picture>
      )}
    </div>
  );
};
