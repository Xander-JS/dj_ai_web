import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  Search, MoreHorizontal, CheckSquare, Square, 
  UploadCloud, FolderPlus, Trash2, AlertCircle, CheckCircle2, 
  Disc, X, HardDrive, Sparkles, RefreshCw, Loader2, Clock, AlertTriangle
} from 'lucide-react';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { IconButton } from '../components/ui/IconButton';
import { Badge } from '../components/ui/Badge';
import { MOCK_LIBRARY } from '../mock/library';
import { indexedDBStorage } from '../services/storage/IndexedDBStorage';
import { validateAudioFile, createTrackFromFile } from '../utils/audioValidation';
import { computeFileHash } from '../utils/cryptoHash';
import { formatBytes, formatDate } from '../utils/formatters';
import { audioEngine } from '../audio';
import { useDJStore } from '../store/useDJStore';
import { analysisSyncManager } from '../services/analysis';
import { keyToCamelot } from '../audio/analysis/camelotMapper';
import type { Track, AnalysisStatus, MusicalKeyCamelot } from '../types/track';
import '../components/ui/Table.css';
import './Library.css';
import { clsx } from 'clsx';

export type FilterType = 'all' | 'local' | 'demo' | 'audio' | 'video';

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
  isLocal: boolean;
  fileSizeFormatted?: string;
  dateAddedFormatted?: string;
  rawLocalTrack?: Track;
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
  const { deckA, deckB, loadTrackToDeckA, loadTrackToDeckB, analyzeTrack } = useDJStore();

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

    let successCount = 0;
    const errors: string[] = [];

    const files = Array.from(fileList);

    for (const file of files) {
      // 1. Validar extensión y formato
      const validation = validateAudioFile(file);
      if (!validation.valid) {
        errors.push(validation.error || file.name);
        continue;
      }

      // 2. Comprobar si ya existe
      const isDuplicate = await indexedDBStorage.hasDuplicate(file.name, file.size);
      if (isDuplicate) {
        errors.push(t('library.duplicate_warning', { name: file.name }));
        continue;
      }

      // 3. Decodificar para obtener duración real
      let durationSeconds = 0;
      try {
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await audioEngine.decodeAudioData(arrayBuffer);
        durationSeconds = audioBuffer.duration;
      } catch (err) {
        console.warn(`[Library] No se pudo decodificar la duración previa de ${file.name}:`, err);
      }

      // Calcular huella criptográfica SHA-256 sobre el contenido exacto
      let contentHash: string | undefined;
      try {
        contentHash = await computeFileHash(file);
      } catch (hashErr) {
        console.warn(`[Library] No se pudo calcular el hash de ${file.name}:`, hashErr);
      }

      // 4. Crear entidad Track y persistir en IndexedDB
      const newTrack = createTrackFromFile(file, durationSeconds, contentHash);
      try {
        const result = await indexedDBStorage.saveTrack(newTrack, file);
        if (!result.persisted) {
          errors.push(`"${file.name}" se cargó en memoria temporal pero no se pudo persistir en IndexedDB (${result.reason || 'sin persistencia'}). Se perderá al recargar.`);
        } else {
          successCount++;
        }
      } catch (saveErr) {
        errors.push(`Error al guardar ${file.name}: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}`);
      }
    }

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
      let trackToLoad: Track;
      if (unifiedTrack.rawLocalTrack) {
        trackToLoad = unifiedTrack.rawLocalTrack;
      } else {
        // Pista de demostración
        trackToLoad = {
          id: unifiedTrack.id,
          title: unifiedTrack.title,
          artist: unifiedTrack.artist,
          album: unifiedTrack.album,
          duration: 30,
          durationFormatted: unifiedTrack.durationFormatted,
          type: unifiedTrack.type,
          source: { type: 'blob' },
          analysis: {
            status: 'analyzed',
            bpm: unifiedTrack.bpm,
            key: unifiedTrack.key,
            camelot: unifiedTrack.camelot,
            energy: unifiedTrack.energy,
          },
          dateAdded: Date.now(),
        };
      }

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

  // Construcción unificada de filas (Demo + Local)
  const unifiedTracks: UnifiedRowTrack[] = [
    // Pistas locales importadas
    ...localTracks.map((lt): UnifiedRowTrack => {
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
        isLocal: true,
        fileSizeFormatted: lt.fileMeta?.fileSize ? formatBytes(lt.fileMeta.fileSize) : undefined,
        dateAddedFormatted: lt.dateAdded ? formatDate(lt.dateAdded) : undefined,
        rawLocalTrack: lt,
      };
    }),
    // Pistas mock de demostración
    ...MOCK_LIBRARY.map((mt): UnifiedRowTrack => ({
      id: `demo_${mt.id}`,
      title: mt.title,
      artist: mt.artist,
      album: mt.album,
      bpm: mt.bpm,
      key: mt.key,
      camelot: keyToCamelot(mt.key) || undefined,
      energy: mt.energy,
      status: 'analyzed',
      durationFormatted: mt.duration,
      type: mt.type,
      isLocal: false,
    })),
  ];

  // Filtrado reactivo por tipo y búsqueda
  const filteredTracks = unifiedTracks.filter((track) => {
    // Filtro por categoría
    if (filter === 'local' && !track.isLocal) return false;
    if (filter === 'demo' && track.isLocal) return false;
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
              variant={filter === 'demo' ? 'primary' : 'outline'} 
              size="sm" 
              onClick={() => setFilter('demo')}
            >
              {t('library.filter_demo')}
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
                      <Badge variant={track.isLocal ? 'primary' : 'outline'}>
                        {track.isLocal ? t('library.badge_local') : t('library.badge_demo')}
                      </Badge>
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
                      onAnalyze={track.isLocal && track.rawLocalTrack ? () => handleAnalyzeTrack(track.rawLocalTrack!, track.status === 'analyzed') : undefined}
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
                      {track.isLocal && track.rawLocalTrack && (
                        track.status === 'analyzing' ? (
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
                            onClick={() => handleAnalyzeTrack(track.rawLocalTrack!, true)}
                          />
                        ) : (
                          <IconButton 
                            icon={<Sparkles size={15} />} 
                            size="sm" 
                            variant="ghost"
                            title={t('library.action_analyze')}
                            aria-label={t('library.action_analyze')}
                            onClick={() => handleAnalyzeTrack(track.rawLocalTrack!, false)}
                          />
                        )
                      )}
                      {track.isLocal && track.rawLocalTrack && (
                        <IconButton 
                          icon={<Trash2 size={16} />} 
                          size="sm" 
                          variant="ghost"
                          title={t('library.delete_track')}
                          aria-label={t('library.delete_track')}
                          onClick={() => setDeleteConfirmTrack(track.rawLocalTrack || null)}
                        />
                      )}
                      {!track.isLocal && (
                        <IconButton icon={<MoreHorizontal size={16} />} size="sm" aria-label="More" />
                      )}
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
                      {filter === 'local' ? t('library.empty_local_title') : t('states.empty_title')}
                    </span>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                      {filter === 'local' ? t('library.empty_local_desc') : t('states.empty_desc')}
                    </span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

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

