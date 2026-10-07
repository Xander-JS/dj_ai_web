import React from 'react';
import { Play, SkipBack, SkipForward, Volume2 } from 'lucide-react';
import { IconButton } from '../components/ui/IconButton';
import { Progress } from '../components/ui/Progress';
import { Slider } from '../components/ui/Slider';

export const PlayerBar: React.FC = () => {
  return (
    <footer className="layout-player" style={{ justifyContent: 'space-between', gap: 'var(--space-8)' }}>
      {/* Track Info */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flex: 1 }}>
        <div style={{ width: '56px', height: '56px', backgroundColor: 'var(--border-strong)', borderRadius: 'var(--radius-sm)' }}></div>
        <div>
          <div style={{ fontWeight: 'var(--font-weight-semibold)', fontSize: 'var(--text-sm)' }}>Nombre de la Pista</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-xs)' }}>Artista</div>
        </div>
      </div>

      {/* Controls & Progress */}
      <div style={{ flex: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <IconButton icon={<SkipBack size={20} />} />
          <IconButton 
            icon={<Play size={24} />} 
            variant="primary" 
            style={{ 
              width: '40px', height: '40px', 
              borderRadius: 'var(--radius-full)',
              display: 'flex', alignItems: 'center', justifyContent: 'center' 
            }} 
          />
          <IconButton icon={<SkipForward size={20} />} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: 'var(--space-3)' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', width: '35px', textAlign: 'right' }}>0:00</span>
          <Progress value={30} size="sm" style={{ flex: 1 }} />
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', width: '35px' }}>3:45</span>
        </div>
      </div>

      {/* Extra Controls (Volume) */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
        <Volume2 size={20} style={{ color: 'var(--text-secondary)' }} />
        <div style={{ width: '100px' }}>
          <Slider defaultValue={80} />
        </div>
      </div>
    </footer>
  );
};
