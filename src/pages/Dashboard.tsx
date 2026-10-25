import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Clock, FolderPlus, Music, Pause, Play } from 'lucide-react';
import { Button } from '../components/atoms/Button';
import { IconButton } from '../components/atoms/IconButton';
import { Icon } from '../components/atoms/Icon';
import { Tag } from '../components/atoms/Tag';
import { EmptyState } from '../components/molecules/EmptyState';
import { Panel } from '../components/molecules/Panel';
import { ConsoleTemplate } from '../components/templates/ConsoleTemplate';
import { useSmoothScroll } from '../design-system/smoothScroll';
import { VINYL_IMAGE } from '../components/organisms/landingAssets';
import { SmartRecommendationCard } from '../components/dashboard/SmartRecommendationCard';
import { resolveReferenceDeck, type ReferenceDeck } from '../components/dashboard/referenceDeck';
import { indexedDBStorage } from '../services/storage/IndexedDBStorage';
import { importFilesToLocalLibrary, notifyDuplicateImports } from '../services/localLibraryImport';
import { analysisSyncManager } from '../services/analysis';
import { toastStore } from '../services/notifications/toastService';
import { useDJStore } from '../store/useDJStore';
import { computeLibraryStats, getRecentlyAddedTracks } from '../utils/libraryStats';
import type { Track } from '../types/track';
import './Dashboard.css';

const RECENT_TRACKS_LIMIT = 4;

export const Dashboard: React.FC = () => {
  const { t } = useTranslation();
  const { deckA, deckB, loadTrackToDeck, playDeck, togglePlayDeck } = useDJStore();
  const navigate = useNavigate();
  // Deck elegido en «Recomendaciones de mezcla»; el clic en una pista reciente carga en él
  const [selectedDeck, setSelectedDeck] = useState<ReferenceDeck | null>(null);
  const targetDeck = resolveReferenceDeck(selectedDeck, Boolean(deckA.track), Boolean(deckB.track));
  const targetDeckState = targetDeck === 'A' ? deckA : deckB;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [localTracks, setLocalTracks] = useState<Track[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const bandTitleId = useId();
  const smoothScrollRef = useSmoothScroll<HTMLDivElement>();

  // Carga desde IndexedDB y suscripción a resultados de análisis para mantener las métricas al día
  useEffect(() => {
    let isMounted = true;
    indexedDBStorage
      .getAllTracks()
      .then((stored) => {
        if (isMounted) setLocalTracks(stored);
      })
      .catch((err) => {
        console.error('[Dashboard] Error al cargar pistas locales:', err);
      });

    const unsubscribe = analysisSyncManager.subscribe((trackId, analysis) => {
      if (!isMounted) return;
      setLocalTracks((prev) => prev.map((tr) => (tr.id === trackId ? { ...tr, analysis } : tr)));
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  // Acción rápida: importación local desde el Dashboard; el resultado llega a la campana
  const handleImportFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setIsImporting(true);
    try {
      const { duplicates } = await importFilesToLocalLibrary(
        Array.from(fileList),
        (name) => t('library.duplicate_warning', { name }),
      );
      notifyDuplicateImports(duplicates, (count) => t('library.toast.duplicates', { count }));
      setLocalTracks(await indexedDBStorage.getAllTracks());
    } catch (err) {
      console.error('[Dashboard] Error al importar pistas:', err);
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [t]);

  const stats = useMemo(() => computeLibraryStats(localTracks), [localTracks]);
  const recentTracks = useMemo(() => getRecentlyAddedTracks(localTracks, RECENT_TRACKS_LIMIT), [localTracks]);

  const handleLoadRecent = async (track: Track, deck: ReferenceDeck = targetDeck): Promise<boolean> => {
    const loaded = await loadTrackToDeck(deck, track);
    const params = { title: track.title, deck: `Deck ${deck}` };
    // Confirmación discreta en la esquina: no desplaza la lista de recientes
    if (loaded) toastStore.show('success', t('library.load_success', params));
    else toastStore.show('error', t('library.load_error', params));
    return loaded;
  };

  // Play en la lista: carga en el deck elegido en Recomendaciones y lo reproduce cuando la carga
  // termina; si la pista ya está en ese deck, Play/Pausa sin recargarla ni reiniciarla
  const handlePlayRecent = async (track: Track) => {
    const deck = targetDeck;
    if (targetDeckState.track?.id === track.id) {
      await togglePlayDeck(deck);
      return;
    }
    if (await handleLoadRecent(track, deck)) await playDeck(deck);
  };

  const readouts = [
    { value: String(stats.totalTracks), label: t('dashboard.library_tracks') },
    { value: String(stats.analyzedTracks), label: t('dashboard.analyzed_tracks') },
    { value: `${stats.totalHours} h`, label: t('dashboard.library_hours') },
  ];

  return (
    <ConsoleTemplate ref={smoothScrollRef} className="sd-home sd-scroll-area">
      <input
        type="file"
        ref={fileInputRef}
        multiple
        accept=".mp3,.wav,audio/mpeg,audio/wav,audio/mp3"
        hidden
        onChange={(e) => handleImportFiles(e.target.files)}
      />

      {/* Cabina: qué es esta pantalla, las dos acciones principales y el estado de la biblioteca */}
      <section className="sd-home-band sd-field-sage" aria-labelledby={bandTitleId}>
        <picture className="sd-home-band__visual" aria-hidden="true">
          <source srcSet={VINYL_IMAGE.webp} type="image/webp" />
          <img src={VINYL_IMAGE.src} width={VINYL_IMAGE.width} height={VINYL_IMAGE.height} alt="" loading="lazy" decoding="async" />
        </picture>

        <div className="sd-home-band__copy">
          <h2 id={bandTitleId} className="sd-home-band__title">{t('dashboard.title')}</h2>
          <p className="sd-home-band__subtitle">{t('dashboard.subtitle')}</p>
          <div className="sd-home-band__actions">
            <Button variant="accent" size="lg" onClick={() => navigate('/mixer')}>
              {t('common.mix')}
              <Icon icon={ArrowRight} size="md" />
            </Button>
            <Button
              variant="ghost"
              size="lg"
              disabled={isImporting}
              aria-busy={isImporting}
              onClick={() => fileInputRef.current?.click()}
            >
              <Icon icon={FolderPlus} size="md" />
              {isImporting ? t('library.importing') : t('library.import_btn')}
            </Button>
          </div>
        </div>

        <dl className="sd-home-band__readouts">
          {readouts.map((item) => (
            <div key={item.label} className="sd-home-readout">
              <dt className="sd-home-readout__label">{item.label}</dt>
              <dd className="sd-home-readout__value sd-num">{item.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="sd-home-grid">
        {/* Pistas añadidas recientemente a la biblioteca local */}
        <Panel
          title={t('dashboard.recent')}
          icon={Clock}
          className="sd-home-recent"
          description={recentTracks.length > 0 ? t('dashboard.recent_target', { deck: targetDeck }) : undefined}
        >
          {recentTracks.length === 0 ? (
            <EmptyState
              icon={Music}
              title={t('dashboard.recent_empty_title')}
              description={t('dashboard.recent_empty_desc')}
            />
          ) : (
            <ul className="sd-track-list">
              {recentTracks.map((track) => {
                const isAnalyzed = track.analysis?.status === 'analyzed';
                const artist = track.artist || t('dj.unknown_artist');
                const isPreviewing = targetDeckState.track?.id === track.id && targetDeckState.playbackState === 'playing';
                return (
                  <li key={track.id} className="sd-track-row sd-track-row--interactive">
                    {/* Botón principal: su área se extiende a toda la fila; Play queda por encima */}
                    <button
                      type="button"
                      className="sd-track-row__load"
                      aria-label={t('dashboard.recent_load_aria', { title: track.title, artist, deck: targetDeck })}
                      title={t('dashboard.recent_load_hint', { deck: targetDeck })}
                      onClick={() => {
                        // Ya asignada a ese deck: no se recarga, así el clic nunca detiene ni reinicia la reproducción
                        if (targetDeckState.track?.id !== track.id) void handleLoadRecent(track);
                      }}
                    >
                      <span className="sd-track-row__info">
                        <span className="sd-track-row__title">{track.title}</span>
                        <span className="sd-track-row__artist">{artist}</span>
                      </span>
                    </button>
                    {/* Huecos fijos para BPM, tonalidad y duración: alineados entre filas aunque falte un dato */}
                    <div className="sd-track-row__meta">
                      <span className="sd-track-row__slot sd-track-row__slot--bpm">
                        {isAnalyzed && track.analysis.bpm ? (
                          <Tag tone="paper" className="sd-num">{Math.round(track.analysis.bpm)} BPM</Tag>
                        ) : null}
                      </span>
                      <span className="sd-track-row__slot sd-track-row__slot--key">
                        {isAnalyzed && track.analysis.key ? (
                          <Tag tone="paper">{track.analysis.key}</Tag>
                        ) : null}
                      </span>
                      <span className="sd-track-row__duration sd-num">{track.durationFormatted}</span>
                    </div>
                    <IconButton
                      icon={<Icon icon={isPreviewing ? Pause : Play} size="sm" />}
                      label={t(isPreviewing ? 'dashboard.recent_pause_aria' : 'dashboard.recent_play_aria', { title: track.title })}
                      aria-pressed={isPreviewing}
                      size="sm"
                      variant="ink"
                      className="sd-track-row__play"
                      onClick={() => void handlePlayRecent(track)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <SmartRecommendationCard selectedDeck={selectedDeck} onSelectedDeckChange={setSelectedDeck} />
      </div>
    </ConsoleTemplate>
  );
};
