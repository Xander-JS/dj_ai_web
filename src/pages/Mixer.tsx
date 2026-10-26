import React from 'react';
import { DJConsole } from '../components/dj/organisms/DJConsole';
import './Mixer.css';

/** Sección Mixer: la consola completa (pantalla digital, Deck A, mixer y Deck B). */
export const Mixer: React.FC = () => (
  <div className="mixer-page-container">
    <DJConsole />
  </div>
);
