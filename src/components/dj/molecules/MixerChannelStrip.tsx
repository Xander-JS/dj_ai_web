import React from 'react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { useDJStore } from '../../../store/useDJStore';
import type { PlaybackState } from '../../../types/deck';
import { getChannelSignal, getFilterValueText } from '../../../services/console/mixerPanelModel';
import { ConsoleKnob } from '../atoms/ConsoleKnob';
import { ConsoleFader } from '../atoms/ConsoleFader';
import { ConsoleKey } from '../atoms/ConsoleKey';
import { ConsoleLed } from '../atoms/ConsoleLed';
import { LevelMeter } from '../atoms/LevelMeter';
import './MixerChannelStrip.css';

export interface MixerChannelStripProps {
  deckId: 'A' | 'B';
  isPlaying: boolean;
  playbackState: PlaybackState;
  hasTrack: boolean;
  /** Nivel real del canal (0–100), tras GAIN, EQ, FILTER y el fader, antes del crossfader. */
  vuLevel: number;
}

/**
 * Columna de canal (CH 1 = Deck A, CH 2 = Deck B), de arriba abajo: `CH n` con su LED de señal,
 * GAIN · HI · MID · LOW · FILTER, el CUE de pre-escucha y el fader con el vúmetro del lado del
 * Master. Los controles siguen activos sin pista: sus valores se conservan para la siguiente.
 */
export const MixerChannelStrip: React.FC<MixerChannelStripProps> = ({ deckId, isPlaying, playbackState, hasTrack, vuLevel }) => {
  const { t } = useTranslation();
  const { mixer, setChannelGain, setChannelEq, setChannelFilter, setChannelVolume, setCuePfl } = useDJStore();

  const channel = deckId === 'A' ? mixer.channelA : mixer.channelB;
  const num = deckId === 'A' ? '1' : '2';
  const tone = deckId === 'A' ? 'a' : 'b';
  const channelLabel = t('mixer.channel', { num });
  const signal = getChannelSignal({ hasTrack, playbackState, isPlaying, level: vuLevel });
  const stateText = `${t(signal.stateMessage.key)} · ${t(signal.signalMessage.key)}`;
  const filterText = getFilterValueText(channel.eq.filter);

  const knob = (
    id: 'gain' | 'hi' | 'mid' | 'low',
    labelKey: string,
    value: number,
    onChange: (value: number) => void,
  ) => (
    <ConsoleKnob
      tone={tone}
      bipolar
      defaultValue={50}
      value={value}
      label={t(labelKey)}
      aria-label={`${t(labelKey)} ${num}`}
      data-testid={`${id}-slider-${deckId}`}
      onValueChange={onChange}
    />
  );

  return (
    <section
      className={clsx('mixer-channel', `mixer-channel--${tone}`, `console-tone-${tone}`)}
      data-testid={`channel-strip-${deckId}`}
      aria-label={channelLabel}
    >
      <header className="mixer-channel__head">
        <span className="mixer-channel__name">{channelLabel}</span>
        <span className="mixer-channel__signal" title={stateText} data-testid={`channel-signal-${deckId}`}>
          <ConsoleLed on={signal.led.on} color={signal.led.color} dim={signal.led.dim} />
        </span>
        <span className="sd-visually-hidden">{stateText}</span>
      </header>

      <div className="mixer-channel__knobs">
        {knob('gain', 'mixer.gain', channel.gain, (value) => setChannelGain(deckId, value))}
        <div className="mixer-channel__eq" role="group" aria-label={`${t('mixer.eq')} ${num}`}>
          {knob('hi', 'mixer.high', channel.eq.high, (value) => setChannelEq(deckId, 'high', value))}
          {knob('mid', 'mixer.mid', channel.eq.mid, (value) => setChannelEq(deckId, 'mid', value))}
          {knob('low', 'mixer.low', channel.eq.low, (value) => setChannelEq(deckId, 'low', value))}
        </div>
        <ConsoleKnob
          tone={tone}
          bipolar
          defaultValue={50}
          value={channel.eq.filter}
          label={t('mixer.filter')}
          startLabel={t('mixer.filter_lpf')}
          endLabel={t('mixer.filter_hpf')}
          aria-label={`${t('mixer.filter')} ${num}`}
          aria-valuetext={t(filterText.key, filterText.values)}
          data-testid={`filter-slider-${deckId}`}
          onValueChange={(value) => setChannelFilter(deckId, value)}
        />
      </div>

      <ConsoleKey
        className="mixer-channel__cue"
        lit={channel.cuePfl}
        tone="amber"
        onClick={() => setCuePfl(deckId, !channel.cuePfl)}
        aria-pressed={channel.cuePfl}
        aria-label={`${t('mixer.cue_pfl')} ${num}`}
        title={t('mixer.cue_pfl_title')}
        data-testid={`cue-btn-${deckId}`}
      >
        <ConsoleLed on={channel.cuePfl} color="amber" />
        {t('mixer.cue_pfl')}
      </ConsoleKey>

      <div className="mixer-channel__fader">
        <ConsoleFader
          orientation="vertical"
          tone={tone}
          value={channel.volume}
          aria-label={`${channelLabel} ${t('mixer.volume')}`}
          aria-valuetext={`${channel.volume}%`}
          data-testid={`volume-fader-${deckId}`}
          onValueChange={(value) => setChannelVolume(deckId, value)}
        />
        <LevelMeter
          className="mixer-channel__meter"
          level={vuLevel}
          label={t('mixer.meter_channel', { num })}
          data-testid={`vu-meter-${deckId}`}
          fillTestId={`vu-meter-fill-${deckId}`}
        />
      </div>
    </section>
  );
};
