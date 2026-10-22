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
  CheckCircle2,
  AlertTriangle,
  Layers,
} from 'lucide-react';
import { Card, CardBody } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { StateView } from '../ui/StateView';
import { useDJStore } from '../../store/useDJStore';
import { indexedDBStorage } from '../../services/storage/IndexedDBStorage';
import { LatestRequest } from '../../services/ai/LatestRequest';
import {
  getTrackRecommendations,
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
  } | null>(null);
  const [activeRequest, setActiveRequest] = useState<{ id: number; referenceTrack: Track; availableTracks: Track[] } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isMockResult, setIsMockResult] = useState<boolean>(false);
  const [modelUsed, setModelUsed] = useState<string | null>(null);
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

  useLayoutEffect(() => {
    invalidateRecommendationRequest();
    const requestGate = recommendationRequest.current;
    return () => requestGate.invalidate();
  }, [referenceTrack, availableTracks, invalidateRecommendationRequest]);

  // Función para solicitar recomendaciones a Gemini
  const handleFetchRecommendations = useCallback(
    async (forceMock = false) => {
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

      try {
        const response = await getTrackRecommendations(referenceTrack, availableTracks, {
          forceMock,
          signal: request.signal,
        });

        if (!isCurrentRequest()) return;

        if (response.success) {
          setRecommendationResult({ referenceTrack, availableTracks, recommendations: response.recommendations });
          setIsMockResult(response.isMock);
          setModelUsed(response.model || null);
          if (response.warning && response.recommendations.length === 0) {
            setErrorMsg(response.warning);
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
        const error = err as { name?: string };
        setErrorMsg(t(error?.name === 'AbortError' ? 'dashboard.error_timeout' : 'dashboard.error_server'));
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
    <Card elevated className="smart-rec-card">
      <CardBody className="smart-rec-container">
        {/* Cabecera */}
        <div className="smart-rec-header">
          <div className="smart-rec-title-group">
            <h3 className="smart-rec-title">
              <Sparkles size={18} color="var(--color-primary-500)" />
              {t('dashboard.smart_recommendations_title')}
            </h3>
            <p className="smart-rec-subtitle">
              {t('dashboard.smart_recommendations_subtitle')}
            </p>
          </div>

          {modelUsed && (
            <Badge variant={isMockResult ? 'outline' : 'primary'}>
              {isMockResult ? t('dashboard.badge_mock') : t('dashboard.badge_gemini')}
            </Badge>
          )}
        </div>

        {/* Selector de Deck de Referencia */}
        <div className="smart-rec-controls">
          <div className="smart-rec-deck-selector">
            <button
              type="button"
              className={`smart-rec-deck-btn ${activeDeck === 'A' ? 'active' : ''}`}
              onClick={() => setActiveDeck('A')}
            >
              <span className="smart-rec-deck-btn-title">
                <Disc size={13} />
                {t('dashboard.select_deck_a')}
              </span>
              <span className="smart-rec-deck-btn-track">
                {deckA.track ? deckA.track.title : t('dashboard.no_track_in_deck')}
              </span>
            </button>

            <button
              type="button"
              className={`smart-rec-deck-btn ${activeDeck === 'B' ? 'active' : ''}`}
              onClick={() => setActiveDeck('B')}
            >
              <span className="smart-rec-deck-btn-title">
                <Disc size={13} />
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
                variant="primary"
                size="sm"
                onClick={() => handleFetchRecommendations(false)}
                disabled={isLoading || referenceTrack.analysis?.status !== 'analyzed' || typeof referenceTrack.analysis.bpm !== 'number' || !(referenceTrack.analysis.camelot || referenceTrack.analysis.key)}
              >
                {isLoading ? (
                  <Loader2 size={14} className="smart-rec-spin" />
                ) : (
                  <Sparkles size={14} />
                )}
                {recommendations.length > 0
                  ? t('dashboard.refresh_recommendations')
                  : t('dashboard.get_recommendations')}
              </Button>
            ) : (
              <span className="smart-rec-empty-hint">{t('dashboard.load_local_track_first')}</span>
            )}

            {referenceTrack && !isLoading && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleFetchRecommendations(true)}
                title={t('dashboard.force_mock_mode')}
              >
                <Layers size={13} />
                {t('dashboard.try_mock')}
              </Button>
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
          <div className="smart-rec-feedback" role="status">
            <CheckCircle2 size={14} />
            <span>{feedback}</span>
          </div>
        )}

        {/* Estados de Contenido */}
        {isLoading && (
          <StateView
            status="loading"
            title={t('dashboard.loading_recommendations')}
            description={t('dashboard.loading_recommendations_desc')}
          />
        )}

        {!isLoading && errorMsg && (
          <div className="smart-rec-error-box">
            <AlertTriangle size={24} color="#f59e0b" />
            <span>{errorMsg}</span>
            <div className="smart-rec-item-actions">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleFetchRecommendations(false)}
              >
                <RotateCcw size={12} />
                {t('dashboard.retry')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleFetchRecommendations(true)}
              >
                {t('dashboard.try_mock')}
              </Button>
            </div>
          </div>
        )}

        {!isLoading && !errorMsg && !referenceTrack && (
          <div className="smart-rec-empty-box">
            <Disc size={28} />
            <p>{t('dashboard.no_deck_track_prompt')}</p>
          </div>
        )}

        {!isLoading &&
          !errorMsg &&
          referenceTrack &&
          recommendations.length === 0 && (
            <div className="smart-rec-empty-box">
              <Sparkles size={28} />
              <p>
                {t('dashboard.current_track_info', {
                  title: referenceTrack.title,
                  bpm: referenceTrack.analysis?.bpm ? `${referenceTrack.analysis.bpm} BPM` : t('dashboard.bpm_na', 'BPM N/A'),
                  key: referenceTrack.analysis?.camelot || referenceTrack.analysis?.key || t('dashboard.key_na', 'Camelot N/A'),
                  action: t('dashboard.get_recommendations', 'Obtener con Gemini'),
                })}
              </p>
            </div>
          )}

        {/* Lista de Recomendaciones Obtenidas */}
        {!isLoading && !errorMsg && recommendations.length > 0 && (
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

              return (
                <div key={rec.trackId} className="smart-rec-item">
                  {/* Encabezado del item */}
                  <div className="smart-rec-item-header">
                    <div className="smart-rec-item-title-col">
                      <span className="smart-rec-item-title">
                        #{index + 1} {rec.title || t('dashboard.untitled_track', 'Pista sin título')}
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
                      <span className="smart-rec-tag" style={{ borderColor: 'var(--color-error-500, #ef4444)', color: 'var(--color-error-500, #ef4444)' }}>
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
                      <span className="smart-rec-tag" style={{ borderColor: 'var(--color-warning-500, #f59e0b)', color: 'var(--color-warning-500, #f59e0b)' }}>
                        {t('dashboard.different_harmony', 'Armonía diferente')}
                      </span>
                    )}
                    {rec.energy !== undefined && (
                      <span className="smart-rec-tag" title={t('dashboard.local_verified', 'Datos verificados')}>
                        ⚡ {rec.energy}/10
                      </span>
                    )}
                    {rec.isAnalysisVerified && (
                      <span className="smart-rec-verified-tag" title={t('dashboard.local_verified', 'Datos verificados')}>
                        ✓ {t('dashboard.local_verified', 'Datos verificados')}
                      </span>
                    )}
                  </div>

                  {/* Justificación comprensible del modelo */}
                  <p className="smart-rec-justification">{rec.justification}</p>

                  {/* Sugerencia de técnica de transición */}
                  {rec.transitionSuggestion && (
                    <div className="smart-rec-transition">
                      <Lightbulb size={13} color="var(--color-primary-500)" />
                      <span>{rec.transitionSuggestion}</span>
                    </div>
                  )}

                  {/* Botones de acción para cargar en Deck A o Deck B */}
                  <div className="smart-rec-item-actions">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleLoadTrack(rec, 'A')}
                      title={t('dashboard.load_deck_a')}
                    >
                      <Disc size={12} />
                      {t('dashboard.load_deck_a')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleLoadTrack(rec, 'B')}
                      title={t('dashboard.load_deck_b')}
                    >
                      <Disc size={12} />
                      {t('dashboard.load_deck_b')}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
};
