import React from 'react';
import { useTranslation } from 'react-i18next';
import { CheckSquare, ListPlus, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '../atoms/Button';
import { Icon } from '../atoms/Icon';
import { SelectMenu } from '../molecules/SelectMenu';
import type { Playlist } from '../../types/playlist';
import './LibrarySelectionBar.css';

export interface LibrarySelectionBarProps {
  selectedCount: number;
  /** Pistas de la vista actual (filtro + búsqueda): alcance de «Seleccionar todas» */
  visibleCount: number;
  isFiltered: boolean;
  playlists: Playlist[];
  /** Pistas de la playlist que siguen en la biblioteca (descarta ids huérfanos) */
  countPlaylistTracks: (playlist: Playlist) => number;
  targetPlaylistId: string;
  onTargetPlaylistChange: (id: string) => void;
  onAddToPlaylist: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onReanalyze: () => void;
  onDelete: () => void;
  /** Un borrado en curso bloquea las acciones */
  busy?: boolean;
}

// Barra contextual de la selección: aparece con la primera pista marcada y desaparece al vaciarla.
// Campo inverso, como la barra que sustituye; en pantallas estrechas los grupos bajan de línea.
export const LibrarySelectionBar: React.FC<LibrarySelectionBarProps> = ({
  selectedCount,
  visibleCount,
  isFiltered,
  playlists,
  countPlaylistTracks,
  targetPlaylistId,
  onTargetPlaylistChange,
  onAddToPlaylist,
  onSelectAll,
  onDeselectAll,
  onReanalyze,
  onDelete,
  busy = false,
}) => {
  const { t } = useTranslation();
  const allSelected = selectedCount >= visibleCount;

  return (
    <div className="sd-library-bar sd-field-inverse sd-selection-bar" role="region" aria-label={t('library.bulk.region')}>
      <div className="sd-selection-bar__scope">
        <span className="sd-library-bar__title sd-num" aria-live="polite">
          <Icon icon={CheckSquare} size="md" />
          {t('library.selected_count', { count: selectedCount })}
        </span>
        {isFiltered && <span className="sd-selection-bar__hint">{t('library.bulk.scope_filtered')}</span>}
        <span className="sd-selection-bar__group">
          {!allSelected && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={onSelectAll}>
              {isFiltered
                ? t('library.bulk.select_visible', { count: visibleCount })
                : t('library.bulk.select_all', { count: visibleCount })}
            </Button>
          )}
          <Button variant="ghost" size="sm" disabled={busy} onClick={onDeselectAll}>
            {t('library.bulk.deselect_all')}
          </Button>
        </span>
      </div>

      <div className="sd-selection-bar__actions">
        {playlists.length === 0 ? (
          <span className="sd-selection-bar__hint sd-selection-bar__hint--fill">{t('library.playlist_none_available')}</span>
        ) : (
          <span className="sd-selection-bar__group">
            <SelectMenu
              size="sm"
              label={t('library.playlist_target')}
              placeholder={t('library.playlist_target')}
              value={targetPlaylistId}
              disabled={busy}
              menuMinWidth={256}
              searchPlaceholder={playlists.length > 8 ? t('library.bulk.search_playlists') : undefined}
              noResultsLabel={t('states.empty_title')}
              options={playlists.map((playlist) => ({
                value: playlist.id,
                label: playlist.name,
                description: t('playlists.tracks_count', { count: countPlaylistTracks(playlist) }),
              }))}
              onChange={onTargetPlaylistChange}
              wrapperClassName="sd-selection-bar__playlist"
            />
            <Button variant="accent" size="sm" disabled={!targetPlaylistId || busy} onClick={onAddToPlaylist}>
              <Icon icon={ListPlus} size="sm" />
              {t('library.playlist_add_btn')}
            </Button>
          </span>
        )}
        <span className="sd-selection-bar__group">
          <Button variant="ink" size="sm" disabled={busy} onClick={onReanalyze}>
            <Icon icon={RefreshCw} size="sm" />
            {t('library.bulk.reanalyze')}
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onDelete}>
            <Icon icon={Trash2} size="sm" />
            {t('library.bulk.delete')}
          </Button>
        </span>
      </div>
    </div>
  );
};
