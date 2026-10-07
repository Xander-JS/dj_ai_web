import React from 'react';
import { useTranslation } from 'react-i18next';
import { Play } from 'lucide-react';
import { Card, CardBody } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { IconButton } from '../components/ui/IconButton';
import { Badge } from '../components/ui/Badge';
import { MOCK_RECENT_TRACKS, MOCK_RECOMMENDATIONS, MOCK_STATS } from '../mock/dashboard';
import './Dashboard.css';

export const Dashboard: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="dashboard-container">
      
      {/* Header Area */}
      <div className="dashboard-header">
        <div>
          <h2 style={{ fontSize: 'var(--text-3xl)', margin: 0 }}>{t('dashboard.welcome')}</h2>
          <p style={{ color: 'var(--text-secondary)', marginTop: 'var(--space-2)' }}>
            DJ_System v1.0
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
              <h3 style={{ margin: 0 }}>{t('dashboard.recent')}</h3>
              <span style={{ color: 'var(--color-primary-500)', fontSize: 'var(--text-sm)', cursor: 'pointer' }}>
                {t('common.view_all')}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {MOCK_RECENT_TRACKS.map(track => (
                <div key={track.id} className="track-item">
                  <div className="track-info">
                    <div style={{ width: '40px', height: '40px', backgroundColor: 'var(--border-strong)', borderRadius: 'var(--radius-sm)' }}></div>
                    <div>
                      <div style={{ fontWeight: 'var(--font-weight-medium)' }}>{track.title}</div>
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

        {/* Stats & Recommendations */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          
          <Card>
            <CardBody style={{ display: 'flex', justifyContent: 'space-around', padding: 'var(--space-6) 0' }}>
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

          <Card elevated>
            <CardBody>
              <h3 style={{ margin: '0 0 var(--space-4) 0' }}>{t('dashboard.recommendations')}</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {MOCK_RECOMMENDATIONS.map(rec => (
                  <div key={rec.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-2) 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <div style={{ width: '48px', height: '48px', backgroundColor: 'var(--border-base)', borderRadius: 'var(--radius-md)' }}></div>
                      <div>
                        <div style={{ fontWeight: 'var(--font-weight-medium)' }}>{rec.title}</div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
                          {rec.tracks} {t('common.tracks', 'pistas')}
                        </div>
                      </div>
                    </div>
                    <Badge variant="outline">{rec.type}</Badge>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>

        </div>
      </div>
    </div>
  );
};
