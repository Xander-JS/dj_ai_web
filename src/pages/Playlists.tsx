import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Play, MoreHorizontal, ListMusic } from 'lucide-react';
import { IconButton } from '../components/ui/IconButton';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { StateView } from '../components/ui/StateView';
import { MOCK_PLAYLISTS } from '../mock/playlists';
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
          <h3 className="playlists-title">{t('playlists.title')}</h3>
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
                <Badge variant="secondary" className="playlist-badge">Playlist</Badge>
                <h1 className="playlist-detail-title">{activePlaylist.name}</h1>
                <p className="playlist-detail-desc">
                  {activePlaylist.description}
                </p>
                <div className="playlist-detail-meta">
                  <span className="playlist-detail-author">DJ_System</span>
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
            <div className="playlist-tracks-container">
              {activePlaylist.tracks.length > 0 ? (
                <table className="library-table">
                  <thead>
                    <tr>
                      <th className="col-index">#</th>
                      <th>{t('library.col_title')}</th>
                      <th>{t('library.col_artist')}</th>
                      <th>{t('library.col_bpm')}</th>
                      <th className="col-duration">{t('library.col_duration')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activePlaylist.tracks.map((track, index) => (
                      <tr key={track.id}>
                        <td className="track-index">{index + 1}</td>
                        <td className="track-title">{track.title}</td>
                        <td className="track-artist">{track.artist}</td>
                        <td>{track.bpm}</td>
                        <td className="track-duration">{track.duration}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <StateView 
                  status="empty" 
                  icon={ListMusic} 
                  title={t('playlists.empty_title')}
                  description={t('playlists.empty_desc')} 
                />
              )}
            </div>
          </>
        ) : (
          <StateView 
            status="empty" 
            icon={ListMusic} 
            title={t('playlists.empty_title')}
            description={t('playlists.empty_desc')} 
          />
        )}
      </div>

    </div>
  );
};
