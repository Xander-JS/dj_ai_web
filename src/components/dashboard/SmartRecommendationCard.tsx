/**
 * SYSTEM DJ — Smart Track Recommendation Card Component
 * Integra Gemini AI con el estado de decks y la biblioteca de audio.
 */

import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import {
  SlidersVertical,
  Disc,
  Loader2,
  Check,
  Zap,
  AlertTriangle,
  Minus,
  Activity,
  Music2,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '../atoms/Button';
import { Icon } from '../atoms/Icon';
import { IconButton } from '../atoms/IconButton';
import { Tag } from '../atoms/Tag';
import { EmptyState } from '../molecules/EmptyState';
import { Panel } from '../molecules/Panel';
import { DURATION, EASE_OUT } from '../../design-system/motion';
import { useAnimationsEnabled } from '../../design-system/motionPreference';
import { useDJStore } from '../../store/useDJStore';
import { recommendationStore, useRecommendationStore } from '../../store/useRecommendationStore';
import { indexedDBStorage } from '../../services/storage/IndexedDBStorage';
import { LatestRequest } from '../../services/ai/LatestRequest';
import { notificationCenter } from '../../services/notifications/notificationCenter';
import {
  getTrackRecommendations,
  getTrackRecommendationExplanations,
  applyRecommendationExplanations,
  extractCandidateMetadata,
} from '../../services/ai';
import type { Track } from '../../types/track';
import { resolveReferenceDeck, type ReferenceDeck } from './referenceDeck';
import './SmartRecommendationCard.css';

type FactTone = 'ok' | 'alert' | 'unknown' | 'neutral';
type ScoreTier = 'high' | 'medium' | 'low' | 'none';

// Icono de estado de cada dato: el color nunca es la única señal
const FACT_STATE_ICON: Partial<Record<FactTone, LucideIcon>> = {
  ok: Check,
  alert: AlertTriangle,
  unknown: Minus,
};

const factTone = (compatible: boolean | null | undefined): FactTone =>
  compatible === true ? 'ok' : compatible === false ? 'alert' : 'unknown';

// Mismos umbrales que ya marcaban la compatibilidad (80 / 50)
const scoreTier = (score: number | null): ScoreTier =>
  score === null ? 'none' : score >= 80 ? 'high' : score >= 50 ? 'medium' : 'low';

const ENERGY_SEGMENTS = 10;

/** Desplazamiento lateral de la tarjeta al pasar a la recomendación siguiente o anterior. */
const CARD_SHIFT_PX = 24;

// Entra por el lado hacia el que se avanza y sale por el contrario; la saliente se retira antes
// para que las dos tarjetas apenas coincidan mientras se cruzan
const cardVariants = (exitDuration: number) => ({
  enter: (direction: number) => ({ opacity: 0, x: direction * CARD_SHIFT_PX }),
  center: { opacity: 1, x: 0 },
  exit: (direction: number) => ({
    opacity: 0,
    x: direction * -CARD_SHIFT_PX,
    transition: { duration: exitDuration, ease: EASE_OUT },
  }),
});
const CARD_VARIANTS = cardVariants(DURATION.fast);
const CARD_VARIANTS_STATIC = cardVariants(0);

interface RecommendationFactProps {
  tone: FactTone;
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  children?: React.ReactNode;
}

// Lectura de un dato musical: etiqueta, valor grande y qué significa para la mezcla
const RecommendationFact: React.FC<RecommendationFactProps> = ({ tone, icon, label, value, detail, children }) => {
  const stateIcon = FACT_STATE_ICON[tone];
  return (
    <div className={clsx('smart-rec-fact', `smart-rec-fact--${tone}`, tone === 'ok' && 'sd-field-sage', tone === 'alert' && 'sd-field-acid')}>
      <dt className="smart-rec-fact__label">
        <Icon icon={icon} size="xs" />
        {label}
        {stateIcon && (
          <span className="smart-rec-fact__state">
            <Icon icon={stateIcon} size="xs" />
          </span>
        )}
      </dt>
      <dd className="smart-rec-fact__value sd-num">{value}</dd>
      {children}
      {detail && <dd className="smart-rec-fact__detail">{detail}</dd>}
    </div>
  );
};

// Alto que sigue a su contenido con una transición, en vez de saltar al generar recomendaciones
const AnimatedHeight: React.FC<{ duration: number; children: React.ReactNode }> = ({ duration, children }) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | 'auto'>('auto');

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setHeight(content.offsetHeight));
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div className="smart-rec-height" initial={false} animate={{ height }} transition={{ duration, ease: EASE_OUT }}>
      <div ref={contentRef}>{children}</div>
    </motion.div>
  );
};

export interface SmartRecommendationCardProps {
  /** Elección explícita del deck (controlada por Home, que la comparte con «Añadidas recientemente»). */
  selectedDeck?: ReferenceDeck | null;
  onSelectedDeckChange?: (deck: ReferenceDeck) => void;
}

export const SmartRecommendationCard: React.FC<SmartRecommendationCardProps> = ({
  selectedDeck: controlledDeck,
  onSelectedDeckChange,
}) => {
  const { t } = useTranslation();
  const { deckA, deckB } = useDJStore();

  const [uncontrolledDeck, setUncontrolledDeck] = useState<ReferenceDeck | null>(null);
  const selectedDeck = controlledDeck !== undefined ? controlledDeck : uncontrolledDeck;
  const [localTracks, setLocalTracks] = useState<Track[] | null>(null);
  // El resultado vive en recommendationStore: sobrevive al cambiar de sección y no se recalcula solo
  const recommendationResult = useRecommendationStore();
  const [activeRequest, setActiveRequest] = useState<{ id: number; referenceTrack: Track; availableTracks: Track[] } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const recommendationRequest = useRef(new LatestRequest());
  const animationsEnabled = useAnimationsEnabled();
  // Recomendación visible: una tarjeta a la vez entre las ya calculadas (no pide otras)
  const [page, setPage] = useState<{ key: string; index: number; direction: 1 | -1 }>({ key: '', index: 0, direction: 1 });

  const invalidateRecommendationRequest = useCallback(() => {
    recommendationRequest.current.invalidate();
  }, []);

  // Carga de pistas locales desde IndexedDB
  useEffect(() => {
    let isMounted = true;
    indexedDBStorage
      .getAllTracks()
      .then((stored) => {
        if (isMounted) setLocalTracks(stored);
      })
      .catch((err) => {
        console.warn('[SmartRecommendationCard] No se pudieron cargar pistas locales:', err);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // Solo las pistas locales tienen un recurso de audio que el deck puede cargar.
  const availableTracks = useMemo<Track[]>(() => {
    const validLocalTracks = (localTracks ?? []).filter((t) => Boolean(t && typeof t.id === 'string' && t.id.trim()));
    return validLocalTracks;
  }, [localTracks]);

  // Selección derivada de deck activo: preferencia explícita o deck con pista cargada
  const activeDeck = resolveReferenceDeck(selectedDeck, Boolean(deckA.track), Boolean(deckB.track));
  const setActiveDeck = (deck: ReferenceDeck) => {
    recommendationRequest.current.invalidate();
    setActiveRequest(null);
    if (controlledDeck === undefined) setUncontrolledDeck(deck);
    onSelectedDeckChange?.(deck);
  };

  // Pista de referencia activa según el deck seleccionado
  const referenceTrack = useMemo<Track | null>(() => {
    if (activeDeck === 'A') {
      return deckA.track || null;
    }
    return deckB.track || null;
  }, [activeDeck, deckA.track, deckB.track]);

  // El resultado guardado vale para la misma pista de referencia mientras todas las pistas
  // recomendadas sigan en la biblioteca (al volver a Inicio, antes de leerla, se da por válido)
  const resultIsCurrent = (result: typeof recommendationResult, track: Track | null | undefined) =>
    Boolean(track) &&
    result !== null &&
    result.referenceTrackId === track?.id &&
    (localTracks === null || result.recommendations.every((rec) => availableTracks.some((tr) => tr.id === rec.trackId)));
  const currentResult = resultIsCurrent(recommendationResult, referenceTrack) ? recommendationResult : null;
  const recommendations = currentResult?.recommendations ?? [];
  const insufficientCandidateCount = currentResult?.insufficientCandidateCount ?? 0;
  const isMockResult = currentResult?.isMock ?? false;
  const modelUsed = currentResult?.model ?? null;
  const explanationsUnavailable = currentResult?.explanationsUnavailable ?? false;
  const isLoading = activeRequest?.referenceTrack === referenceTrack &&
    activeRequest.availableTracks === availableTracks;
  // Un único estado visible en el hueco de resultados: el cálculo local termina antes que las
  // explicaciones, y desde ese momento las recomendaciones sustituyen a la carga
  const isCalculating = isLoading && recommendations.length === 0;

  // La posición se reinicia con cada lista nueva; las explicaciones tardías no la mueven
  const recommendationsKey = recommendations.map((rec) => rec.trackId).join('|');
  const pageIndex = page.key === recommendationsKey ? Math.min(page.index, Math.max(0, recommendations.length - 1)) : 0;
  const goToRecommendation = (direction: 1 | -1) => {
    const index = pageIndex + direction;
    if (index < 0 || index >= recommendations.length) return;
    setPage({ key: recommendationsKey, index, direction });
  };
  const slideDirection = page.key === recommendationsKey ? page.direction : 1;
  const motionTransition = { duration: animationsEnabled ? DURATION.base : 0, ease: EASE_OUT };

  // Cambiar de deck no anima si no cambiaría nada: ambos vacíos, o la misma pista sin recomendaciones calculadas
  const hasRecommendationsFor = (track: Track | null | undefined) =>
    resultIsCurrent(recommendationResult, track) && (recommendationResult?.recommendations.length ?? 0) > 0;
  const isSameDeckTrack = Boolean(deckA.track && deckB.track && deckA.track.id === deckB.track.id);
  const skipDeckAnimation =
    (!deckA.track && !deckB.track) ||
    (isSameDeckTrack && !hasRecommendationsFor(deckA.track) && !hasRecommendationsFor(deckB.track));
  const deckTransition = skipDeckAnimation ? { ...motionTransition, duration: 0 } : motionTransition;

  useLayoutEffect(() => {
    invalidateRecommendationRequest();
    const requestGate = recommendationRequest.current;
    return () => requestGate.invalidate();
  }, [referenceTrack, availableTracks, invalidateRecommendationRequest]);

  // Función para solicitar recomendaciones a Gemini
  const handleFetchRecommendations = useCallback(
    async () => {
      if (!referenceTrack) return;
      if (
        referenceTrack.analysis?.status !== 'analyzed' ||
        typeof referenceTrack.analysis.bpm !== 'number' ||
        !(referenceTrack.analysis.camelot || referenceTrack.analysis.key)
      ) {
        recommendationStore.set(null);
        setErrorMsg('dashboard.reference_analysis_required');
        notificationCenter.push({ type: 'error', messageKey: 'dashboard.reference_analysis_required' });
        return;
      }

      const request = recommendationRequest.current.begin();
      const isCurrentRequest = () => recommendationRequest.current.isCurrent(request.id);
      setActiveRequest({ id: request.id, referenceTrack, availableTracks });
      setErrorMsg(null);
      // Durante el cálculo solo se ve la carga, no la lista anterior debajo
      recommendationStore.set(null);

      let localResultsReady = false;
      try {
        const response = await getTrackRecommendations(referenceTrack, availableTracks, {
          signal: request.signal,
        });

        if (!isCurrentRequest()) return;

        if (response.success) {
          const localRecommendations = response.recommendations;
          localResultsReady = true;
          // Publish local decisions immediately; Gemini can only enrich text.
          recommendationStore.set({
            referenceTrackId: referenceTrack.id,
            recommendations: localRecommendations,
            insufficientCandidateCount: response.insufficientCandidateCount ?? 0,
            isMock: response.isMock,
            model: response.model || null,
            explanationsUnavailable: false,
          });
          if (response.warning && response.recommendations.length === 0) {
            notificationCenter.push({ type: 'error', messageKey: 'dashboard.no_candidates' });
          }

          if (localRecommendations.length > 0) {
            const explanationResponse = await getTrackRecommendationExplanations(
              extractCandidateMetadata(referenceTrack),
              localRecommendations,
              { signal: request.signal }
            );
            if (!isCurrentRequest()) return;

            if (explanationResponse.success) {
              recommendationStore.update({
                recommendations: applyRecommendationExplanations(localRecommendations, explanationResponse.explanations),
                explanationsUnavailable: Boolean(explanationResponse.warning),
              });
            } else if (explanationResponse.errorCode !== 'cancelled') {
              recommendationStore.update({ explanationsUnavailable: true });
            }
          }
        } else {
          let userMessage = response.error || 'dashboard.error_title';
          if (response.errorCode === 'quota_exceeded') {
            userMessage = 'dashboard.error_quota_exceeded';
          } else if (response.errorCode === 'auth_error') {
            userMessage = 'dashboard.error_auth';
          } else if (response.errorCode === 'network_error') {
            userMessage = 'dashboard.error_network';
          } else if (response.errorCode === 'timeout') {
            userMessage = 'dashboard.error_timeout';
          }

          setErrorMsg(userMessage);
          notificationCenter.push({ type: 'error', messageKey: userMessage });
        }
      } catch (err: unknown) {
        if (!isCurrentRequest()) return;
        if (localResultsReady) {
          recommendationStore.update({ explanationsUnavailable: true });
        } else {
          const error = err as { name?: string };
          const messageKey = error?.name === 'AbortError' ? 'dashboard.error_timeout' : 'dashboard.error_server';
          setErrorMsg(messageKey);
          notificationCenter.push({ type: 'error', messageKey });
        }
      } finally {
        if (isCurrentRequest()) {
          setActiveRequest(null);
          recommendationRequest.current.finish(request.id);
        }
      }
    },
    [referenceTrack, availableTracks, t]
  );

  // BPM y tonalidad analizados de la pista de cada deck: la referencia se lee sin abrir el Mixer
  const deckMeta = (track: Track | null | undefined): string | null => {
    if (!track || track.analysis?.status !== 'analyzed') return null;
    const parts = [
      typeof track.analysis.bpm === 'number' ? `${Math.round(track.analysis.bpm)} BPM` : null,
      track.analysis.camelot || track.analysis.key || null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : null;
  };

  return (
    <Panel
      className="smart-rec-card"
      bodyClassName="smart-rec-container"
      title={t('dashboard.smart_recommendations_title')}
      description={t('dashboard.smart_recommendations_subtitle')}
      icon={SlidersVertical}
      aside={modelUsed && (
        <Tag tone={isMockResult ? 'paper' : 'ink'}>
          {isMockResult ? t('dashboard.badge_mock') : t('dashboard.badge_gemini')}
        </Tag>
      )}
    >

        {/* Selector de Deck de Referencia */}
        <div className="smart-rec-controls">
          <div className="smart-rec-deck-selector" role="group" aria-label={t('dashboard.reference_track')}>
            <button
              type="button"
              aria-pressed={activeDeck === 'A'}
              className={`smart-rec-deck-btn ${activeDeck === 'A' ? 'active' : ''}`}
              onClick={() => setActiveDeck('A')}
            >
              {activeDeck === 'A' && (
                <motion.span layoutId="smart-rec-deck-indicator" className="smart-rec-deck-indicator" transition={deckTransition} aria-hidden="true" />
              )}
              <span className="smart-rec-deck-btn-title">
                <Icon icon={Disc} size="xs" />
                {t('dashboard.select_deck_a')}
              </span>
              <span className="smart-rec-deck-btn-track">
                {deckA.track ? deckA.track.title : t('dashboard.no_track_in_deck')}
              </span>
              {deckMeta(deckA.track) && <span className="smart-rec-deck-btn-meta sd-num">{deckMeta(deckA.track)}</span>}
            </button>

            <button
              type="button"
              aria-pressed={activeDeck === 'B'}
              className={`smart-rec-deck-btn ${activeDeck === 'B' ? 'active' : ''}`}
              onClick={() => setActiveDeck('B')}
            >
              {activeDeck === 'B' && (
                <motion.span layoutId="smart-rec-deck-indicator" className="smart-rec-deck-indicator" transition={deckTransition} aria-hidden="true" />
              )}
              <span className="smart-rec-deck-btn-title">
                <Icon icon={Disc} size="xs" />
                {t('dashboard.select_deck_b')}
              </span>
              <span className="smart-rec-deck-btn-track">
                {deckB.track ? deckB.track.title : t('dashboard.no_track_in_deck')}
              </span>
              {deckMeta(deckB.track) && <span className="smart-rec-deck-btn-meta sd-num">{deckMeta(deckB.track)}</span>}
            </button>
          </div>

          {/* Fila de acción principal */}
          <div className="smart-rec-action-row">
            {referenceTrack ? (
              <Button
                variant="accent"
                onClick={() => handleFetchRecommendations()}
                disabled={isLoading || referenceTrack.analysis?.status !== 'analyzed' || typeof referenceTrack.analysis.bpm !== 'number' || !(referenceTrack.analysis.camelot || referenceTrack.analysis.key)}
              >
                {isLoading ? (
                  <Icon icon={Loader2} size="sm" className="smart-rec-spin" />
                ) : (
                  <Icon icon={SlidersVertical} size="sm" />
                )}
                {recommendations.length > 0
                  ? t('dashboard.refresh_recommendations')
                  : t('dashboard.get_recommendations')}
              </Button>
            ) : (
              <span className="smart-rec-empty-hint">{t('dashboard.load_local_track_first')}</span>
            )}

          </div>
        </div>

        {/* El contenido de la referencia se funde al cambiar de deck en vez de saltar */}
        <AnimatedHeight duration={motionTransition.duration}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={activeDeck}
            className="smart-rec-stage"
            initial={skipDeckAnimation ? false : { opacity: 0, y: animationsEnabled ? 8 : 0 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={deckTransition}
          >
            {referenceTrack && (
              referenceTrack.analysis?.status !== 'analyzed' ||
              typeof referenceTrack.analysis.bpm !== 'number' ||
              !(referenceTrack.analysis.camelot || referenceTrack.analysis.key)
            ) && (
              <p className="smart-rec-empty-hint" role="status">{t('dashboard.reference_analysis_required')}</p>
            )}

            {/* Estados de Contenido: carga, invitación y resultados ocupan el mismo hueco
                (.smart-rec-slot, alto mínimo común), así que pasar de uno a otro no mueve la página */}
            {isCalculating && (
              <EmptyState
                status="loading"
                className="smart-rec-slot"
                title={t('dashboard.loading_recommendations')}
                description={t('dashboard.loading_recommendations_desc')}
              />
            )}

            {explanationsUnavailable && recommendations.length > 0 && (
              <p className="smart-rec-evidence-note" role="status">
                {t('dashboard.ai_explanation_unavailable')}
              </p>
            )}

            {!isLoading && !errorMsg && !referenceTrack && (
              <EmptyState
                icon={Disc}
                className="smart-rec-empty-box"
                title={t('dashboard.no_deck_track_prompt')}
              />
            )}

            {!isLoading &&
              !errorMsg &&
              referenceTrack &&
              recommendations.length === 0 && insufficientCandidateCount === 0 && (
                <div className="smart-rec-empty-box smart-rec-slot">
                  <Icon icon={SlidersVertical} size="lg" />
                  <p>
                    {t('dashboard.current_track_info', {
                      title: referenceTrack.title,
                      bpm: referenceTrack.analysis?.bpm ? `${referenceTrack.analysis.bpm} BPM` : t('dashboard.bpm_na', 'BPM N/A'),
                      key: referenceTrack.analysis?.camelot || referenceTrack.analysis?.key || t('dashboard.key_na', 'Camelot N/A'),
                      action: t('dashboard.get_recommendations'),
                    })}
                  </p>
                </div>
              )}

            {!isLoading && !errorMsg && insufficientCandidateCount > 0 && (
              <p className="smart-rec-evidence-note" role="status">
                {t('dashboard.insufficient_evidence', { count: insufficientCandidateCount })}
              </p>
            )}

            {/* Recomendaciones obtenidas: una tarjeta a la vez, con navegación entre las calculadas */}
            {!errorMsg && recommendations.length > 0 && (
              <div className="smart-rec-results smart-rec-slot">
                <div className="smart-rec-pager">
                  <p className="smart-rec-list-head" role="status">
                    {t('dashboard.results_summary', { count: recommendations.length, title: referenceTrack?.title ?? '' })}
                  </p>
                  {recommendations.length > 1 && (
                    <div className="smart-rec-pager__nav" role="group" aria-label={t('dashboard.recommendation_nav')}>
                      <IconButton
                        icon={<Icon icon={ChevronLeft} size="sm" />}
                        size="sm"
                        label={t('dashboard.recommendation_prev')}
                        disabled={pageIndex === 0}
                        onClick={() => goToRecommendation(-1)}
                      />
                      <span className="smart-rec-pager__count sd-num" aria-live="polite">
                        {t('dashboard.recommendation_position', { current: pageIndex + 1, total: recommendations.length })}
                      </span>
                      <IconButton
                        icon={<Icon icon={ChevronRight} size="sm" />}
                        size="sm"
                        label={t('dashboard.recommendation_next')}
                        disabled={pageIndex >= recommendations.length - 1}
                        onClick={() => goToRecommendation(1)}
                      />
                    </div>
                  )}
                </div>
                <ol className="smart-rec-list" start={pageIndex + 1}>
                  <AnimatePresence mode="popLayout" initial={false} custom={slideDirection}>
                    {recommendations.slice(pageIndex, pageIndex + 1).map((rec) => {
                      const index = pageIndex;
                      const score = rec.compatibilityScore;
                      const tier = scoreTier(score);
                      const missingEvidence = [
                        rec.tempoEvaluation?.relation === 'unknown' ? t('dashboard.bpm_label', 'BPM') : null,
                        rec.harmonicEvaluation?.relation === 'unknown' ? t('dashboard.key_label', 'Key') : null,
                      ].filter((value): value is string => value !== null).join(', ');

                      const tempo = rec.tempoEvaluation;
                      const pitch = tempo?.pitchShiftPercent;
                      const signedPitch = pitch !== undefined ? `${pitch > 0 ? '+' : ''}${pitch}%` : '';
                      const tempoDetail =
                        tempo?.relation === 'exact' ? t('dashboard.tempo_exact')
                        : tempo?.relation === 'in_range' ? (pitch !== undefined ? `${t('dashboard.pitch_label')} ${signedPitch}` : t('dashboard.tempo_in_range'))
                        : tempo?.relation === 'half_time' ? `${t('dashboard.half_tempo', '½ Tempo')} (~${tempo.effectiveBpm} BPM)`
                        : tempo?.relation === 'double_time' ? `${t('dashboard.double_tempo', '2x Tempo')} (~${tempo.effectiveBpm} BPM)`
                        : tempo?.relation === 'out_of_range' ? t('dashboard.pitch_out_of_range', 'Pitch > ±8%')
                        : t('dashboard.fact_unknown');

                      const harmonic = rec.harmonicEvaluation?.relation;
                      const harmonicDetail =
                        harmonic === 'same_key' ? t('dashboard.harmonic_same_key')
                        : harmonic === 'relative' ? t('dashboard.harmonic_relative')
                        : harmonic === 'adjacent' ? t('dashboard.harmonic_adjacent')
                        : harmonic === 'incompatible' ? t('dashboard.different_harmony', 'Armonía diferente')
                        : t('dashboard.fact_unknown');

                      const energyLevel = rec.energy !== undefined ? Math.round(rec.energy) : null;

                      return (
                        <motion.li
                          key={rec.trackId}
                          className={`smart-rec-item smart-rec-item--${tier}`}
                          custom={slideDirection}
                          variants={animationsEnabled ? CARD_VARIANTS : CARD_VARIANTS_STATIC}
                          initial="enter"
                          animate="center"
                          exit="exit"
                          transition={motionTransition}
                        >
                          {/* Cabecera: posición, pista y compatibilidad global */}
                          <div className="smart-rec-item-header">
                            <span className="smart-rec-item-rank sd-num" aria-hidden="true">
                              {String(index + 1).padStart(2, '0')}
                            </span>
                            <div className="smart-rec-item-title-col">
                              <h4 className="smart-rec-item-title">
                                {rec.title || t('dashboard.untitled_track', 'Pista sin título')}
                              </h4>
                              {rec.artist ? (
                                <span className="smart-rec-item-artist">{rec.artist}</span>
                              ) : null}
                            </div>

                            <div className={`smart-rec-score smart-rec-score--${tier} sd-field-inverse`}>
                              <span className="smart-rec-score__label">{t('dashboard.match_score')}</span>
                              <span className="smart-rec-score__value sd-num">
                                {score !== null ? <>{score}<small>%</small></> : t('dashboard.score_na')}
                              </span>
                              {score !== null && (
                                <span className="smart-rec-score__bar" aria-hidden="true">
                                  <span className="smart-rec-score__fill" style={{ transform: `scaleX(${Math.min(100, Math.max(0, score)) / 100})` }} />
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Metadatos musicales verificados: qué dice cada dato sobre la mezcla */}
                          <dl className="smart-rec-facts">
                            <RecommendationFact
                              tone={factTone(tempo?.compatible)}
                              icon={Activity}
                              label={t('dashboard.fact_tempo')}
                              value={rec.bpm ? `${rec.bpm} BPM` : t('dashboard.bpm_na', 'BPM N/A')}
                              detail={tempoDetail}
                            />
                            <RecommendationFact
                              tone={factTone(rec.harmonicEvaluation?.compatible)}
                              icon={Music2}
                              label={t('dashboard.key_label', 'Key')}
                              value={rec.camelot || rec.key || t('dashboard.key_na', 'Camelot N/A')}
                              detail={harmonicDetail}
                            />
                            <RecommendationFact
                              tone={energyLevel !== null ? 'neutral' : 'unknown'}
                              icon={Zap}
                              label={t('dashboard.fact_energy')}
                              value={energyLevel !== null ? `${rec.energy}/10` : t('dashboard.energy_na')}
                            >
                              {energyLevel !== null && (
                                <dd className="smart-rec-energy" aria-hidden="true">
                                  {Array.from({ length: ENERGY_SEGMENTS }, (_, segment) => (
                                    <span key={segment} className={clsx('smart-rec-energy__cell', segment < energyLevel && 'is-on')} />
                                  ))}
                                </dd>
                              )}
                            </RecommendationFact>
                          </dl>

                          {/* Procedencia de la evidencia */}
                          <div className="smart-rec-item-footer">
                            <div className="smart-rec-item-badges">
                              <Tag tone={rec.evidenceStatus === 'partial' ? 'acid' : 'sage'}>
                                {rec.evidenceStatus === 'partial'
                                  ? t('dashboard.partial_evidence', { missing: missingEvidence })
                                  : t('dashboard.full_evidence')}
                              </Tag>
                              {rec.isAnalysisVerified && (
                                <Tag tone="surface" className="smart-rec-verified-tag">
                                  <Icon icon={Check} size="xs" />
                                  {t('dashboard.local_verified', 'Datos verificados')}
                                </Tag>
                              )}
                              <Tag tone={rec.isMock ? 'surface' : 'ink'} className="smart-rec-source-tag">
                                {rec.isMock ? t('dashboard.badge_mock') : t('dashboard.ai_generated', 'Sugerencia IA')}
                              </Tag>
                            </div>

                          </div>
                        </motion.li>
                      );
                    })}
                  </AnimatePresence>
                </ol>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
        </AnimatedHeight>
    </Panel>
  );
};
