import React, { useState, useEffect, useRef, useCallback, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { 
  Search, CheckSquare, Square, MinusSquare,
  UploadCloud, FolderPlus, Trash2, AlertCircle, CheckCircle2, 
  Disc, X, HardDrive, Sparkles, RefreshCw, Loader2, Clock, AlertTriangle,
  Target, WandSparkles, ArrowLeftRight, Link2, Pencil, Check, Music
} from 'lucide-react';
import { Button } from '../components/atoms/Button';
import { IconButton } from '../components/atoms/IconButton';
import { Icon } from '../components/atoms/Icon';
import { Tag } from '../components/atoms/Tag';
import { TextField } from '../components/atoms/TextField';
import { SegmentedControl } from '../components/molecules/SegmentedControl';
import { SelectMenu } from '../components/molecules/SelectMenu';
import { ConfirmDialog } from '../components/molecules/ConfirmDialog';
import { PageHeader } from '../components/molecules/PageHeader';
import { EmptyState } from '../components/molecules/EmptyState';
import { ConsoleTemplate } from '../components/templates/ConsoleTemplate';
import { useSmoothScroll } from '../design-system/smoothScroll';
import { DURATION, EASE_OUT } from '../design-system/motion';
import { useAnimationsEnabled } from '../design-system/motionPreference';
import { LibrarySelectionBar } from '../components/organisms/LibrarySelectionBar';
import { AnalysisQueuePanel } from '../components/organisms/AnalysisQueuePanel';
import { YouTubeImportModal, type YouTubeImportResult } from '../components/library/YouTubeImportModal';
import { indexedDBStorage } from '../services/storage/IndexedDBStorage';
import { importFilesToLocalLibrary, importRemoteAudioToLocalLibrary, notifyDuplicateImports } from '../services/localLibraryImport';
import { settingsStore } from '../store/useSettingsStore';
import type { ExtractedAudio } from '../services/youtubeService';
import { formatDate } from '../utils/formatters';
import { useDJStore } from '../store/useDJStore';
import { useSeedStore } from '../store/useSeedStore';
import { buildPlaylistFromSeeds, MAX_SEED_TRACKS } from '../engine/playlistBuilder';
import { notificationCenter } from '../services/notifications/notificationCenter';
import { toastStore } from '../services/notifications/toastService';
import { analysisSyncManager, bulkAnalysisQueue } from '../services/analysis';
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
import {
  filterLibraryRows,
  isLinkTrack,
  isLocalTrack,
  type SourceFilter,
} from '../utils/libraryFilters';
import './Library.css';
import { clsx } from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';


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
  /** Esperando turno en la cola de reanálisis */
  queued?: boolean;
}

export const AnalysisStatusBadge: React.FC<AnalysisStatusBadgeProps> = ({
  status,
  error,
  onAnalyze,
  queued = false,
}) => {
  const { t } = useTranslation();

  const getStatusConfig = () => {
    if (queued) {
      return {
        icon: <Icon icon={Clock} size="xs" />,
        label: t('library.queue.status_queued'),
        title: t('library.queue.status_queued_title'),
        className: 'sd-status--queued',
        isInteractive: false,
      };
    }
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
  const tableScrollRef = useSmoothScroll<HTMLDivElement>();
  const animationsEnabled = useAnimationsEnabled();
  const { deckA, deckB, loadTrackToDeckA, loadTrackToDeckB, analyzeTrack } = useDJStore();
  const { seedTrackIds, toggleSeed, removeSeed, swapSeeds, clearSeeds } = useSeedStore();
  const [isGenerating, setIsGenerating] = useState(false);

  const [filter, setFilter] = useState<SourceFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTracks, setSelectedTracks] = useState<Set<string>>(new Set());

  const [localTracks, setLocalTracks] = useState<Track[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  // Análisis en curso lanzados desde esta vista: los avisos cuentan el lote completo
  const analysisBatchRef = useRef({ pending: 0, done: 0, failed: 0 });
  const deletedToastText = (count: number) =>
    count === 1 ? t('library.toast.deleted') : t('library.toast.deleted_count', { count });

  const [deleteConfirmTrack, setDeleteConfirmTrack] = useState<Track | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  // Ancla del rango con Mayús + clic
  const selectionAnchorRef = useRef<string | null>(null);
  const queue = useSyncExternalStore(bulkAnalysisQueue.subscribe, bulkAnalysisQueue.getSnapshot);
  const [youtubeModalOpen, setYoutubeModalOpen] = useState(false);

  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [targetPlaylistId, setTargetPlaylistId] = useState('');

  // Edición manual en línea de BPM, tonalidad Camelot y energía
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [metadataDraft, setMetadataDraft] = useState<MetadataDraft>({ bpm: '', camelot: '', energy: '' });
  const [initialMetadataDraft, setInitialMetadataDraft] = useState<MetadataDraft>({ bpm: '', camelot: '', energy: '' });
  const [isSavingMetadata, setIsSavingMetadata] = useState(false);
  // Resalte breve del Modo referencia cuando cambian sus pistas
  const [isSeedBarUpdated, setIsSeedBarUpdated] = useState(false);

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

    const files = Array.from(fileList);
    const { successCount, errors, duplicates, importedTracks } = await importFilesToLocalLibrary(
      files,
      (name) => t('library.duplicate_warning', { name }),
    );

    await refreshLocalTracks();
    setIsImporting(false);
    if (settingsStore.getSnapshot().autoAnalyzeOnImport) {
      importedTracks.forEach((track) => { void handleAnalyzeTrack(track); });
    }

    // Resultado como aviso instantáneo en la esquina: no desplaza la cabecera ni la tabla
    if (successCount > 0 && errors.length === 0) {
      toastStore.show('success', t('library.toast.imported'));
    } else if (successCount > 0 && errors.length > 0) {
      toastStore.show('warning', t('library.import_partial_warning', {
        success: t('library.toast.imported'),
        warnings: errors.join(', '),
      }));
    } else if (errors.length > 0) {
      toastStore.show('error', errors.join(' | '));
    }
    notifyDuplicateImports(duplicates, (count) => t('library.toast.duplicates', { count }));
  };

  // Importación desde YouTube: mismo flujo que un archivo local y análisis automático (si está activado en Ajustes)
  const handleYouTubeAudio = async ({ blob, filename }: ExtractedAudio): Promise<YouTubeImportResult> => {
    const { successCount, errors, duplicates, importedTracks } = await importRemoteAudioToLocalLibrary(
      blob,
      filename,
      (name) => t('library.duplicate_warning', { name }),
    );
    await refreshLocalTracks();

    // Ya estaba en la biblioteca: el aviso instantáneo lo explica y el modal se cierra
    if (duplicates.length > 0) {
      notifyDuplicateImports(duplicates, (count) => t('library.toast.duplicates', { count }));
      return { ok: true };
    }

    if (successCount === 0) {
      return { ok: false, error: errors.join(' | ') || undefined };
    }

    toastStore.show('success', t('library.toast.imported'));
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

    const batch = analysisBatchRef.current;
    batch.pending += 1;
    try {
      // Marcado visual optimista
      setLocalTracks((prev) =>
        prev.map((t) =>
          t.id === track.id ? { ...t, analysis: { ...t.analysis, status: 'analyzing' } } : t
        )
      );

      const result = await analyzeTrack(track, force);

      // Un solo aviso por resultado que se actualiza en el sitio: «Análisis completado (X)»
      if (result.status === 'failed') {
        batch.failed += 1;
        toastStore.show('warning', t('library.toast.analysis_failed'), { group: 'library-analysis-failed', count: batch.failed });
      } else if (result.status === 'analyzed') {
        batch.done += 1;
        toastStore.show('success', t(force ? 'library.toast.reanalyzed' : 'library.toast.analyzed'), { group: 'library-analysis-done', count: batch.done });
      }
    } catch (err) {
      console.error('[Library] Error al solicitar análisis:', err);
      batch.failed += 1;
      toastStore.show('error', t('library.toast.analysis_failed'), { group: 'library-analysis-failed', count: batch.failed });
    } finally {
      // Lote terminado: el siguiente empieza a contar desde cero
      batch.pending -= 1;
      if (batch.pending === 0) analysisBatchRef.current = { pending: 0, done: 0, failed: 0 };
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
      toastStore.show('success', deletedToastText, { group: 'library-deleted' });
    } catch (err) {
      console.error('[Library] Error al eliminar pista:', err);
      toastStore.show('error', t('library.delete_error', { error: err instanceof Error ? err.message : String(err) }));
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
      toastStore.show('error', text);
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
      toastStore.show('success', t(edits.bpm !== undefined ? 'library.toast.bpm_updated' : 'library.toast.metadata_updated'));
    } catch (err) {
      console.error('[Library] Error al guardar metadatos:', err);
      toastStore.show('error', t('library.toast.save_failed'));
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
        toastStore.show('success', t('library.toast.added_to_deck', { deck: deckLabel }));
      } else {
        toastStore.show('error', t('library.toast.load_failed', { deck: deckLabel }));
      }
    } catch (err) {
      const deckLabel = deckId === 'A' ? 'Deck A' : 'Deck B';
      toastStore.show('error', t('library.load_exception_error', {
        deck: deckLabel,
        error: err instanceof Error ? err.message : String(err),
      }));
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
        album: lt.album || '-',
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
        dateAddedFormatted: lt.dateAdded ? formatDate(lt.dateAdded) : undefined,
        rawLocalTrack: lt,
      };
    });

  // Filtrado reactivo por origen y búsqueda
  const filteredTracks = filterLibraryRows(unifiedTracks, filter, 'all', searchQuery);
  const localCount = localTracks.filter(isLocalTrack).length;
  const linkCount = localTracks.filter(isLinkTrack).length;
  // Un filtro de origen solo reduce la vista si hay pistas del otro origen
  const isFiltered = (filter === 'local' && localCount < localTracks.length)
    || (filter === 'link' && linkCount < localTracks.length)
    || searchQuery.trim() !== '';

  // La selección solo abarca pistas visibles: al cambiar la vista se descartan las que quedan ocultas,
  // para que ninguna acción masiva alcance pistas que el usuario ya no ve
  const selectedRows = filteredTracks.filter((track) => selectedTracks.has(track.id));
  const allVisibleSelected = filteredTracks.length > 0 && selectedRows.length === filteredTracks.length;
  const queuedIds = new Set(queue.pending.map((item) => item.trackId));

  const changeView = (nextFilter: SourceFilter, nextQuery: string) => {
    setFilter(nextFilter);
    setSearchQuery(nextQuery);
    const visibleIds = new Set(filterLibraryRows(unifiedTracks, nextFilter, 'all', nextQuery).map((track) => track.id));
    setSelectedTracks((prev) => {
      const next = new Set([...prev].filter((id) => visibleIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  };

  // Pistas de referencia resueltas en orden (1.ª = inicio, 2.ª = cierre); se ignoran ids ya eliminados
  const seedTracks = seedTrackIds
    .map((id) => localTracks.find((tr) => tr.id === id))
    .filter((tr): tr is Track => Boolean(tr));

  const handleToggleSeed = (track: Track) => {
    const result = toggleSeed(track.id);
    if (result.action === 'replaced') {
      toastStore.show('warning', t('seed.limit_reached', { max: MAX_SEED_TRACKS }));
    } else {
      toastStore.show('success', t('seed.updated'));
    }
    // toggleSeed siempre modifica las referencias (añade, quita o reemplaza)
    setIsSeedBarUpdated(true);
  };

  // Modo referencia: secuencia la biblioteca desde las semillas y guarda el resultado como playlist
  const handleGenerateFromSeeds = async () => {
    if (seedTracks.length === 0 || isGenerating) return;
    setIsGenerating(true);
    const seedIds = seedTracks.map((tr) => tr.id);
    // Solo aviso instantáneo: el rechazo no se registra en el historial de notificaciones
    const showAlreadyGenerated = () => toastStore.show('warning', t('seed.already_generated'));
    try {
      if (await playlistService.findBySeeds(seedIds)) {
        showAlreadyGenerated();
        return;
      }
      const result = buildPlaylistFromSeeds({ seedTracks, candidates: localTracks });
      if (result.trackIds.length <= seedTracks.length) {
        notificationCenter.push({ type: 'warning', messageKey: 'seed.no_compatible' });
        return;
      }
      const name = seedTracks.length === 2
        ? t('seed.generated_name_pair', { start: seedTracks[0].title, end: seedTracks[1].title })
        : t('seed.generated_name', { title: seedTracks[0].title });
      const created = await playlistService.createSeedMix(name, seedIds, result.trackIds);
      if (!created) {
        showAlreadyGenerated();
        return;
      }
      notificationCenter.push({
        type: 'success',
        messageKey: 'notifications.seed_mix_generated',
        params: { name: created.name, count: result.trackIds.length },
      });
      // La vista de Playlists abre directamente la playlist recién generada
      navigate('/playlists', { state: { playlistId: created.id } });
    } catch (err) {
      toastStore.show('error', t('library.playlist_add_error', { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setIsGenerating(false);
    }
  };

  // Añade las pistas seleccionadas (en el orden de la tabla) a la playlist elegida
  const handleAddSelectedToPlaylist = async () => {
    const playlist = playlists.find((p) => p.id === targetPlaylistId);
    if (!playlist || selectedRows.length === 0) return;
    const ids = selectedRows.map((tr) => tr.id);
    try {
      const before = playlist.trackIds.length;
      const updated = await playlistService.update(playlist.id, (p) => addTracksToPlaylist(p, ids));
      const added = updated ? updated.trackIds.length - before : 0;
      if (added > 0) toastStore.show('success', t('library.playlist_add_success', { count: added, name: playlist.name }));
      else toastStore.show('warning', t('library.playlist_add_none', { name: playlist.name }));
      clearSelection();
    } catch (err) {
      toastStore.show('error', t('library.playlist_add_error', { error: err instanceof Error ? err.message : String(err) }));
    }
  };

  // Clic: alterna una pista · Mayús + clic: marca el tramo desde la última pista pulsada
  const toggleSelection = (id: string, extendRange = false) => {
    const anchor = selectionAnchorRef.current;
    const ids = filteredTracks.map((track) => track.id);
    const from = anchor ? ids.indexOf(anchor) : -1;
    const to = ids.indexOf(id);
    const next = new Set(selectedTracks);
    if (extendRange && from !== -1 && to !== -1 && from !== to) {
      for (const rangeId of ids.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(rangeId);
    } else if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    selectionAnchorRef.current = id;
    setSelectedTracks(next);
  };

  const selectAllVisible = () => {
    setSelectedTracks(new Set(filteredTracks.map((track) => track.id)));
  };

  const clearSelection = () => {
    selectionAnchorRef.current = null;
    setSelectedTracks(new Set());
  };

  // Reanálisis masivo: las pistas pasan a la cola y se procesan una a una en segundo plano
  const handleBulkReanalyze = () => {
    const { added, duplicates } = bulkAnalysisQueue.enqueue(
      selectedRows.map((track) => ({ trackId: track.id, title: track.title })),
    );
    clearSelection();
    if (duplicates > 0) {
      const parts = [
        added > 0 ? t('library.bulk.queue_added', { count: added }) : '',
        t('library.bulk.queue_duplicates', { count: duplicates }),
      ];
      toastStore.show('warning', parts.filter(Boolean).join(' '));
    }
  };

  // Borrado masivo: mismo mecanismo que el individual, pista a pista, con el resultado real
  const handleBulkDelete = async () => {
    const targets = selectedRows.map((track) => track.rawLocalTrack);
    if (targets.length === 0) return;
    setIsDeleting(true);
    const failedIds: string[] = [];
    const errors: string[] = [];
    for (const track of targets) {
      try {
        if (analysisSyncManager.isAnalyzing(track.id)) analysisSyncManager.cancelAnalysis(track.id);
        await indexedDBStorage.deleteTrack(track.id);
        removeSeed(track.id);
      } catch (err) {
        failedIds.push(track.id);
        errors.push(`${track.title}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // deleteTrack también retira las pistas de las playlists; avisar a las vistas suscritas
    if (failedIds.length < targets.length) playlistService.notifyExternalChange();
    await refreshLocalTracks();
    setSelectedTracks(new Set(failedIds));
    selectionAnchorRef.current = null;
    setIsDeleting(false);
    setBulkDeleteOpen(false);

    const deleted = targets.length - failedIds.length;
    // Mismo aviso agrupado que el borrado individual: «Pistas eliminadas (X)»
    if (deleted > 0) toastStore.show('success', deletedToastText, { group: 'library-deleted', count: deleted });
    if (failedIds.length > 0 && deleted > 0) {
      toastStore.show('warning', t('library.bulk.delete_partial', { deleted, total: targets.length, failed: failedIds.length, errors: errors.join(' | ') }));
    } else if (failedIds.length > 0) {
      toastStore.show('error', t('library.bulk.delete_failed', { total: targets.length, errors: errors.join(' | ') }));
    }
  };

  const filterOptions: { value: SourceFilter; label: React.ReactNode }[] = [
    { value: 'all', label: t('library.filter_all') },
    {
      value: 'local',
      label: (
        <>
          <Icon icon={HardDrive} size="sm" />
          {t('library.filter_local')}
          <span className="sd-num">({localCount})</span>
        </>
      ),
    },
    {
      value: 'link',
      label: (
        <>
          <Icon icon={Link2} size="sm" />
          {t('library.filter_link')}
          <span className="sd-num">({linkCount})</span>
        </>
      ),
    },
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
        onChange={(e) => {
          void handleImportFiles(e.target.files);
          // Permite volver a elegir el mismo archivo para que su duplicado se notifique
          e.target.value = '';
        }}
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

        <div className="sd-library-toolbar">
          <TextField
            type="search"
            placeholder={t('library.search_tracks')}
            aria-label={t('library.search_tracks')}
            icon={<Icon icon={Search} size="sm" />}
            value={searchQuery}
            onChange={(e) => changeView(filter, e.target.value)}
            wrapperClassName="sd-library-toolbar__search"
          />

          <div className="sd-library-toolbar__filters">
            <SegmentedControl
              label={t('library.filters_label')}
              value={filter}
              options={filterOptions}
              onChange={(value) => changeView(value, searchQuery)}
            />
          </div>
        </div>

        {/* Modo referencia (semillas) */}
        {localTracks.length > 0 && (
          <div
            className={clsx('sd-library-bar', isSeedBarUpdated && 'is-updated')}
            role="region"
            aria-label={t('seed.mode_title')}
            onAnimationEnd={(e) => { if (e.target === e.currentTarget) setIsSeedBarUpdated(false); }}
          >
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

        {/* Cola de reanálisis en segundo plano y su resumen */}
        <AnalysisQueuePanel />

        {/* Barra contextual de la selección: el hueco se pliega con ella y la salida termina antes de desmontarla */}
        <AnimatePresence initial={false}>
          {selectedRows.length > 0 && (
            <motion.div
              key="selection-bar"
              className="sd-selection-bar-slot"
              initial={{ height: 0, opacity: 0, overflow: 'hidden' }}
              animate={{ height: 'auto', opacity: 1, transitionEnd: { overflow: 'visible' } }}
              exit={{ height: 0, opacity: 0, overflow: 'hidden', pointerEvents: 'none' }}
              transition={{ duration: animationsEnabled ? DURATION.base : 0, ease: EASE_OUT }}
            >
              <div className="sd-selection-bar-slot__inner">
                <LibrarySelectionBar
                  selectedCount={selectedRows.length}
                  visibleCount={filteredTracks.length}
                  isFiltered={isFiltered}
                  playlists={playlists}
                  countPlaylistTracks={(playlist) => playlist.trackIds.filter((id) => localTracks.some((tr) => tr.id === id)).length}
                  targetPlaylistId={targetPlaylistId}
                  onTargetPlaylistChange={setTargetPlaylistId}
                  onAddToPlaylist={handleAddSelectedToPlaylist}
                  onSelectAll={selectAllVisible}
                  onDeselectAll={clearSelection}
                  onReanalyze={handleBulkReanalyze}
                  onDelete={() => setBulkDeleteOpen(true)}
                  busy={isDeleting}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Tabla unificada */}
      <div ref={tableScrollRef} className="sd-library-table-wrap sd-scroll-area">
        <table className="sd-table sd-library-table">
          <thead>
            <tr>
              <th className="sd-table__check">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={allVisibleSelected ? true : selectedRows.length > 0 ? 'mixed' : false}
                  aria-label={t('library.bulk.select_all_rows')}
                  title={t('library.bulk.select_all_rows')}
                  disabled={filteredTracks.length === 0}
                  className="sd-table__checkbox"
                  onClick={() => (selectedRows.length > 0 ? clearSelection() : selectAllVisible())}
                >
                  <Icon
                    icon={allVisibleSelected ? CheckSquare : selectedRows.length > 0 ? MinusSquare : Square}
                    size="sm"
                    className={selectedRows.length > 0 ? 'sd-table__check-on' : 'sd-table__check-off'}
                  />
                </button>
              </th>
              <th>{t('library.col_title')}</th>
              <th className="sd-library-table__deck"><span className="sd-visually-hidden">{t('library.col_deck')}</span></th>
              <th>{t('library.col_album')}</th>
              <th className="sd-table__num">{t('library.col_bpm')}</th>
              <th colSpan={2}>{t('library.col_key')}</th>
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
              const isQueued = queuedIds.has(track.id);

              return (
                <tr key={track.id} className={clsx(isSelected && 'is-selected', (isLoadedInDeckA || isLoadedInDeckB) && 'is-prepared')}>
                  <td className="sd-table__check" onClick={(e) => { if (e.target === e.currentTarget) toggleSelection(track.id, e.shiftKey); }}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={isSelected}
                      aria-label={t('library.bulk.select_row', { title: track.title })}
                      className="sd-table__checkbox"
                      onClick={(e) => toggleSelection(track.id, e.shiftKey)}
                    >
                      <Icon
                        icon={isSelected ? CheckSquare : Square}
                        size="sm"
                        className={isSelected ? 'sd-table__check-on' : 'sd-table__check-off'}
                      />
                    </button>
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
                      </span>
                      <span className="sd-library-track__line">
                        <span className="sd-library-track__artist">{track.artist}</span>
                        <Tag tone="surface" className="sd-library-track__tag">{isLinkTrack(track.rawLocalTrack) ? t('library.badge_link') : t('library.badge_local')}</Tag>
                        {track.type === 'video' && <Tag tone="surface" className="sd-library-track__tag">V</Tag>}
                      </span>
                    </div>
                  </td>
                  {/* Columna reservada para la asignación a Deck: vacía si la pista no está cargada */}
                  <td className="sd-library-table__deck">
                    {(isLoadedInDeckA || isLoadedInDeckB) && (
                      <span className="sd-library-table__decks">
                        {isLoadedInDeckA && (
                          <Tag tone="ink" className="sd-library-track__tag" title={t('library.load_deck_a')}>
                            <Icon icon={Disc} size="xs" className={clsx(deckA.playbackState === 'playing' && 'sd-deck-spin')} />
                            Deck A
                          </Tag>
                        )}
                        {isLoadedInDeckB && (
                          <Tag tone="ink" className="sd-library-track__tag" title={t('library.load_deck_b')}>
                            <Icon icon={Disc} size="xs" className={clsx(deckB.playbackState === 'playing' && 'sd-deck-spin')} />
                            Deck B
                          </Tag>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="sd-library-table__file">
                    <span className="sd-library-table__file-name">{track.album}</span>
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
                  {isEditing ? (
                    <td colSpan={2}>
                      <SelectMenu
                        size="sm"
                        label={t('library.manual_key_label')}
                        placeholder={t('library.manual_key_none')}
                        value={metadataDraft.camelot}
                        disabled={isSavingMetadata}
                        menuMinWidth={176}
                        options={[
                          { value: '', label: t('library.manual_key_none') },
                          ...CAMELOT_KEYS.map((camelot) => ({ value: camelot, label: `${camelot} · ${camelotToKey(camelot)}` })),
                        ]}
                        onChange={(camelot) => setMetadataDraft((d) => ({ ...d, camelot }))}
                        onKeyDown={(e) => handleMetadataKeyDown(e, track)}
                        wrapperClassName="sd-library-edit sd-library-edit--key"
                      />
                    </td>
                  ) : track.key ? (
                    <>
                      {/* Tonalidad y Camelot en celdas propias: cada una se alinea en su columna */}
                      <td
                        className={clsx('sd-library-table__key', track.manualFields.includes('camelot') && 'is-manual')}
                        title={track.manualFields.includes('camelot') ? t('library.manual_value_title') : undefined}
                      >
                        <span className="sd-library-key__name">{track.key}</span>
                      </td>
                      <td className="sd-library-table__camelot">
                        {track.camelot && (
                          <Tag tone="surface" className="sd-library-key__camelot">
                            {track.camelot}
                          </Tag>
                        )}
                      </td>
                    </>
                  ) : (
                    <td colSpan={2}>
                      <span className="sd-library-table__muted">—</span>
                    </td>
                  )}
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
                      queued={isQueued}
                      onAnalyze={isQueued ? undefined : () => handleAnalyzeTrack(track.rawLocalTrack, track.status === 'analyzed')}
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
                      {isQueued ? (
                        <IconButton
                          icon={<Icon icon={Clock} size="sm" />}
                          size="sm"
                          disabled
                          label={t('library.queue.status_queued_title')}
                        />
                      ) : track.status === 'analyzing' ? (
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
                <td colSpan={11}>
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

      {/* Confirmación para eliminar una pista local */}
      <ConfirmDialog
        open={deleteConfirmTrack !== null}
        title={t('library.delete_track')}
        description={deleteConfirmTrack ? t('library.delete_confirm', { title: deleteConfirmTrack.title }) : ''}
        cancelLabel={t('common.cancel')}
        confirmLabel={<><Icon icon={Trash2} size="sm" />{t('common.delete')}</>}
        onCancel={() => setDeleteConfirmTrack(null)}
        onConfirm={() => { if (deleteConfirmTrack) void handleDeleteTrack(deleteConfirmTrack); }}
      />

      {/* Confirmación del borrado masivo: indica cuántas pistas se eliminarán */}
      <ConfirmDialog
        open={bulkDeleteOpen}
        busy={isDeleting}
        title={t('library.bulk.delete_title', { count: selectedRows.length })}
        description={t('library.bulk.delete_confirm', { count: selectedRows.length })}
        cancelLabel={t('common.cancel')}
        confirmLabel={<><Icon icon={Trash2} size="sm" />{isDeleting ? t('library.bulk.deleting') : t('common.delete')}</>}
        onCancel={() => setBulkDeleteOpen(false)}
        onConfirm={() => void handleBulkDelete()}
      />
    </ConsoleTemplate>
  );
};

