/**
 * SYSTEM DJ — Smart Track Recommendation Card Component
 * Integra Gemini AI con el estado de decks y la biblioteca de audio.
 */

import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Sparkles,
  Disc,
  RotateCcw,
  Loader2,
  Lightbulb,
  Check,
  Zap,
} from 'lucide-react';
import { Button } from '../atoms/Button';
import { Icon } from '../atoms/Icon';
import { Tag } from '../atoms/Tag';
import { EmptyState } from '../molecules/EmptyState';
import { Notice } from '../molecules/Notice';
import { Panel } from '../molecules/Panel';
import { useDJStore } from '../../store/useDJStore';
import { indexedDBStorage } from '../../services/storage/IndexedDBStorage';
import { LatestRequest } from '../../services/ai/LatestRequest';
import {
  getTrackRecommendations,
  getTrackRecommendationExplanations,
  applyRecommendationExplanations,
  extractCandidateMetadata,
  type TrackRecommendation,
} from '../../services/ai';
import type { Track } from '../../types/track';
import './SmartRecommendationCard.css';

export const SmartRecommendationCard: React.FC = () => {
  const { t } = useTranslation();
  const { deckA, deckB, loadTrackToDeckA, loadTrackToDeckB } = useDJStore();

  const [selectedDeck, setSelectedDeck] = useState<'A' | 'B' | null>(null);
  const [localTracks, setLocalTracks] = useState<Track[]>([]);
  const [recommendationResult, setRecommendationResult] = useState<{
    referenceTrack: Track;
    availableTracks: Track[];
    recommendations: TrackRecommendation[];
    insufficientCandidateCount: number;
  } | null>(null);
  const [activeRequest, setActiveRequest] = useState<{ id: number; referenceTrack: Track; availableTracks: Track[] } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isMockResult, setIsMockResult] = useState<boolean>(false);
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [explanationsUnavailable, setExplanationsUnavailable] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const recommendationRequest = useRef(new LatestRequest());

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
    const validLocalTracks = localTracks.filter((t) => Boolean(t && typeof t.id === 'string' && t.id.trim()));
    return validLocalTracks;
  }, [localTracks]);

  // Selección derivada de deck activo: preferencia explícita o deck con pista cargada
  const activeDeck: 'A' | 'B' = selectedDeck ?? (deckA.track ? 'A' : (deckB.track ? 'B' : 'A'));
  const setActiveDeck = (deck: 'A' | 'B') => {
    recommendationRequest.current.invalidate();
    setActiveRequest(null);
    setSelectedDeck(deck);
  };

  // Pista de referencia activa según el deck seleccionado
  const referenceTrack = useMemo<Track | null>(() => {
    if (activeDeck === 'A') {
      return deckA.track || null;
    }
    return deckB.track || null;
  }, [activeDeck, deckA.track, deckB.track]);

  const recommendations = recommendationResult?.referenceTrack === referenceTrack &&
    recommendationResult.availableTracks === availableTracks
    ? recommendationResult.recommendations
    : [];
  const isLoading = activeRequest?.referenceTrack === referenceTrack &&
    activeRequest.availableTracks === availableTracks;
  const insufficientCandidateCount = recommendationResult?.referenceTrack === referenceTrack &&
    recommendationResult.availableTracks === availableTracks
    ? recommendationResult.insufficientCandidateCount
    : 0;

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
        setRecommendationResult(null);
        setErrorMsg(t('dashboard.reference_analysis_required'));
        return;
      }

      const request = recommendationRequest.current.begin();
      const isCurrentRequest = () => recommendationRequest.current.isCurrent(request.id);
      setActiveRequest({ id: request.id, referenceTrack, availableTracks });
      setErrorMsg(null);
      setFeedback(null);
      setExplanationsUnavailable(false);

      let localResultsReady = false;
      try {
        const response = await getTrackRecommendations(referenceTrack, availableTracks, {
          signal: request.signal,
        });

        if (!isCurrentRequest()) return;

        if (response.success) {
          const localRecommendations = response.recommendations;
          localResultsReady = true;
          const localResult = {
            referenceTrack,
            availableTracks,
            recommendations: localRecommendations,
            insufficientCandidateCount: response.insufficientCandidateCount ?? 0,
          };
          // Publish local decisions immediately; Gemini can only enrich text.
          setRecommendationResult(localResult);
          setIsMockResult(response.isMock);
          setModelUsed(response.model || null);
          if (response.warning && response.recommendations.length === 0) {
            setErrorMsg(response.warning);
          }

          if (localRecommendations.length > 0) {
            const explanationResponse = await getTrackRecommendationExplanations(
              extractCandidateMetadata(referenceTrack),
              localRecommendations,
              { signal: request.signal }
            );
            if (!isCurrentRequest()) return;

            if (explanationResponse.success) {
              setRecommendationResult({
                ...localResult,
                recommendations: applyRecommendationExplanations(localRecommendations, explanationResponse.explanations),
              });
              setExplanationsUnavailable(Boolean(explanationResponse.warning));
            } else if (explanationResponse.errorCode !== 'cancelled') {
              setExplanationsUnavailable(true);
            }
          }
        } else {
          let userMessage = response.error || t('dashboard.error_title');
          if (response.errorCode === 'quota_exceeded') {
            userMessage = t('dashboard.error_quota_exceeded');
          } else if (response.errorCode === 'auth_error') {
            userMessage = t('dashboard.error_auth');
          } else if (response.errorCode === 'network_error') {
            userMessage = t('dashboard.error_network');
          } else if (response.errorCode === 'timeout') {
            userMessage = t('dashboard.error_timeout');
          }

          setErrorMsg(userMessage);
          setIsMockResult(false);
        }
      } catch (err: unknown) {
        if (!isCurrentRequest()) return;
        if (localResultsReady) {
          setExplanationsUnavailable(true);
        } else {
          const error = err as { name?: string };
          setErrorMsg(t(error?.name === 'AbortError' ? 'dashboard.error_timeout' : 'dashboard.error_server'));
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

  // Cargar una pista recomendada en Deck A o Deck B sin interrumpir el deck opuesto
  const handleLoadTrack = async (rec: TrackRecommendation, targetDeck: 'A' | 'B') => {
    const targetTrack = availableTracks.find((tr) => tr.id === rec.trackId);
    if (!targetTrack) return;

    try {
      const loadFn = targetDeck === 'A' ? loadTrackToDeckA : loadTrackToDeckB;
      const loaded = await loadFn(targetTrack);
      if (loaded) {
        setFeedback(
          t('dashboard.loaded_to_deck', {
            deck: targetDeck === 'A' ? 'Deck A' : 'Deck B',
          })
        );
        setTimeout(() => setFeedback(null), 3500);
      } else {
        setErrorMsg(t('dashboard.track_load_failed'));
      }
    } catch (err) {
      console.error('[SmartRecommendationCard] Error al cargar pista:', err);
      setErrorMsg(t('dashboard.track_load_failed'));
    }
  };

  return (
    <Panel
      className="smart-rec-card"
      bodyClassName="smart-rec-container"
      title={t('dashboard.smart_recommendations_title')}
      description={t('dashboard.smart_recommendations_subtitle')}
      icon={Sparkles}
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
              <span className="smart-rec-deck-btn-title">
                <Icon icon={Disc} size="xs" />
                {t('dashboard.select_deck_a')}
              </span>
              <span className="smart-rec-deck-btn-track">
                {deckA.track ? deckA.track.title : t('dashboard.no_track_in_deck')}
              </span>
            </button>

            <button
              type="button"
              aria-pressed={activeDeck === 'B'}
              className={`smart-rec-deck-btn ${activeDeck === 'B' ? 'active' : ''}`}
              onClick={() => setActiveDeck('B')}
            >
              <span className="smart-rec-deck-btn-title">
                <Icon icon={Disc} size="xs" />
                {t('dashboard.select_deck_b')}
              </span>
              <span className="smart-rec-deck-btn-track">
                {deckB.track ? deckB.track.title : t('dashboard.no_track_in_deck')}
              </span>
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
                  <Icon icon={Sparkles} size="sm" />
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

        {referenceTrack && (
          referenceTrack.analysis?.status !== 'analyzed' ||
          typeof referenceTrack.analysis.bpm !== 'number' ||
          !(referenceTrack.analysis.camelot || referenceTrack.analysis.key)
        ) && (
          <p className="smart-rec-empty-hint" role="status">{t('dashboard.reference_analysis_required')}</p>
        )}

        {/* Feedback temporal de carga a Deck */}
        {feedback && (
          <Notice tone="success" className="smart-rec-feedback">
            {feedback}
          </Notice>
        )}

        {/* Estados de Contenido */}
        {isLoading && (
          <EmptyState
            status="loading"
            title={t('dashboard.loading_recommendations')}
            description={t('dashboard.loading_recommendations_desc')}
          />
        )}

        {explanationsUnavailable && recommendations.length > 0 && (
          <p className="smart-rec-evidence-note" role="status">
            {t('dashboard.ai_explanation_unavailable')}
          </p>
        )}

        {!isLoading && errorMsg && (
          <Notice
            tone="error"
            className="smart-rec-error-box"
            action={
              <Button
                variant="ink"
                size="sm"
                onClick={() => handleFetchRecommendations()}
              >
                <Icon icon={RotateCcw} size="xs" />
                {t('dashboard.retry')}
              </Button>
            }
          >
            {errorMsg}
          </Notice>
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
            <div className="smart-rec-empty-box">
              <Icon icon={Sparkles} size="lg" />
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

        {/* Lista de Recomendaciones Obtenidas */}
        {!errorMsg && recommendations.length > 0 && (
          <div className="smart-rec-list">
            {recommendations.map((rec, index) => {
              const scoreClass =
                rec.compatibilityScore === null
                  ? ''
                  : rec.compatibilityScore >= 80
                  ? 'smart-rec-score-high'
                  : rec.compatibilityScore >= 50
                  ? 'smart-rec-score-medium'
                  : 'smart-rec-score-low';
              const missingEvidence = [
                rec.tempoEvaluation?.relation === 'unknown' ? t('dashboard.bpm_label', 'BPM') : null,
                rec.harmonicEvaluation?.relation === 'unknown' ? t('dashboard.key_label', 'Key') : null,
              ].filter((value): value is string => value !== null).join(', ');

              return (
                <div key={rec.trackId} className="smart-rec-item">
                  {/* Encabezado del item */}
                  <div className="smart-rec-item-header">
                    <div className="smart-rec-item-title-col">
                      <span className="smart-rec-item-title">
                        <span className="smart-rec-item-rank sd-num">{index + 1}</span>
                        {rec.title || t('dashboard.untitled_track', 'Pista sin título')}
                      </span>
                      {rec.artist ? (
                        <span className="smart-rec-item-artist">{rec.artist}</span>
                      ) : null}
                    </div>

                    <div className="smart-rec-item-badges">
                      {rec.compatibilityScore !== null && (
                        <span className={`smart-rec-score-badge ${scoreClass}`}>
                          {rec.compatibilityScore}%
                        </span>
                      )}
                      <span className="smart-rec-evidence-tag">
                        {rec.evidenceStatus === 'partial'
                          ? t('dashboard.partial_evidence', { missing: missingEvidence })
                          : t('dashboard.full_evidence')}
                      </span>
                      {rec.isMock ? (
                        <span className="smart-rec-mock-tag">
                          {t('dashboard.badge_mock')}
                        </span>
                      ) : (
                        <span className="smart-rec-gemini-tag">
                          {t('dashboard.ai_generated', 'Sugerencia IA')}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Metadatos musicales verificados */}
                  <div className="smart-rec-meta-tags">
                    {rec.bpm ? (
                      <span className="smart-rec-tag" title={t('dashboard.local_verified', 'Datos verificados')}>
                        {rec.bpm} BPM
                      </span>
                    ) : (
                      <span className="smart-rec-tag smart-rec-tag-na">
                        {t('dashboard.bpm_na', 'BPM N/A')}
                      </span>
                    )}
                    {rec.tempoEvaluation?.pitchShiftPercent !== undefined && rec.tempoEvaluation.relation === 'in_range' && (
                      <span className="smart-rec-tag">
                        {t('dashboard.pitch_label')}: {rec.tempoEvaluation.pitchShiftPercent > 0 ? '+' : ''}{rec.tempoEvaluation.pitchShiftPercent}%
                      </span>
                    )}
                    {rec.tempoEvaluation?.relation === 'out_of_range' && (
                      <span className="smart-rec-tag smart-rec-tag--alert">
                        {t('dashboard.pitch_out_of_range', 'Pitch > ±8%')}
                      </span>
                    )}
                    {rec.tempoEvaluation?.relation === 'half_time' && (
                      <span className="smart-rec-tag">
                        {t('dashboard.half_tempo', '½ Tempo')} (~{rec.tempoEvaluation.effectiveBpm} BPM)
                      </span>
                    )}
                    {rec.tempoEvaluation?.relation === 'double_time' && (
                      <span className="smart-rec-tag">
                        {t('dashboard.double_tempo', '2x Tempo')} (~{rec.tempoEvaluation.effectiveBpm} BPM)
                      </span>
                    )}
                    {(rec.camelot || rec.key) ? (
                      <span className="smart-rec-tag" title={t('dashboard.local_verified', 'Datos verificados')}>
                        {t('dashboard.key_label', 'Key')}: {rec.camelot || rec.key}
                      </span>
                    ) : (
                      <span className="smart-rec-tag smart-rec-tag-na">
                        {t('dashboard.key_na', 'Camelot N/A')}
                      </span>
                    )}
                    {rec.harmonicEvaluation?.relation === 'incompatible' && (
                      <span className="smart-rec-tag smart-rec-tag--alert">
                        {t('dashboard.different_harmony', 'Armonía diferente')}
                      </span>
                    )}
                    {rec.energy !== undefined && (
                      <span className="smart-rec-tag" title={t('dashboard.local_verified', 'Datos verificados')}>
                        <Icon icon={Zap} size="xs" />
                        {rec.energy}/10
                      </span>
                    )}
                    {rec.isAnalysisVerified && (
                      <span className="smart-rec-verified-tag" title={t('dashboard.local_verified', 'Datos verificados')}>
                        <Icon icon={Check} size="xs" />
                        {t('dashboard.local_verified', 'Datos verificados')}
                      </span>
                    )}
                  </div>

                  {/* Gemini text is optional; local evidence remains the fallback. */}
                  {rec.aiExplanation && (
                    <span className="smart-rec-gemini-tag">{t('dashboard.ai_explanation_label')}</span>
                  )}
                  <p className="smart-rec-justification">{rec.aiExplanation || rec.justification}</p>

                  {/* Sugerencia de técnica de transición */}
                  {rec.transitionSuggestion && (
                    <div className="smart-rec-transition">
                      <Icon icon={Lightbulb} size="sm" />
                      <span>{rec.transitionSuggestion}</span>
                    </div>
                  )}

                  {/* Botones de acción para cargar en Deck A o Deck B */}
                  <div className="smart-rec-item-actions">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleLoadTrack(rec, 'A')}
                      title={t('dashboard.load_deck_a')}
                    >
                      <Icon icon={Disc} size="sm" />
                      {t('dashboard.load_deck_a')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleLoadTrack(rec, 'B')}
                      title={t('dashboard.load_deck_b')}
                    >
                      <Icon icon={Disc} size="sm" />
                      {t('dashboard.load_deck_b')}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
    </Panel>
  );
};
