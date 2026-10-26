import React, { useState, useEffect } from 'react';
import { useDJStore } from '../../../store/useDJStore';
import { audioEngine } from '../../../audio';
import { SILENT_STEREO, getEffectiveLevels, type StereoLevel } from '../../../services/console/mixerPanelModel';
import { MixerChannelStrip } from '../molecules/MixerChannelStrip';
import { MixerMasterStrip } from '../molecules/MixerMasterStrip';
import { MixerCrossfader } from '../molecules/MixerCrossfader';
import '../consoleTheme.css';
import './MixerConsole.css';

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

/**
 * Mixer central (sección 4): CH 1 | MASTER | CH 2 separados por líneas finas y el crossfader a
 * todo el ancho debajo. Es parte de la misma placa de plástico que los decks, no una tarjeta.
 * Lee los vúmetros reales del motor a ~30 Hz en estado local (nunca en el store global).
 */
export const MixerConsole: React.FC = () => {
  const { deckA, deckB, isMasterMuted } = useDJStore();

  const isPlayingA = deckA.playbackState === 'playing';
  const isPlayingB = deckB.playbackState === 'playing';
  const isAnyPlaying = isPlayingA || isPlayingB;

  // Estados locales para los vúmetros a 30 Hz (evita rerenders en el store global)
  const [vuA, setVuA] = useState(0);
  const [vuB, setVuB] = useState(0);
  const [vuMaster, setVuMaster] = useState<StereoLevel>(SILENT_STEREO);

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
          setVuA(isPlayingA ? audioEngine.getDeckVUMeter('A') : 0);
          setVuB(isPlayingB ? audioEngine.getDeckVUMeter('B') : 0);
          setVuMaster(isMasterMuted ? SILENT_STEREO : audioEngine.getMasterStereoVUMeter());
        } catch {
          setVuA(0);
          setVuB(0);
          setVuMaster(SILENT_STEREO);
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
  const levels = getEffectiveLevels({ isPlayingA, isPlayingB, isMasterMuted, levelA: vuA, levelB: vuB, master: vuMaster });

  return (
    <div className="mixer-console" data-testid="mixer-console">
      <div className="mixer-console__columns">
        <MixerChannelStrip
          deckId="A"
          isPlaying={isPlayingA}
          playbackState={deckA.playbackState}
          hasTrack={Boolean(deckA.track)}
          vuLevel={levels.a}
        />
        <MixerMasterStrip level={levels.master} />
        <MixerChannelStrip
          deckId="B"
          isPlaying={isPlayingB}
          playbackState={deckB.playbackState}
          hasTrack={Boolean(deckB.track)}
          vuLevel={levels.b}
        />
      </div>
      <MixerCrossfader />
    </div>
  );
};
