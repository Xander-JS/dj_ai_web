import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { useDJStore } from '../../store/useDJStore';
import { audioEngine } from '../../audio';
import { calculateCrossfaderGains } from '../../audio/djAudioMath';
import { bandRanges, updateLevels } from '../player/visualizerModel';
import type { PlaybackState } from '../../types/deck';
import { ConsoleKnob } from './ConsoleKnob';
import { ConsoleFader } from './ConsoleFader';
import { MIXER_ASSETS } from './mixerAssets';
import './consoleTheme.css';
import './MixerConsole.css';

/** Nivel (0–100) a partir del cual el LED de señal de un canal se enciende. */
const SIGNAL_THRESHOLD = 2;

/**
 * Vúmetro de LEDs segmentados. Pinta el nivel real que recibe por props (sin estado propio):
 * la escala de colores es fija y solo se recorta la parte encendida.
 */
const LevelMeter: React.FC<{ level: number; label: string; className?: string; 'data-testid'?: string; fillTestId?: string }> = ({
  level,
  label,
  className,
  fillTestId,
  ...rest
}) => {
  const clamped = Math.max(0, Math.min(100, level));
  return (
    <div
      className={clsx('vu-meter', className)}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      {...rest}
    >
      <span className="vu-meter-scale" aria-hidden="true" />
      <span
        className="vu-meter-fill"
        aria-hidden="true"
        data-testid={fillTestId}
        style={{ clipPath: `inset(${100 - clamped}% 0 0 0)` }}
      />
      <span className={clsx('vu-meter-clip', clamped >= 95 && 'is-on')} aria-hidden="true" />
    </div>
  );
};

export interface ChannelStripProps {
  deckId: 'A' | 'B';
  channelName?: string;
  isPlaying?: boolean;
  playbackState?: PlaybackState;
  hasTrack?: boolean;
  vuLevel?: number;
}

export const ChannelStrip: React.FC<ChannelStripProps> = ({
  deckId,
  channelName,
  isPlaying = false,
  playbackState = 'stopped',
  hasTrack = false,
  vuLevel = 0
}) => {
  const { t } = useTranslation();
  const {
    mixer,
    setChannelGain,
    setChannelEq,
    setChannelFilter,
    setChannelVolume,
    setCuePfl
  } = useDJStore();

  const channel = deckId === 'A' ? mixer.channelA : mixer.channelB;
  const displayName = channelName || (deckId === 'A' ? '1' : '2');
  const clampedVu = Math.max(0, Math.min(100, vuLevel));
  const tone = deckId === 'A' ? 'a' : 'b';
  const channelLabel = t('mixer.channel', { num: displayName });
  const hasSignal = clampedVu >= SIGNAL_THRESHOLD;
  const stateKey = !hasTrack ? 'empty' : playbackState === 'loading' ? 'loading' : isPlaying ? 'playing' : 'paused';
  const stateText = `${t(`mixer.state_${stateKey}`)} · ${t(hasSignal ? 'mixer.signal_present' : 'mixer.signal_absent')}`;
  const filterText = channel.eq.filter < 50
    ? t('mixer.filter_lpf_value', { value: Math.round(((50 - channel.eq.filter) / 50) * 100) })
    : channel.eq.filter > 50
    ? t('mixer.filter_hpf_value', { value: Math.round(((channel.eq.filter - 50) / 50) * 100) })
    : t('mixer.filter_off');

  return (
    <section
      className={clsx('channel-strip', `channel-strip-${tone}`, `console-tone-${tone}`, isPlaying && 'is-playing')}
      data-testid={`channel-strip-${deckId}`}
      aria-label={channelLabel}
    >
      <header className="channel-header">
        <span className="channel-deck-badge" aria-hidden="true">{deckId}</span>
        <span className="channel-header-name">{channelLabel}</span>
        <span
          className={clsx('channel-signal-led', hasSignal && 'is-on', `is-${stateKey}`)}
          title={stateText}
          aria-hidden="true"
        />
        <span className="sd-visually-hidden">{stateText}</span>
      </header>

      <div className="channel-controls">
        <ConsoleKnob
          tone={tone}
          bipolar
          defaultValue={50}
          value={channel.gain}
          label={t('mixer.gain')}
          aria-label={`${t('mixer.gain')} ${displayName}`}
          data-testid={`gain-slider-${deckId}`}
          onValueChange={(value) => setChannelGain(deckId, value)}
        />

        <div className="channel-eq-group" role="group" aria-label={`${t('mixer.eq')} ${displayName}`}>
          <ConsoleKnob
            size="compact"
            tone={tone}
            bipolar
            defaultValue={50}
            value={channel.eq.high}
            label={t('mixer.high')}
            aria-label={`${t('mixer.high')} ${displayName}`}
            data-testid={`hi-slider-${deckId}`}
            onValueChange={(value) => setChannelEq(deckId, 'high', value)}
          />
          <ConsoleKnob
            size="compact"
            tone={tone}
            bipolar
            defaultValue={50}
            value={channel.eq.mid}
            label={t('mixer.mid')}
            aria-label={`${t('mixer.mid')} ${displayName}`}
            data-testid={`mid-slider-${deckId}`}
            onValueChange={(value) => setChannelEq(deckId, 'mid', value)}
          />
          <ConsoleKnob
            size="compact"
            tone={tone}
            bipolar
            defaultValue={50}
            value={channel.eq.low}
            label={t('mixer.low')}
            aria-label={`${t('mixer.low')} ${displayName}`}
            data-testid={`low-slider-${deckId}`}
            onValueChange={(value) => setChannelEq(deckId, 'low', value)}
          />
        </div>

        <div className="channel-filter-group">
          <span className="channel-filter-legend" aria-hidden="true">
            <span>{t('mixer.filter_lpf')}</span>
            <span>{t('mixer.filter_hpf')}</span>
          </span>
          <ConsoleKnob
            tone={tone}
            bipolar
            defaultValue={50}
            value={channel.eq.filter}
            label={t('mixer.filter')}
            aria-label={`${t('mixer.filter')} ${displayName}`}
            aria-valuetext={filterText}
            data-testid={`filter-slider-${deckId}`}
            onValueChange={(value) => setChannelFilter(deckId, value)}
          />
        </div>

        <button
          type="button"
          className={clsx('mixer-cue-btn', channel.cuePfl && 'mixer-cue-btn-active')}
          onClick={() => setCuePfl(deckId, !channel.cuePfl)}
          aria-pressed={channel.cuePfl}
          aria-label={`${t('mixer.cue_pfl', 'CUE')} ${displayName}`}
          data-testid={`cue-btn-${deckId}`}
          title={t('mixer.cue_pfl_title')}
        >
          <span className="mixer-btn-led" aria-hidden="true" />
          {t('mixer.cue_pfl', 'CUE')}
        </button>
      </div>

      <div className="channel-fader-section">
        <ConsoleFader
          orientation="vertical"
          tone={tone}
          value={channel.volume}
          aria-label={`${channelLabel} ${t('mixer.volume')}`}
          aria-valuetext={`${channel.volume}%`}
          data-testid={`volume-fader-${deckId}`}
          onValueChange={(value) => setChannelVolume(deckId, value)}
        />
        {/* Nivel VU real pre-crossfader */}
        <LevelMeter
          level={clampedVu}
          label={t('mixer.meter_channel', { num: displayName })}
          data-testid={`vu-meter-${deckId}`}
          fillTestId={`vu-meter-fill-${deckId}`}
        />
      </div>
    </section>
  );
};

const CROSSFADER_TICKS = [0, 0.25, 0.5, 0.75, 1];

/** Bandas del analizador de espectro del Master (comparte el AnalyserNode del VU Master). */
const SPECTRUM_BANDS = 16;

// Utilidades para temporización segura en browser y testing headless
const safeRequestAnimationFrame = (callback: (time: number) => void): number => {
  if (typeof requestAnimationFrame !== 'undefined') {
    return requestAnimationFrame(callback);
  }
  return setTimeout(() => callback(Date.now()), 33) as unknown as number;
};

const safeCancelAnimationFrame = (id: number): void => {
  if (typeof cancelAnimationFrame !== 'undefined') {
    cancelAnimationFrame(id);
  } else {
    clearTimeout(id);
  }
};

const TARGET_FPS_INTERVAL_MS = 33; // ~30 FPS

export const MixerConsole: React.FC = () => {
  const { t } = useTranslation();
  const {
    deckA,
    deckB,
    mixer,
    masterVolume,
    isMasterMuted,
    setCrossfader,
    setCrossfaderCurve,
    setMasterVolume,
    toggleMasterMute
  } = useDJStore();

  const isPlayingA = deckA.playbackState === 'playing';
  const isPlayingB = deckB.playbackState === 'playing';
  const isAnyPlaying = isPlayingA || isPlayingB;

  // Estados locales para los vúmetros a 30 Hz (evita rerenders en el store global)
  const [vuA, setVuA] = useState(0);
  const [vuB, setVuB] = useState(0);
  const [vuMaster, setVuMaster] = useState(0);
  // Barras del espectro: se escriben directamente en el DOM desde el mismo bucle, sin renders
  const spectrumBarsRef = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    if (!isAnyPlaying) {
      return;
    }

    let rafId: number | null = null;
    let lastTime = 0;
    let spectrum: Uint8Array<ArrayBuffer> | null = null;
    let ranges: [number, number][] = [];
    const bandLevels = new Float32Array(SPECTRUM_BANDS);
    const bars = spectrumBarsRef.current;

    const paintSpectrum = () => {
      for (let i = 0; i < SPECTRUM_BANDS; i++) {
        const bar = bars[i];
        if (bar) bar.style.transform = `scaleY(${bandLevels[i].toFixed(3)})`;
      }
    };

    const measureLoop = (timestamp: number) => {
      if (timestamp - lastTime >= TARGET_FPS_INTERVAL_MS) {
        lastTime = timestamp;
        try {
          const levelA = isPlayingA ? audioEngine.getDeckVUMeter('A') : 0;
          const levelB = isPlayingB ? audioEngine.getDeckVUMeter('B') : 0;
          const levelMaster = isMasterMuted ? 0 : audioEngine.getMasterVUMeter();

          setVuA(Math.max(0, Math.min(100, levelA)));
          setVuB(Math.max(0, Math.min(100, levelB)));
          setVuMaster(Math.max(0, Math.min(100, levelMaster)));

          // Espectro real del Master: lectura del analizador existente, sin nodos nuevos
          const size = audioEngine.getMasterSpectrumSize();
          let hasSpectrum = false;
          if (size > 0 && !isMasterMuted) {
            if (!spectrum || spectrum.length !== size) {
              spectrum = new Uint8Array(size);
              ranges = bandRanges(size, SPECTRUM_BANDS);
            }
            hasSpectrum = audioEngine.readMasterSpectrum(spectrum);
          }
          updateLevels(bandLevels, hasSpectrum ? spectrum : null, ranges);
          paintSpectrum();
        } catch {
          setVuA(0);
          setVuB(0);
          setVuMaster(0);
        }
      }
      rafId = safeRequestAnimationFrame(measureLoop);
    };

    rafId = safeRequestAnimationFrame(measureLoop);

    return () => {
      if (rafId !== null) {
        safeCancelAnimationFrame(rafId);
        rafId = null;
      }
      bandLevels.fill(0);
      paintSpectrum();
    };
  }, [isAnyPlaying, isPlayingA, isPlayingB, isMasterMuted]);

  // Si no hay reproducción activa o está en reposo, el nivel efectivo es 0
  const effectiveVuA = isPlayingA ? vuA : 0;
  const effectiveVuB = isPlayingB ? vuB : 0;
  const effectiveVuMaster = isAnyPlaying && !isMasterMuted ? vuMaster : 0;

  // Luz de cada lado del crossfader: ganancia real que aplica el motor con la curva activa
  const crossfaderGains = calculateCrossfaderGains(mixer.crossfader / 100, mixer.crossfaderCurve);
  // La pantalla del espectro sigue al transporte, no al nivel instantáneo (que cae entre golpes)
  const isMasterLive = isAnyPlaying && !isMasterMuted;
  const curves = [
    { id: 'constant-power', title: t('mixer.curve_constant_power', 'Potencia constante'), label: t('mixer.curve_cp_short', 'CP') },
    { id: 'linear', title: t('mixer.curve_linear', 'Lineal'), label: t('mixer.curve_lin_short', 'LIN') },
    { id: 'cut', title: t('mixer.curve_cut', 'Corte (Scratch)'), label: t('mixer.curve_cut_short', 'CUT') },
  ] as const;

  return (
    <div
      className="mixer-console"
      data-testid="mixer-console"
      style={{ '--console-texture': `url(${MIXER_ASSETS.brushedMetal})` } as React.CSSProperties}
    >
      <header className="mixer-console-header">
        <span className="mixer-console-title">{t('mixer.console_title')}</span>
        <span className={clsx('mixer-console-status', isAnyPlaying && 'is-live')}>
          <span className="mixer-console-status-led" aria-hidden="true" />
          {isAnyPlaying ? t('mixer.status_live') : t('mixer.status_standby')}
        </span>
      </header>

      <div className="mixer-channels-area">
        <ChannelStrip
          deckId="A"
          channelName="1"
          isPlaying={isPlayingA}
          playbackState={deckA.playbackState}
          hasTrack={Boolean(deckA.track)}
          vuLevel={effectiveVuA}
        />

        {/* Sección Master Central */}
        <section
          className={clsx('channel-strip mixer-master-strip console-tone-master', isMasterMuted && 'is-muted')}
          data-testid="mixer-master-strip"
          aria-label={t('mixer.master')}
        >
          <header className="channel-header">
            <span className="channel-header-name">{t('mixer.master')}</span>
          </header>

          <div className="channel-controls master-controls">
            <ConsoleKnob
              tone="master"
              value={masterVolume}
              label={t('mixer.master')}
              aria-label={t('mixer.master')}
              aria-valuetext={isMasterMuted ? `${masterVolume}% · ${t('mixer.muted')}` : `${masterVolume}%`}
              data-testid="master-volume-slider"
              onValueChange={(value) => setMasterVolume(value)}
            />

            {/* Espectro real de la mezcla Master */}
            <div
              className={clsx('mixer-spectrum', isMasterLive && 'has-signal')}
              role="img"
              aria-label={isMasterLive ? t('mixer.spectrum_label') : isMasterMuted ? t('mixer.muted') : t('mixer.no_signal')}
              data-testid="master-spectrum"
            >
              <span className="mixer-spectrum-bars" aria-hidden="true">
                {Array.from({ length: SPECTRUM_BANDS }, (_, i) => (
                  <span
                    key={i}
                    ref={(el) => { spectrumBarsRef.current[i] = el; }}
                    className="mixer-spectrum-bar"
                  />
                ))}
              </span>
              <span className="mixer-spectrum-idle" aria-hidden="true">
                {isMasterMuted ? t('mixer.muted') : t('mixer.no_signal')}
              </span>
            </div>

            <button
              type="button"
              className={clsx('mixer-mute-switch', isMasterMuted && 'mixer-mute-btn-active')}
              onClick={toggleMasterMute}
              aria-pressed={isMasterMuted}
              aria-label={t('mixer.mute', 'MUTE')}
              data-testid="master-mute-btn"
              title={isMasterMuted ? t('mixer.mute_on_title') : t('mixer.mute_off_title')}
            >
              <span className="mixer-mute-switch-plate" aria-hidden="true">
                <img src={MIXER_ASSETS.buttonOff} alt="" draggable={false} decoding="async" className="is-off" />
                <img src={MIXER_ASSETS.buttonOn} alt="" draggable={false} decoding="async" className="is-on" />
              </span>
              <span className="mixer-mute-switch-label">
                <span className="mixer-btn-led" aria-hidden="true" />
                {t('mixer.mute', 'MUTE')}
              </span>
            </button>
          </div>

          <div className="channel-fader-section master-meter-section">
            <LevelMeter
              className="master-vu-meter"
              level={effectiveVuMaster}
              label={t('mixer.meter_master')}
              data-testid="master-vu-meter"
              fillTestId="master-vu-meter-fill"
            />
          </div>
        </section>

        <ChannelStrip
          deckId="B"
          channelName="2"
          isPlaying={isPlayingB}
          playbackState={deckB.playbackState}
          hasTrack={Boolean(deckB.track)}
          vuLevel={effectiveVuB}
        />
      </div>

      {/* Área del Crossfader y Selector de Curva */}
      <div className="mixer-crossfader-area">
        <div className="crossfader-header">
          <span className="console-legend">{t('mixer.crossfader_title')}</span>
          <div className="crossfader-curve-selector" role="group" aria-label={t('mixer.curve', 'CURVE')}>
            <span className="mixer-control-label-curve" aria-hidden="true">{t('mixer.curve', 'CURVE')}</span>
            <div className="curve-buttons-group">
              {curves.map((curve) => (
                <button
                  key={curve.id}
                  type="button"
                  className={clsx('curve-btn', mixer.crossfaderCurve === curve.id && 'curve-btn-active')}
                  onClick={() => setCrossfaderCurve(curve.id)}
                  aria-pressed={mixer.crossfaderCurve === curve.id}
                  title={curve.title}
                  aria-label={curve.title}
                  data-testid={`curve-btn-${curve.id}`}
                >
                  {curve.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="crossfader-container">
          <span
            className="crossfader-side crossfader-side-a console-tone-a"
            style={{ '--side-gain': crossfaderGains.gainA } as React.CSSProperties}
            aria-hidden="true"
          >
            A
          </span>
          <ConsoleFader
            className="crossfader-fader"
            orientation="horizontal"
            tone="master"
            value={mixer.crossfader}
            fillFrom={50}
            ticks={CROSSFADER_TICKS}
            aria-label={t('mixer.crossfader_label')}
            aria-valuetext={t('mixer.crossfader_value', { a: Math.round(crossfaderGains.gainA * 100), b: Math.round(crossfaderGains.gainB * 100) })}
            data-testid="crossfader-slider"
            onValueChange={(value) => setCrossfader(value)}
          />
          <span
            className="crossfader-side crossfader-side-b console-tone-b"
            style={{ '--side-gain': crossfaderGains.gainB } as React.CSSProperties}
            aria-hidden="true"
          >
            B
          </span>
        </div>
      </div>

    </div>
  );
};
