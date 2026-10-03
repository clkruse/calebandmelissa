const CENTER_LAT = 37.853;
const CENTER_LON = -122.258;
const RADIUS_MI = 25;
const RADIUS_KM = RADIUS_MI * 1.60934;
const POLL_INTERVAL_MS = 20000;

const CATEGORY_LABELS = {
  0: 'No info',
  1: 'No category',
  2: 'Light (< 15500 lbs)',
  3: 'Small (15500–75000 lbs)',
  4: 'Large (75000–300000 lbs)',
  5: 'High vortex large',
  6: 'Heavy (> 300000 lbs)',
  7: 'High performance',
  8: 'Rotorcraft',
  9: 'Glider / sailplane',
  10: 'Lighter-than-air',
  11: 'Parachutist / skydiver',
  12: 'Ultralight / hang-glider',
  14: 'UAV',
  15: 'Space / transatmospheric',
  16: 'Surface emergency vehicle',
  17: 'Surface service vehicle',
  18: 'Point obstacle',
  19: 'Cluster obstacle',
  20: 'Line obstacle',
};

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function radiusToBbox(lat, lon, radiusKm) {
  const latDelta = radiusKm / 111.32;
  const lonDelta = radiusKm / (111.32 * Math.cos(toRad(lat)));
  return {
    lamin: (lat - latDelta).toFixed(4),
    lamax: (lat + latDelta).toFixed(4),
    lomin: (lon - lonDelta).toFixed(4),
    lomax: (lon + lonDelta).toFixed(4),
  };
}

function msToKnots(ms) {
  return ms != null ? (ms * 1.94384).toFixed(0) : '—';
}

function metersToFeet(m) {
  return m != null ? (m * 3.28084).toFixed(0) : '—';
}

function verticalRateToFpm(ms) {
  return ms != null ? (ms * 196.85).toFixed(0) : '—';
}

// Vertical rate with directional arrow indicator
function verticalRateDisplay(ms) {
  if (ms == null) return '—';
  const fpm = (ms * 196.85).toFixed(0);
  if (ms > 0.5) return `\u2191 ${fpm} fpm`;
  if (ms < -0.5) return `\u2193 ${fpm} fpm`;
  return `\u2192 0 fpm`;
}

// Extrapolate a plane's lat/lon given elapsed seconds since last known position.
// velocity in m/s, trueTrack in degrees from north (clockwise).
function extrapolatePosition(lat, lon, velocity, trueTrack, dtSeconds) {
  if (velocity == null || trueTrack == null || velocity === 0) return [lon, lat];
  const headingRad = toRad(trueTrack);
  const dLat = (velocity * Math.cos(headingRad) * dtSeconds) / 111320;
  const dLon = (velocity * Math.sin(headingRad) * dtSeconds) / (111320 * Math.cos(toRad(lat)));
  return [lon + dLon, lat + dLat];
}

// Linear interpolation, null-safe.
function lerp(a, b, t) {
  if (a == null || b == null) return b;
  return a + (b - a) * t;
}

// SmoothStep: ease-in/ease-out curve (Hermite interpolation).
function smoothStep(t) {
  return t * t * (3 - 2 * t);
}

// Triple-applied smoothStep for very smooth heading transitions.
function tripleSmoothStep(t) {
  return smoothStep(smoothStep(smoothStep(t)));
}

// Lerp between two angles (degrees) via the shortest arc.
// t is 0..1, result is 0..360.
function lerpAngle(from, to, t) {
  let diff = ((to - from + 540) % 360) - 180; // shortest signed delta
  let result = from + diff * t;
  return ((result % 360) + 360) % 360;
}

// Median Absolute Deviation altitude filter.
// Rejects altitude spikes from ADS-B sensor noise.
// Returns the filtered altitude (newAlt if it passes, median of history if not).
// Mutates `history` by pushing newAlt when accepted.
function filterAltitude(history, newAlt) {
  if (newAlt == null) return newAlt;
  if (history.length < 3) {
    history.push(newAlt);
    return newAlt;
  }
  const sorted = history.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const deviations = sorted.map((v) => Math.abs(v - median));
  deviations.sort((a, b) => a - b);
  const mad = deviations[Math.floor(deviations.length / 2)];
  // Threshold of 3: reject if deviation from median > 3 * MAD
  // Use a minimum MAD of 50m to avoid over-filtering stable altitudes
  const threshold = 3 * Math.max(mad, 50);
  if (Math.abs(newAlt - median) > threshold) {
    return median; // reject outlier, return median instead
  }
  history.push(newAlt);
  if (history.length > 10) history.shift();
  return newAlt;
}

// Catmull-Rom spline: takes an array of [lon, lat] or [lon, lat, alt] and returns
// a smoothed version. Passes through every original point; adds `segments`
// interpolated points per span. Preserves altitude (3rd element) via linear interp.
function smoothPath(coords, segments) {
  if (coords.length < 4) return coords.slice();
  segments = segments || 16;
  const hasAlt = coords[0].length > 2;
  const result = [];

  // Only smooth interior segments where all 4 control points are distinct.
  // Stop 2 segments before the end so the spline can't overshoot the tail.
  const lastSmoothed = coords.length - 3;
  for (let i = 0; i < lastSmoothed; i++) {
    const p0 = coords[Math.max(i - 1, 0)];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[i + 2];

    for (let s = 0; s < segments; s++) {
      const t = s / segments;
      const t2 = t * t;
      const t3 = t2 * t;
      const lon =
        0.5 * (
          (2 * p1[0]) +
          (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3
        );
      const lat =
        0.5 * (
          (2 * p1[1]) +
          (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3
        );
      if (hasAlt) {
        // Linear interpolation for altitude (no spline needed — smooth enough)
        const alt = (p1[2] || 0) + ((p2[2] || 0) - (p1[2] || 0)) * t;
        result.push([lon, lat, alt]);
      } else {
        result.push([lon, lat]);
      }
    }
  }
  // Straight-line the last 3 points (no spline, no overshoot)
  result.push(coords[coords.length - 3].slice());
  result.push(coords[coords.length - 2].slice());
  result.push(coords[coords.length - 1].slice());
  return result;
}

// Parse a hex color string (#RRGGBB) into [r, g, b].
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Convert [r, g, b] to #RRGGBB hex string.
function rgbToHex(r, g, b) {
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// Map altitude (meters) to a lightness factor (0 = very light/washed-out, 1 = full color).
// Ground level is light, cruise altitude is full intensity.
function altitudeToLightness(altMeters) {
  const alt = altMeters || 0;
  if (alt <= 0) return 0.25;
  if (alt >= 10000) return 1.0;
  // Smooth ramp from 0.25 (ground) to 1.0 (10km+)
  return 0.25 + 0.75 * (alt / 10000);
}

// Produce a hex color from a base category color, adjusted for altitude lightness
// and an age factor (older trail points fade toward white).
// baseHex: '#RRGGBB', altMeters: number, ageFactor: 0..1 (0=old/faded, 1=current)
function trailColorHex(baseHex, altMeters, ageFactor) {
  const [r, g, b] = hexToRgb(baseHex);
  // Altitude controls how much of the base color shows vs white
  const altFactor = altitudeToLightness(altMeters);
  // Combined intensity: both altitude and age fade toward white
  const intensity = altFactor * ageFactor;
  const bg = 255;
  return rgbToHex(
    Math.round(r * intensity + bg * (1 - intensity)),
    Math.round(g * intensity + bg * (1 - intensity)),
    Math.round(b * intensity + bg * (1 - intensity)),
  );
}

// Build a Mapbox line-gradient expression from coords with altitude (3rd element).
// Uses the aircraft's category color as the base hue, varying lightness by altitude.
// coords: [[lon, lat, alt], ...], baseColor: '#RRGGBB'.
function buildTrailGradient(coords, baseColor) {
  const fallback = baseColor || '#9B9B9B';
  if (coords.length < 2) return ['interpolate', ['linear'], ['line-progress'], 0, fallback, 1, fallback];

  // Compute cumulative distances for accurate line-progress mapping
  const distances = [0];
  for (let i = 1; i < coords.length; i++) {
    const dx = coords[i][0] - coords[i - 1][0];
    const dy = coords[i][1] - coords[i - 1][1];
    distances.push(distances[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  const totalDist = distances[distances.length - 1];
  if (totalDist === 0) return ['interpolate', ['linear'], ['line-progress'], 0, fallback, 1, fallback];

  // Sample at most 64 stops to keep the expression manageable
  const maxStops = 64;
  const step = Math.max(1, Math.floor(coords.length / maxStops));

  const expr = ['interpolate', ['linear'], ['line-progress']];
  let lastProgress = -1;
  for (let i = 0; i < coords.length; i += step) {
    const progress = Math.min(distances[i] / totalDist, 1);
    if (progress <= lastProgress) continue;
    lastProgress = progress;

    const alt = coords[i][2] || 0;
    // Older trail points (progress near 0) are more faded
    const ageFactor = 0.3 + 0.7 * progress;
    expr.push(progress, trailColorHex(fallback, alt, ageFactor));
  }
  // Ensure we have the final point
  if (lastProgress < 1) {
    const lastAlt = coords[coords.length - 1][2] || 0;
    expr.push(1, trailColorHex(fallback, lastAlt, 1));
  }

  return expr;
}

// Trim path coordinates that extend ahead of the aircraft's current position.
// Finds the closest point to aircraftCoord in the tail portion of coords, truncates there.
// Returns a new array (does not mutate input).
function trimPathAheadOfAircraft(coords, aircraftCoord) {
  if (coords.length < 2) return coords.slice();
  // Search the last third of the path (covers spline overshoot generously)
  const searchLen = Math.min(Math.max(Math.ceil(coords.length / 3), 30), coords.length);
  const startIdx = coords.length - searchLen;
  let bestIdx = coords.length - 1;
  let bestDist = Infinity;
  for (let i = startIdx; i < coords.length; i++) {
    const dx = coords[i][0] - aircraftCoord[0];
    const dy = coords[i][1] - aircraftCoord[1];
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return coords.slice(0, bestIdx + 1);
}
