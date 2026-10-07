import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Play, MoreHorizontal, ListMusic } from 'lucide-react';
import { IconButton } from '../components/ui/IconButton';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { MOCK_PLAYLISTS, Playlist } from '../mock/playlists';
import { clsx } from 'clsx';
import './Playlists.css';

export const Playlists: React.FC = () => {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<string | null>(MOCK_PLAYLISTS[0].id);

  const activePlaylist = MOCK_PLAYLISTS.find(p => p.id === activeId);

  return (
    <div className="playlists-container">
      
      {/* Sidebar: List of playlists */}
      <div className="playlists-sidebar">
        <div className="playlists-sidebar-header">
          <h3 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>{t('playlists.title')}</h3>
          <IconButton icon={<Plus size={20} />} title={t('playlists.create')} />
        </div>
        
        <div className="playlists-list">
          {MOCK_PLAYLISTS.map(playlist => (
            <div 
              key={playlist.id} 
              className={clsx('playlist-item', activeId === playlist.id && 'active')}
              onClick={() => setActiveId(playlist.id)}
            >
              <div className="playlist-cover-mini" style={{ backgroundColor: playlist.coverColor }}></div>
              <div className="playlist-info-mini">
                <span className="playlist-name-mini">{playlist.name}</span>
                <span className="playlist-count-mini">
                  {t('playlists.tracks_count', { count: playlist.tracks.length })}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Content: Playlist Details */}
      <div className="playlist-detail">
        {activePlaylist ? (
          <>
            <div className="playlist-detail-header">
              <div className="playlist-cover-large" style={{ backgroundColor: activePlaylist.coverColor }}></div>
              <div className="playlist-detail-info">
                <Badge variant="secondary" style={{ width: 'fit-content' }}>Playlist</Badge>
                <h1 className="playlist-detail-title">{activePlaylist.name}</h1>
                <p style={{ color: 'var(--text-secondary)', margin: '0 0 var(--space-2) 0' }}>
                  {activePlaylist.description}
                </p>
                <div className="playlist-detail-meta">
                  <span style={{ fontWeight: 'var(--font-weight-medium)', color: 'var(--text-primary)' }}>DJ_System</span>
                  <span>•</span>
                  <span>{t('playlists.tracks_count', { count: activePlaylist.tracks.length })}</span>
                </div>
                
                <div className="playlist-detail-actions">
                  <Button variant="primary">
                    <Play size={18} />
                    {t('common.play')}
                  </Button>
                  <IconButton icon={<MoreHorizontal size={20} />} variant="outline" />
                </div>
              </div>
            </div>

            {/* Reusing a simplified version of the library table layout */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-6)' }}>
              {activePlaylist.tracks.length > 0 ? (
                <table className="library-table">
                  <thead>
                    <tr>
                      <th style={{ width: '40px' }}>#</th>
                      <th>{t('library.col_title')}</th>
                      <th>{t('library.col_artist')}</th>
                      <th>{t('library.col_bpm')}</th>
                      <th style={{ textAlign: 'right' }}>{t('library.col_duration')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activePlaylist.tracks.map((track, index) => (
                      <tr key={track.id}>
                        <td style={{ color: 'var(--text-tertiary)' }}>{index + 1}</td>
                        <td style={{ fontWeight: 'var(--font-weight-medium)' }}>{track.title}</td>
                        <td style={{ color: 'var(--text-secondary)' }}>{track.artist}</td>
                        <td>{track.bpm}</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{track.duration}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="playlist-empty-state" style={{ height: '200px' }}>
                  <ListMusic size={48} />
                  <p>{t('playlists.empty_desc')}</p>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="playlist-empty-state">
            <ListMusic size={64} />
            <h2>{t('playlists.empty_title')}</h2>
            <p>{t('playlists.empty_desc')}</p>
          </div>
        )}
      </div>

    </div>
  );
};
