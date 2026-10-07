import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Slider } from '../ui/Slider';
import './MixerConsole.css';

const ChannelStrip: React.FC<{ channelName: string; isPlaying?: boolean }> = ({ channelName, isPlaying }) => {
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
      <div className="channel-header">CH {channelName}</div>
      
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
          <span className="mixer-control-label" style={{ color: 'var(--color-primary-500)' }}>
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
              height: isPlaying ? `${Math.random() * 30 + 50}%` : '0%',
              transition: 'height 0.1s ease'
            }}
          ></div>
        </div>
      </div>
    </div>
  );
};

export const MixerConsole: React.FC = () => {
  const [crossfader, setCrossfader] = useState(50);
  // Just simulating random interval for VU meters
  const [tick, setTick] = useState(0);

  React.useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 150);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="mixer-console">
      
      <div className="mixer-channels-area">
        {/* We pass tick just to force a re-render for the simulated VU meter animation */}
        <ChannelStrip channelName="1" isPlaying={true} key={`ch1-${tick}`} />
        <ChannelStrip channelName="2" isPlaying={false} key={`ch2-${tick}`} />
      </div>

      <div className="mixer-crossfader-area">
        <span className="mixer-control-label">A - CROSSFADER - B</span>
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
