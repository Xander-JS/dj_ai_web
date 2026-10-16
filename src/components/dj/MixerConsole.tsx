import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { Slider } from '../ui/Slider';
import { useDJStore } from '../../store/useDJStore';
import { audioEngine } from '../../audio';
import './MixerConsole.css';

export interface ChannelStripProps {
  deckId: 'A' | 'B';
  channelName?: string;
  isPlaying?: boolean;
  vuLevel?: number;
}

export const ChannelStrip: React.FC<ChannelStripProps> = ({ 
  deckId, 
  channelName, 
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

  return (
    <div className="channel-strip" data-testid={`channel-strip-${deckId}`}>
      <div className="channel-header">{t('mixer.channel', { num: displayName })}</div>
      
      <div className="channel-controls">
        <div className="mixer-control-group">
          <span className="mixer-control-label">{t('mixer.gain')}</span>
          <Slider 
            value={channel.gain} 
            min={0}
            max={100}
            aria-label={`${t('mixer.gain')} ${displayName}`}
            data-testid={`gain-slider-${deckId}`}
            onChange={(e) => setChannelGain(deckId, Number(e.target.value))} 
          />
        </div>
        
        <div className="mixer-control-group">
          <span className="mixer-control-label">{t('mixer.high')}</span>
          <Slider 
            value={channel.eq.high} 
            min={0}
            max={100}
            aria-label={`${t('mixer.high')} ${displayName}`}
            data-testid={`hi-slider-${deckId}`}
            onChange={(e) => setChannelEq(deckId, 'high', Number(e.target.value))} 
          />
        </div>
        
        <div className="mixer-control-group">
          <span className="mixer-control-label">{t('mixer.mid')}</span>
          <Slider 
            value={channel.eq.mid} 
            min={0}
            max={100}
            aria-label={`${t('mixer.mid')} ${displayName}`}
            data-testid={`mid-slider-${deckId}`}
            onChange={(e) => setChannelEq(deckId, 'mid', Number(e.target.value))} 
          />
        </div>
        
        <div className="mixer-control-group">
          <span className="mixer-control-label">{t('mixer.low')}</span>
          <Slider 
            value={channel.eq.low} 
            min={0}
            max={100}
            aria-label={`${t('mixer.low')} ${displayName}`}
            data-testid={`low-slider-${deckId}`}
            onChange={(e) => setChannelEq(deckId, 'low', Number(e.target.value))} 
          />
        </div>
        
        <div className="mixer-control-group">
          <span className="mixer-control-label mixer-control-label-primary">
            {t('mixer.filter')}
          </span>
          <Slider 
            value={channel.eq.filter} 
            min={0}
            max={100}
            aria-label={`${t('mixer.filter')} ${displayName}`}
            data-testid={`filter-slider-${deckId}`}
            onChange={(e) => setChannelFilter(deckId, Number(e.target.value))} 
          />
        </div>

        <div className="mixer-control-group mixer-cue-group">
          <button
            type="button"
            className={clsx('mixer-cue-btn', channel.cuePfl && 'mixer-cue-btn-active')}
            onClick={() => setCuePfl(deckId, !channel.cuePfl)}
            aria-label={`${t('mixer.cue_pfl', 'CUE')} ${displayName}`}
            data-testid={`cue-btn-${deckId}`}
            title={t('mixer.cue_pfl', 'CUE')}
          >
            {t('mixer.cue_pfl', 'CUE')}
          </button>
        </div>
      </div>

      <div className="channel-fader-section">
        <Slider 
          orientation="vertical" 
          value={channel.volume} 
          min={0}
          max={100}
          aria-label={`${t('mixer.channel', { num: displayName })} Volume`}
          data-testid={`volume-fader-${deckId}`}
          onChange={(e) => setChannelVolume(deckId, Number(e.target.value))} 
        />
        <div className="vu-meter" data-testid={`vu-meter-${deckId}`}>
          {/* Nivel VU real pre-crossfader */}
          <div 
            className="vu-meter-fill" 
            data-testid={`vu-meter-fill-${deckId}`}
            style={{ 
              height: `${clampedVu}%`
            }}
          />
        </div>
      </div>
    </div>
  );
};

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

  useEffect(() => {
    if (!isAnyPlaying) {
      return;
    }

    let rafId: number | null = null;
    let lastTime = 0;

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
    };
  }, [isAnyPlaying, isPlayingA, isPlayingB, isMasterMuted]);

  // Si no hay reproducción activa o está en reposo, el nivel efectivo es 0
  const effectiveVuA = isPlayingA ? vuA : 0;
  const effectiveVuB = isPlayingB ? vuB : 0;
  const effectiveVuMaster = isAnyPlaying && !isMasterMuted ? vuMaster : 0;

  return (
    <div className="mixer-console" data-testid="mixer-console">
      
      <div className="mixer-channels-area">
        <ChannelStrip deckId="A" channelName="1" isPlaying={isPlayingA} vuLevel={effectiveVuA} />
        
        {/* Sección Master Central */}
        <div className="channel-strip mixer-master-strip" data-testid="mixer-master-strip">
          <div className="channel-header">{t('mixer.master')}</div>

          <div className="channel-controls master-controls">
            <div className="mixer-control-group">
              <span className="mixer-control-label">{t('mixer.master')}</span>
              <Slider 
                value={isMasterMuted ? 0 : masterVolume} 
                min={0}
                max={100}
                aria-label={t('mixer.master')}
                data-testid="master-volume-slider"
                onChange={(e) => setMasterVolume(Number(e.target.value))} 
              />
            </div>

            <div className="mixer-control-group mixer-mute-group">
              <button
                type="button"
                className={clsx('mixer-mute-btn', isMasterMuted && 'mixer-mute-btn-active')}
                onClick={toggleMasterMute}
                aria-label={t('mixer.mute', 'MUTE')}
                data-testid="master-mute-btn"
                title={t('mixer.mute', 'MUTE')}
              >
                {t('mixer.mute', 'MUTE')}
              </button>
            </div>
          </div>

          <div className="channel-fader-section">
            <Slider 
              orientation="vertical" 
              value={isMasterMuted ? 0 : masterVolume} 
              min={0}
              max={100}
              aria-label={`${t('mixer.master')} Fader`}
              data-testid="master-fader"
              onChange={(e) => setMasterVolume(Number(e.target.value))} 
            />
            <div className="vu-meter master-vu-meter" data-testid="master-vu-meter">
              <div 
                className="vu-meter-fill master-vu-fill" 
                data-testid="master-vu-meter-fill"
                style={{ 
                  height: `${effectiveVuMaster}%`
                }}
              />
            </div>
          </div>
        </div>

        <ChannelStrip deckId="B" channelName="2" isPlaying={isPlayingB} vuLevel={effectiveVuB} />
      </div>

      {/* Área del Crossfader y Selector de Curva */}
      <div className="mixer-crossfader-area">
        <div className="crossfader-header">
          <span className="mixer-control-label">{t('mixer.crossfader')}</span>
          <div className="crossfader-curve-selector">
            <span className="mixer-control-label-curve">{t('mixer.curve', 'CURVE')}:</span>
            <div className="curve-buttons-group">
              <button
                type="button"
                className={clsx('curve-btn', mixer.crossfaderCurve === 'constant-power' && 'curve-btn-active')}
                onClick={() => setCrossfaderCurve('constant-power')}
                title={t('mixer.curve_constant_power', 'Potencia constante')}
                data-testid="curve-btn-constant-power"
              >
                {t('mixer.curve_cp_short', 'CP')}
              </button>
              <button
                type="button"
                className={clsx('curve-btn', mixer.crossfaderCurve === 'linear' && 'curve-btn-active')}
                onClick={() => setCrossfaderCurve('linear')}
                title={t('mixer.curve_linear', 'Lineal')}
                data-testid="curve-btn-linear"
              >
                {t('mixer.curve_lin_short', 'LIN')}
              </button>
              <button
                type="button"
                className={clsx('curve-btn', mixer.crossfaderCurve === 'cut' && 'curve-btn-active')}
                onClick={() => setCrossfaderCurve('cut')}
                title={t('mixer.curve_cut', 'Corte (Scratch)')}
                data-testid="curve-btn-cut"
              >
                {t('mixer.curve_cut_short', 'CUT')}
              </button>
            </div>
          </div>
        </div>

        <div className="crossfader-container">
          <Slider 
            value={mixer.crossfader} 
            min={0}
            max={100}
            aria-label={t('mixer.crossfader')}
            data-testid="crossfader-slider"
            onChange={(e) => setCrossfader(Number(e.target.value))} 
          />
        </div>
      </div>

    </div>
  );
};
