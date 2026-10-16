import React from 'react';
import { Deck } from '../components/dj/Deck';
import { MixerConsole } from '../components/dj/MixerConsole';
import './Mixer.css';

export const Mixer: React.FC = () => {
  return (
    <div className="mixer-page-container">
      
      {/* Deck A (Conectado al motor real e IndexedDB) */}
      <div className="deck-container">
        <Deck deckName="A" />
      </div>

      {/* Mixer Central Console (Conectado a useDJStore y AudioEngine) */}
      <div className="mixer-console-container">
        <MixerConsole />
      </div>

      {/* Deck B (Conectado al motor real e IndexedDB) */}
      <div className="deck-container">
        <Deck deckName="B" />
      </div>

    </div>
  );
};
