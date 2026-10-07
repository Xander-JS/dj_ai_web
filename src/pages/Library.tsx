import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Play, MoreHorizontal, CheckSquare, Square } from 'lucide-react';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { IconButton } from '../components/ui/IconButton';
import { Badge } from '../components/ui/Badge';
import { MOCK_LIBRARY, Track } from '../mock/library';
import './Library.css';
import { clsx } from 'clsx';

export const Library: React.FC = () => {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<'all' | 'audio' | 'video'>('all');
  const [selectedTracks, setSelectedTracks] = useState<Set<string>>(new Set());

  const filteredTracks = MOCK_LIBRARY.filter(track => {
    if (filter === 'all') return true;
    return track.type === filter;
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
    <div className="library-container">
      
      <div className="library-header">
        <h2 style={{ fontSize: 'var(--text-3xl)', margin: 0 }}>{t('library.title')}</h2>
        
        <div className="library-toolbar">
          <div style={{ position: 'relative', width: '300px' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '11px', color: 'var(--text-tertiary)' }} />
            <Input placeholder={t('library.search_tracks')} style={{ paddingLeft: '38px' }} />
          </div>
          
          <div className="library-filters">
            <Button 
              variant={filter === 'all' ? 'primary' : 'outline'} 
              size="sm" 
              onClick={() => setFilter('all')}
            >
              {t('library.filter_all')}
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

      <div className="library-table-container">
        <table className="library-table">
          <thead>
            <tr>
              <th className="col-checkbox">
                {/* Simulated select all */}
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
            {filteredTracks.map(track => {
              const isSelected = selectedTracks.has(track.id);
              return (
                <tr key={track.id} className={clsx(isSelected && 'selected')}>
                  <td className="col-checkbox" onClick={() => toggleSelection(track.id)} style={{ cursor: 'pointer' }}>
                    {isSelected ? <CheckSquare size={16} color="var(--color-primary-500)" /> : <Square size={16} color="var(--text-tertiary)" />}
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <span style={{ fontWeight: 'var(--font-weight-medium)' }}>{track.title}</span>
                      {track.type === 'video' && <Badge variant="secondary">V</Badge>}
                    </div>
                  </td>
                  <td>{track.artist}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{track.album}</td>
                  <td>{track.bpm}</td>
                  <td>
                    <Badge variant="outline">{track.key}</Badge>
                  </td>
                  <td>
                    <div className="energy-bar-container">
                      <div className="energy-bar">
                        <div className="energy-bar-fill" style={{ width: `${track.energy * 10}%` }}></div>
                      </div>
                      <span style={{ fontSize: 'var(--text-xs)', width: '15px' }}>{track.energy}</span>
                    </div>
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>{track.duration}</td>
                  <td className="col-actions">
                    <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                      <IconButton icon={<Play size={16} />} size="sm" />
                      <IconButton icon={<MoreHorizontal size={16} />} size="sm" />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

    </div>
  );
};
