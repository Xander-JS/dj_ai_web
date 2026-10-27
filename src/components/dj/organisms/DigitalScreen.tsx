import React, { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { ScreenButtonRow } from '../molecules/ScreenButtonRow';
import { ScreenDeckIdent } from '../molecules/ScreenDeckIdent';
import { ScreenWaveform } from '../molecules/ScreenWaveform';
import { ScreenTechInfo } from '../molecules/ScreenTechInfo';
import { ScreenRecCounter } from '../molecules/ScreenRecCounter';
import { ConsoleLiveIndicator } from '../molecules/ConsoleLiveIndicator';
import { ScreenPowerOn } from '../molecules/ScreenPowerOn';
import { ScreenLoadMenu, type MenuDeckInfo } from './ScreenLoadMenu';
import { useDJStore, type DeckStoreState } from '../../../store/useDJStore';
import { useSessionCapture } from '../../../hooks/useSessionCapture';
import { digitalScreenStore } from '../../../services/console/digitalScreenStore';
import { toggleSessionCaptureWithFeedback } from '../../../services/session/sessionCaptureFeedback';
import type { DeckId } from '../../../types/deck';
import './DigitalScreen.css';

/**
 * Pantalla digital de la consola: módulo elevado con su botonera (MENU, GRID, LOAD A, LOAD B,
 * REC y el indicador EN VIVO / EN ESPERA) y un área de visualización con dos vistas. La normal muestra, para cada deck, su
 * identificación, su forma de onda y su información técnica; la de menú carga pistas de la
 * biblioteca. El contador de grabación ocupa la esquina superior derecha en ambas.
 */
export const DigitalScreen: React.FC = () => {
  const { t } = useTranslation();
  const { deckA, deckB, seekDeck } = useDJStore();
  const screen = useSyncExternalStore(digitalScreenStore.subscribe, digitalScreenStore.getSnapshot);
  const capture = useSessionCapture();

  // Solo hay pantalla (y atajos V / N activos) mientras el Mixer está montado
  useEffect(() => digitalScreenStore.attach(), []);

  const menuDecks = useMemo<Record<DeckId, MenuDeckInfo>>(() => ({
    A: { trackId: deckA.track?.id ?? null, title: deckA.track?.title ?? null, playbackState: deckA.playbackState },
    B: { trackId: deckB.track?.id ?? null, title: deckB.track?.title ?? null, playbackState: deckB.playbackState },
  }), [deckA.track?.id, deckA.track?.title, deckA.playbackState, deckB.track?.id, deckB.track?.title, deckB.playbackState]);

  const renderIdent = (deck: DeckStoreState) => (
    <ScreenDeckIdent
      deckId={deck.deckId}
      title={deck.track?.title || t('dj.no_track')}
      artist={deck.track ? deck.track.artist || t('dj.unknown_artist') : ''}
    />
  );

  return (
    <section className="digital-screen" aria-label={t('mixer.screen.label')} data-testid="digital-screen">
      <ScreenButtonRow
        view={screen.view}
        subsection={screen.subsection}
        gridEnabled={screen.gridEnabled}
        recording={capture.active}
        onMenu={() => digitalScreenStore.pressMenu()}
        onGrid={() => digitalScreenStore.toggleGrid()}
        onLoad={(deckId) => digitalScreenStore.pressLoad(deckId)}
        onRec={() => toggleSessionCaptureWithFeedback()}
        status={<ConsoleLiveIndicator />}
      />

      <div
        className={clsx('digital-screen__display', `is-${screen.view}`, capture.active && 'is-recording')}
        data-grid={screen.gridEnabled ? 'on' : 'off'}
        data-testid="digital-screen-display"
      >
        {screen.view === 'menu' ? (
          <ScreenLoadMenu screen={screen} decks={menuDecks} />
        ) : (
          <div className="digital-screen__normal">
            {renderIdent(deckA)}
            <ScreenWaveform deck={deckA} onSeek={(position) => seekDeck('A', position)} />
            {renderIdent(deckB)}
            <ScreenWaveform deck={deckB} onSeek={(position) => seekDeck('B', position)} />
            <div className="digital-screen__tech">
              <ScreenTechInfo deck={deckA} />
              <ScreenTechInfo deck={deckB} />
            </div>
          </div>
        )}
        {capture.active && <ScreenRecCounter elapsedMs={capture.elapsedMs} />}
        <ScreenPowerOn />
      </div>
    </section>
  );
};
