import React, { useRef } from 'react';
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import './TempoBand.css';

interface Readout {
  value: string;
  label: string;
}

const TONES = ['accent', 'sage', 'acid', 'inverse'] as const;
/** Cada fila se repite para cubrir el ancho más el recorrido del desplazamiento */
const REPEAT = 3;
/** Recorrido horizontal en píxeles entre la entrada y la salida de la banda */
const TRAVEL: [number, number] = [-640, -160];

interface RowProps {
  items: Readout[];
  x: MotionValue<number>;
  toneOffset: number;
}

const Row: React.FC<RowProps> = ({ items, x, toneOffset }) => (
  <motion.ul className="sd-tempo-band__row" style={{ x, willChange: 'transform' }}>
    {Array.from({ length: REPEAT }, (_, copy) => items.map((item, i) => (
      <li
        key={`${copy}-${item.value}`}
        className={clsx('sd-tempo-band__tile', `sd-tempo-band__tile--${TONES[(i + toneOffset) % TONES.length]}`)}
      >
        <span className="sd-tempo-band__value">{item.value}</span>
        <span className="sd-tempo-band__label">{item.label}</span>
      </li>
    )))}
  </motion.ul>
);

// Banda de lecturas de la consola (BPM, tonalidades, SYNC…) que se desliza con el scroll:
// la fila superior avanza a la derecha y la inferior a la izquierda, como dos decks.
// Es decorativa y repite lo que ya dicen las secciones, así que se oculta a lectores de pantalla.
export const TempoBand: React.FC = () => {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const forward = useTransform(scrollYProgress, [0, 1], reduceMotion ? [TRAVEL[0], TRAVEL[0]] : TRAVEL);
  const backward = useTransform(scrollYProgress, [0, 1], reduceMotion ? [TRAVEL[0], TRAVEL[0]] : [TRAVEL[1], TRAVEL[0]]);

  const items = t('landing.band.items', { returnObjects: true }) as Readout[];
  const half = Math.ceil(items.length / 2);

  return (
    <div ref={ref} className="sd-tempo-band" aria-hidden="true">
      <Row items={items.slice(0, half)} x={forward} toneOffset={0} />
      <Row items={items.slice(half)} x={backward} toneOffset={2} />
    </div>
  );
};
