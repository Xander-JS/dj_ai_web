import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Award, Clock, LogIn, UserRound } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card, CardBody } from '../components/ui/Card';
import { StateView } from '../components/ui/StateView';
import { AuthModal } from '../components/auth/AuthModal';
import { ProfilePanel } from '../components/profile/ProfilePanel';
import { useAuth } from '../context/AuthContext';
import { MOCK_PROFILE } from '../mock/profile';
import './Profile.css';

export const Profile: React.FC = () => {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);

  return (
    <div className="profile-container">
      
      {user ? (
        <ProfilePanel />
      ) : (
        <div className="profile-header-card">
          <StateView
            status="empty"
            icon={UserRound}
            title={loading ? t('states.loading') : t('profile.sign_in_required_title')}
            description={t('profile.sign_in_required_desc')}
            action={!loading && (
              <Button onClick={() => setAuthOpen(true)}>
                <LogIn size={16} />
                {t('auth.sign_in')}
              </Button>
            )}
          />
          <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
        </div>
      )}

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
