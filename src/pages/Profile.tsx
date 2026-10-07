import React from 'react';
import { useTranslation } from 'react-i18next';
import { Edit2, Award, Clock } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card, CardBody } from '../components/ui/Card';
import { MOCK_PROFILE } from '../mock/profile';
import './Profile.css';

export const Profile: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="profile-container">
      
      {/* Header / Main Info */}
      <div className="profile-header-card">
        <div className="profile-avatar-large">
          {/* Fallback initials if no image */}
          {MOCK_PROFILE.name.charAt(0)}
        </div>
        <div className="profile-info">
          <h1 className="profile-name">{MOCK_PROFILE.name}</h1>
          <span className="profile-username">{MOCK_PROFILE.username}</span>
          <p className="profile-bio">{MOCK_PROFILE.bio}</p>
          
          <div className="profile-stats-bar">
            <div className="profile-stat">
              <span className="profile-stat-value">{MOCK_PROFILE.followers}</span>
              <span className="profile-stat-label">{t('profile.followers')}</span>
            </div>
            <div className="profile-stat">
              <span className="profile-stat-value">{MOCK_PROFILE.following}</span>
              <span className="profile-stat-label">{t('profile.following')}</span>
            </div>
            <div className="profile-stat">
              <span className="profile-stat-value">{MOCK_PROFILE.sessions}</span>
              <span className="profile-stat-label">{t('profile.sessions')}</span>
            </div>
          </div>
        </div>
        <div>
          <Button variant="outline">
            <Edit2 size={16} />
            {t('profile.edit')}
          </Button>
        </div>
      </div>

      <div className="profile-content-grid">
        
        {/* Achievements Section */}
        <div className="profile-section">
          <h2 className="profile-section-title">{t('profile.achievements')}</h2>
          <Card>
            <CardBody className="profile-achievements-list">
              {MOCK_PROFILE.achievements.map(ach => (
                <div key={ach.id} className="achievement-item">
                  <div className="achievement-icon">
                    <Award size={24} />
                  </div>
                  <div>
                    <div className="achievement-title">{ach.title}</div>
                    <div className="achievement-desc">{ach.description}</div>
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>

        {/* History Section */}
        <div className="profile-section">
          <h2 className="profile-section-title">{t('profile.history')}</h2>
          <Card>
            <CardBody className="profile-history-list">
              {MOCK_PROFILE.history.map(item => (
                <div key={item.id} className="history-item">
                  <div className="history-bullet"></div>
                  <div className="history-content">
                    <div className="history-action">{item.action}</div>
                    <div className="history-target">{item.target}</div>
                  </div>
                  <div className="history-date">
                    <Clock size={12} />
                    {item.date}
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>

      </div>

    </div>
  );
};
