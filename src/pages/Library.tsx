import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { 
  Search, CheckSquare, Square, 
  UploadCloud, FolderPlus, Trash2, AlertCircle, CheckCircle2, 
  Disc, X, HardDrive, Sparkles, RefreshCw, Loader2, Clock, AlertTriangle, ListPlus,
  Target, WandSparkles, ArrowLeftRight, Link2
} from 'lucide-react';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { IconButton } from '../components/ui/IconButton';
import { Badge } from '../components/ui/Badge';
import { YouTubeImportModal, type YouTubeImportResult } from '../components/library/YouTubeImportModal';
import { indexedDBStorage } from '../services/storage/IndexedDBStorage';
import { importFilesToLocalLibrary, importRemoteAudioToLocalLibrary } from '../services/localLibraryImport';
import type { ExtractedAudio } from '../services/youtubeService';
import { formatBytes, formatDate } from '../utils/formatters';
import { useDJStore } from '../store/useDJStore';
import { useSeedStore } from '../store/useSeedStore';
import { buildPlaylistFromSeeds, MAX_SEED_TRACKS } from '../engine/playlistBuilder';
import { notificationCenter } from '../services/notifications/notificationCenter';
import { analysisSyncManager } from '../services/analysis';
import { playlistService, addTracksToPlaylist } from '../services/playlists/playlistService';
import { keyToCamelot } from '../audio/analysis/camelotMapper';
import type { Track, AnalysisStatus, MusicalKeyCamelot } from '../types/track';
import type { Playlist } from '../types/playlist';
import '../components/ui/Table.css';
import './Library.css';
import { clsx } from 'clsx';

export type FilterType = 'all' | 'local' | 'audio' | 'video';

export interface UnifiedRowTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  bpm?: number;
  key?: string;
  camelot?: MusicalKeyCamelot;
  energy?: number;
  status: AnalysisStatus;
  analysisError?: string;
  durationFormatted: string;
  type: 'audio' | 'video';
  fileSizeFormatted?: string;
  dateAddedFormatted?: string;
  rawLocalTrack: Track;
}

export interface AnalysisStatusBadgeProps {
  status: AnalysisStatus;
  error?: string;
  onAnalyze?: () => void;
}

export const AnalysisStatusBadge: React.FC<AnalysisStatusBadgeProps> = ({
  status,
  error,
  onAnalyze,
}) => {
  const { t } = useTranslation();

  const getStatusConfig = () => {
    switch (status) {
      case 'analyzing':
        return {
          icon: <Loader2 size={12} className="spin-anim" />,
          label: t('library.status_analyzing'),
          title: t('library.status_analyzing_title'),
          className: 'status-badge-analyzing',
          isInteractive: false,
        };
      case 'analyzed':
        return {
          icon: <CheckCircle2 size={12} />,
          label: t('library.status_analyzed'),
          title: t('library.status_analyzed_title'),
          className: 'status-badge-analyzed',
          isInteractive: Boolean(onAnalyze),
        };
      case 'failed':
        return {
          icon: <AlertCircle size={12} />,
          label: t('library.status_failed'),
          title: error ? `${t('library.status_failed_title')}: ${error}` : t('library.status_failed_title'),
          className: 'status-badge-failed',
          isInteractive: Boolean(onAnalyze),
        };
      case 'unsupported':
        return {
          icon: <AlertTriangle size={12} />,
          label: t('library.status_unsupported'),
          title: error || t('library.status_unsupported_title'),
          className: 'status-badge-unsupported',
          isInteractive: Boolean(onAnalyze),
        };
      case 'pending':
      default:
        return {
          icon: <Clock size={12} />,
          label: t('library.status_pending'),
          title: t('library.status_pending_title'),
          className: 'status-badge-pending',
          isInteractive: Boolean(onAnalyze),
        };
    }
  };

  const config = getStatusConfig();

  return (
    <span
      role="status"
      aria-label={config.title}
      title={config.title}
      className={clsx('status-badge', config.className, config.isInteractive && 'interactive')}
      onClick={config.isInteractive ? onAnalyze : undefined}
    >
      {config.icon}
      <span>{config.label}</span>
    </span>
  );
};

export const Library: React.FC = () => {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { deckA, deckB, loadTrackToDeckA, loadTrackToDeckB, analyzeTrack } = useDJStore();
  const { seedTrackIds, toggleSeed, removeSeed, swapSeeds, clearSeeds } = useSeedStore();
  const [isGenerating, setIsGenerating] = useState(false);

  const [filter, setFilter] = useState<FilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTracks, setSelectedTracks] = useState<Set<string>>(new Set());

  const [localTracks, setLocalTracks] = useState<Track[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const [feedback, setFeedback] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);

  const [deleteConfirmTrack, setDeleteConfirmTrack] = useState<Track | null>(null);
  const [youtubeModalOpen, setYoutubeModalOpen] = useState(false);

  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [targetPlaylistId, setTargetPlaylistId] = useState('');

  // Playlists locales disponibles como destino para las pistas seleccionadas
  useEffect(() => {
    let isMounted = true;
    const load = () => {
      playlistService
        .getAll()
        .then((stored) => {
          if (isMounted) setPlaylists(stored);
        })
        .catch((err) => console.error('[Library] Error al cargar playlists:', err));
    };
    load();
    const unsubscribe = playlistService.subscribe(load);
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  // Carga inicial y suscripción reactiva en tiempo real al gestor de análisis
  useEffect(() => {
    let isMounted = true;
    indexedDBStorage
      .getAllTracks()
      .then((stored) => {
        if (isMounted) {
          setLocalTracks(stored);
        }
      })
      .catch((err) => {
        console.error('[Library] Error al cargar pistas locales:', err);
      });

    // Suscripción reactiva para reflejar análisis completados, fallidos o en curso sin recarga
    const unsubscribe = analysisSyncManager.subscribe((trackId, analysis) => {
      if (!isMounted) return;
      setLocalTracks((prevTracks) =>
        prevTracks.map((tr) => (tr.id === trackId ? { ...tr, analysis } : tr))
      );
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const refreshLocalTracks = useCallback(async () => {
    try {
      const stored = await indexedDBStorage.getAllTracks();
      setLocalTracks(stored);
    } catch (err) {
      console.error('[Library] Error al refrescar pistas locales:', err);
    }
  }, []);

  // Manejo de importación de archivos
  const handleImportFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    setIsImporting(true);
    setFeedback(null);

    const files = Array.from(fileList);
    const { successCount, errors } = await importFilesToLocalLibrary(
      files,
      (name) => t('library.duplicate_warning', { name }),
    );

    await refreshLocalTracks();
    setIsImporting(false);

    if (successCount > 0 && errors.length === 0) {
      setFeedback({
        type: 'success',
        text: t('library.import_success', { count: successCount }),
      });
    } else if (successCount > 0 && errors.length > 0) {
      setFeedback({
        type: 'warning',
        text: t('library.import_partial_warning', {
          success: t('library.import_success', { count: successCount }),
          warnings: errors.join(', '),
        }),
      });
    } else if (errors.length > 0) {
      setFeedback({
        type: 'error',
        text: errors.join(' | '),
      });
    }
  };

  // Importación desde YouTube: mismo flujo que un archivo local y análisis automático en segundo plano
  const handleYouTubeAudio = async ({ blob, filename }: ExtractedAudio): Promise<YouTubeImportResult> => {
    const { successCount, errors, importedTracks } = await importRemoteAudioToLocalLibrary(
      blob,
      filename,
      (name) => t('library.duplicate_warning', { name }),
    );
    await refreshLocalTracks();

    if (successCount === 0) {
      return { ok: false, error: errors.join(' | ') || undefined };
    }

    setFeedback({ type: 'success', text: t('library.import_success', { count: successCount }) });
    importedTracks.forEach((track) => { void handleAnalyzeTrack(track); });
    return { ok: true };
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await handleImportFiles(e.dataTransfer.files);
    }
  };

  // Acción contextual: Analizar o Reanalizar pista
  const handleAnalyzeTrack = async (track: Track, force = false) => {
    // Evitar solicitudes duplicadas innecesarias si ya está procesándose
    if (analysisSyncManager.isAnalyzing(track.id)) {
      return;
    }

    try {
      // Marcado visual optimista
      setLocalTracks((prev) =>
        prev.map((t) =>
          t.id === track.id ? { ...t, analysis: { ...t.analysis, status: 'analyzing' } } : t
        )
      );

      const result = await analyzeTrack(track, force);

      if (result.status === 'failed') {
        setFeedback({
          type: 'warning',
          text: t('library.analysis_failed_warning', {
            title: track.title,
            error: result.analysisError || t('states.error_desc'),
          }),
        });
      } else if (result.status === 'analyzed') {
        const bpmStr = result.bpm ? `${result.bpm} BPM` : '';
        const keyStr = result.key ? `${result.key}` : '';
        setFeedback({
          type: 'success',
          text: t('library.analysis_success', {
            title: track.title,
            bpm: bpmStr,
            key: keyStr,
          }),
        });
      }
    } catch (err) {
      console.error('[Library] Error al solicitar análisis:', err);
      setFeedback({
        type: 'error',
        text: t('library.analysis_error', {
          title: track.title,
          error: err instanceof Error ? err.message : String(err),
        }),
      });
    }
  };

  // Eliminación de pista local
  const handleDeleteTrack = async (track: Track) => {
    try {
      // Cancelar análisis en vuelo si estuviera analizándose para evitar escrituras huérfanas
      analysisSyncManager.cancelAnalysis(track.id);

      await indexedDBStorage.deleteTrack(track.id);
      setDeleteConfirmTrack(null);
      
      // Remover de inmediato del estado local
      setLocalTracks((prev) => prev.filter((t) => t.id !== track.id));
      setSelectedTracks((prev) => {
        if (!prev.has(track.id)) return prev;
        const next = new Set(prev);
        next.delete(track.id);
        return next;
      });
      // deleteTrack también la retira de las playlists; avisar a las vistas suscritas
      playlistService.notifyExternalChange();
      removeSeed(track.id);

      await refreshLocalTracks();
      setFeedback({
        type: 'success',
        text: t('library.delete_success', {
          title: track.title,
          defaultValue: `Pista "${track.title}" eliminada de la biblioteca local.`,
        }),
      });
    } catch (err) {
      console.error('[Library] Error al eliminar pista:', err);
      setFeedback({
        type: 'error',
        text: t('library.delete_error', { error: err instanceof Error ? err.message : String(err) }),
      });
    }
  };

  // Carga real de pista en Deck A o Deck B
  const handleLoadToDeck = async (unifiedTrack: UnifiedRowTrack, deckId: 'A' | 'B') => {
    try {
      const trackToLoad = unifiedTrack.rawLocalTrack;
      const loadFn = deckId === 'A' ? loadTrackToDeckA : loadTrackToDeckB;
      const loaded = await loadFn(trackToLoad);
      const deckLabel = deckId === 'A' ? 'Deck A' : 'Deck B';
      if (loaded) {
        setFeedback({
          type: 'success',
          text: t('library.load_success', { title: trackToLoad.title, deck: deckLabel }),
        });
      } else {
        setFeedback({
          type: 'error',
          text: t('library.load_error', { title: trackToLoad.title, deck: deckLabel }),
        });
      }
    } catch (err) {
      const deckLabel = deckId === 'A' ? 'Deck A' : 'Deck B';
      setFeedback({
        type: 'error',
        text: t('library.load_exception_error', {
          deck: deckLabel,
          error: err instanceof Error ? err.message : String(err),
        }),
      });
    }
  };

  // Filas de la tabla: solo pistas importadas y procesadas localmente (IndexedDB)
  const unifiedTracks: UnifiedRowTrack[] = localTracks.map((lt): UnifiedRowTrack => {
      const isAnalyzed = lt.analysis?.status === 'analyzed';
      return {
        id: lt.id,
        title: lt.title,
        artist: lt.artist || t('dj.unknown_artist'),
        album: lt.fileMeta?.fileName || '-',
        bpm: isAnalyzed ? lt.analysis.bpm : undefined,
        key: isAnalyzed ? lt.analysis.key : undefined,
        camelot: isAnalyzed
          ? lt.analysis.camelot || (lt.analysis.key ? keyToCamelot(lt.analysis.key) || undefined : undefined)
          : undefined,
        energy: isAnalyzed ? lt.analysis.energy : undefined,
        status: lt.analysis?.status || 'pending',
        analysisError: lt.analysis?.analysisError,
        durationFormatted: lt.durationFormatted,
        type: lt.type,
        fileSizeFormatted: lt.fileMeta?.fileSize ? formatBytes(lt.fileMeta.fileSize) : undefined,
        dateAddedFormatted: lt.dateAdded ? formatDate(lt.dateAdded) : undefined,
        rawLocalTrack: lt,
      };
    });

  // Filtrado reactivo por tipo y búsqueda
  const filteredTracks = unifiedTracks.filter((track) => {
    // Filtro por categoría ('all' y 'local' muestran la biblioteca local completa)
    if (filter === 'audio' && track.type !== 'audio') return false;
    if (filter === 'video' && track.type !== 'video') return false;

    // Filtro por texto de búsqueda
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      const matchTitle = track.title.toLowerCase().includes(q);
      const matchArtist = track.artist.toLowerCase().includes(q);
      const matchAlbum = track.album.toLowerCase().includes(q);
      return matchTitle || matchArtist || matchAlbum;
    }

    return true;
  });

  // Pistas de referencia resueltas en orden (1.ª = inicio, 2.ª = cierre); se ignoran ids ya eliminados
  const seedTracks = seedTrackIds
    .map((id) => localTracks.find((tr) => tr.id === id))
    .filter((tr): tr is Track => Boolean(tr));

  const handleToggleSeed = (track: Track) => {
    const result = toggleSeed(track.id);
    if (result.action === 'replaced') {
      const replaced = localTracks.find((tr) => tr.id === result.replacedId);
      setFeedback({
        type: 'warning',
        text: t('seed.replaced', { max: MAX_SEED_TRACKS, removed: replaced?.title ?? '', added: track.title }),
      });
    }
  };

  // Modo referencia: secuencia la biblioteca desde las semillas y guarda el resultado como playlist
  const handleGenerateFromSeeds = async () => {
    if (seedTracks.length === 0 || isGenerating) return;
    setIsGenerating(true);
    try {
      const result = buildPlaylistFromSeeds({ seedTracks, candidates: localTracks });
      if (result.trackIds.length <= seedTracks.length) {
        setFeedback({ type: 'warning', text: t('seed.no_compatible') });
        return;
      }
      const name = seedTracks.length === 2
        ? t('seed.generated_name_pair', { start: seedTracks[0].title, end: seedTracks[1].title })
        : t('seed.generated_name', { title: seedTracks[0].title });
      const created = await playlistService.create(name);
      await playlistService.update(created.id, (p) => addTracksToPlaylist(p, result.trackIds));
      notificationCenter.push({
        type: 'success',
        messageKey: 'notifications.seed_mix_generated',
        params: { name: created.name, count: result.trackIds.length },
      });
      navigate('/playlists');
    } catch (err) {
      setFeedback({
        type: 'error',
        text: t('library.playlist_add_error', { error: err instanceof Error ? err.message : String(err) }),
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // Añade las pistas seleccionadas (en el orden de la tabla) a la playlist elegida
  const handleAddSelectedToPlaylist = async () => {
    const playlist = playlists.find((p) => p.id === targetPlaylistId);
    if (!playlist || selectedTracks.size === 0) return;
    const ids = unifiedTracks.filter((tr) => selectedTracks.has(tr.id)).map((tr) => tr.id);
    try {
      const before = playlist.trackIds.length;
      const updated = await playlistService.update(playlist.id, (p) => addTracksToPlaylist(p, ids));
      const added = updated ? updated.trackIds.length - before : 0;
      setFeedback({
        type: added > 0 ? 'success' : 'warning',
        text: added > 0
          ? t('library.playlist_add_success', { count: added, name: playlist.name })
          : t('library.playlist_add_none', { name: playlist.name }),
      });
      setSelectedTracks(new Set());
    } catch (err) {
      setFeedback({
        type: 'error',
        text: t('library.playlist_add_error', { error: err instanceof Error ? err.message : String(err) }),
      });
    }
  };

  const toggleSelection = (id: string) => {
    const newSelected = new Set(selectedTracks);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedTracks(newSelected);
  };

  return (
    <div 
      className="library-container"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Input de archivo invisible */}
      <input 
        type="file"
        ref={fileInputRef}
        multiple
        accept=".mp3,.wav,audio/mpeg,audio/wav,audio/mp3"
        style={{ display: 'none' }}
        onChange={(e) => handleImportFiles(e.target.files)}
      />

      <div className="library-header">
        <div className="library-title-row">
          <h2 className="library-title">{t('library.title')}</h2>
          
          <div className="library-header-actions">
            <Button 
              variant="primary"
              disabled={isImporting}
              onClick={() => fileInputRef.current?.click()}
            >
              <FolderPlus size={18} />
              {isImporting ? t('library.importing') : t('library.import_btn')}
            </Button>
            <Button variant="outline" onClick={() => setYoutubeModalOpen(true)}>
              <Link2 size={18} />
              {t('library.import_youtube_btn')}
            </Button>
          </div>
        </div>

        {/* Zona visual interactiva de Drag & Drop */}
        <div 
          className={clsx('library-dropzone', isDragging && 'active')}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="dropzone-icon">
            <UploadCloud size={24} />
          </div>
          <div className="dropzone-text-group">
            <span className="dropzone-main-text">{t('library.drag_drop_title')}</span>
            <span className="dropzone-sub-text">{t('library.drag_drop_subtitle')}</span>
          </div>
        </div>

        {/* Notificaciones y alertas */}
        {feedback && (
          <div className={clsx('library-alert', feedback.type)}>
            <div className="alert-content">
              {feedback.type === 'success' && <CheckCircle2 size={18} />}
              {feedback.type === 'warning' && <AlertCircle size={18} />}
              {feedback.type === 'error' && <AlertCircle size={18} />}
              <span>{feedback.text}</span>
            </div>
            <IconButton 
              icon={<X size={16} />} 
              size="sm" 
              variant="ghost" 
              onClick={() => setFeedback(null)} 
            />
          </div>
        )}

        <div className="library-toolbar">
          <Input 
            placeholder={t('library.search_tracks')} 
            icon={<Search size={18} />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            wrapperClassName="library-search-container" 
          />
          
          <div className="library-filters">
            <Button 
              variant={filter === 'all' ? 'primary' : 'outline'} 
              size="sm" 
              onClick={() => setFilter('all')}
            >
              {t('library.filter_all')}
            </Button>
            <Button 
              variant={filter === 'local' ? 'primary' : 'outline'} 
              size="sm" 
              onClick={() => setFilter('local')}
            >
              <HardDrive size={14} />
              {t('library.filter_local')} ({localTracks.length})
            </Button>
            <Button 
              variant={filter === 'audio' ? 'primary' : 'outline'} 
              size="sm" 
              onClick={() => setFilter('audio')}
            >
              {t('library.filter_audio')}
            </Button>
            <Button 
              variant={filter === 'video' ? 'primary' : 'outline'} 
              size="sm" 
              onClick={() => setFilter('video')}
            >
              {t('library.filter_video')}
            </Button>
          </div>
        </div>
      </div>

      {/* Modo referencia (semillas) */}
      {localTracks.length > 0 && (
        <div className="library-filters" style={{ alignItems: 'center' }} role="region" aria-label={t('seed.mode_title')}>
          <Target size={16} aria-hidden="true" />
          <strong>{t('seed.mode_title')}</strong>
          {seedTracks.length === 0 ? (
            <span className="text-muted">{t('seed.mode_hint', { max: MAX_SEED_TRACKS })}</span>
          ) : (
            seedTracks.map((seed, index) => (
              <Badge key={seed.id} variant="secondary" title={seed.title}>
                {seedTracks.length === 2
                  ? t(index === 0 ? 'seed.start_label' : 'seed.end_label', { title: seed.title })
                  : t('seed.single_label', { title: seed.title })}
              </Badge>
            ))
          )}
          {seedTracks.length === 2 && (
            <IconButton
              icon={<ArrowLeftRight size={14} />}
              size="sm"
              variant="ghost"
              title={t('seed.swap')}
              aria-label={t('seed.swap')}
              onClick={swapSeeds}
            />
          )}
          <Button
            variant="primary"
            size="sm"
            disabled={seedTracks.length === 0 || isGenerating}
            title={seedTracks.length === 0 ? t('seed.generate_disabled') : undefined}
            onClick={handleGenerateFromSeeds}
          >
            <WandSparkles size={14} />
            {isGenerating ? t('seed.generating') : t('seed.generate')}
          </Button>
          {seedTracks.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearSeeds}>
              {t('seed.clear')}
            </Button>
          )}
        </div>
      )}

      {/* Acción sobre la selección: añadir a playlist */}
      {selectedTracks.size > 0 && (
        <div className="library-filters" style={{ alignItems: 'center' }}>
          <span>{t('library.selected_count', { count: selectedTracks.size })}</span>
          {playlists.length === 0 ? (
            <span className="text-muted">{t('library.playlist_none_available')}</span>
          ) : (
            <>
              <select
                className="input-field"
                aria-label={t('library.playlist_target')}
                value={targetPlaylistId}
                onChange={(e) => setTargetPlaylistId(e.target.value)}
              >
                <option value="">{t('library.playlist_target')}</option>
                {playlists.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <Button variant="primary" size="sm" disabled={!targetPlaylistId} onClick={handleAddSelectedToPlaylist}>
                <ListPlus size={14} />
                {t('library.playlist_add_btn')}
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" onClick={() => setSelectedTracks(new Set())}>
            {t('common.cancel')}
          </Button>
        </div>
      )}

      {/* Tabla unificada */}
      <div className="library-table-container">
        <table className="library-table">
          <thead>
            <tr>
              <th className="col-checkbox">
                <Square size={16} />
              </th>
              <th>{t('library.col_title')}</th>
              <th>{t('library.col_artist')}</th>
              <th>{t('library.col_album')}</th>
              <th>{t('library.col_bpm')}</th>
              <th>{t('library.col_key')}</th>
              <th>{t('library.col_energy')}</th>
              <th className="col-status">{t('library.col_status')}</th>
              <th>{t('library.col_duration')}</th>
              <th className="col-actions"></th>
            </tr>
          </thead>
          <tbody>
            {filteredTracks.map((track) => {
              const isSelected = selectedTracks.has(track.id);
              const isLoadedInDeckA = deckA.track?.title === track.title;
              const isLoadedInDeckB = deckB.track?.title === track.title;
              const seedIndex = seedTrackIds.indexOf(track.id);

              return (
                <tr key={track.id} className={clsx(isSelected && 'selected', (isLoadedInDeckA || isLoadedInDeckB) && 'prepared')}>
                  <td className="col-checkbox" onClick={() => toggleSelection(track.id)}>
                    {isSelected ? (
                      <CheckSquare size={16} className="icon-selected" />
                    ) : (
                      <Square size={16} className="icon-unselected" />
                    )}
                  </td>
                  <td>
                    <div className="track-title-container">
                      <span className="track-title">{track.title}</span>
                      <Badge variant="primary">{t('library.badge_local')}</Badge>
                      {seedIndex !== -1 && (
                        <Badge variant="warning" title={t('seed.badge_title')}>
                          <Target size={11} aria-hidden="true" /> {t('seed.badge', { index: seedIndex + 1 })}
                        </Badge>
                      )}
                      {track.type === 'video' && <Badge variant="secondary">V</Badge>}
                      {isLoadedInDeckA && (
                        <span className="deck-prepared-tag" title={t('library.load_deck_a')}>
                          <Disc size={13} className={clsx(deckA.playbackState === 'playing' && 'playing-anim-spin')} />
                          Deck A {deckA.playbackState === 'playing' ? `(${t('dj.play')})` : ''}
                        </span>
                      )}
                      {isLoadedInDeckB && (
                        <span className="deck-prepared-tag deck-b-tag" title={t('library.load_deck_b')}>
                          <Disc size={13} className={clsx(deckB.playbackState === 'playing' && 'playing-anim-spin')} />
                          Deck B {deckB.playbackState === 'playing' ? `(${t('dj.play')})` : ''}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>{track.artist}</td>
                  <td className="track-album">
                    {track.album}
                    {track.fileSizeFormatted && (
                      <span className="text-muted" style={{ marginLeft: 'var(--space-2)' }}>
                        ({track.fileSizeFormatted})
                      </span>
                    )}
                  </td>
                  <td>
                    {track.status === 'analyzed' && track.bpm !== undefined && track.bpm > 0 ? (
                      <span className="track-bpm-value">{track.bpm % 1 === 0 ? track.bpm : track.bpm.toFixed(1)}</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td>
                    {track.status === 'analyzed' && track.key ? (
                      <div className="track-key-group">
                        <span className="track-key-name">{track.key}</span>
                        {track.camelot && (
                          <Badge variant="outline" className="track-camelot-badge">
                            {track.camelot}
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td>
                    {track.status === 'analyzed' && typeof track.energy === 'number' ? (
                      <div className="energy-bar-container" title={t('library.energy_label', { val: track.energy })}>
                        <div className="energy-bar">
                          <div 
                            className="energy-bar-fill" 
                            style={{ width: `${Math.min(10, Math.max(0, track.energy)) * 10}%` }}
                          ></div>
                        </div>
                        <span className="energy-bar-value">{track.energy}</span>
                      </div>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="col-status">
                    <AnalysisStatusBadge
                      status={track.status}
                      error={track.analysisError}
                      onAnalyze={() => handleAnalyzeTrack(track.rawLocalTrack, track.status === 'analyzed')}
                    />
                  </td>
                  <td className="track-duration">{track.durationFormatted}</td>
                  <td className="col-actions">
                    <div className="track-actions-container">
                      <IconButton 
                        icon={<span className="deck-action-badge">A</span>} 
                        size="sm" 
                        variant={isLoadedInDeckA ? 'primary' : 'outline'}
                        title={t('library.load_deck_a')}
                        aria-label={t('library.load_deck_a')}
                        onClick={() => handleLoadToDeck(track, 'A')}
                      />
                      <IconButton 
                        icon={<span className="deck-action-badge">B</span>} 
                        size="sm" 
                        variant={isLoadedInDeckB ? 'secondary' : 'outline'}
                        title={t('library.load_deck_b')}
                        aria-label={t('library.load_deck_b')}
                        onClick={() => handleLoadToDeck(track, 'B')}
                      />
                      <IconButton
                        icon={<Target size={15} />}
                        size="sm"
                        variant={seedIndex !== -1 ? 'primary' : 'ghost'}
                        aria-pressed={seedIndex !== -1}
                        title={seedIndex !== -1 ? t('seed.unmark') : t('seed.mark')}
                        aria-label={seedIndex !== -1 ? t('seed.unmark') : t('seed.mark')}
                        onClick={() => handleToggleSeed(track.rawLocalTrack)}
                      />
                      {track.status === 'analyzing' ? (
                        <IconButton 
                          icon={<Loader2 size={15} className="spin-anim" />} 
                          size="sm" 
                          variant="ghost"
                          disabled
                          title={t('library.status_analyzing')}
                          aria-label={t('library.status_analyzing')}
                        />
                      ) : track.status === 'analyzed' ? (
                        <IconButton 
                          icon={<RefreshCw size={15} />} 
                          size="sm" 
                          variant="ghost"
                          title={t('library.action_reanalyze')}
                          aria-label={t('library.action_reanalyze')}
                          onClick={() => handleAnalyzeTrack(track.rawLocalTrack, true)}
                        />
                      ) : (
                        <IconButton 
                          icon={<Sparkles size={15} />} 
                          size="sm" 
                          variant="ghost"
                          title={t('library.action_analyze')}
                          aria-label={t('library.action_analyze')}
                          onClick={() => handleAnalyzeTrack(track.rawLocalTrack, false)}
                        />
                      )}
                      <IconButton 
                        icon={<Trash2 size={16} />} 
                        size="sm" 
                        variant="ghost"
                        title={t('library.delete_track')}
                        aria-label={t('library.delete_track')}
                        onClick={() => setDeleteConfirmTrack(track.rawLocalTrack)}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}

            {filteredTracks.length === 0 && (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <AlertCircle size={28} className="text-muted" />
                    <span style={{ fontWeight: 'var(--font-weight-medium)', color: 'var(--text-primary)' }}>
                      {localTracks.length === 0 ? t('library.empty_local_title') : t('states.empty_title')}
                    </span>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                      {localTracks.length === 0 ? t('library.empty_local_desc') : t('states.empty_desc')}
                    </span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <YouTubeImportModal
        open={youtubeModalOpen}
        onClose={() => setYoutubeModalOpen(false)}
        onAudioReceived={handleYouTubeAudio}
      />

      {/* Modal de confirmación para eliminar pista local */}
      {deleteConfirmTrack && (
        <div className="delete-confirm-overlay" onClick={() => setDeleteConfirmTrack(null)}>
          <div className="delete-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="delete-modal-title">{t('library.delete_track')}</h3>
            <p className="delete-modal-desc">
              {t('library.delete_confirm', { title: deleteConfirmTrack.title })}
            </p>
            <div className="delete-modal-actions">
              <Button variant="outline" onClick={() => setDeleteConfirmTrack(null)}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" onClick={() => handleDeleteTrack(deleteConfirmTrack)}>
                <Trash2 size={16} />
                {t('common.delete')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

