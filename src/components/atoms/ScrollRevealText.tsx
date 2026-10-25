import React, { useRef } from 'react';
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from 'framer-motion';
import { clsx } from 'clsx';
import './ScrollRevealText.css';

/** Cuántos caracteres se encienden a la vez: suaviza la transición entre letras. */
const REVEAL_WINDOW = 8;

interface CharProps {
  char: string;
  progress: MotionValue<number>;
  start: number;
  end: number;
}

const Char: React.FC<CharProps> = ({ char, progress, start, end }) => {
  const opacity = useTransform(progress, [start, end], [0.2, 1]);
  return <motion.span style={{ opacity }}>{char}</motion.span>;
};

interface WordLayout {
  word: string;
  /** Posición del primer carácter de la palabra dentro del texto completo */
  offset: number;
}

function layoutWords(text: string): WordLayout[] {
  const words = text.split(' ');
  return words.map((word, i) => ({
    word,
    offset: words.slice(0, i).reduce((sum, previous) => sum + previous.length + 1, 0),
  }));
}

export interface ScrollRevealTextProps {
  text: string;
  className?: string;
}

/**
 * Párrafo que se "enciende" carácter a carácter según avanza el scroll.
 * El texto completo se expone una sola vez a lectores de pantalla; las letras
 * animadas quedan ocultas para ellos. Con movimiento reducido se muestra entero.
 */
export const ScrollRevealText: React.FC<ScrollRevealTextProps> = ({ text, className }) => {
  const ref = useRef<HTMLParagraphElement>(null);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 0.85', 'end 0.5'] });

  if (reduceMotion) {
    return <p ref={ref} className={clsx('sd-reveal-text', className)}>{text}</p>;
  }

  const total = text.length;

  return (
    <p ref={ref} className={clsx('sd-reveal-text', className)}>
      <span className="sd-visually-hidden">{text}</span>
      <span aria-hidden="true">
        {layoutWords(text).map(({ word, offset }, wordIndex, all) => (
          <React.Fragment key={`${wordIndex}-${word}`}>
            <span className="sd-reveal-text__word">
              {Array.from(word).map((char, charIndex) => {
                const start = (offset + charIndex) / total;
                return (
                  <Char
                    key={charIndex}
                    char={char}
                    progress={scrollYProgress}
                    start={start}
                    end={Math.min(1, start + REVEAL_WINDOW / total)}
                  />
                );
              })}
            </span>
            {wordIndex < all.length - 1 ? ' ' : null}
          </React.Fragment>
        ))}
      </span>
    </p>
  );
};
