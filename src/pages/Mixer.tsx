import React from 'react';
import { Deck } from '../components/dj/Deck';
import { MixerConsole } from '../components/dj/MixerConsole';
import { MOCK_LIBRARY } from '../mock/library';
import './Mixer.css';

export const Mixer: React.FC = () => {
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

      {/* Mixer Central Console */}
      <div className="mixer-console-container">
        <MixerConsole />
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
