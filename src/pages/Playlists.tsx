import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Play, ListMusic, Pencil, Trash2, ChevronUp, ChevronDown, X, Check } from 'lucide-react';
import { IconButton } from '../components/ui/IconButton';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';
import { StateView } from '../components/ui/StateView';
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
import { formatDuration } from '../utils/formatters';
import type { Playlist } from '../types/playlist';
import type { Track } from '../types/track';
import { clsx } from 'clsx';
import '../components/ui/Table.css';
import './Playlists.css';

export const Playlists: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { loadTrackToDeckA } = useDJStore();

  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [libraryTracks, setLibraryTracks] = useState<Track[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

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

  const handlePlay = async () => {
    const first = activeTracks[0];
    if (!first) return;
    const loaded = await loadTrackToDeckA(first);
    if (!loaded) {
      notificationCenter.push({ type: 'error', messageKey: 'library.load_error', params: { title: first.title, deck: 'Deck A' } });
    }
  };

  if (!isLoaded) {
    return <StateView status="loading" />;
  }

  return (
    <div className="playlists-container">

      {/* Sidebar: List of playlists */}
      <div className="playlists-sidebar">
        <div className="playlists-sidebar-header">
          <h3 className="playlists-title">{t('playlists.title')}</h3>
          <IconButton
            icon={isCreating ? <X size={20} /> : <Plus size={20} />}
            title={t('playlists.create')}
            aria-label={t('playlists.create')}
            onClick={() => setIsCreating((v) => !v)}
          />
        </div>

        {isCreating && (
          <form className="playlists-sidebar-header" onSubmit={handleCreate}>
            <Input
              autoFocus
              placeholder={t('playlists.name_placeholder')}
              aria-label={t('playlists.name_placeholder')}
              maxLength={MAX_PLAYLIST_NAME_LENGTH}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setIsCreating(false)}
            />
            <IconButton
              type="submit"
              icon={<Check size={18} />}
              title={t('playlists.create_confirm')}
              aria-label={t('playlists.create_confirm')}
              disabled={!normalizePlaylistName(newName)}
            />
          </form>
        )}

        <div className="playlists-list">
          {playlists.map(playlist => (
            <div
              key={playlist.id}
              className={clsx('playlist-item', activePlaylist?.id === playlist.id && 'active')}
              onClick={() => selectPlaylist(playlist.id)}
            >
              <div className="playlist-cover-mini" style={{ backgroundColor: playlist.coverColor }}></div>
              <div className="playlist-info-mini">
                <span className="playlist-name-mini">{playlist.name}</span>
                <span className="playlist-count-mini">
                  {t('playlists.tracks_count', { count: playlist.trackIds.filter((id) => tracksById.has(id)).length })}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Content: Playlist Details */}
      <div className="playlist-detail">
        {activePlaylist ? (
          <>
            <div className="playlist-detail-header">
              <div className="playlist-cover-large" style={{ backgroundColor: activePlaylist.coverColor }}></div>
              <div className="playlist-detail-info">
                <Badge variant="secondary" className="playlist-badge">Playlist</Badge>
                {isRenaming ? (
                  <form className="playlist-detail-actions" onSubmit={handleRename}>
                    <Input
                      autoFocus
                      aria-label={t('playlists.rename')}
                      maxLength={MAX_PLAYLIST_NAME_LENGTH}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => e.key === 'Escape' && setIsRenaming(false)}
                    />
                    <Button type="submit" variant="primary" disabled={!normalizePlaylistName(renameValue)}>
                      {t('common.save')}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setIsRenaming(false)}>
                      {t('common.cancel')}
                    </Button>
                  </form>
                ) : (
                  <h1 className="playlist-detail-title">{activePlaylist.name}</h1>
                )}
                <div className="playlist-detail-meta">
                  <span>{t('playlists.tracks_count', { count: activeTracks.length })}</span>
                  <span>•</span>
                  <span>{t('playlists.total_duration', { time: formatDuration(totalDuration) })}</span>
                </div>

                {isConfirmingDelete ? (
                  <div className="playlist-detail-actions">
                    <span className="playlist-detail-desc">
                      {t('playlists.delete_confirm', { name: activePlaylist.name })}
                    </span>
                    <Button variant="outline" onClick={() => setIsConfirmingDelete(false)}>
                      {t('common.cancel')}
                    </Button>
                    <Button variant="primary" onClick={handleDelete}>
                      <Trash2 size={16} />
                      {t('common.delete')}
                    </Button>
                  </div>
                ) : (
                  <div className="playlist-detail-actions">
                    <Button variant="primary" disabled={activeTracks.length === 0} onClick={handlePlay}>
                      <Play size={18} />
                      {t('common.play')}
                    </Button>
                    <IconButton
                      icon={<Pencil size={18} />}
                      variant="outline"
                      title={t('playlists.rename')}
                      aria-label={t('playlists.rename')}
                      onClick={() => {
                        setRenameValue(activePlaylist.name);
                        setIsRenaming(true);
                      }}
                    />
                    <IconButton
                      icon={<Trash2 size={18} />}
                      variant="outline"
                      title={t('playlists.delete')}
                      aria-label={t('playlists.delete')}
                      onClick={() => setIsConfirmingDelete(true)}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="playlist-tracks-container">
              {/* Añadir pistas desde la biblioteca local */}
              {libraryTracks.length === 0 ? (
                <StateView
                  status="empty"
                  icon={ListMusic}
                  title={t('playlists.no_library_title')}
                  description={t('playlists.no_library_desc')}
                  action={<Button variant="outline" onClick={() => navigate('/library')}>{t('navigation.library')}</Button>}
                />
              ) : (
                <div className="playlist-detail-actions" style={{ marginTop: 0, marginBottom: 'var(--space-6)' }}>
                  <select
                    className="input-field"
                    aria-label={t('playlists.add_track')}
                    value={trackToAdd}
                    disabled={availableToAdd.length === 0}
                    onChange={(e) => setTrackToAdd(e.target.value)}
                  >
                    <option value="">
                      {availableToAdd.length === 0 ? t('playlists.all_tracks_added') : t('playlists.select_track')}
                    </option>
                    {availableToAdd.map((tr) => (
                      <option key={tr.id} value={tr.id}>
                        {tr.artist ? `${tr.title} — ${tr.artist}` : tr.title}
                      </option>
                    ))}
                  </select>
                  <Button variant="outline" disabled={!trackToAdd} onClick={handleAddTrack}>
                    <Plus size={16} />
                    {t('playlists.add_track')}
                  </Button>
                </div>
              )}

              {activeTracks.length > 0 ? (
                <table className="library-table">
                  <thead>
                    <tr>
                      <th className="col-index">#</th>
                      <th>{t('library.col_title')}</th>
                      <th>{t('library.col_artist')}</th>
                      <th>{t('library.col_bpm')}</th>
                      <th className="col-duration">{t('library.col_duration')}</th>
                      <th className="col-actions"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeTracks.map((track, index) => {
                      // Índice real en trackIds (puede diferir si hay ids huérfanos)
                      const storedIndex = activePlaylist.trackIds.indexOf(track.id);
                      const bpm = track.analysis?.status === 'analyzed' ? track.analysis.bpm : undefined;
                      return (
                        <tr key={track.id}>
                          <td className="track-index">{index + 1}</td>
                          <td className="track-title">{track.title}</td>
                          <td className="track-artist">{track.artist || t('dj.unknown_artist')}</td>
                          <td>{bpm ? Math.round(bpm) : '—'}</td>
                          <td className="track-duration col-duration">{track.durationFormatted}</td>
                          <td className="col-actions">
                            <IconButton
                              icon={<ChevronUp size={16} />}
                              size="sm"
                              title={t('playlists.move_up')}
                              aria-label={t('playlists.move_up')}
                              disabled={index === 0}
                              onClick={() => updateActive((p) => moveTrackInPlaylist(p, storedIndex, activePlaylist.trackIds.indexOf(activeTracks[index - 1].id)))}
                            />
                            <IconButton
                              icon={<ChevronDown size={16} />}
                              size="sm"
                              title={t('playlists.move_down')}
                              aria-label={t('playlists.move_down')}
                              disabled={index === activeTracks.length - 1}
                              onClick={() => updateActive((p) => moveTrackInPlaylist(p, storedIndex, activePlaylist.trackIds.indexOf(activeTracks[index + 1].id)))}
                            />
                            <IconButton
                              icon={<X size={16} />}
                              size="sm"
                              title={t('playlists.remove_track')}
                              aria-label={t('playlists.remove_track')}
                              onClick={() => updateActive((p) => removeTrackFromPlaylist(p, track.id))}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : libraryTracks.length > 0 ? (
                <StateView
                  status="empty"
                  icon={ListMusic}
                  title={t('playlists.empty_playlist_title')}
                  description={t('playlists.empty_playlist_desc')}
                />
              ) : null}
            </div>
          </>
        ) : (
          <StateView
            status="empty"
            icon={ListMusic}
            title={t('playlists.no_playlists_title')}
            description={t('playlists.no_playlists_desc')}
            action={
              <Button variant="primary" onClick={() => setIsCreating(true)}>
                <Plus size={16} />
                {t('playlists.create')}
              </Button>
            }
          />
        )}
      </div>

    </div>
  );
};
