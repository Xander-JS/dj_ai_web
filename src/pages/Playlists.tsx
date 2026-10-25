import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Play, Pause, Shuffle, ListMusic, Pencil, Trash2, ChevronUp, ChevronDown, X, Check, Music } from 'lucide-react';
import { Button } from '../components/atoms/Button';
import { IconButton } from '../components/atoms/IconButton';
import { Icon } from '../components/atoms/Icon';
import { TextField } from '../components/atoms/TextField';
import { EmptyState } from '../components/molecules/EmptyState';
import { Notice } from '../components/molecules/Notice';
import { SelectMenu } from '../components/molecules/SelectMenu';
import { ConsoleTemplate } from '../components/templates/ConsoleTemplate';
import { useSmoothScroll } from '../design-system/smoothScroll';
import { indexedDBStorage } from '../services/storage/IndexedDBStorage';
import { notificationCenter } from '../services/notifications/notificationCenter';
import {
  playlistService,
  addTracksToPlaylist,
  removeTrackFromPlaylist,
  moveTrackInPlaylist,
  renamePlaylist,
  normalizePlaylistName,
  MAX_PLAYLIST_NAME_LENGTH,
} from '../services/playlists/playlistService';
import { useDJStore } from '../store/useDJStore';
import { playerQueue, usePlayerQueue } from '../services/player/playerService';
import { formatDuration } from '../utils/formatters';
import type { Playlist } from '../types/playlist';
import type { Track } from '../types/track';
import { clsx } from 'clsx';
import './Playlists.css';

// La portada se pinta con un campo plano del sistema derivado de forma estable del color guardado;
// el dato `coverColor` no cambia
const COVER_FIELDS = ['sd-field-accent', 'sd-field-sage', 'sd-field-acid'] as const;

function coverFieldClass(coverColor: string): string {
  let hash = 0;
  for (const char of coverColor) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COVER_FIELDS[hash % COVER_FIELDS.length];
}

function playlistInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '#';
}

export const Playlists: React.FC = () => {
  const { t } = useTranslation();
  const tableScrollRef = useSmoothScroll<HTMLDivElement>();
  const navigate = useNavigate();
  const { deckA, togglePlayDeckA } = useDJStore();
  const queue = usePlayerQueue();

  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [libraryTracks, setLibraryTracks] = useState<Track[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  // Al llegar desde «Generar mix» la playlist creada viene en el estado de navegación
  const location = useLocation();
  const [activeId, setActiveId] = useState<string | null>(
    () => (location.state as { playlistId?: string } | null)?.playlistId ?? null
  );

  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [trackToAdd, setTrackToAdd] = useState('');

  const reportError = useCallback((err: unknown) => {
    console.error('[Playlists] Error en operación de playlist:', err);
    notificationCenter.push({
      type: 'error',
      messageKey: 'notifications.playlist_error',
      params: { error: err instanceof Error ? err.message : String(err) },
    });
  }, []);

  // Carga de playlists y pistas locales; se recarga ante cualquier cambio del servicio
  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      try {
        const [storedPlaylists, storedTracks] = await Promise.all([
          playlistService.getAll(),
          indexedDBStorage.getAllTracks(),
        ]);
        if (!isMounted) return;
        setPlaylists(storedPlaylists);
        setLibraryTracks(storedTracks);
      } catch (err) {
        console.error('[Playlists] Error al cargar datos locales:', err);
      } finally {
        if (isMounted) setIsLoaded(true);
      }
    };
    void load();
    const unsubscribe = playlistService.subscribe(() => void load());
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const tracksById = useMemo(() => new Map(libraryTracks.map((tr) => [tr.id, tr])), [libraryTracks]);

  // Selección derivada: la elegida si sigue existiendo, o la primera disponible
  const activePlaylist = playlists.find((p) => p.id === activeId) ?? playlists[0] ?? null;

  // Pistas resueltas en orden; se omiten ids cuya pista ya no existe en la biblioteca
  const activeTracks = useMemo<Track[]>(() => {
    if (!activePlaylist) return [];
    return activePlaylist.trackIds
      .map((id) => tracksById.get(id))
      .filter((tr): tr is Track => Boolean(tr));
  }, [activePlaylist, tracksById]);

  const availableToAdd = useMemo(
    () => libraryTracks.filter((tr) => !activePlaylist?.trackIds.includes(tr.id)),
    [libraryTracks, activePlaylist],
  );

  const totalDuration = activeTracks.reduce((sum, tr) => sum + (tr.duration || 0), 0);

  const selectPlaylist = (id: string) => {
    setActiveId(id);
    setIsRenaming(false);
    setIsConfirmingDelete(false);
    setTrackToAdd('');
  };

  const updateActive = async (edit: (playlist: Playlist) => Playlist) => {
    if (!activePlaylist) return;
    try {
      await playlistService.update(activePlaylist.id, edit);
    } catch (err) {
      reportError(err);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!normalizePlaylistName(newName)) return;
    try {
      const created = await playlistService.create(newName);
      setActiveId(created.id);
      setNewName('');
      setIsCreating(false);
      notificationCenter.push({ type: 'success', messageKey: 'notifications.playlist_created', params: { name: created.name } });
    } catch (err) {
      reportError(err);
    }
  };

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!normalizePlaylistName(renameValue)) return;
    await updateActive((p) => renamePlaylist(p, renameValue));
    setIsRenaming(false);
  };

  const handleDelete = async () => {
    if (!activePlaylist) return;
    try {
      await playlistService.remove(activePlaylist.id);
      setActiveId(null);
      setIsConfirmingDelete(false);
      notificationCenter.push({ type: 'success', messageKey: 'notifications.playlist_deleted', params: { name: activePlaylist.name } });
    } catch (err) {
      reportError(err);
    }
  };

  const handleAddTrack = async () => {
    if (!trackToAdd) return;
    await updateActive((p) => addTracksToPlaylist(p, [trackToAdd]));
    setTrackToAdd('');
  };

  // Reproducción por la cola compartida (Deck A): antes solo se cargaba la primera pista y
  // nunca se llamaba a Play, por eso una playlist (también de una sola pista) no sonaba.
  const contextId = activePlaylist ? `playlist:${activePlaylist.id}` : null;
  const currentEntry = queue.entries[queue.currentIndex] ?? null;
  const isActiveContext = contextId !== null && queue.contextId === contextId && currentEntry !== null;
  const isContextLoaded = isActiveContext && deckA.track?.id === currentEntry.track.id;
  const isContextPlaying = isContextLoaded && deckA.playbackState === 'playing';
  const isShuffleActive = isActiveContext && queue.shuffle;

  const handlePlay = () => {
    if (activeTracks.length === 0) return;
    // La playlist ya está en el reproductor: Play/Pausa sin reiniciar la cola
    if (isContextLoaded) {
      void togglePlayDeckA();
      return;
    }
    void playerQueue.playTracks(activeTracks, { shuffle: false, contextId });
  };

  const handleShuffle = () => {
    if (activeTracks.length === 0) return;
    // Sonando esta playlist, el botón alterna el modo sin cortar la pista en curso
    if (isActiveContext) {
      playerQueue.toggleShuffle();
      return;
    }
    void playerQueue.playTracks(activeTracks, { shuffle: true, contextId });
  };

  if (!isLoaded) {
    return (
      <ConsoleTemplate fill className="sd-playlists">
        <EmptyState status="loading" title={t('states.loading')} />
      </ConsoleTemplate>
    );
  }

  return (
    <ConsoleTemplate fill className="sd-playlists">
      <div className="sd-playlists__layout">

        {/* Lista de playlists */}
        <section className="sd-playlists-list" aria-labelledby="playlists-list-title">
          <header className="sd-playlists-list__header">
            <h2 id="playlists-list-title" className="sd-playlists-list__title">{t('playlists.title')}</h2>
            <IconButton
              icon={<Icon icon={isCreating ? X : Plus} size="md" />}
              label={t('playlists.create')}
              variant={isCreating ? 'surface' : 'ink'}
              aria-expanded={isCreating}
              onClick={() => setIsCreating((v) => !v)}
            />
          </header>

          {isCreating && (
            <form className="sd-playlists-list__create" onSubmit={handleCreate}>
              <TextField
                autoFocus
                placeholder={t('playlists.name_placeholder')}
                aria-label={t('playlists.name_placeholder')}
                maxLength={MAX_PLAYLIST_NAME_LENGTH}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setIsCreating(false)}
                wrapperClassName="sd-playlists-list__create-field"
              />
              <IconButton
                type="submit"
                icon={<Icon icon={Check} size="md" />}
                label={t('playlists.create_confirm')}
                variant="ink"
                disabled={!normalizePlaylistName(newName)}
              />
            </form>
          )}

          <ul className="sd-playlists-list__items">
            {playlists.map(playlist => (
              <li key={playlist.id}>
                <button
                  type="button"
                  aria-current={activePlaylist?.id === playlist.id ? 'true' : undefined}
                  className={clsx('sd-playlist-item', activePlaylist?.id === playlist.id && 'is-active')}
                  onClick={() => selectPlaylist(playlist.id)}
                >
                  <span className={clsx('sd-playlist-cover sd-playlist-cover--mini', coverFieldClass(playlist.coverColor))} aria-hidden="true">
                    {playlistInitial(playlist.name)}
                  </span>
                  <span className="sd-playlist-item__info">
                    <span className="sd-playlist-item__name">{playlist.name}</span>
                    <span className="sd-playlist-item__count sd-num">
                      {t('playlists.tracks_count', { count: playlist.trackIds.filter((id) => tracksById.has(id)).length })}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* Detalle de la playlist activa */}
        <section className="sd-playlist-detail" aria-label={activePlaylist?.name}>
          {activePlaylist ? (
            <>
              <header className="sd-playlist-detail__header">
                <div className={clsx('sd-playlist-cover sd-playlist-cover--large', coverFieldClass(activePlaylist.coverColor))} aria-hidden="true">
                  {playlistInitial(activePlaylist.name)}
                </div>
                <div className="sd-playlist-detail__info">
                  {isRenaming ? (
                    <form className="sd-playlist-detail__actions" onSubmit={handleRename}>
                      <TextField
                        autoFocus
                        aria-label={t('playlists.rename')}
                        maxLength={MAX_PLAYLIST_NAME_LENGTH}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Escape' && setIsRenaming(false)}
                        wrapperClassName="sd-playlist-detail__rename"
                      />
                      <Button type="submit" variant="ink" disabled={!normalizePlaylistName(renameValue)}>
                        {t('common.save')}
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setIsRenaming(false)}>
                        {t('common.cancel')}
                      </Button>
                    </form>
                  ) : (
                    <h2 className="sd-playlist-detail__title">{activePlaylist.name}</h2>
                  )}
                  <p className="sd-playlist-detail__meta sd-num">
                    <span>{t('playlists.tracks_count', { count: activeTracks.length })}</span>
                    <span aria-hidden="true">·</span>
                    <span>{t('playlists.total_duration', { time: formatDuration(totalDuration) })}</span>
                  </p>

                  {isConfirmingDelete ? (
                    <Notice
                      tone="error"
                      role="status"
                      className="sd-playlist-detail__confirm"
                      action={
                        <>
                          <Button variant="ghost" size="sm" onClick={() => setIsConfirmingDelete(false)}>
                            {t('common.cancel')}
                          </Button>
                          <Button variant="ink" size="sm" onClick={handleDelete}>
                            <Icon icon={Trash2} size="sm" />
                            {t('common.delete')}
                          </Button>
                        </>
                      }
                    >
                      {t('playlists.delete_confirm', { name: activePlaylist.name })}
                    </Notice>
                  ) : (
                    <div className="sd-playlist-detail__actions">
                      {/* Solo icono: Play y Pausa ocupan el mismo cuadrado y la fila no se mueve */}
                      <IconButton
                        icon={<Icon icon={isContextPlaying ? Pause : Play} size="md" className={clsx(!isContextPlaying && 'sd-playlist-detail__play-glyph')} />}
                        variant="accent"
                        label={isContextPlaying ? t('playlists.pause_playlist') : t('playlists.play_sequential')}
                        disabled={activeTracks.length === 0}
                        onClick={handlePlay}
                      />
                      <IconButton
                        icon={<Icon icon={Shuffle} size="md" />}
                        variant={isShuffleActive ? 'ink' : 'surface'}
                        label={isShuffleActive ? t('playlists.shuffle_on') : t('playlists.shuffle_play')}
                        aria-pressed={isShuffleActive}
                        disabled={activeTracks.length === 0}
                        className={clsx('sd-playlist-detail__shuffle', isShuffleActive && 'is-on')}
                        onClick={handleShuffle}
                      />
                      <IconButton
                        icon={<Icon icon={Pencil} size="md" />}
                        variant="surface"
                        label={t('playlists.rename')}
                        onClick={() => {
                          setRenameValue(activePlaylist.name);
                          setIsRenaming(true);
                        }}
                      />
                      <IconButton
                        icon={<Icon icon={Trash2} size="md" />}
                        variant="surface"
                        label={t('playlists.delete')}
                        onClick={() => setIsConfirmingDelete(true)}
                      />
                    </div>
                  )}
                </div>
              </header>

              <div className="sd-playlist-detail__tracks">
                {/* Añadir pistas desde la biblioteca local */}
                {libraryTracks.length === 0 ? (
                  <EmptyState
                    icon={ListMusic}
                    title={t('playlists.no_library_title')}
                    description={t('playlists.no_library_desc')}
                    action={
                      <Button variant="ink" onClick={() => navigate('/library')}>
                        <Icon icon={Music} size="md" />
                        {t('navigation.library')}
                      </Button>
                    }
                  />
                ) : (
                  <div className="sd-playlist-detail__add">
                    <SelectMenu
                      label={t('playlists.add_track')}
                      placeholder={availableToAdd.length === 0 ? t('playlists.all_tracks_added') : t('playlists.select_track')}
                      value={trackToAdd}
                      disabled={availableToAdd.length === 0}
                      searchPlaceholder={availableToAdd.length > 8 ? t('playlists.search_tracks') : undefined}
                      noResultsLabel={t('states.empty_title')}
                      menuMinWidth={320}
                      options={availableToAdd.map((tr) => ({
                        value: tr.id,
                        label: tr.title,
                        description: tr.artist || t('dj.unknown_artist'),
                      }))}
                      onChange={setTrackToAdd}
                      wrapperClassName="sd-playlist-detail__add-select"
                    />
                    <Button variant="ink" disabled={!trackToAdd} onClick={handleAddTrack}>
                      <Icon icon={Plus} size="md" />
                      {t('playlists.add_track')}
                    </Button>
                  </div>
                )}

                {activeTracks.length > 0 ? (
                  <div ref={tableScrollRef} className="sd-playlist-detail__table-wrap sd-scroll-area">
                    <table className="sd-table sd-playlist-table">
                      <thead>
                        <tr>
                          <th className="sd-table__num sd-playlist-table__index">#</th>
                          <th>{t('library.col_title')}</th>
                          <th>{t('library.col_artist')}</th>
                          <th className="sd-table__num">{t('library.col_bpm')}</th>
                          <th className="sd-table__num">{t('library.col_duration')}</th>
                          <th className="sd-table__actions"><span className="sd-visually-hidden">{t('library.col_actions')}</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeTracks.map((track, index) => {
                          // Índice real en trackIds (puede diferir si hay ids huérfanos)
                          const storedIndex = activePlaylist.trackIds.indexOf(track.id);
                          const bpm = track.analysis?.status === 'analyzed' ? track.analysis.bpm : undefined;
                          return (
                            <tr key={track.id}>
                              <td className="sd-table__num sd-playlist-table__index">{index + 1}</td>
                              <td className="sd-playlist-table__title">{track.title}</td>
                              <td className="sd-playlist-table__muted">{track.artist || t('dj.unknown_artist')}</td>
                              <td className="sd-table__num">{bpm ? Math.round(bpm) : '—'}</td>
                              <td className="sd-table__num sd-playlist-table__muted">{track.durationFormatted}</td>
                              <td className="sd-table__actions">
                                <div className="sd-playlist-table__actions">
                                  <IconButton
                                    icon={<Icon icon={ChevronUp} size="sm" />}
                                    size="sm"
                                    label={t('playlists.move_up')}
                                    disabled={index === 0}
                                    onClick={() => updateActive((p) => moveTrackInPlaylist(p, storedIndex, activePlaylist.trackIds.indexOf(activeTracks[index - 1].id)))}
                                  />
                                  <IconButton
                                    icon={<Icon icon={ChevronDown} size="sm" />}
                                    size="sm"
                                    label={t('playlists.move_down')}
                                    disabled={index === activeTracks.length - 1}
                                    onClick={() => updateActive((p) => moveTrackInPlaylist(p, storedIndex, activePlaylist.trackIds.indexOf(activeTracks[index + 1].id)))}
                                  />
                                  <IconButton
                                    icon={<Icon icon={X} size="sm" />}
                                    size="sm"
                                    label={t('playlists.remove_track')}
                                    onClick={() => updateActive((p) => removeTrackFromPlaylist(p, track.id))}
                                  />
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : libraryTracks.length > 0 ? (
                  <EmptyState
                    icon={ListMusic}
                    title={t('playlists.empty_playlist_title')}
                    description={t('playlists.empty_playlist_desc')}
                  />
                ) : null}
              </div>
            </>
          ) : (
            <EmptyState
              icon={ListMusic}
              className="sd-playlist-detail__empty"
              title={t('playlists.no_playlists_title')}
              description={t('playlists.no_playlists_desc')}
              action={
                <Button variant="accent" onClick={() => setIsCreating(true)}>
                  <Icon icon={Plus} size="md" />
                  {t('playlists.create')}
                </Button>
              }
            />
          )}
        </section>

      </div>
    </ConsoleTemplate>
  );
};
