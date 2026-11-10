import type { Track } from '../../types/track.ts';
import { apiUrl } from './apiBase.ts';
export interface MixPlan {
  trackId: string;
  enterAfterBeats: number;
  transitionBeats: number;
  adjustments: Array<{ beat: number; control: 'low' | 'mid' | 'high' | 'filter' | 'volume' | 'gain' | 'pitch' | 'hotCue' | 'loop' | 'barSync'; value: number; deck?: 'A' | 'B' }>;
}
export function validateMixPlan(value: unknown, ids: string[]): MixPlan | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as MixPlan;
  if (!ids.includes(p.trackId) || !Number.isInteger(p.enterAfterBeats) || p.enterAfterBeats < 16 || p.enterAfterBeats > 128
    || ![8, 16, 32].includes(p.transitionBeats) || !Array.isArray(p.adjustments) || p.adjustments.length > 8) return null;
  if (p.adjustments.some(a => !a || !Number.isInteger(a.beat) || a.beat < 0 || a.beat > 64
    || (a.deck !== undefined && a.deck !== 'A' && a.deck !== 'B')
    || !['low', 'mid', 'high', 'filter', 'volume', 'gain', 'pitch', 'hotCue', 'loop', 'barSync'].includes(a.control) || !Number.isFinite(a.value)
    || (a.control === 'barSync' ? a.value !== 1 : a.control === 'hotCue' ? (!Number.isInteger(a.value) || a.value < 1 || a.value > 8) : a.control === 'loop' ? ![1, 2, 4, 8, 16].includes(a.value) : a.control === 'pitch' ? a.value < 47 || a.value > 53 : a.value < (a.control === 'volume' ? 70 : 35) || a.value > (a.control === 'volume' ? 85 : 65)))) return null;
  return p;
}
export async function requestMixPlan(reference: Track, candidates: Track[], signal: AbortSignal, context?: { position: number; duration: number; playbackRate: number; crossfader: number; hotCues: number[]; downbeatConfirmed: boolean; lead: 'A' | 'B'; decks: Array<{ deck: 'A' | 'B'; trackId: string; hotCues: number[]; downbeatConfirmed: boolean }> }): Promise<MixPlan | null> {
  const { getSupabase, isSupabaseConfigured } = await import('../supabase/client');
  if (!isSupabaseConfigured || signal.aborted) return null;
  const { data } = await (await getSupabase()).auth.getSession();
  if (!data.session || signal.aborted) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 19000);
  const metadata = (t: Track) => ({ id: t.id, ...(t.analysis.status === 'analyzed' ? {
    bpm: t.analysis.bpm, camelot: t.analysis.camelot, energy: t.analysis.energy,
  } : {}) });
  try {
    const response = await fetch(apiUrl('/api/ai/mix-plan'), {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify({ context, reference: metadata(reference), candidates: candidates.map(metadata) }),
      signal: AbortSignal.any([signal, controller.signal]),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return signal.aborted ? null : validateMixPlan(body.plan, candidates.map(t => t.id));
  } catch { return null; } finally { clearTimeout(timeout); }
}
