import React, { useId, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../atoms/IconButton';
import { areKeysHarmonicallyCompatible, camelotToKey } from '../../audio/analysis/camelotMapper';
import type { MusicalKeyCamelot } from '../../types/track';
import { DURATION, EASE_OUT } from '../../design-system/motion';
import './KeyMatcher.css';

type CamelotLetter = 'A' | 'B';

const toCode = (number: number, letter: CamelotLetter) => `${number}${letter}` as MusicalKeyCamelot;

/** Vecinos armónicos según la misma regla que usa el motor de recomendaciones. */
function compatibleKeys(code: MusicalKeyCamelot): MusicalKeyCamelot[] {
  const all: MusicalKeyCamelot[] = [];
  for (let n = 1; n <= 12; n += 1) all.push(toCode(n, 'A'), toCode(n, 'B'));
  return all.filter((candidate) => candidate !== code && areKeysHarmonicallyCompatible(code, candidate));
}

// Demostración interactiva de la mezcla armónica: elige una tonalidad y ve con cuáles encaja
export const KeyMatcher: React.FC = () => {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const labelId = useId();
  const [number, setNumber] = useState(8);
  const [letter, setLetter] = useState<CamelotLetter>('A');

  const code = toCode(number, letter);
  const matches = compatibleKeys(code);
  const step = (delta: number) => setNumber((current) => ((current - 1 + delta + 12) % 12) + 1);

  return (
    <div className="sd-key-matcher">
      <p id={labelId} className="sd-key-matcher__label">{t('landing.features.key_matcher.label')}</p>

      <div className="sd-key-matcher__controls">
        <div className="sd-key-matcher__dial" role="group" aria-labelledby={labelId}>
          <IconButton
            label={t('landing.features.key_matcher.previous')}
            icon={<ChevronLeft size={22} aria-hidden="true" />}
            onClick={() => step(-1)}
          />
          <span className="sd-key-matcher__value">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={code}
                className="sd-key-matcher__code"
                initial={{ opacity: 0, y: reduceMotion ? 0 : 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduceMotion ? 0 : -14 }}
                transition={{ duration: DURATION.base, ease: EASE_OUT }}
              >
                {code}
              </motion.span>
            </AnimatePresence>
            <span className="sd-key-matcher__name">{camelotToKey(code)}</span>
          </span>
          <IconButton
            label={t('landing.features.key_matcher.next')}
            icon={<ChevronRight size={22} aria-hidden="true" />}
            onClick={() => step(1)}
          />
        </div>

        <div className="sd-key-matcher__mode" role="group" aria-label={t('landing.features.key_matcher.mode')}>
          {(['A', 'B'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={letter === option}
              onClick={() => setLetter(option)}
            >
              {t(option === 'A' ? 'landing.features.key_matcher.minor' : 'landing.features.key_matcher.major')}
            </button>
          ))}
        </div>
      </div>

      <p className="sd-key-matcher__label">{t('landing.features.key_matcher.result')}</p>
      <ul className="sd-key-matcher__matches">
        {matches.map((match) => (
          <li key={match}>
            <span className="sd-key-matcher__match-code">{match}</span>
            <span className="sd-key-matcher__match-name">{camelotToKey(match)}</span>
          </li>
        ))}
      </ul>
      <p className="sd-visually-hidden" aria-live="polite">
        {t('landing.features.key_matcher.summary', { key: code, list: matches.join(', ') })}
      </p>
      <p className="sd-key-matcher__note">{t('landing.features.key_matcher.note')}</p>
    </div>
  );
};
