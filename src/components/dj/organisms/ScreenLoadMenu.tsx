import React, { useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { ScreenReplaceDialog } from '../molecules/ScreenReplaceDialog';
import { digitalScreenStore, type DigitalScreenSnapshot } from '../../../services/console/digitalScreenStore';
import {
  SCREEN_NAV_KEYS,
  SCREEN_SUBSECTIONS,
  filterTracksByTitle,
  initialSelectionIndex,
  resolveLoadIntent,
  resolveMenuKey,
  toMenuRow,
  type MenuCommand,
  type MenuZone,
} from '../../../services/console/screenMenuModel';
import { loadTrackWithFeedback, readLibraryWithFeedback } from '../../../services/console/libraryLoadFeedback';
import { isEditableTarget, SHORTCUTS_PASSTHROUGH_ATTRIBUTE } from '../../../services/keyboard/keyboardShortcuts';
import type { DeckId, PlaybackState } from '../../../types/deck';
import type { Track } from '../../../types/track';
import { INPUT_MAX_LENGTH } from '../../../config/constants';
import './ScreenLoadMenu.css';

/** Lo único que el menú necesita de cada deck (sin el tiempo, que cambia en cada tic). */
export interface MenuDeckInfo {
  trackId: string | null;
  title: string | null;
  playbackState: PlaybackState;
}

export interface ScreenLoadMenuProps {
  screen: DigitalScreenSnapshot;
  decks: Readonly<Record<DeckId, MenuDeckInfo>>;
}

const passthrough = { [SHORTCUTS_PASSTHROUGH_ATTRIBUTE]: 'pass' };

/**
 * Vista de menú de la pantalla digital: contenedor MENU con los subapartados LOAD A / LOAD B, el
 * buscador por título y la lista de la biblioteca; debajo, la barra de teclas. Se maneja con
 * ocho teclas (flechas, Inicio, Fin, Enter, Esc) aunque el foco esté fuera de la pantalla, salvo
 * cuando lo tiene otro control nativo de la consola.
 */
export const ScreenLoadMenu: React.FC<ScreenLoadMenuProps> = React.memo(({ screen, decks }) => {
  const { t } = useTranslation();
  const baseId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const subsectionsRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const loadingDecks = useRef(new Set<DeckId>());

  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [search, setSearch] = useState('');
  const [zone, setZone] = useState<MenuZone>('list');
  // La selección vale para una apertura y un subapartado; al cambiar, vuelve a la regla inicial
  const [selection, setSelection] = useState<{ key: string; id: string | null }>({ key: '', id: null });

  const { subsection, replace, focusRequest } = screen;
  const targetDeck = decks[subsection];
  const loadedTrackId = targetDeck.trackId;
  const visibleTracks = tracks ? filterTracksByTitle(tracks, search) : [];
  const rows = visibleTracks.map(toMenuRow);
  const selectionKey = `${subsection}:${focusRequest}:${tracks ? 'ready' : 'pending'}`;
  const initialIndex = initialSelectionIndex(rows, loadedTrackId);
  const selectedId = selection.key === selectionKey ? selection.id : rows[initialIndex]?.id ?? null;
  const selectedIndex = selectedId ? rows.findIndex((row) => row.id === selectedId) : -1;

  const listId = `${baseId}-list`;
  const optionId = (index: number) => `${baseId}-row-${index}`;
  const subsectionId = (deckId: DeckId) => `${baseId}-sub-${deckId}`;

  // La biblioteca se relee cada vez que se abre el menú: puede haber cambiado en otra sección
  useEffect(() => {
    let cancelled = false;
    void readLibraryWithFeedback().then((library) => {
      if (!cancelled) setTracks(library ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Al abrir y al cambiar de subapartado con los botones, el foco va a la lista
  useEffect(() => {
    listRef.current?.focus({ preventScroll: true });
  }, [focusRequest]);

  // Al cerrarse la confirmación (Esc, Cancelar o Reemplazar) el foco vuelve a la lista, ya sin `inert`
  const hadReplace = useRef(false);
  useEffect(() => {
    if (replace) hadReplace.current = true;
    else if (hadReplace.current) {
      hadReplace.current = false;
      listRef.current?.focus({ preventScroll: true });
    }
  }, [replace]);

  // La fila seleccionada siempre queda a la vista
  const selectedOptionId = selectedIndex >= 0 ? optionId(selectedIndex) : null;
  useEffect(() => {
    if (selectedOptionId) document.getElementById(selectedOptionId)?.scrollIntoView({ block: 'nearest' });
  }, [selectedOptionId]);

  const focusZone = (next: MenuZone) => {
    const element = next === 'subsections' ? subsectionsRef.current : next === 'search' ? searchRef.current : listRef.current;
    element?.focus({ preventScroll: true });
  };

  const select = (index: number) => {
    const row = rows[index];
    if (row) setSelection({ key: selectionKey, id: row.id });
  };

  const requestLoad = (track: Track | undefined) => {
    if (!track) return;
    const intent = resolveLoadIntent({ trackId: loadedTrackId, playbackState: targetDeck.playbackState }, track.id);
    if (intent === 'confirm') digitalScreenStore.requestReplace(subsection, track.id);
    else if (intent === 'load') void load(subsection, track);
  };

  const load = async (deckId: DeckId, track: Track) => {
    // Una carga por deck a la vez: Enter repetido no lanza otra mientras se decodifica
    if (loadingDecks.current.has(deckId)) return;
    loadingDecks.current.add(deckId);
    try {
      await loadTrackWithFeedback(deckId, track);
    } finally {
      loadingDecks.current.delete(deckId);
    }
  };

  const confirmReplace = () => {
    if (!replace) return;
    const track = tracks?.find((candidate) => candidate.id === replace.trackId);
    digitalScreenStore.cancelReplace();
    if (track) void load(replace.deckId, track);
  };

  const apply = (command: MenuCommand) => {
    switch (command.type) {
      case 'subsection':
        digitalScreenStore.selectSubsection(command.deckId);
        break;
      case 'focus':
        focusZone(command.zone);
        break;
      case 'select':
        select(command.index);
        if (zone !== 'list') focusZone('list');
        break;
      case 'load':
        requestLoad(visibleTracks[selectedIndex]);
        break;
      case 'clear-search':
        setSearch('');
        break;
      case 'close':
        digitalScreenStore.closeMenu();
        break;
    }
  };

  const handleWindowKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    if (!SCREEN_NAV_KEYS.has(event.key)) return;
    const inside = Boolean(rootRef.current && event.target instanceof Node && rootRef.current.contains(event.target));
    // Un control nativo de la consola con el foco (fader, perilla…) conserva sus teclas
    if (!inside && isEditableTarget(event.target)) return;

    if (replace) {
      // Con la confirmación abierta solo cuentan Enter y Esc
      event.preventDefault();
      if (event.repeat) return;
      if (event.key === 'Escape') digitalScreenStore.cancelReplace();
      else if (event.key === 'Enter' && !digitalScreenStore.isEnterGuarded()) confirmReplace();
      return;
    }

    const command = resolveMenuKey(zone, event.key, {
      subsection,
      selectedIndex,
      rowCount: rows.length,
      searchText: search,
    });
    if (command.type === 'native') return;
    event.preventDefault();
    apply(command);
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleWindowKey(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const replaceTrack = replace ? tracks?.find((candidate) => candidate.id === replace.trackId) : undefined;
  const emptyText = tracks && rows.length === 0
    ? (tracks.length === 0 ? t('mixer.picker_empty') : t('mixer.picker_no_results'))
    : null;

  return (
    <div ref={rootRef} className={clsx('screen-menu', `console-tone-${subsection.toLowerCase()}`)} data-testid="screen-menu">
      <div className="screen-menu__stage">
        <fieldset className={clsx('screen-menu__frame', replace && 'is-dimmed')} inert={Boolean(replace)}>
          <legend className="screen-menu__legend">{t('mixer.screen.menu')}</legend>

          <div
            ref={subsectionsRef}
            className="screen-menu__subsections"
            role="listbox"
            tabIndex={0}
            aria-label={t('mixer.screen.subsections')}
            aria-activedescendant={subsectionId(subsection)}
            onFocus={() => setZone('subsections')}
            data-testid="screen-menu-subsections"
            {...passthrough}
          >
            {SCREEN_SUBSECTIONS.map((deckId) => (
              <div
                key={deckId}
                id={subsectionId(deckId)}
                role="option"
                aria-selected={deckId === subsection}
                className={clsx('screen-menu__subsection', `console-tone-${deckId.toLowerCase()}`, deckId === subsection && 'is-active')}
                onClick={() => {
                  digitalScreenStore.selectSubsection(deckId);
                  focusZone('subsections');
                }}
                data-testid={`screen-menu-subsection-${deckId.toLowerCase()}`}
              >
                {t(`mixer.screen.load_${deckId.toLowerCase()}`)}
              </div>
            ))}
          </div>

          <div className="screen-menu__browser">
            <input
              ref={searchRef}
              type="text"
              maxLength={INPUT_MAX_LENGTH}
              className="screen-menu__search"
              placeholder={t('mixer.screen.search')}
              aria-label={t('mixer.screen.search')}
              aria-controls={listId}
              autoComplete="off"
              spellCheck={false}
              value={search}
              onChange={(event) => {
                const next = event.target.value;
                setSearch(next);
                const first = tracks ? filterTracksByTitle(tracks, next)[0] : undefined;
                setSelection({ key: selectionKey, id: first?.id ?? null });
              }}
              onFocus={() => setZone('search')}
              data-testid="screen-menu-search"
            />

            <div className="screen-menu__table">
              <div className="screen-menu__row screen-menu__row--head" aria-hidden="true">
                <span>{t('mixer.screen.col_title')}</span>
                <span>{t('mixer.screen.col_bpm')}</span>
                <span>{t('mixer.screen.col_camelot')}</span>
                <span>{t('mixer.screen.col_duration')}</span>
              </div>
              <div
                ref={listRef}
                id={listId}
                className="screen-menu__list"
                role="listbox"
                tabIndex={0}
                aria-label={t('mixer.screen.list', { deck: subsection })}
                aria-activedescendant={selectedIndex >= 0 ? optionId(selectedIndex) : undefined}
                onFocus={() => setZone('list')}
                data-testid="screen-menu-list"
                {...passthrough}
              >
                {rows.map((row, index) => {
                  const isLoaded = row.id === loadedTrackId;
                  return (
                    <div
                      key={row.id}
                      id={optionId(index)}
                      role="option"
                      aria-selected={index === selectedIndex}
                      className={clsx('screen-menu__row', index === selectedIndex && 'is-selected', isLoaded && 'is-loaded')}
                      onClick={() => {
                        select(index);
                        focusZone('list');
                      }}
                      onDoubleClick={() => requestLoad(visibleTracks[index])}
                      data-testid={`screen-menu-row-${row.id}`}
                    >
                      <span className="screen-menu__title">
                        <span className="screen-menu__loaded-mark" aria-hidden="true" />
                        <span className="screen-menu__title-text">{row.title}</span>
                        {isLoaded && <span className="sd-visually-hidden">, {t('mixer.screen.loaded', { deck: subsection })}</span>}
                      </span>
                      <span>{row.bpm}</span>
                      <span>{row.camelot}</span>
                      <span>{row.duration}</span>
                    </div>
                  );
                })}
              </div>
              {emptyText && <p className="screen-menu__empty">{emptyText}</p>}
            </div>
          </div>
        </fieldset>

        {replace && (
          <ScreenReplaceDialog
            deckId={replace.deckId}
            outTitle={decks[replace.deckId].title ?? t('dj.no_track')}
            inTitle={replaceTrack?.title ?? ''}
            onCancel={() => digitalScreenStore.cancelReplace()}
            onReplace={confirmReplace}
          />
        )}
      </div>

      <p className="screen-menu__keybar" data-testid="screen-menu-keybar">
        {replace ? t('mixer.screen.keybar_dialog') : t('mixer.screen.keybar_menu')}
      </p>
    </div>
  );
});

ScreenLoadMenu.displayName = 'ScreenLoadMenu';
