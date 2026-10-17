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

export {
  computeProvisionalBeatgrid,
  getBeatPhase,
  DEFAULT_MAX_PROVISIONAL_BEATS,
  type ProvisionalBeatgrid,
  type ProvisionalBeatgridOptions,
  type BeatPhaseResult,
} from './beatgrid.ts';

export {
  calculatePhaseAlignmentPlan,
  evaluateSlewRateAt,
  integrateSlewTrajectory,
  MIN_PLAYBACK_RATE,
  MAX_PLAYBACK_RATE,
  DEFAULT_PLANNING_MARGIN_SEC,
  PHASE_ALIGN_TOLERANCE_SEC,
  DEFAULT_MAX_SLEW_SLOPE,
  DEFAULT_MAX_SLEW_DEVIATION,
  MAX_SLEW_DURATION_SEC,
  MIN_RATE_HEADROOM,
  type PhaseAlignmentInput,
  type SlewProfilePlan,
  type PhaseAlignmentCalculationResult,
  type PhaseAlignmentStatus,
} from './phaseAlignment.ts';
