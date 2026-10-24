import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { 
  Search, CheckSquare, Square, 
  UploadCloud, FolderPlus, Trash2, AlertCircle, CheckCircle2, 
  Disc, X, HardDrive, Sparkles, RefreshCw, Loader2, Clock, AlertTriangle, ListPlus,
  Target, WandSparkles, ArrowLeftRight, Link2, Pencil, Check, Music
} from 'lucide-react';
import { Button } from '../components/atoms/Button';
import { IconButton } from '../components/atoms/IconButton';
import { Icon } from '../components/atoms/Icon';
import { Tag } from '../components/atoms/Tag';
import { TextField } from '../components/atoms/TextField';
import { SelectField } from '../components/atoms/SelectField';
import { SegmentedControl } from '../components/molecules/SegmentedControl';
import { PageHeader } from '../components/molecules/PageHeader';
import { Notice } from '../components/molecules/Notice';
import { EmptyState } from '../components/molecules/EmptyState';
import { ConsoleTemplate } from '../components/templates/ConsoleTemplate';
import { YouTubeImportModal, type YouTubeImportResult } from '../components/library/YouTubeImportModal';
import { indexedDBStorage } from '../services/storage/IndexedDBStorage';
import { importFilesToLocalLibrary, importRemoteAudioToLocalLibrary } from '../services/localLibraryImport';
import { settingsStore } from '../store/useSettingsStore';
import type { ExtractedAudio } from '../services/youtubeService';
import { formatBytes, formatDate } from '../utils/formatters';
import { useDJStore } from '../store/useDJStore';
import { useSeedStore } from '../store/useSeedStore';
import { buildPlaylistFromSeeds, MAX_SEED_TRACKS } from '../engine/playlistBuilder';
import { notificationCenter } from '../services/notifications/notificationCenter';
import { analysisSyncManager } from '../services/analysis';
import { playlistService, addTracksToPlaylist } from '../services/playlists/playlistService';
import { camelotToKey, keyToCamelot } from '../audio/analysis/camelotMapper';
import {
  CAMELOT_KEYS,
  MANUAL_BPM_MAX,
  MANUAL_BPM_MIN,
  MANUAL_ENERGY_MAX,
  MANUAL_ENERGY_MIN,
  validateManualAnalysisEdits,
  type ManualAnalysisEdits,
} from '../utils/trackAnalysis';
import type { Track, AnalysisStatus, ManualAnalysisField, MusicalKeyCamelot } from '../types/track';
import type { Playlist } from '../types/playlist';
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
  manualFields: ManualAnalysisField[];
  status: AnalysisStatus;
  analysisError?: string;
  durationFormatted: string;
  type: 'audio' | 'video';
  fileSizeFormatted?: string;
  dateAddedFormatted?: string;
  rawLocalTrack: Track;
}

interface MetadataDraft {
  bpm: string;
  camelot: string;
  energy: string;
}

/** Convierte el borrador de la fila en ediciones; los campos sin cambios no se marcan como manuales. */
function draftToManualEdits(draft: MetadataDraft, initial: MetadataDraft): ManualAnalysisEdits {
  const edits: ManualAnalysisEdits = {};
  if (draft.bpm.trim() !== initial.bpm) {
    edits.bpm = draft.bpm.trim() === '' ? null : Number(draft.bpm);
  }
  if (draft.camelot !== initial.camelot) {
    edits.camelot = draft.camelot === '' ? null : (draft.camelot as MusicalKeyCamelot);
  }
  if (draft.energy.trim() !== initial.energy) {
    edits.energy = draft.energy.trim() === '' ? null : Number(draft.energy);
  }
  return edits;
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
          icon: <Icon icon={Loader2} size="xs" className="sd-status__spin" />,
          label: t('library.status_analyzing'),
          title: t('library.status_analyzing_title'),
          className: 'sd-status--analyzing',
          isInteractive: false,
        };
      case 'analyzed':
        return {
          icon: <Icon icon={CheckCircle2} size="xs" />,
          label: t('library.status_analyzed'),
          title: t('library.status_analyzed_title'),
          className: 'sd-status--analyzed',
          isInteractive: Boolean(onAnalyze),
        };
      case 'failed':
        return {
          icon: <Icon icon={AlertCircle} size="xs" />,
          label: t('library.status_failed'),
          title: error ? `${t('library.status_failed_title')}: ${error}` : t('library.status_failed_title'),
          className: 'sd-status--failed',
          isInteractive: Boolean(onAnalyze),
        };
      case 'unsupported':
        return {
          icon: <Icon icon={AlertTriangle} size="xs" />,
          label: t('library.status_unsupported'),
          title: error || t('library.status_unsupported_title'),
          className: 'sd-status--unsupported',
          isInteractive: Boolean(onAnalyze),
        };
      case 'pending':
      default:
        return {
          icon: <Icon icon={Clock} size="xs" />,
          label: t('library.status_pending'),
          title: t('library.status_pending_title'),
          className: 'sd-status--pending',
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
      className={clsx('sd-status', config.className, config.isInteractive && 'sd-status--interactive')}
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

  // Edición manual en línea de BPM, tonalidad Camelot y energía
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [metadataDraft, setMetadataDraft] = useState<MetadataDraft>({ bpm: '', camelot: '', energy: '' });
  const [initialMetadataDraft, setInitialMetadataDraft] = useState<MetadataDraft>({ bpm: '', camelot: '', energy: '' });
  const [isSavingMetadata, setIsSavingMetadata] = useState(false);

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
    const { successCount, errors, importedTracks } = await importFilesToLocalLibrary(
      files,
      (name) => t('library.duplicate_warning', { name }),
    );

    await refreshLocalTracks();
    setIsImporting(false);
    if (settingsStore.getSnapshot().autoAnalyzeOnImport) {
      importedTracks.forEach((track) => { void handleAnalyzeTrack(track); });
    }

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

  // Importación desde YouTube: mismo flujo que un archivo local y análisis automático (si está activado en Ajustes)
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
    if (settingsStore.getSnapshot().autoAnalyzeOnImport) {
      importedTracks.forEach((track) => { void handleAnalyzeTrack(track); });
    }
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

  const handleStartMetadataEdit = (track: UnifiedRowTrack) => {
    const initial: MetadataDraft = {
      bpm: track.bpm !== undefined ? String(track.bpm) : '',
      camelot: track.camelot ?? '',
      energy: track.energy !== undefined ? String(track.energy) : '',
    };
    setInitialMetadataDraft(initial);
    setMetadataDraft(initial);
    setEditingTrackId(track.id);
  };

  const handleCancelMetadataEdit = () => {
    setEditingTrackId(null);
  };

  const handleSaveMetadataEdit = async (track: UnifiedRowTrack) => {
    const edits = draftToManualEdits(metadataDraft, initialMetadataDraft);
    if (Object.keys(edits).length === 0) {
      setEditingTrackId(null);
      return;
    }

    const invalid = validateManualAnalysisEdits(edits);
    if (invalid) {
      const text = invalid === 'bpm'
        ? t('library.manual_invalid_bpm', { min: MANUAL_BPM_MIN, max: MANUAL_BPM_MAX })
        : invalid === 'energy'
          ? t('library.manual_invalid_energy', { min: MANUAL_ENERGY_MIN, max: MANUAL_ENERGY_MAX })
          : t('library.manual_invalid_camelot');
      setFeedback({ type: 'error', text });
      return;
    }

    setIsSavingMetadata(true);
    try {
      // El gestor persiste en IndexedDB y notifica a la Biblioteca y a los Decks suscritos
      const updated = await analysisSyncManager.updateManualAnalysis(track.id, edits);
      if (!updated) {
        throw new Error(t('states.error_desc'));
      }
      setEditingTrackId(null);
      setFeedback({ type: 'success', text: t('library.manual_saved', { title: track.title }) });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: t('library.manual_save_error', {
          title: track.title,
          error: err instanceof Error ? err.message : String(err),
        }),
      });
    } finally {
      setIsSavingMetadata(false);
    }
  };

  const handleMetadataKeyDown = (event: React.KeyboardEvent, track: UnifiedRowTrack) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void handleSaveMetadataEdit(track);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      handleCancelMetadataEdit();
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
      // 'unsupported' puede conservar energía real o valores corregidos manualmente
      const hasMetrics = lt.analysis?.status === 'analyzed' || lt.analysis?.status === 'unsupported';
      return {
        id: lt.id,
        title: lt.title,
        artist: lt.artist || t('dj.unknown_artist'),
        album: lt.fileMeta?.fileName || '-',
        bpm: hasMetrics ? lt.analysis.bpm : undefined,
        key: hasMetrics ? lt.analysis.key : undefined,
        camelot: hasMetrics
          ? lt.analysis.camelot || (lt.analysis.key ? keyToCamelot(lt.analysis.key) || undefined : undefined)
          : undefined,
        energy: hasMetrics ? lt.analysis.energy : undefined,
        manualFields: lt.analysis?.manualFields ?? [],
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

  const filterOptions: { value: FilterType; label: React.ReactNode }[] = [
    { value: 'all', label: t('library.filter_all') },
    {
      value: 'local',
      label: (
        <>
          <Icon icon={HardDrive} size="sm" />
          {t('library.filter_local')}
          <span className="sd-num">({localTracks.length})</span>
        </>
      ),
    },
    { value: 'audio', label: t('library.filter_audio') },
    { value: 'video', label: t('library.filter_video') },
  ];

  return (
    <ConsoleTemplate
      fill
      className="sd-library"
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
        hidden
        onChange={(e) => handleImportFiles(e.target.files)}
      />

      <div className="sd-library__header">
        <PageHeader
          title={t('library.title')}
          actions={
            <>
              <Button
                variant="accent"
                disabled={isImporting}
                aria-busy={isImporting}
                onClick={() => fileInputRef.current?.click()}
              >
                <Icon icon={FolderPlus} size="md" />
                {isImporting ? t('library.importing') : t('library.import_btn')}
              </Button>
              <Button variant="ghost" onClick={() => setYoutubeModalOpen(true)}>
                <Icon icon={Link2} size="md" />
                {t('library.import_youtube_btn')}
              </Button>
            </>
          }
        />

        {/* Zona visual interactiva de Drag & Drop */}
        <div
          role="button"
          tabIndex={0}
          className={clsx('sd-library-dropzone', isDragging ? 'sd-field-acid' : 'sd-field-sage', isDragging && 'is-active')}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
        >
          <Icon icon={UploadCloud} size="lg" />
          <span className="sd-library-dropzone__text">
            <span className="sd-library-dropzone__title">{t('library.drag_drop_title')}</span>
            <span className="sd-library-dropzone__hint">{t('library.drag_drop_subtitle')}</span>
          </span>
        </div>

        {/* Notificaciones y alertas */}
        {feedback && (
          <Notice
            tone={feedback.type}
            dismissLabel={t('common.close')}
            onDismiss={() => setFeedback(null)}
          >
            {feedback.text}
          </Notice>
        )}

        <div className="sd-library-toolbar">
          <TextField
            type="search"
            placeholder={t('library.search_tracks')}
            aria-label={t('library.search_tracks')}
            icon={<Icon icon={Search} size="sm" />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            wrapperClassName="sd-library-toolbar__search"
          />

          <SegmentedControl
            label={t('library.filters_label')}
            value={filter}
            options={filterOptions}
            onChange={setFilter}
          />
        </div>

        {/* Modo referencia (semillas) */}
        {localTracks.length > 0 && (
          <div className="sd-library-bar" role="region" aria-label={t('seed.mode_title')}>
            <span className="sd-library-bar__title">
              <Icon icon={Target} size="md" />
              {t('seed.mode_title')}
            </span>
            {seedTracks.length === 0 ? (
              <span className="sd-library-bar__hint">{t('seed.mode_hint', { max: MAX_SEED_TRACKS })}</span>
            ) : (
              <span className="sd-library-bar__seeds">
                {seedTracks.map((seed, index) => (
                  <Tag key={seed.id} tone="acid" title={seed.title} className="sd-library-bar__seed">
                    {seedTracks.length === 2
                      ? t(index === 0 ? 'seed.start_label' : 'seed.end_label', { title: seed.title })
                      : t('seed.single_label', { title: seed.title })}
                  </Tag>
                ))}
              </span>
            )}
            <span className="sd-library-bar__actions">
              {seedTracks.length === 2 && (
                <IconButton
                  icon={<Icon icon={ArrowLeftRight} size="sm" />}
                  label={t('seed.swap')}
                  size="sm"
                  onClick={swapSeeds}
                />
              )}
              <Button
                variant="ink"
                size="sm"
                disabled={seedTracks.length === 0 || isGenerating}
                title={seedTracks.length === 0 ? t('seed.generate_disabled') : undefined}
                onClick={handleGenerateFromSeeds}
              >
                <Icon icon={WandSparkles} size="sm" />
                {isGenerating ? t('seed.generating') : t('seed.generate')}
              </Button>
              {seedTracks.length > 0 && (
                <Button variant="ghost" size="sm" onClick={clearSeeds}>
                  {t('seed.clear')}
                </Button>
              )}
            </span>
          </div>
        )}

        {/* Acción sobre la selección: añadir a playlist */}
        {selectedTracks.size > 0 && (
          <div className="sd-library-bar sd-field-inverse">
            <span className="sd-library-bar__title sd-num">{t('library.selected_count', { count: selectedTracks.size })}</span>
            {playlists.length === 0 ? (
              <span className="sd-library-bar__hint">{t('library.playlist_none_available')}</span>
            ) : (
              <span className="sd-library-bar__actions">
                <SelectField
                  size="sm"
                  aria-label={t('library.playlist_target')}
                  value={targetPlaylistId}
                  onChange={(e) => setTargetPlaylistId(e.target.value)}
                >
                  <option value="">{t('library.playlist_target')}</option>
                  {playlists.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </SelectField>
                <Button variant="accent" size="sm" disabled={!targetPlaylistId} onClick={handleAddSelectedToPlaylist}>
                  <Icon icon={ListPlus} size="sm" />
                  {t('library.playlist_add_btn')}
                </Button>
              </span>
            )}
            <Button variant="ghost" size="sm" className="sd-library-bar__end" onClick={() => setSelectedTracks(new Set())}>
              {t('common.cancel')}
            </Button>
          </div>
        )}
      </div>

      {/* Tabla unificada */}
      <div className="sd-library-table-wrap">
        <table className="sd-table sd-library-table">
          <thead>
            <tr>
              <th className="sd-table__check">
                <Icon icon={Square} size="sm" />
              </th>
              <th>{t('library.col_title')}</th>
              <th>{t('library.col_album')}</th>
              <th className="sd-table__num">{t('library.col_bpm')}</th>
              <th>{t('library.col_key')}</th>
              <th>{t('library.col_energy')}</th>
              <th>{t('library.col_status')}</th>
              <th className="sd-table__num">{t('library.col_duration')}</th>
              <th className="sd-table__actions"><span className="sd-visually-hidden">{t('library.col_actions')}</span></th>
            </tr>
          </thead>
          <tbody>
            {filteredTracks.map((track) => {
              const isSelected = selectedTracks.has(track.id);
              const isLoadedInDeckA = deckA.track?.title === track.title;
              const isLoadedInDeckB = deckB.track?.title === track.title;
              const seedIndex = seedTrackIds.indexOf(track.id);
              const isEditing = editingTrackId === track.id;

              return (
                <tr key={track.id} className={clsx(isSelected && 'is-selected', (isLoadedInDeckA || isLoadedInDeckB) && 'is-prepared')}>
                  <td className="sd-table__check" onClick={() => toggleSelection(track.id)}>
                    {isSelected ? (
                      <Icon icon={CheckSquare} size="sm" className="sd-table__check-on" />
                    ) : (
                      <Icon icon={Square} size="sm" className="sd-table__check-off" />
                    )}
                  </td>
                  <td className="sd-library-table__track">
                    <div className="sd-library-track">
                      <span className="sd-library-track__line">
                        <span className="sd-library-track__title">{track.title}</span>
                        {seedIndex !== -1 && (
                          <Tag tone="acid" className="sd-library-track__tag" title={t('seed.badge_title')}>
                            <Icon icon={Target} size="xs" /> {t('seed.badge', { index: seedIndex + 1 })}
                          </Tag>
                        )}
                        {isLoadedInDeckA && (
                          <Tag tone="ink" className="sd-library-track__tag" title={t('library.load_deck_a')}>
                            <Icon icon={Disc} size="xs" className={clsx(deckA.playbackState === 'playing' && 'sd-deck-spin')} />
                            Deck A {deckA.playbackState === 'playing' ? `(${t('dj.play')})` : ''}
                          </Tag>
                        )}
                        {isLoadedInDeckB && (
                          <Tag tone="ink" className="sd-library-track__tag" title={t('library.load_deck_b')}>
                            <Icon icon={Disc} size="xs" className={clsx(deckB.playbackState === 'playing' && 'sd-deck-spin')} />
                            Deck B {deckB.playbackState === 'playing' ? `(${t('dj.play')})` : ''}
                          </Tag>
                        )}
                      </span>
                      <span className="sd-library-track__line">
                        <span className="sd-library-track__artist">{track.artist}</span>
                        <Tag tone="surface" className="sd-library-track__tag">{t('library.badge_local')}</Tag>
                        {track.type === 'video' && <Tag tone="surface" className="sd-library-track__tag">V</Tag>}
                      </span>
                    </div>
                  </td>
                  <td className="sd-library-table__file">
                    <span className="sd-library-table__file-name">{track.album}</span>
                    {track.fileSizeFormatted && (
                      <span className="sd-library-table__muted sd-num">{track.fileSizeFormatted}</span>
                    )}
                  </td>
                  <td className="sd-table__num">
                    {isEditing ? (
                      <TextField
                        size="sm"
                        type="number"
                        inputMode="decimal"
                        min={MANUAL_BPM_MIN}
                        max={MANUAL_BPM_MAX}
                        step={0.1}
                        value={metadataDraft.bpm}
                        aria-label={t('library.manual_bpm_label')}
                        disabled={isSavingMetadata}
                        onChange={(e) => setMetadataDraft((d) => ({ ...d, bpm: e.target.value }))}
                        onKeyDown={(e) => handleMetadataKeyDown(e, track)}
                        wrapperClassName="sd-library-edit sd-library-edit--bpm"
                        autoFocus
                      />
                    ) : track.bpm !== undefined && track.bpm > 0 ? (
                      <span
                        className={clsx('sd-library-table__bpm sd-num', track.manualFields.includes('bpm') && 'is-manual')}
                        title={track.manualFields.includes('bpm') ? t('library.manual_value_title') : undefined}
                      >
                        {track.bpm % 1 === 0 ? track.bpm : track.bpm.toFixed(1)}
                      </span>
                    ) : (
                      <span className="sd-library-table__muted">—</span>
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <SelectField
                        size="sm"
                        value={metadataDraft.camelot}
                        aria-label={t('library.manual_key_label')}
                        disabled={isSavingMetadata}
                        onChange={(e) => setMetadataDraft((d) => ({ ...d, camelot: e.target.value }))}
                        onKeyDown={(e) => handleMetadataKeyDown(e, track)}
                        wrapperClassName="sd-library-edit sd-library-edit--key"
                      >
                        <option value="">{t('library.manual_key_none')}</option>
                        {CAMELOT_KEYS.map((camelot) => (
                          <option key={camelot} value={camelot}>
                            {camelot} · {camelotToKey(camelot)}
                          </option>
                        ))}
                      </SelectField>
                    ) : track.key ? (
                      <div
                        className={clsx('sd-library-key', track.manualFields.includes('camelot') && 'is-manual')}
                        title={track.manualFields.includes('camelot') ? t('library.manual_value_title') : undefined}
                      >
                        <span className="sd-library-key__name">{track.key}</span>
                        {track.camelot && (
                          <Tag tone="surface" className="sd-library-key__camelot">
                            {track.camelot}
                          </Tag>
                        )}
                      </div>
                    ) : (
                      <span className="sd-library-table__muted">—</span>
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <TextField
                        size="sm"
                        type="number"
                        inputMode="numeric"
                        min={MANUAL_ENERGY_MIN}
                        max={MANUAL_ENERGY_MAX}
                        step={1}
                        value={metadataDraft.energy}
                        aria-label={t('library.manual_energy_label')}
                        disabled={isSavingMetadata}
                        onChange={(e) => setMetadataDraft((d) => ({ ...d, energy: e.target.value }))}
                        onKeyDown={(e) => handleMetadataKeyDown(e, track)}
                        wrapperClassName="sd-library-edit sd-library-edit--energy"
                      />
                    ) : typeof track.energy === 'number' ? (
                      <div
                        className={clsx('sd-energy', track.manualFields.includes('energy') && 'is-manual')}
                        title={track.manualFields.includes('energy')
                          ? `${t('library.energy_label', { val: track.energy })} · ${t('library.manual_value_title')}`
                          : t('library.energy_label', { val: track.energy })}
                      >
                        <div className="sd-energy__track">
                          <div
                            className="sd-energy__fill"
                            style={{ width: `${Math.min(10, Math.max(0, track.energy)) * 10}%` }}
                          ></div>
                        </div>
                        <span className="sd-energy__value sd-num">{track.energy}</span>
                      </div>
                    ) : (
                      <span className="sd-library-table__muted">—</span>
                    )}
                  </td>
                  <td>
                    <AnalysisStatusBadge
                      status={track.status}
                      error={track.analysisError}
                      onAnalyze={() => handleAnalyzeTrack(track.rawLocalTrack, track.status === 'analyzed')}
                    />
                  </td>
                  <td className="sd-table__num sd-library-table__muted sd-num">{track.durationFormatted}</td>
                  <td className="sd-table__actions">
                    <div className="sd-library-actions">
                      <IconButton
                        icon={<span className="sd-library-actions__deck">A</span>}
                        size="sm"
                        variant={isLoadedInDeckA ? 'ink' : 'surface'}
                        label={t('library.load_deck_a')}
                        onClick={() => handleLoadToDeck(track, 'A')}
                      />
                      <IconButton
                        icon={<span className="sd-library-actions__deck">B</span>}
                        size="sm"
                        variant={isLoadedInDeckB ? 'ink' : 'surface'}
                        label={t('library.load_deck_b')}
                        onClick={() => handleLoadToDeck(track, 'B')}
                      />
                      <IconButton
                        icon={<Icon icon={Target} size="sm" />}
                        size="sm"
                        variant={seedIndex !== -1 ? 'ink' : 'ghost'}
                        aria-pressed={seedIndex !== -1}
                        label={seedIndex !== -1 ? t('seed.unmark') : t('seed.mark')}
                        onClick={() => handleToggleSeed(track.rawLocalTrack)}
                      />
                      {isEditing ? (
                        <>
                          <IconButton
                            icon={<Icon icon={Check} size="sm" />}
                            size="sm"
                            variant="ink"
                            disabled={isSavingMetadata}
                            label={t('library.action_save_metadata')}
                            onClick={() => handleSaveMetadataEdit(track)}
                          />
                          <IconButton
                            icon={<Icon icon={X} size="sm" />}
                            size="sm"
                            disabled={isSavingMetadata}
                            label={t('library.action_cancel_edit')}
                            onClick={handleCancelMetadataEdit}
                          />
                        </>
                      ) : (
                        <IconButton
                          icon={<Icon icon={Pencil} size="sm" />}
                          size="sm"
                          disabled={track.status === 'analyzing'}
                          label={t('library.action_edit_metadata')}
                          onClick={() => handleStartMetadataEdit(track)}
                        />
                      )}
                      {track.status === 'analyzing' ? (
                        <IconButton
                          icon={<Icon icon={Loader2} size="sm" className="sd-status__spin" />}
                          size="sm"
                          disabled
                          label={t('library.status_analyzing')}
                        />
                      ) : track.status === 'analyzed' ? (
                        <IconButton
                          icon={<Icon icon={RefreshCw} size="sm" />}
                          size="sm"
                          label={t('library.action_reanalyze')}
                          onClick={() => handleAnalyzeTrack(track.rawLocalTrack, true)}
                        />
                      ) : (
                        <IconButton
                          icon={<Icon icon={Sparkles} size="sm" />}
                          size="sm"
                          label={t('library.action_analyze')}
                          onClick={() => handleAnalyzeTrack(track.rawLocalTrack, false)}
                        />
                      )}
                      <IconButton
                        icon={<Icon icon={Trash2} size="sm" />}
                        size="sm"
                        label={t('library.delete_track')}
                        onClick={() => setDeleteConfirmTrack(track.rawLocalTrack)}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}

            {filteredTracks.length === 0 && (
              <tr className="sd-table__empty-row">
                <td colSpan={9}>
                  <EmptyState
                    icon={localTracks.length === 0 ? Music : Search}
                    title={localTracks.length === 0 ? t('library.empty_local_title') : t('states.empty_title')}
                    description={localTracks.length === 0 ? t('library.empty_local_desc') : t('states.empty_desc')}
                  />
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
        <div className="sd-confirm-overlay" onClick={() => setDeleteConfirmTrack(null)}>
          <div
            className="sd-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="library-delete-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="library-delete-title" className="sd-confirm__title">{t('library.delete_track')}</h3>
            <p className="sd-confirm__description">
              {t('library.delete_confirm', { title: deleteConfirmTrack.title })}
            </p>
            <div className="sd-confirm__actions">
              <Button variant="ghost" onClick={() => setDeleteConfirmTrack(null)}>
                {t('common.cancel')}
              </Button>
              <Button variant="ink" onClick={() => handleDeleteTrack(deleteConfirmTrack)}>
                <Icon icon={Trash2} size="sm" />
                {t('common.delete')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConsoleTemplate>
  );
};

