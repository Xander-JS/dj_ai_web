import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Slider } from '../ui/Slider';
import { useDJStore } from '../../store/useDJStore';
import './MixerConsole.css';

const ChannelStrip: React.FC<{ channelName: string; isPlaying?: boolean; vuLevel: number }> = ({ channelName, isPlaying, vuLevel }) => {
  const { t } = useTranslation();
  
  // Simulated state for visual feedback
  const [gain, setGain] = useState(50);
  const [hi, setHi] = useState(50);
  const [mid, setMid] = useState(50);
  const [low, setLow] = useState(50);
  const [filter, setFilter] = useState(50);
  const [volume, setVolume] = useState(80);

  return (
    <div className="channel-strip">
      <div className="channel-header">{t('mixer.channel', { num: channelName })}</div>
      
      <div className="channel-controls">
        <div className="mixer-control-group">
          <span className="mixer-control-label">{t('mixer.gain')}</span>
          <Slider value={gain} onChange={(e) => setGain(Number(e.target.value))} />
        </div>
        
        <div className="mixer-control-group">
          <span className="mixer-control-label">{t('mixer.high')}</span>
          <Slider value={hi} onChange={(e) => setHi(Number(e.target.value))} />
        </div>
        
        <div className="mixer-control-group">
          <span className="mixer-control-label">{t('mixer.mid')}</span>
          <Slider value={mid} onChange={(e) => setMid(Number(e.target.value))} />
        </div>
        
        <div className="mixer-control-group">
          <span className="mixer-control-label">{t('mixer.low')}</span>
          <Slider value={low} onChange={(e) => setLow(Number(e.target.value))} />
        </div>
        
        <div className="mixer-control-group">
          <span className="mixer-control-label mixer-control-label-primary">
            {t('mixer.filter')}
          </span>
          <Slider value={filter} onChange={(e) => setFilter(Number(e.target.value))} />
        </div>
      </div>

      <div className="channel-fader-section">
        <Slider 
          orientation="vertical" 
          value={volume} 
          onChange={(e) => setVolume(Number(e.target.value))} 
        />
        <div className="vu-meter">
          {/* Simulate VU meter bouncing if "playing" */}
          <div 
            className="vu-meter-fill" 
            style={{ 
              height: isPlaying ? `${vuLevel}%` : '0%'
            }}
          ></div>
        </div>
      </div>
    </div>
  );
};

const VU_UPDATE_INTERVAL_MS = 150;
const VU_MIN_LEVEL = 50;
const VU_LEVEL_RANGE = 30;

export const MixerConsole: React.FC = () => {
  const { t } = useTranslation();
  const { deckA, deckB } = useDJStore();
  const [crossfader, setCrossfader] = useState(50);
  // Simulated VU meter level, refreshed on an interval (randomness kept out of render)
  const [vuLevel, setVuLevel] = useState(VU_MIN_LEVEL);

  useEffect(() => {
    const interval = setInterval(
      () => setVuLevel(Math.random() * VU_LEVEL_RANGE + VU_MIN_LEVEL),
      VU_UPDATE_INTERVAL_MS
    );
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="mixer-console">
      
      <div className="mixer-channels-area">
        <ChannelStrip channelName="1" isPlaying={deckA.playbackState === 'playing'} vuLevel={vuLevel} />
        <ChannelStrip channelName="2" isPlaying={deckB.playbackState === 'playing'} vuLevel={vuLevel} />
      </div>

      <div className="mixer-crossfader-area">
        <span className="mixer-control-label">{t('mixer.crossfader')}</span>
        <div className="crossfader-container">
          <Slider 
            value={crossfader} 
            onChange={(e) => setCrossfader(Number(e.target.value))} 
          />
        </div>
      </div>

    </div>
  );
};
