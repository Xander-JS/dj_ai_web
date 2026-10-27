import React from 'react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { useDJStore } from '../../../store/useDJStore';
import type { StereoLevel } from '../../../services/console/mixerPanelModel';
import { ConsoleKnob } from '../atoms/ConsoleKnob';
import { ConsoleKey } from '../atoms/ConsoleKey';
import { ConsoleLed } from '../atoms/ConsoleLed';
import { LevelMeter } from '../atoms/LevelMeter';
import './MixerMasterStrip.css';

export interface MixerMasterStripProps {
  /** Nivel real L / R de la mezcla tras el volumen maestro (0 con MUTE o sin reproducción). */
  level: StereoLevel;
}

/**
 * Columna MASTER, más estrecha y neutra: el pomo de volumen (sin serigrafía: la cabecera ya lo
 * nombra), el vúmetro estéreo de dos barras y MUTE con su LED. Con MUTE el arco del pomo se
 * atenúa y el valor nominal se conserva.
 */
export const MixerMasterStrip: React.FC<MixerMasterStripProps> = ({ level }) => {
  const { t } = useTranslation();
  const { masterVolume, isMasterMuted, setMasterVolume, toggleMasterMute } = useDJStore();

  return (
    <section
      className={clsx('mixer-master', 'console-tone-master', isMasterMuted && 'is-muted')}
      data-testid="mixer-master-strip"
      aria-label={t('mixer.master')}
    >
      <header className="mixer-master__head">
        <span className="mixer-master__name">{t('mixer.master')}</span>
      </header>

      <ConsoleKnob
        size="master"
        tone="master"
        value={masterVolume}
        aria-label={t('mixer.master')}
        aria-valuetext={isMasterMuted ? `${masterVolume}% · ${t('mixer.muted')}` : `${masterVolume}%`}
        data-testid="master-volume-slider"
        onValueChange={(value) => setMasterVolume(value)}
      />

      <div className="mixer-master__meter" role="group" aria-label={t('mixer.meter_master')} data-testid="master-vu-meter">
        <LevelMeter level={level.left} label={t('mixer.meter_master_left')} fillTestId="master-vu-meter-fill-left" />
        <LevelMeter level={level.right} label={t('mixer.meter_master_right')} fillTestId="master-vu-meter-fill-right" />
      </div>

      <ConsoleKey
        className="mixer-master__mute"
        lit={isMasterMuted}
        tone="red"
        onClick={toggleMasterMute}
        aria-pressed={isMasterMuted}
        aria-label={t('mixer.mute')}
        title={isMasterMuted ? t('mixer.mute_on_title') : t('mixer.mute_off_title')}
        data-testid="master-mute-btn"
      >
        <ConsoleLed on={isMasterMuted} color="red" />
        {t('mixer.mute')}
      </ConsoleKey>
    </section>
  );
};
