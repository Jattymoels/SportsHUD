// SportsHUD track engine: position against a known track or a set pace, as
// plain numbers. No display code and no sport-specific code lives under engine/.

export { haversine, createProjection } from './geo.js';
export { parseGpx, toFixes, toGpx, findPauses } from './gpx.js';
export { movingTime, createClock } from './clock.js';
export { buildRoute, snapToRoute, pointAtDistance } from './route.js';
export {
  PROGRESS_DEFAULTS,
  createProgressTracker,
  projectRecording,
  monotone,
  distAtTime,
  timeAtDist,
} from './progress.js';
export { ODOMETER_DEFAULTS, createOdometer, measureDistance } from './odometer.js';
export {
  STOP_DEFAULTS,
  findStops,
  prepareGhost,
  ghostFromFixes,
  gapAt,
  createGapTracker,
  gapSeriesAfterwards,
  compareGapSeries,
} from './gap.js';
export { speedOfPace, paceOf, paceGapAt, createPaceTracker, paceSeriesAfterwards } from './pace.js';
export { AUTOPAUSE_DEFAULTS, createAutoPause } from './autopause.js';
export { createRunSession } from './session.js';
export { fillGaps, createReplay, checkB1, checkPace } from './replay.js';
