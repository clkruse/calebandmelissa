let pollInterval = POLL_INTERVAL_MS;
let pollTimer = null;
let lastPollTime = 0;
let currentPlanes = [];     // planes from current poll (with corr* fields for blending)
let planeState = {};        // icao24 -> { prev, trail: [[lon,lat],...], altHistory: [] }
let animFrameId = null;

// Background aircraft-type lookup (tar1090-db) for accurate categorization
const TYPE_CACHE_KEY = 'skymap_typeCache';
const typeCache = loadTypeCache();
let typeCodeDbReady = null;  // promise that resolves to the type code DB

// Background route resolution — callsign → "SFO → LAX"
const routeCache = {};  // callsign -> route string or null

function loadTypeCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(TYPE_CACHE_KEY)) || {};
    const clean = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v == null) continue;
      // Migrate old format (bare category number) to new { cat, type, reg }
      if (typeof v === 'number') clean[k] = { cat: v };
      else if (v.cat != null) clean[k] = v;
    }
    return clean;
  } catch { return {}; }
}

function saveTypeCache() {
  try {
    // Only persist entries with a resolved category
    const toSave = {};
    for (const [k, v] of Object.entries(typeCache)) {
      if (v?.cat != null) toSave[k] = v;
    }
    localStorage.setItem(TYPE_CACHE_KEY, JSON.stringify(toSave));
  } catch { /* quota exceeded — ignore */ }
}

const TRAIL_BUFFER_SIZE = 40;
const TELEPORT_THRESHOLD_DEG = 0.3;
const MIN_BLEND_SEC = 2;  // minimum seconds to fade position correction
const MAX_BLEND_SEC = 8;  // cap for very large corrections
const MAX_EXTRAP_SEC = 90;        // stop dead-reckoning past this; data is stale
const STALE_CLEAR_MS = 5 * 60e3;  // drop planes entirely after this long without data
let lastPollError = null;         // message of the most recent failed poll, or null

function startPolling() {
  // Pre-fetch the type code database (non-blocking)
  typeCodeDbReady = fetchTypeCodeDb().catch(err => {
    console.warn('Failed to load type code DB:', err.message);
    return null;
  });
  initSplitFlap();
  poll(); // immediate first fetch
  pollTimer = setInterval(poll, pollInterval);
  animFrameId = requestAnimationFrame(animateLoop);
}

async function poll() {
  try {
    const bbox = radiusToBbox(CENTER_LAT, CENTER_LON, RADIUS_KM);
    const data = await fetchStates(bbox);

    if (!data.states || data.states.length === 0) {
      currentPlanes = [];
      planeState = {};
      lastPollTime = Date.now();
      lastPollError = null;
      updatePlanes({ type: 'FeatureCollection', features: [] });
      showNoPlanes(true);
      updateStatusBar(0);
      return;
    }

    const parsed = data.states.map(parseStateVector);
    const filtered = filterByRadius(parsed, CENTER_LAT, CENTER_LON, RADIUS_KM);

    // Snapshot the *displayed* position so the next cycle's correction
    // starts exactly where the user saw the plane — no snap-back.
    const snapDt = lastPollTime > 0 ? (Date.now() - lastPollTime) / 1000 : 0;

    for (const p of currentPlanes) {
      const state = planeState[p.icao24];
      if (state) {
        const blendSec = p.blendSec || MIN_BLEND_SEC;
        // Linear ramp for position (matches Fix C in interpolatedGeoJSON)
        const linearT = Math.min(snapDt / blendSec, 1);
        const fade = 1 - linearT;
        // smoothStep for heading and scalar blending
        const blendT = smoothStep(Math.min(snapDt / blendSec, 1));

        // Fix D: no extrapolation for ground planes
        let displayLon, displayLat;
        if (p.onGround) {
          displayLon = p.lon + (p.corrLon || 0) * fade;
          displayLat = p.lat + (p.corrLat || 0) * fade;
        } else {
          const extrap = extrapolatePosition(p.lat, p.lon, p.velocity, p.trueTrack, snapDt);
          displayLon = extrap[0] + (p.corrLon || 0) * fade;
          displayLat = extrap[1] + (p.corrLat || 0) * fade;
        }

        // Altitude: extrapolate with vertical rate (same pattern as position with velocity)
        const altExtrap = (p.baroAltitude || 0) + (p.verticalRate || 0) * snapDt;
        state.prev = {
          displayLon,
          displayLat,
          displayHeading: (p.trueTrack || 0) + (p.corrTrack || 0) * (1 - blendT),
          displayAltitude: altExtrap + (p.corrAltitude || 0) * fade,
          velocity: lerp(p.prevVelocity, p.velocity, blendT),
          verticalRate: lerp(p.prevVerticalRate, p.verticalRate, blendT),
        };
      }
    }

    // Build set of current icao24s for pruning
    const currentIcaos = new Set(filtered.map((p) => p.icao24));

    // Attach correction values to each plane, update trail buffers
    for (const p of filtered) {
      let state = planeState[p.icao24];
      if (!state) {
        state = { prev: null, trail: [], altHistory: [] };
        planeState[p.icao24] = state;
      }

      // Teleportation detection: if plane jumps too far, reset its trail
      if (state.prev) {
        const dLat = Math.abs(p.lat - state.prev.displayLat);
        const dLon = Math.abs(p.lon - state.prev.displayLon);
        if (dLat > TELEPORT_THRESHOLD_DEG || dLon > TELEPORT_THRESHOLD_DEG) {
          state.trail = [];
          state.altHistory = [];
          state.prev = null;
        }
      }

      // Push new position to trail buffer
      state.trail.push([p.lon, p.lat]);
      if (state.trail.length > TRAIL_BUFFER_SIZE) {
        state.trail.shift();
      }

      // MAD altitude filtering — reject sensor spikes
      p.baroAltitude = filterAltitude(state.altHistory, p.baroAltitude);

      const prev = state.prev;
      if (prev) {
        // Correction = where the plane was displayed minus the new API position.
        // This gets faded to zero over blendSec so the plane smoothly converges.
        p.corrLon = prev.displayLon - p.lon;
        p.corrLat = prev.displayLat - p.lat;
        p.corrTrack = ((prev.displayHeading - (p.trueTrack || 0) + 540) % 360) - 180;

        // Fix A: Directional correction clamping — project correction onto heading
        // direction and remove any backward component that would cause reverse motion.
        if (p.trueTrack != null && !p.onGround) {
          const headingRad = toRad(p.trueTrack);
          const fwdLon = Math.sin(headingRad);
          const fwdLat = Math.cos(headingRad);
          const dot = p.corrLon * fwdLon + p.corrLat * fwdLat;
          if (dot < 0) {
            // Remove backward component, keep perpendicular component
            p.corrLon -= dot * fwdLon;
            p.corrLat -= dot * fwdLat;
          }
        }

        // Fix B: Zero-velocity snap — when velocity is near zero, snap quickly
        // to avoid fading correction pushing a stationary icon around.
        if ((p.velocity || 0) < 5) {
          p.blendSec = MIN_BLEND_SEC;
        } else {
          // Scale blend time so correction rate never exceeds forward speed
          const corrDeg = Math.sqrt(p.corrLon * p.corrLon + p.corrLat * p.corrLat);
          const corrMeters = corrDeg * 111320;
          const speed = Math.max(p.velocity || 50, 50);
          p.blendSec = Math.min(Math.max(corrMeters / speed, MIN_BLEND_SEC), MAX_BLEND_SEC);
        }

        // Altitude correction: same dead-reckoning pattern as position
        p.corrAltitude = prev.displayAltitude - (p.baroAltitude || 0);
        p.prevVelocity = prev.velocity;
        p.prevVerticalRate = prev.verticalRate;
      } else {
        // New plane — no correction, start extrapolating from API position immediately
        p.corrLon = 0;
        p.corrLat = 0;
        p.corrTrack = 0;
        p.corrAltitude = 0;
        p.blendSec = MIN_BLEND_SEC;
        p.prevVelocity = p.velocity;
        p.prevVerticalRate = p.verticalRate;
      }
    }

    // Prune planeState for planes no longer in view
    for (const icao of Object.keys(planeState)) {
      if (!currentIcaos.has(icao)) delete planeState[icao];
    }

    currentPlanes = filtered;
    lastPollTime = Date.now();
    lastPollError = null;

    // Resolve aircraft types via tar1090-db
    resolveTypes(filtered);

    // Resolve routes in background
    resolveRoutes(filtered);

    showNoPlanes(filtered.length === 0);
    updateStatusBar(filtered.length);

    // Adaptive polling based on rate limit remaining
    const newInterval = adaptivePollInterval(rateLimitRemaining);
    if (newInterval !== pollInterval) {
      pollInterval = newInterval;
      clearInterval(pollTimer);
      pollTimer = setInterval(poll, pollInterval);
    }
  } catch (err) {
    console.error('Poll error:', err.message);
    lastPollError = err.message;
    if (lastPollTime > 0 && Date.now() - lastPollTime > STALE_CLEAR_MS) {
      currentPlanes = [];
      planeState = {};
      updatePlanes({ type: 'FeatureCollection', features: [] });
      showNoPlanes(true, 'Flight data unavailable');
    }
    updateStatusBar(currentPlanes.length);
    if (err.retryAfter) {
      pollInterval = err.retryAfter * 1000;
      clearInterval(pollTimer);
      pollTimer = setInterval(poll, pollInterval);
      console.warn(`Rate limited, backing off to ${pollInterval / 1000}s`);
    }
  }
}

function animateLoop() {
  if (currentPlanes.length > 0 && lastPollTime > 0) {
    // Freeze positions once data is stale rather than flying planes off in straight lines
    const dtSeconds = Math.min((Date.now() - lastPollTime) / 1000, MAX_EXTRAP_SEC);
    const geojson = interpolatedGeoJSON(currentPlanes, dtSeconds);
    updatePlanes(geojson);
    updateSplitFlap(geojson);

    // Update track line and info panel for selected plane
    if (selectedIcao) {
      const feature = geojson.features.find((f) => f.properties.icao24 === selectedIcao);
      if (feature) {
        updateTrackLine(feature.geometry.coordinates, feature.properties.altitude);
        updateInfoPanel(feature.properties);
      }
    }
  }
  animFrameId = requestAnimationFrame(animateLoop);
}

function interpolatedGeoJSON(planes, dtSeconds) {
  return {
    type: 'FeatureCollection',
    features: planes.map((p) => {
      const blendSec = p.blendSec || MIN_BLEND_SEC;
      // Fix C: Linear ramp for position blending (smoothStep can peak at 1.5x
      // average correction rate, exceeding extrapolation rate → net backward motion).
      const linearT = Math.min(dtSeconds / blendSec, 1);
      const fade = 1 - linearT;

      // Fix D: Suppress ground-plane extrapolation — ground planes have unreliable
      // heading data, so just blend the correction toward the API position.
      let lon, lat;
      if (p.onGround) {
        lon = p.lon + (p.corrLon || 0) * fade;
        lat = p.lat + (p.corrLat || 0) * fade;
      } else {
        // Dead-reckoning: extrapolate forward from latest API position
        const extrap = extrapolatePosition(p.lat, p.lon, p.velocity, p.trueTrack, dtSeconds);
        lon = extrap[0] + (p.corrLon || 0) * fade;
        lat = extrap[1] + (p.corrLat || 0) * fade;
      }

      // Heading: API heading + fading correction (keep smoothStep for snappy heading)
      const headingBlendT = smoothStep(Math.min(dtSeconds / blendSec, 1));
      const headingFade = 1 - headingBlendT;
      let heading = (p.trueTrack || 0) + (p.corrTrack || 0) * headingFade;
      heading = ((heading % 360) + 360) % 360;

      // Altitude: dead-reckon with vertical rate, same pattern as position
      const altExtrap = (p.baroAltitude || 0) + (p.verticalRate || 0) * dtSeconds;
      const altitude = altExtrap + (p.corrAltitude || 0) * fade;

      // Velocity/vert rate: no derivative to extrapolate, blend then hold
      const velocity = lerp(p.prevVelocity, p.velocity, headingBlendT);
      const verticalRate = lerp(p.prevVerticalRate, p.verticalRate, headingBlendT);

      const cached = typeCache[p.icao24];
      const category = (cached?.cat != null) ? cached.cat : p.category;
      const label = shortTypeName(cached?.type) || p.callsign;

      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: {
          icao24: p.icao24,
          callsign: p.callsign,
          label: label,
          originCountry: p.originCountry,
          altitude: altitude,
          velocity: velocity,
          trueTrack: heading,
          verticalRate: verticalRate,
          onGround: p.onGround,
          category: category,
          iconName: categoryToIcon(category),
          color: p.onGround ? '#9B9B9B' : categoryColor(category),
        },
      };
    }),
  };
}

// Resolve aircraft types via tar1090-db chunk files
let _resolveInFlight = false;

function resolveTypes(planes) {
  const needed = planes.filter(p => !typeCache[p.icao24]).map(p => p.icao24);
  if (needed.length === 0 || _resolveInFlight) return;
  _resolveInFlight = true;

  _resolveTypesAsync(needed).finally(() => { _resolveInFlight = false; });
}

async function _resolveTypesAsync(icaos) {
  try {
    const typeCodeDb = await typeCodeDbReady;

    // Group ICAOs by their chunk prefixes (walk from 1-char to deeper)
    // We'll resolve each ICAO by walking the chunk tree
    const resolved = new Set();

    // Batch by first character to minimize chunk fetches
    const byPrefix = {};
    for (const icao of icaos) {
      const upper = icao.toUpperCase();
      const prefix = upper[0];
      if (!byPrefix[prefix]) byPrefix[prefix] = [];
      byPrefix[prefix].push({ icao, upper });
    }

    for (const [prefix, entries] of Object.entries(byPrefix)) {
      try {
        await _walkChunkTree(prefix, entries, typeCodeDb, resolved);
      } catch (err) {
        console.warn(`Chunk tree walk failed for prefix ${prefix}:`, err.message);
      }
    }

    // Mark unresolved so they don't get retried every poll
    for (const icao of icaos) {
      if (!resolved.has(icao) && !typeCache[icao]) {
        typeCache[icao] = { cat: null };
      }
    }

    saveTypeCache();
  } catch (err) {
    console.warn('Type resolution failed:', err.message);
  }
}

async function _walkChunkTree(chunkName, entries, typeCodeDb, resolved) {
  let chunk;
  try {
    chunk = await fetchDbChunk(chunkName);
  } catch {
    return;  // chunk doesn't exist
  }

  // Try to resolve entries at this level
  const remaining = [];
  for (const { icao, upper } of entries) {
    if (resolved.has(icao)) continue;
    const suffix = upper.slice(chunkName.length);
    if (suffix && chunk[suffix]) {
      const record = chunk[suffix];
      const cat = classifyFromDb(record, typeCodeDb);
      typeCache[icao] = { cat, type: record[3] || null, reg: record[0] || null };
      resolved.add(icao);
    } else {
      remaining.push({ icao, upper });
    }
  }

  // Recurse into children chunks for unresolved entries
  if (chunk.children && remaining.length > 0) {
    const childPrefixes = new Set(chunk.children);
    const byChild = {};
    for (const entry of remaining) {
      // Find the matching child prefix (next level deeper)
      const nextPrefix = entry.upper.slice(0, chunkName.length + 1);
      if (childPrefixes.has(nextPrefix)) {
        if (!byChild[nextPrefix]) byChild[nextPrefix] = [];
        byChild[nextPrefix].push(entry);
      }
    }

    for (const [childName, childEntries] of Object.entries(byChild)) {
      await _walkChunkTree(childName, childEntries, typeCodeDb, resolved);
    }
  }
}

// Resolve routes in background via adsbdb callsign lookups
let _routesInFlight = false;

function resolveRoutes(planes) {
  const needed = planes
    .filter(p => p.callsign && !(p.callsign in routeCache) && !isRegistrationCallsign(p.callsign))
    .sort((a, b) => haversineDistance(CENTER_LAT, CENTER_LON, a.lat, a.lon)
                  - haversineDistance(CENTER_LAT, CENTER_LON, b.lat, b.lon))
    .map(p => p.callsign);
  // Deduplicate
  const unique = [...new Set(needed)];
  if (unique.length === 0 || _routesInFlight) return;
  _routesInFlight = true;

  _resolveRoutesAsync(unique).finally(() => { _routesInFlight = false; });
}

async function _resolveRoutesAsync(callsigns) {
  // Fetch up to 5 at a time to avoid hammering adsbdb
  const batch = callsigns.slice(0, 5);
  const results = await Promise.allSettled(
    batch.map(cs => fetchRouteInfo(cs).then(route => [cs, route]))
  );
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      const [cs, route] = result.value;
      if (route?.origin && route?.destination) {
        const orig = route.origin.iata_code || route.origin.icao_code || '?';
        const dest = route.destination.iata_code || route.destination.icao_code || '?';
        routeCache[cs] = `${orig} → ${dest}`;
      } else {
        routeCache[cs] = null;  // no route found, don't retry
      }
    } else if (result.status === 'rejected') {
      // Don't cache failures — allow retry on next poll
    }
  }
  // Mark remaining callsigns that weren't in this batch as unchecked
  // (they'll be picked up on the next poll cycle)
}

// US tail numbers used as callsigns (N12345, N361JL) never resolve to a route.
function isRegistrationCallsign(cs) {
  return /^N\d{1,5}[A-Z]{0,2}$/.test(cs);
}

// 4-tier adaptive polling based on API rate limit headers
function adaptivePollInterval(remaining) {
  if (remaining == null || remaining > 500) return POLL_INTERVAL_MS; // plenty
  if (remaining > 200) return Math.max(POLL_INTERVAL_MS, 10000);     // low
  if (remaining > 50) return Math.max(POLL_INTERVAL_MS, 30000);      // very low
  return Math.max(POLL_INTERVAL_MS, 60000);                          // critical
}

function showNoPlanes(show, text = 'No planes found') {
  const overlay = document.getElementById('no-planes-overlay');
  overlay.querySelector('span').textContent = text;
  overlay.classList.toggle('visible', show);
}

function updateStatusBar(count) {
  const bar = document.getElementById('status-bar');
  const time = lastPollTime ? new Date(lastPollTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
  let text = `${count} aircraft within ${RADIUS_MI} mi  ·  updated ${time}`;
  if (lastPollError) {
    const ageSec = lastPollTime ? Math.round((Date.now() - lastPollTime) / 1000) : null;
    text = `Flight data unavailable (${lastPollError})` + (ageSec != null ? `  ·  last update ${ageSec}s ago` : '');
  } else if (pollInterval > POLL_INTERVAL_MS) {
    text += `  ·  polling every ${pollInterval / 1000}s (rate limited)`;
  }
  bar.textContent = text;
  bar.classList.toggle('stale', !!lastPollError);
}

// Pause polling/animation when tab is hidden, resume on visible
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInterval(pollTimer);
    pollTimer = null;
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  } else {
    lastPollTime = 0; // prevent stale extrapolation on resume
    poll();
    pollTimer = setInterval(poll, pollInterval);
    animFrameId = requestAnimationFrame(animateLoop);
  }
});

// Boot
document.addEventListener('DOMContentLoaded', initMap);
