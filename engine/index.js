// SportsHUD track engine: position against a known track, as plain numbers.
// No display code and no sport-specific code lives under engine/.

export { haversine, createProjection } from './geo.js';
export { parseGpx, toFixes, findPauses } from './gpx.js';
export { buildRoute, snapToRoute, pointAtDistance } from './route.js';
export {
  PROGRESS_DEFAULTS,
  createProgressTracker,
  projectRecording,
  monotone,
  distAtTime,
  timeAtDist,
} from './progress.js';
export {
  STOP_DEFAULTS,
  findStops,
  movingTime,
  prepareGhost,
  gapAt,
  createGapTracker,
  gapSeriesAfterwards,
  compareGapSeries,
} from './gap.js';
export { fillGaps, createReplay, checkB1 } from './replay.js';
