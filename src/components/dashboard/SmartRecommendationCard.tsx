/**
 * SYSTEM DJ — Smart Track Recommendation Card Component
 * Integra Gemini AI con el estado de decks y la biblioteca de audio.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Sparkles,
  Disc,
  RotateCcw,
  Loader2,
  Lightbulb,
  CheckCircle2,
  AlertTriangle,
  Play,
  Layers,
} from 'lucide-react';
import { Card, CardBody } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { StateView } from '../ui/StateView';
import { useDJStore } from '../../store/useDJStore';
import { indexedDBStorage } from '../../services/storage/IndexedDBStorage';
import { MOCK_LIBRARY } from '../../mock/library';
import { keyToCamelot } from '../../audio/analysis/camelotMapper';
import {
  getTrackRecommendations,
  type TrackRecommendation,
} from '../../services/ai';
import type { Track } from '../../types/track';
import './SmartRecommendationCard.css';

/**
 * Convierte una pista estática de la librería de prueba en una entidad Track completa con análisis.
 */
function createTrackFromMockItem(mockItem: (typeof MOCK_LIBRARY)[number]): Track {
  return {
    id: `demo-${mockItem.id}`,
    title: mockItem.title,
    artist: mockItem.artist,
    album: mockItem.album,
    duration: 180,
    durationFormatted: mockItem.duration || '3:00',
    type: mockItem.type,
    source: { type: 'blob' },
    analysis: {
      status: 'analyzed',
      bpm: mockItem.bpm,
      key: mockItem.key,
      camelot: keyToCamelot(mockItem.key),
      energy: mockItem.energy,
    },
    dateAdded: Date.now(),
  };
}

export const SmartRecommendationCard: React.FC = () => {
  const { t } = useTranslation();
  const { deckA, deckB, loadTrackToDeckA, loadTrackToDeckB } = useDJStore();

  const [selectedDeck, setSelectedDeck] = useState<'A' | 'B' | null>(null);
  const [localTracks, setLocalTracks] = useState<Track[]>([]);
  const [recommendations, setRecommendations] = useState<TrackRecommendation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isMockResult, setIsMockResult] = useState<boolean>(false);
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

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

  // Construir catálogo de pistas disponibles (locales + demo convertidas)
  // Tratamiento tolerante: no se descartan canciones por falta de BPM, tonalidad o fallos de análisis.
  // Únicamente se excluyen elementos sin identificador válido según el contrato del sistema.
  const availableTracks = useMemo<Track[]>(() => {
    const demoTracks = MOCK_LIBRARY.map(createTrackFromMockItem);
    const validLocalTracks = localTracks.filter((t) => Boolean(t && typeof t.id === 'string' && t.id.trim()));
    return [...validLocalTracks, ...demoTracks];
  }, [localTracks]);

  // Selección derivada de deck activo: preferencia explícita o deck con pista cargada
  const activeDeck: 'A' | 'B' = selectedDeck ?? (deckA.track ? 'A' : (deckB.track ? 'B' : 'A'));
  const setActiveDeck = (deck: 'A' | 'B') => setSelectedDeck(deck);

  // Pista de referencia activa según el deck seleccionado
  const referenceTrack = useMemo<Track | null>(() => {
    if (activeDeck === 'A') {
      return deckA.track || null;
    }
    return deckB.track || null;
  }, [activeDeck, deckA.track, deckB.track]);

  // Función para solicitar recomendaciones a Gemini
  const handleFetchRecommendations = useCallback(
    async (forceMock = false) => {
      if (!referenceTrack) return;

      setIsLoading(true);
      setErrorMsg(null);
      setFeedback(null);

      try {
        const response = await getTrackRecommendations(referenceTrack, availableTracks, {
          forceMock,
        });

        if (response.success) {
          setRecommendations(response.recommendations);
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
        const error = err as { message?: string };
        setErrorMsg(error?.message || t('dashboard.error_title'));
      } finally {
        setIsLoading(false);
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
      }
    } catch (err) {
      console.error('[SmartRecommendationCard] Error al cargar pista:', err);
    }
  };

  // Cargar demo inicial predecible con análisis completo garantizado
  const handleLoadInitialDemo = async () => {
    const demoTracks = MOCK_LIBRARY.map(createTrackFromMockItem);
    const targetTrack = demoTracks[0] || availableTracks.find((t) => t.analysis?.status === 'analyzed') || availableTracks[0];
    if (targetTrack) {
      await loadTrackToDeckA(targetTrack);
      setActiveDeck('A');
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
                disabled={isLoading}
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
              <Button variant="outline" size="sm" onClick={handleLoadInitialDemo}>
                <Play size={13} />
                {t('dashboard.load_demo_deck_a')}
              </Button>
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
                Pista actual: <strong>{referenceTrack.title}</strong> (
                {referenceTrack.analysis?.bpm || 124} BPM,{' '}
                {referenceTrack.analysis?.camelot || 'Camelot N/A'}). Presiona{' '}
                <strong>{t('dashboard.get_recommendations')}</strong> para consultar al
                asistente de IA.
              </p>
            </div>
          )}

        {/* Lista de Recomendaciones Obtenidas */}
        {!isLoading && !errorMsg && recommendations.length > 0 && (
          <div className="smart-rec-list">
            {recommendations.map((rec, index) => {
              const scoreClass =
                rec.compatibilityScore >= 85
                  ? 'smart-rec-score-high'
                  : 'smart-rec-score-medium';

              return (
                <div key={rec.trackId} className="smart-rec-item">
                  {/* Encabezado del item */}
                  <div className="smart-rec-item-header">
                    <div className="smart-rec-item-title-col">
                      <span className="smart-rec-item-title">
                        #{index + 1} {rec.title}
                      </span>
                      <span className="smart-rec-item-artist">{rec.artist}</span>
                    </div>

                    <div className="smart-rec-item-badges">
                      <span className={`smart-rec-score-badge ${scoreClass}`}>
                        {rec.compatibilityScore}%
                      </span>
                      {rec.isMock && (
                        <span className="smart-rec-mock-tag">
                          {t('dashboard.badge_mock')}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Metadatos musicales */}
                  <div className="smart-rec-meta-tags">
                    {rec.bpm && (
                      <span className="smart-rec-tag">{rec.bpm} BPM</span>
                    )}
                    {(rec.camelot || rec.key) && (
                      <span className="smart-rec-tag">
                        Key: {rec.camelot || rec.key}
                      </span>
                    )}
                    {rec.energy !== undefined && (
                      <span className="smart-rec-tag">
                        ⚡ {rec.energy}/10
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
