// Geodesy helpers. Distances in metres, angles in degrees.

const EARTH_RADIUS_M = 6371008.8;
const RAD = Math.PI / 180;

/** Great-circle distance between two lat/lon points, in metres. */
export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Flat local map around (lat0, lon0): x is metres east, y is metres north.
 * Accurate to well under 1% within tens of kilometres, which is all snapping
 * needs. Distances along a route are measured with haversine, not this.
 */
export function createProjection(lat0, lon0) {
  const kx = EARTH_RADIUS_M * RAD * Math.cos(lat0 * RAD);
  const ky = EARTH_RADIUS_M * RAD;
  return {
    lat0,
    lon0,
    toXY(lat, lon) {
      let dLon = lon - lon0;
      if (dLon > 180) dLon -= 360;
      else if (dLon < -180) dLon += 360;
      return [dLon * kx, (lat - lat0) * ky];
    },
    toLatLon(x, y) {
      return [lat0 + y / ky, lon0 + x / kx];
    },
  };
}
