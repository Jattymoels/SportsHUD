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
  passAt,
  createGapTracker,
  gapSeriesAfterwards,
  compareGapSeries,
} from './gap.js';
export { speedOfPace, paceOf, paceProfile, paceGapAt, createPaceTracker, paceSeriesAfterwards } from './pace.js';
export { angleBetween, cameraPose } from './orientation.js';
export { SEGMENT_DEFAULTS, createSegmentTracker } from './segments.js';
export { GUIDE_DEFAULTS, buildGuide, guideFromRuns, groupRuns, groupFixes, elevationAlong, upsAndDowns, findTurns, agreedTurns, findPausePoints, distanceMarkers, upcoming, nextCue } from './guide.js';
export { AUTOPAUSE_DEFAULTS, createAutoPause } from './autopause.js';
export { createRunSession } from './session.js';
export { fillGaps, createReplay, checkB1, checkPace, checkSegments } from './replay.js';
export {
  bearingTo,
  distanceTo,
  turnBetween,
  pointAlong,
  centreOf,
  crossings,
  inside,
  greenDistances,
  WIND_MODEL,
  carryInWind,
  DEFAULT_CLUBS,
  ZONE,
  landingZone,
  clubFor,
  zoneTouches,
  hazardsInPlay,
  lookTarget,
  lookAround,
  featuresOf,
  ADDRESS_DEFAULTS,
  createAddressHider,
  scoreDistances,
  scoreLooks,
} from './golf.js';
export { COURSE_DEFAULTS, courseFromOsm, holeAt, nearestOnLine } from './course.js';
