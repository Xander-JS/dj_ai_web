import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Music } from 'lucide-react';
import { Card, CardBody } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { IconButton } from '../components/ui/IconButton';
import { StateView } from '../components/ui/StateView';
import { SmartRecommendationCard } from '../components/dashboard/SmartRecommendationCard';
import { indexedDBStorage } from '../services/storage/IndexedDBStorage';
import { analysisSyncManager } from '../services/analysis';
import { useDJStore } from '../store/useDJStore';
import { computeLibraryStats, getRecentlyAddedTracks } from '../utils/libraryStats';
import type { Track } from '../types/track';
import './Dashboard.css';

const RECENT_TRACKS_LIMIT = 4;

export const Dashboard: React.FC = () => {
  const { t } = useTranslation();
  const { loadTrackToDeckA } = useDJStore();
  const [localTracks, setLocalTracks] = useState<Track[]>([]);

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

  const stats = useMemo(() => computeLibraryStats(localTracks), [localTracks]);
  const recentTracks = useMemo(() => getRecentlyAddedTracks(localTracks, RECENT_TRACKS_LIMIT), [localTracks]);

  return (
    <div className="dashboard-container">

      {/* Header Area */}
      <div className="dashboard-header">
        <div>
          <h2 className="dashboard-title">{t('dashboard.welcome')}</h2>
          <p className="dashboard-subtitle">
            DJ_System v1.0
          </p>
        </div>
        <div className="dashboard-actions">
          <Button variant="outline">{t('common.mix')}</Button>
          <Button variant="primary">
            <Play size={18} />
            {t('dashboard.quick_actions')}
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
