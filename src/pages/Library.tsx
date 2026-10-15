import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  Search, MoreHorizontal, CheckSquare, Square, 
  UploadCloud, FolderPlus, Trash2, AlertCircle, CheckCircle2, 
  Disc, X, HardDrive
} from 'lucide-react';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { IconButton } from '../components/ui/IconButton';
import { Badge } from '../components/ui/Badge';
import { MOCK_LIBRARY } from '../mock/library';
import { indexedDBStorage } from '../services/storage/IndexedDBStorage';
import { validateAudioFile, createTrackFromFile } from '../utils/audioValidation';
import { formatBytes, formatDate } from '../utils/formatters';
import { audioEngine } from '../audio';
import type { Track } from '../types/track';
import '../components/ui/Table.css';
import './Library.css';
import { clsx } from 'clsx';

type FilterType = 'all' | 'local' | 'demo' | 'audio' | 'video';

interface UnifiedRowTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  bpm?: number;
  key?: string;
  energy?: number;
  durationFormatted: string;
  type: 'audio' | 'video';
  isLocal: boolean;
  fileSizeFormatted?: string;
  dateAddedFormatted?: string;
  rawLocalTrack?: Track;
}

export const Library: React.FC = () => {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  const [preparedDeckATrack, setPreparedDeckATrack] = useState<string | null>(null);

  // Carga inicial de pistas desde IndexedDB
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

    return () => {
      isMounted = false;
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

      // 4. Crear entidad Track y persistir en IndexedDB
      const newTrack = createTrackFromFile(file, durationSeconds);
      try {
        await indexedDBStorage.saveTrack(newTrack, file);
        successCount++;
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
        text: `${t('library.import_success', { count: successCount })} Advertencias: ${errors.join(', ')}`,
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

  // Eliminación de pista local
  const handleDeleteTrack = async (track: Track) => {
    try {
      await indexedDBStorage.deleteTrack(track.id);
      setDeleteConfirmTrack(null);
      await refreshLocalTracks();
      setFeedback({
        type: 'success',
        text: `Pista "${track.title}" eliminada de la biblioteca local.`,
      });
    } catch (err) {
      console.error('[Library] Error al eliminar pista:', err);
      setFeedback({
        type: 'error',
        text: `Error al eliminar la pista: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  // Preparación para Deck A (acción visual hacia Etapa 4)
  const handlePrepareDeckA = (trackTitle: string) => {
    setPreparedDeckATrack(trackTitle);
    setFeedback({
      type: 'success',
      text: `"${trackTitle}" seleccionada y preparada para Deck A.`,
    });
  };

  // Construcción unificada de filas (Demo + Local)
  const unifiedTracks: UnifiedRowTrack[] = [
    // Pistas locales importadas
    ...localTracks.map((lt): UnifiedRowTrack => ({
      id: lt.id,
      title: lt.title,
      artist: lt.artist || t('dj.unknown_artist'),
      album: lt.fileMeta?.fileName || '-',
      bpm: lt.analysis.bpm,
      key: lt.analysis.key,
      energy: lt.analysis.energy,
      durationFormatted: lt.durationFormatted,
      type: lt.type,
      isLocal: true,
      fileSizeFormatted: lt.fileMeta?.fileSize ? formatBytes(lt.fileMeta.fileSize) : undefined,
      dateAddedFormatted: lt.dateAdded ? formatDate(lt.dateAdded) : undefined,
      rawLocalTrack: lt,
    })),
    // Pistas mock de demostración
    ...MOCK_LIBRARY.map((mt): UnifiedRowTrack => ({
      id: `demo_${mt.id}`,
      title: mt.title,
      artist: mt.artist,
      album: mt.album,
      bpm: mt.bpm,
      key: mt.key,
      energy: mt.energy,
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
              <th>{t('library.col_duration')}</th>
              <th className="col-actions"></th>
            </tr>
          </thead>
          <tbody>
            {filteredTracks.map((track) => {
              const isSelected = selectedTracks.has(track.id);
              const isPrepared = preparedDeckATrack === track.title;

              return (
                <tr key={track.id} className={clsx(isSelected && 'selected', isPrepared && 'prepared')}>
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
                      {isPrepared && (
                        <span className="deck-prepared-tag" title={t('library.load_deck_a')}>
                          <Disc size={13} /> Deck A
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
                    {track.bpm !== undefined ? (
                      track.bpm
                    ) : (
                      <span className="text-muted">--</span>
                    )}
                  </td>
                  <td>
                    {track.key ? (
                      <Badge variant="outline">{track.key}</Badge>
                    ) : (
                      <span className="text-muted">--</span>
                    )}
                  </td>
                  <td>
                    {track.energy !== undefined ? (
                      <div className="energy-bar-container">
                        <div className="energy-bar">
                          <div 
                            className="energy-bar-fill" 
                            style={{ width: `${track.energy * 10}%` }}
                          ></div>
                        </div>
                        <span className="energy-bar-value">{track.energy}</span>
                      </div>
                    ) : (
                      <span className="text-muted">--</span>
                    )}
                  </td>
                  <td className="track-duration">{track.durationFormatted}</td>
                  <td className="col-actions">
                    <div className="track-actions-container">
                      <IconButton 
                        icon={<Disc size={16} />} 
                        size="sm" 
                        title={t('library.load_deck_a')}
                        onClick={() => handlePrepareDeckA(track.title)}
                      />
                      {track.isLocal && track.rawLocalTrack && (
                        <IconButton 
                          icon={<Trash2 size={16} />} 
                          size="sm" 
                          variant="ghost"
                          title={t('library.delete_track')}
                          onClick={() => setDeleteConfirmTrack(track.rawLocalTrack || null)}
                        />
                      )}
                      {!track.isLocal && (
                        <IconButton icon={<MoreHorizontal size={16} />} size="sm" />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}

            {filteredTracks.length === 0 && (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
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
                {t('common.cancel', 'Cancelar')}
              </Button>
              <Button variant="primary" onClick={() => handleDeleteTrack(deleteConfirmTrack)}>
                <Trash2 size={16} />
                {t('common.delete', 'Eliminar')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
