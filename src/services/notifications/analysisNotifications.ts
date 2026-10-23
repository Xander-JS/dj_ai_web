/**
 * SYSTEM DJ — Analysis Notifications Bridge
 * Traduce las transiciones de análisis del AnalysisSyncManager en notificaciones del sistema.
 * Solo notifica análisis que pasaron por 'analyzing' en esta sesión, ignorando
 * resultados ya cacheados que se re-emiten al cargar pistas en los decks.
 */

import { analysisSyncManager } from '../analysis';
import { indexedDBStorage } from '../storage/IndexedDBStorage';
import { notificationCenter } from './notificationCenter';

export function connectAnalysisNotifications(): () => void {
  const inFlight = new Set<string>();

  return analysisSyncManager.subscribe((trackId, analysis) => {
    if (analysis.status === 'analyzing') {
      inFlight.add(trackId);
      return;
    }
    if (!inFlight.delete(trackId)) return;
    if (analysis.status !== 'analyzed' && analysis.status !== 'failed' && analysis.status !== 'unsupported') return;

    void indexedDBStorage
      .getTrack(trackId)
      .catch(() => null)
      .then((track) => {
        const title = track?.title || trackId;
        if (analysis.status === 'analyzed') {
          notificationCenter.push({ type: 'success', messageKey: 'notifications.analysis_completed', params: { title } });
        } else {
          notificationCenter.push({
            type: 'error',
            messageKey: 'notifications.analysis_failed',
            params: { title, error: analysis.analysisError || '' },
          });
        }
      });
  });
}
