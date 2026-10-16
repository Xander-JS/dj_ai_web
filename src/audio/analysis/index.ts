/**
 * SYSTEM DJ — Algorithmic Audio Analysis Suite
 * Exportación centralizada de algoritmos matemáticos puros para análisis musical.
 */

export {
  PITCH_CLASS_NAMES,
  pitchClassToKey,
  keyToCamelot,
  camelotToKey,
  areKeysHarmonicallyCompatible,
} from './camelotMapper.ts';

export {
  detectKey,
  extractChromaProfile,
  type KeyDetectionResult,
  type KeyCandidate,
} from './keyDetector.ts';

export {
  detectBpm,
  type BpmDetectionResult,
  type BpmDetectorOptions,
} from './bpmDetector.ts';

export {
  calculateEnergy,
  type EnergyAnalysisResult,
  type EnergyBreakdown,
} from './energyCalculator.ts';

export {
  analyzeAudioPcm,
  extractWaveformPeaks,
  type AudioAnalysisOptions,
} from './audioAnalyzer.ts';
