/**
 * SYSTEM DJ — Algorithmic Acoustic Energy Calculator
 *
 * FÓRMULA DE ENERGÍA ACÚSTICA HEURÍSTICA (Índice entero de 0 a 10):
 *
 * La energía de una pista musical para DJ combina tres dimensiones físicas perceptuales:
 * 1. Nivel de sonoridad global (RMS en escala logarítmica dBFS) -> Ponderación w1 = 0.50
 * 2. Contenido de altas frecuencias y brillo espectral (> 2000 Hz) -> Ponderación w2 = 0.30
 * 3. Densidad dinámica y compresión de mezcla (Inverso del Factor de Cresta) -> Ponderación w3 = 0.20
 *
 * Fórmula matemática:
 *   RawScore = 10 * [ 0.50 * E_RMS + 0.30 * E_HFC + 0.20 * E_Dyn ]
 *   Energy = clamp(round(RawScore), 0, 10)
 *
 * Normalizaciones específicas:
 * - E_RMS: Mapeo lineal de dBFS en el intervalo [-48 dBFS, -6 dBFS] acotado en [0.0, 1.0].
 * - E_HFC: Razón de energía por encima de 2000 Hz respecto al total en el intervalo [0.05, 0.35] acotado en [0.0, 1.0].
 * - E_Dyn: Inverso del Factor de Cresta (Peak / RMS) mapeado en [1.5, 6.0] acotado en [0.0, 1.0].
 */

export interface EnergyBreakdown {
  rmsComponent: number;         // 0.0 a 1.0
  hfcComponent: number;         // 0.0 a 1.0
  dynamicComponent: number;     // 0.0 a 1.0
}

export interface EnergyAnalysisResult {
  energy: number;               // Escala entera de 0 a 10
  rawScore: number;             // Valor continuo sin redondear (0.0 a 10.0)
  rmsDbfs: number;              // Sonoridad global en dBFS
  brightnessRatio: number;      // Proporción de agudos (>2 kHz)
  crestFactor: number;          // Razón pico / RMS
  breakdown: EnergyBreakdown;
}

/**
 * Filtro IIR Pasa-Altos Biquad de 2º orden a 2000 Hz.
 */
function applyBiquadHighpass(
  input: Float32Array,
  sampleRate: number,
  cutoffFreq: number
): Float32Array {
  const output = new Float32Array(input.length);
  const w0 = (2 * Math.PI * cutoffFreq) / sampleRate;
  const alpha = Math.sin(w0) / (2 * 0.7071);
  const cosW0 = Math.cos(w0);

  const b0 = (1 + cosW0) / 2;
  const b1 = -(1 + cosW0);
  const b2 = (1 + cosW0) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosW0;
  const a2 = 1 - alpha;

  const nb0 = b0 / a0;
  const nb1 = b1 / a0;
  const nb2 = b2 / a0;
  const na1 = a1 / a0;
  const na2 = a2 / a0;

  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;

    output[i] = Number.isFinite(y0) ? y0 : 0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }

  return output;
}

/**
 * Función auxiliar de saturación / clamping defensivo entre mínimo y máximo.
 * Inmune a NaN e Infinity.
 */
function clamp(val: number, min: number, max: number): number {
  if (!Number.isFinite(val) || val < min) return min;
  if (val > max) return max;
  return val;
}

/**
 * Calcula la energía acústica de una señal PCM en la escala DJ de 0 a 10.
 */
export function calculateEnergy(
  pcm: Float32Array,
  sampleRate: number
): EnergyAnalysisResult {
  const length = pcm ? pcm.length : 0;

  if (length === 0) {
    return {
      energy: 0,
      rawScore: 0,
      rmsDbfs: -120,
      brightnessRatio: 0,
      crestFactor: 1,
      breakdown: { rmsComponent: 0, hfcComponent: 0, dynamicComponent: 0 },
    };
  }

  // 1. Cálculo de RMS global y Pico absoluto con filtrado de valores finitos
  let sumSq = 0;
  let peak = 0;
  let finiteCount = 0;

  for (let i = 0; i < length; i++) {
    const sample = pcm[i];
    if (!Number.isFinite(sample)) continue;
    const absVal = Math.abs(sample);
    if (absVal > peak) peak = absVal;
    sumSq += absVal * absVal;
    finiteCount++;
  }

  // Silencio, amplitud despreciable o buffer sin muestras finitas válidas
  if (finiteCount === 0) {
    return {
      energy: 0,
      rawScore: 0,
      rmsDbfs: -120,
      brightnessRatio: 0,
      crestFactor: 1,
      breakdown: { rmsComponent: 0, hfcComponent: 0, dynamicComponent: 0 },
    };
  }

  const rms = Math.sqrt(sumSq / finiteCount);

  if (rms < 1e-5) {
    return {
      energy: 0,
      rawScore: 0,
      rmsDbfs: -100,
      brightnessRatio: 0,
      crestFactor: 1,
      breakdown: { rmsComponent: 0, hfcComponent: 0, dynamicComponent: 0 },
    };
  }

  const rmsDbfs = Number.isFinite(rms) && rms > 0 ? 20 * Math.log10(rms) : -120;

  // Normalización RMS: intervalo perceptual habitual de audio masterizado [-48 dBFS, -6 dBFS]
  const rmsComponent = clamp((rmsDbfs - (-48)) / (-6 - (-48)), 0.0, 1.0);

  // 2. Componente de Alta Frecuencia / Brillo (> 2000 Hz)
  // Se aplica un filtro pasa-altos a 2000 Hz para aislar la energía de agudos
  const highPassed = applyBiquadHighpass(pcm, sampleRate, 2000);
  let highSumSq = 0;
  let finiteHighCount = 0;
  for (let i = 0; i < length; i++) {
    const h = highPassed[i];
    if (Number.isFinite(h)) {
      highSumSq += h * h;
      finiteHighCount++;
    }
  }
  const highRms = finiteHighCount > 0 ? Math.sqrt(highSumSq / finiteHighCount) : 0;
  const brightnessRatio = highRms / (rms + 1e-9);

  // Normalización HFC: rango musical típico entre 0.05 y 0.35
  const hfcComponent = clamp((brightnessRatio - 0.05) / (0.35 - 0.05), 0.0, 1.0);

  // 3. Componente de Densidad Dinámica (Inverso del Factor de Cresta)
  const crestFactor = peak / (rms + 1e-9);

  // En pistas DJ con compresión/limitador denso el factor de cresta se sitúa entre 1.5 y 3.0.
  // En pistas dinámicas o grabaciones acústicas se eleva por encima de 6.0.
  const rawDyn = clamp((6.0 - crestFactor) / (6.0 - 1.5), 0.0, 1.0);
  // Gating perceptual: la compresión dinámica solo aporta energía perceptible si la señal es audible
  const audibilityGate = clamp(rmsComponent * 1.5, 0.0, 1.0);
  const dynamicComponent = clamp(rawDyn * audibilityGate, 0.0, 1.0);

  // 4. Suma ponderada explícita
  const wRms = 0.50;
  const wHfc = 0.30;
  const wDyn = 0.20;

  const rawScore = 10 * (wRms * rmsComponent + wHfc * hfcComponent + wDyn * dynamicComponent);
  const energy = clamp(Math.round(rawScore), 0, 10);

  return {
    energy,
    rawScore: Number(rawScore.toFixed(2)),
    rmsDbfs: Number(rmsDbfs.toFixed(1)),
    brightnessRatio: Number(brightnessRatio.toFixed(3)),
    crestFactor: Number(crestFactor.toFixed(2)),
    breakdown: {
      rmsComponent: Number(rmsComponent.toFixed(3)),
      hfcComponent: Number(hfcComponent.toFixed(3)),
      dynamicComponent: Number(dynamicComponent.toFixed(3)),
    },
  };
}
