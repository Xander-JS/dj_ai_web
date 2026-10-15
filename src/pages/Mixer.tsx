import React from 'react';
import { Deck } from '../components/dj/Deck';
import { MixerConsole } from '../components/dj/MixerConsole';
import { MOCK_LIBRARY } from '../mock/library';
import './Mixer.css';

export const Mixer: React.FC = () => {
  const trackB = MOCK_LIBRARY[1];

  return (
    <div className="mixer-page-container">
      
      {/* Deck A (Conectado al motor real e IndexedDB) */}
      <div className="deck-container">
        <Deck 
          deckName="A"
        />
      </div>

      {/* Mixer Central Console (Visual hasta Fase 21) */}
      <div className="mixer-console-container">
        <MixerConsole />
      </div>

      {/* Deck B (Mock visual hasta Fase 21) */}
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
