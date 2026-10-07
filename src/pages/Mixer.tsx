import React from 'react';
import { useTranslation } from 'react-i18next';
import { Deck } from '../components/dj/Deck';
import { MOCK_LIBRARY } from '../mock/library';
import './Mixer.css';

export const Mixer: React.FC = () => {
  const { t } = useTranslation();

  const trackA = MOCK_LIBRARY[0];
  const trackB = MOCK_LIBRARY[1];

  return (
    <div className="mixer-page-container">
      
      {/* Deck A */}
      <div className="deck-container">
        <Deck 
          deckName="A"
          trackTitle={trackA.title}
          trackArtist={trackA.artist}
          bpm={trackA.bpm}
          keyStr={trackA.key}
          timeRemaining="-4:20"
        />
      </div>

      {/* Mixer Central Console (Placeholder for Step 11) */}
      <div className="mixer-console-placeholder">
        <h3 style={{ color: 'var(--text-tertiary)', writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
          {t('navigation.mixer')} CONSOLE
        </h3>
      </div>

      {/* Deck B */}
      <div className="deck-container">
        <Deck 
          deckName="B"
          trackTitle={trackB.title}
          trackArtist={trackB.artist}
          bpm={trackB.bpm}
          keyStr={trackB.key}
          timeRemaining="-6:45"
        />
      </div>

    </div>
  );
};
