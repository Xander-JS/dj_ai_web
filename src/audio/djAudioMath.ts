import type { CrossfaderCurve } from '../types/mixer.ts';

/** Shared crossfader law used by the real-time and offline graphs. */
export function calculateCrossfaderGains(
  position: number,
  curve: CrossfaderCurve,
): { gainA: number; gainB: number } {
  const p = Math.max(0, Math.min(1, position > 1 ? position / 100 : position));
  let gainA = 1;
  let gainB = 1;

  switch (curve) {
    case 'linear':
      gainA = 1 - p;
      gainB = p;
      break;
    case 'constant-power':
      gainA = Math.cos(p * 0.5 * Math.PI);
      gainB = Math.sin(p * 0.5 * Math.PI);
      break;
    case 'cut':
      gainA = p >= 0.95 ? Math.max(0, (1 - p) * 20) : 1;
      gainB = p <= 0.05 ? Math.max(0, p * 20) : 1;
      break;
  }

  return {
    gainA: Math.max(0, Math.min(1, Number(gainA.toFixed(4)))),
    gainB: Math.max(0, Math.min(1, Number(gainB.toFixed(4)))),
  };
}

export type BipolarFilterSettings = {
  type: BiquadFilterType;
  frequency?: number;
};

/** Matches AudioEngineService.setChannelFilter's bipolar filter law. */
export function getBipolarFilterSettings(value: number): BipolarFilterSettings {
  const normalized = Math.max(-100, Math.min(100, value));
  if (normalized === 0) return { type: 'allpass' };
  if (normalized < 0) {
    const factor = (normalized + 100) / 100;
    return { type: 'lowpass', frequency: Number((200 * Math.pow(20000 / 200, factor)).toFixed(2)) };
  }
  const factor = normalized / 100;
  return { type: 'highpass', frequency: Number((20 * Math.pow(8000 / 20, factor)).toFixed(2)) };
}
