import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Play, Music, FolderPlus } from 'lucide-react';
import { Card, CardBody } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { IconButton } from '../components/ui/IconButton';
import { StateView } from '../components/ui/StateView';
import { SmartRecommendationCard } from '../components/dashboard/SmartRecommendationCard';
import { indexedDBStorage } from '../services/storage/IndexedDBStorage';
import { importFilesToLocalLibrary } from '../services/localLibraryImport';
import { analysisSyncManager } from '../services/analysis';
import { useDJStore } from '../store/useDJStore';
import { computeLibraryStats, getRecentlyAddedTracks } from '../utils/libraryStats';
import type { Track } from '../types/track';
import './Dashboard.css';

const RECENT_TRACKS_LIMIT = 4;

export const Dashboard: React.FC = () => {
  const { t } = useTranslation();
  const { loadTrackToDeckA } = useDJStore();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [localTracks, setLocalTracks] = useState<Track[]>([]);
  const [isImporting, setIsImporting] = useState(false);

  // Carga desde IndexedDB y suscripción a resultados de análisis para mantener las métricas al día
  useEffect(() => {
    let isMounted = true;
    indexedDBStorage
      .getAllTracks()
      .then((stored) => {
        if (isMounted) setLocalTracks(stored);
      })
      .catch((err) => {
        console.error('[Dashboard] Error al cargar pistas locales:', err);
      });

    const unsubscribe = analysisSyncManager.subscribe((trackId, analysis) => {
      if (!isMounted) return;
      setLocalTracks((prev) => prev.map((tr) => (tr.id === trackId ? { ...tr, analysis } : tr)));
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  // Acción rápida: importación local desde el Dashboard; el resultado llega a la campana
  const handleImportFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setIsImporting(true);
    try {
      await importFilesToLocalLibrary(
        Array.from(fileList),
        (name) => t('library.duplicate_warning', { name }),
      );
      setLocalTracks(await indexedDBStorage.getAllTracks());
    } catch (err) {
      console.error('[Dashboard] Error al importar pistas:', err);
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [t]);

  const stats = useMemo(() => computeLibraryStats(localTracks), [localTracks]);
  const recentTracks = useMemo(() => getRecentlyAddedTracks(localTracks, RECENT_TRACKS_LIMIT), [localTracks]);

  return (
    <div className="dashboard-container">
      <input
        type="file"
        ref={fileInputRef}
        multiple
        accept=".mp3,.wav,audio/mpeg,audio/wav,audio/mp3"
        style={{ display: 'none' }}
        onChange={(e) => handleImportFiles(e.target.files)}
      />

      {/* Header Area */}
      <div className="dashboard-header">
        <div>
          <h2 className="dashboard-title">{t('dashboard.welcome')}</h2>
          <p className="dashboard-subtitle">
            DJ_System v1.0
          </p>
        </div>
        <div className="dashboard-actions">
          <Button variant="outline" onClick={() => navigate('/mixer')}>{t('common.mix')}</Button>
          <Button
            variant="primary"
            disabled={isImporting}
            title={t('library.import_btn')}
            onClick={() => fileInputRef.current?.click()}
          >
            <FolderPlus size={18} />
            {isImporting ? t('library.importing') : t('dashboard.quick_actions')}
          </Button>
        </div>
      </div>

      {/* Grid Content */}
      <div className="dashboard-grid">

        {/* Recently added local tracks */}
        <Card elevated>
          <CardBody>
            <div className="dashboard-section-header">
              <h3 className="dashboard-section-title">{t('dashboard.recent')}</h3>
            </div>
            {recentTracks.length === 0 ? (
              <StateView
                status="empty"
                icon={Music}
                title={t('dashboard.recent_empty_title')}
                description={t('dashboard.recent_empty_desc')}
              />
            ) : (
              <div className="dashboard-track-list">
                {recentTracks.map(track => {
                  const isAnalyzed = track.analysis?.status === 'analyzed';
                  return (
                    <div key={track.id} className="track-item">
                      <div className="track-info">
                        <div className="track-cover-mini"></div>
                        <div>
                          <div className="track-title">{track.title}</div>
                          <div className="track-meta">
                            <span>{track.artist || t('dj.unknown_artist')}</span>
                            {isAnalyzed && track.analysis.bpm ? (
                              <>
                                <span>•</span>
                                <span>{Math.round(track.analysis.bpm)} BPM</span>
                              </>
                            ) : null}
                            {isAnalyzed && track.analysis.key ? (
                              <>
                                <span>•</span>
                                <span>{track.analysis.key}</span>
                              </>
                            ) : null}
                            <span>•</span>
                            <span>{track.durationFormatted}</span>
                          </div>
                        </div>
                      </div>
                      <IconButton
                        icon={<Play size={16} />}
                        size="sm"
                        variant="ghost"
                        title={t('library.load_deck_a')}
                        aria-label={t('library.load_deck_a')}
                        onClick={() => void loadTrackToDeckA(track)}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Stats & Smart Recommendations */}
        <div className="dashboard-stats-col">

          <Card>
            <CardBody className="dashboard-stats-card">
              <div className="stat-card">
                <span className="stat-value">{stats.totalTracks}</span>
                <span className="stat-label">{t('dashboard.library_tracks')}</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">{stats.analyzedTracks}</span>
                <span className="stat-label">{t('dashboard.analyzed_tracks')}</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">{stats.totalHours}h</span>
                <span className="stat-label">{t('dashboard.library_hours')}</span>
              </div>
            </CardBody>
          </Card>

          <SmartRecommendationCard />

        </div>
      </div>
    </div>
  );
};
