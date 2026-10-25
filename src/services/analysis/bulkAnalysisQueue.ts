/**
 * SYSTEM DJ — Bulk Analysis Queue (instancia de la aplicación)
 * Conecta AnalysisQueue con el gestor de análisis, el almacenamiento local y el centro de
 * notificaciones. Mientras la cola trabaja, cerrar o recargar la pestaña pide confirmación,
 * porque las pistas pendientes se perderían.
 */

import { AnalysisQueue, summarizeQueue } from './AnalysisQueue.ts';
import { analysisSyncManager } from './AnalysisSyncManager.ts';
import { indexedDBStorage } from '../storage/IndexedDBStorage.ts';
import { notificationCenter } from '../notifications/notificationCenter.ts';

/** Límite de espera a un análisis ajeno (deck, importación) antes de reanalizar igualmente. */
const FOREIGN_ANALYSIS_TIMEOUT_MS = 120_000;

function waitUntilIdle(trackId: string): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const unsubscribe = analysisSyncManager.subscribe((id, analysis) => {
      if (id !== trackId || analysis.status === 'analyzing') return;
      // El gestor libera su token justo después de notificar: se comprueba en la siguiente vuelta
      window.setTimeout(() => {
        if (!analysisSyncManager.isAnalyzing(trackId)) finish();
      }, 0);
    });
    const timer = window.setTimeout(finish, FOREIGN_ANALYSIS_TIMEOUT_MS);
    if (!analysisSyncManager.isAnalyzing(trackId)) finish();
  });
}

export const bulkAnalysisQueue = new AnalysisQueue({
  getTrack: (trackId) => indexedDBStorage.getTrack(trackId),
  analyze: (track) => analysisSyncManager.analyzeTrack(track, { force: true }),
  isAnalyzing: (trackId) => analysisSyncManager.isAnalyzing(trackId),
  waitUntilIdle,
  onFinished: (snapshot) => {
    const { analyzed, failed, skipped } = summarizeQueue(snapshot.results);
    notificationCenter.push({
      type: failed > 0 ? 'warning' : 'success',
      messageKey: 'notifications.analysis_queue_finished',
      params: { analyzed, failed, skipped, total: snapshot.total },
    });
  },
});

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    if (bulkAnalysisQueue.getSnapshot().status !== 'running') return;
    event.preventDefault();
    // Navegadores antiguos solo muestran el aviso si se asigna returnValue
    event.returnValue = '';
  });
}
