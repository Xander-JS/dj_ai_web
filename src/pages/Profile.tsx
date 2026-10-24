import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { Icon } from '../components/atoms/Icon';
import { Panel } from '../components/molecules/Panel';
import { ConsoleTemplate } from '../components/templates/ConsoleTemplate';
import { ProfileForm } from '../components/profile/ProfileForm';
import { ProfilePanel } from '../components/profile/ProfilePanel';
import { useAuth } from '../context/AuthContext';
import { indexedDBStorage } from '../services/storage/IndexedDBStorage';
import { computeLibraryStats } from '../utils/libraryStats';
import './Profile.css';

interface DeviceSummary {
  tracks: number;
  hours: number;
  playlists: number;
  sessions: number;
}

/** Recuento real de lo que este navegador guarda en IndexedDB; null mientras carga o si falla */
function useDeviceSummary(): { summary: DeviceSummary | null; failed: boolean } {
  const [summary, setSummary] = useState<DeviceSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      indexedDBStorage.getAllTracks(),
      indexedDBStorage.getAllPlaylists(),
      indexedDBStorage.getRecordedSessions(),
    ])
      .then(([tracks, playlists, sessions]) => {
        if (!active) return;
        const stats = computeLibraryStats(tracks);
        setSummary({ tracks: stats.totalTracks, hours: stats.totalHours, playlists: playlists.length, sessions: sessions.length });
      })
      .catch((error) => {
        console.warn('[Profile] Could not read local data summary:', error);
        if (active) setFailed(true);
      });
    return () => { active = false; };
  }, []);

  return { summary, failed };
}

export const Profile: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { summary, failed } = useDeviceSummary();

  const readouts = [
    { key: 'tracks', label: t('profile.device_tracks'), value: summary?.tracks, to: '/library' },
    { key: 'hours', label: t('profile.device_hours'), value: summary ? `${summary.hours} h` : undefined, to: '/library' },
    { key: 'playlists', label: t('profile.device_playlists'), value: summary?.playlists, to: '/playlists' },
    { key: 'sessions', label: t('profile.sessions'), value: summary?.sessions, to: '/sessions' },
  ];

  return (
    <ConsoleTemplate className="sd-profile">
      <ProfilePanel />

      <div className="sd-profile__grid">
        {user && (
          <Panel title={t('profile.edit')} description={t('settings.account_desc')} className="sd-profile__edit">
            <ProfileForm />
          </Panel>
        )}

        <Panel
          title={t('profile.device_title')}
          description={failed ? t('profile.device_error') : t('profile.device_desc')}
          className="sd-profile__device"
        >
          <ul className="sd-profile-readouts" aria-busy={summary == null && !failed}>
            {readouts.map((item) => (
              <li key={item.key}>
                <button type="button" className="sd-profile-readout" onClick={() => navigate(item.to)}>
                  <span className="sd-profile-readout__value sd-num">
                    {item.value ?? <span className="sd-profile-readout__placeholder">—</span>}
                  </span>
                  <span className="sd-profile-readout__label">
                    {item.label}
                    <Icon icon={ArrowUpRight} size="sm" className="sd-profile-readout__arrow" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </ConsoleTemplate>
  );
};
