import React from 'react';
import { useTranslation } from 'react-i18next';
import { Play } from 'lucide-react';
import { Card, CardBody } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { IconButton } from '../components/ui/IconButton';
import { MOCK_RECENT_TRACKS, MOCK_STATS } from '../mock/dashboard';
import { SmartRecommendationCard } from '../components/dashboard/SmartRecommendationCard';
import './Dashboard.css';

export const Dashboard: React.FC = () => {
  const { t } = useTranslation();

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
        
        {/* Recent Tracks */}
        <Card elevated>
          <CardBody>
            <div className="dashboard-section-header">
              <h3 className="dashboard-section-title">{t('dashboard.recent')}</h3>
              <span className="dashboard-view-all">
                {t('common.view_all')}
              </span>
            </div>
            <div className="dashboard-track-list">
              {MOCK_RECENT_TRACKS.map(track => (
                <div key={track.id} className="track-item">
                  <div className="track-info">
                    <div className="track-cover-mini"></div>
                    <div>
                      <div className="track-title">{track.title}</div>
                      <div className="track-meta">
                        <span>{track.artist}</span>
                        <span>•</span>
                        <span>{track.bpm} BPM</span>
                        <span>•</span>
                        <span>{track.key}</span>
                      </div>
                    </div>
                  </div>
                  <IconButton icon={<Play size={16} />} size="sm" variant="ghost" />
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        {/* Stats & Smart Recommendations */}
        <div className="dashboard-stats-col">
          
          <Card>
            <CardBody className="dashboard-stats-card">
              <div className="stat-card">
                <span className="stat-value">{MOCK_STATS.tracksPlayed}</span>
                <span className="stat-label">{t('dashboard.tracks_played')}</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">{MOCK_STATS.hoursMixed}h</span>
                <span className="stat-label">{t('dashboard.hours_mixed')}</span>
              </div>
            </CardBody>
          </Card>

          <SmartRecommendationCard />

        </div>
      </div>
    </div>
  );
};
