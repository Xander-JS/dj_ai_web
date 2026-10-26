import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { SelectMenu, type SelectMenuHandle } from '../molecules/SelectMenu';
import { useDJStore } from '../../store/useDJStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { indexedDBStorage } from '../../services/storage/IndexedDBStorage';
import { toastStore } from '../../services/notifications/toastService';
import { registerTrackPicker, toggleTrackPicker } from '../../services/console/trackPickerBridge';
import type { DeckId } from '../../types/deck';
import type { Track } from '../../types/track';
import './ConsoleTrackPicker.css';

/** Opción informativa cuando la biblioteca está vacía; nunca coincide con el id de una pista. */
const EMPTY_OPTION = '__empty__';

export interface ConsoleTrackPickerProps {
  deckId: DeckId;
}

/**
 * Selector compacto de la biblioteca para un deck, integrado en la consola. Lee las pistas
 * guardadas y carga la elegida con el mismo proceso que la Biblioteca (loadTrackToDeck), solo
 * en su deck. Se muestra u oculta con clic o con su atajo (V para el Deck A, N para el Deck B);
 * los atajos se consultan en Ajustes, no se muestran en la consola.
 */
export const ConsoleTrackPicker: React.FC<ConsoleTrackPickerProps> = ({ deckId }) => {
  const { t } = useTranslation();
  const { deckA, deckB, loadTrackToDeck } = useDJStore();
  const { settings } = useSettingsStore();
  const [tracks, setTracks] = useState<Track[]>([]);
  const menuRef = useRef<SelectMenuHandle>(null);
  const deck = deckId === 'A' ? deckA : deckB;
  const deckLabel = `Deck ${deckId}`;

  // Se relee al abrir: la biblioteca puede haber cambiado desde otra sección
  const refreshTracks = useCallback(() => {
    indexedDBStorage
      .getAllTracks()
      .then(setTracks)
      .catch((error: unknown) => {
        console.warn('[ConsoleTrackPicker] Could not read the library:', error);
        toastStore.show('error', t('mixer.picker_library_error'));
      });
  }, [t]);

  useEffect(() => {
    refreshTracks();
  }, [refreshTracks]);

  useEffect(() => registerTrackPicker(deckId, () => menuRef.current?.toggle()), [deckId]);

  // Con la lista abierta (fuera del buscador) su atajo la oculta y el del otro deck pasa a ese selector
  const ownCode = deckId === 'A' ? settings.shortcutBindings.libraryA : settings.shortcutBindings.libraryB;
  const otherCode = deckId === 'A' ? settings.shortcutBindings.libraryB : settings.shortcutBindings.libraryA;
  const handleMenuKey = (event: React.KeyboardEvent): boolean => {
    if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.repeat) return false;
    if (event.code === ownCode) {
      menuRef.current?.toggle();
      return true;
    }
    if (event.code === otherCode) {
      menuRef.current?.toggle();
      toggleTrackPicker(deckId === 'A' ? 'B' : 'A');
      return true;
    }
    return false;
  };

  const handleChange = async (trackId: string) => {
    const track = tracks.find((candidate) => candidate.id === trackId);
    if (!track) return;
    try {
      const loaded = await loadTrackToDeck(deckId, track);
      if (loaded) toastStore.show('success', t('library.toast.added_to_deck', { deck: deckLabel }));
      else toastStore.show('error', t('library.toast.load_failed', { deck: deckLabel }));
    } catch (error) {
      toastStore.show('error', t('library.load_exception_error', {
        deck: deckLabel,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  };

  const options = tracks.length > 0
    ? tracks.map((track) => ({
        value: track.id,
        label: track.title,
        description: [track.artist, track.analysis?.bpm ? `${Math.round(track.analysis.bpm)} BPM` : null].filter(Boolean).join(' · '),
      }))
    : [{ value: EMPTY_OPTION, label: t('mixer.picker_empty'), disabled: true }];

  return (
    <div
      className={clsx('console-track-picker', `console-tone-${deckId === 'A' ? 'a' : 'b'}`)}
      data-testid={`console-track-picker-${deckId}`}
    >
      <span className="console-track-picker__legend">
        <span className="console-legend">{t('mixer.picker_label', { deck: deckId })}</span>
      </span>
      <SelectMenu
        size="sm"
        value={deck.track?.id ?? ''}
        options={options}
        placeholder={t('mixer.picker_placeholder')}
        label={t('mixer.picker_aria', { deck: deckId })}
        searchPlaceholder={t('mixer.picker_search')}
        noResultsLabel={t('mixer.picker_no_results')}
        menuMinWidth={260}
        disabled={deck.playbackState === 'loading'}
        handleRef={menuRef}
        onOpen={refreshTracks}
        returnFocus={false}
        onMenuKey={handleMenuKey}
        menuClassName="console-track-picker__menu"
        wrapperClassName="console-track-picker__select"
        onChange={(value) => void handleChange(value)}
      />
    </div>
  );
};
