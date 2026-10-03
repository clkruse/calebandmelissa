// Set your Mapbox token here
mapboxgl.accessToken = 'pk.eyJ1IjoiY2xrcnVzZSIsImEiOiJjaXIxY2M2dGcwMnNiZnZtZzN0Znk3MXRuIn0.MyKHSjxjG-ZcI2BkRUSGJA';

let map;
let selectedIcao = null;

const CATEGORY_COLORS = {
  2: '#00A65C', 9: '#00A65C', 10: '#00A65C', 11: '#00A65C', 12: '#00A65C',
  3: '#F7931E',
  4: '#0039A6', 5: '#0039A6',
  6: '#E03C31', 7: '#E03C31', 15: '#E03C31',
  8: '#A626AA',
  14: '#FCCC0A',
};

function categoryColor(cat) {
  return CATEGORY_COLORS[cat] || '#9B9B9B';
}

let trackHistoryCoords = [];  // smoothed historical waypoints (from API, computed once)
let trackLiveCoords = [];     // accumulated live interpolated positions (unsmoothed)
let trackHistoryLoaded = false; // gates rendering until history fetch completes
let trackBaseColor = '#9B9B9B'; // category color of the selected plane's trail

// --- Aircraft icons from tar1090 (GPL v2, wiedehopf/tar1090) ---
// Rendered as white-on-transparent SDF icons via SVG Path2D.

const ICON_SHAPES = {
  airliner: {
    viewBox: [-1, -2, 34, 34],
    path: 'M16 1c-.17 0-.67.58-.9 1.03-.6 1.21-.6 1.15-.65 5.2-.04 2.97-.08 3.77-.18 3.9-.15.17-1.82 1.1-1.98 1.1-.08 0-.1-.25-.05-.83.03-.5.01-.92-.05-1.08-.1-.25-.13-.26-.71-.26-.82 0-.86.07-.78 1.5.03.6.08 1.17.11 1.25.05.12-.02.2-.25.33l-8 4.2c-.2.2-.18.1-.19 1.29 3.9-1.2 3.71-1.21 3.93-1.21.06 0 .1 0 .13.14.08.3.28.3.28-.04 0-.25.03-.27 1.16-.6.65-.2 1.22-.35 1.28-.35.05 0 .12.04.15.17.07.3.27.27.27-.08 0-.25.01-.27.7-.47.68-.1.98-.09 1.47-.1.18 0 .22 0 .26.18.06.34.22.35.27-.01.04-.2.1-.17 1.06-.14l1.07.02.05 4.2c.05 3.84.07 4.28.26 5.09.11.49.2.99.2 1.11 0 .19-.31.43-1.93 1.5l-1.93 1.26v1.02l4.13-.95.63 1.54c.05.07.12.09.19.09s.14-.02.19-.09l.63-1.54 4.13.95V29.3l-1.93-1.27c-1.62-1.06-1.93-1.3-1.93-1.49 0-.12.09-.62.2-1.11.19-.81.2-1.25.26-5.09l.05-4.2 1.07-.02c.96-.03 1.02-.05 1.06.14.05.36.21.35.27 0 .04-.17.08-.16.26-.16.49 0 .8-.02 1.48.1.68.2.69.21.69.46 0 .35.2.38.27.08.03-.13.1-.17.15-.17.06 0 .63.15 1.28.34 1.13.34 1.16.36 1.16.61 0 .35.2.34.28.04.03-.13.07-.14.13-.14.22 0 .03 0 3.93 1.2-.01-1.18.02-1.07-.19-1.27l-8-4.21c-.23-.12-.3-.21-.25-.33.03-.08.08-.65.11-1.25.08-1.43.04-1.5-.78-1.5-.58 0-.61.01-.71.26-.06.16-.08.58-.05 1.08.04.58.03.83-.05.83-.16 0-1.83-.93-1.98-1.1-.1-.13-.14-.93-.18-3.9-.05-4.05-.05-3.99-.65-5.2C16.67 1.58 16.17 1 16 1z',
  },
  helicopter: {
    viewBox: [-13, -13, 90, 90],
    path: 'm 24.698,60.712 c 0,0 -0.450,2.134 -0.861,2.142 -0.561,0.011 -0.480,-3.836 -0.593,-5.761 -0.064,-1.098 1.381,-1.192 1.481,-0.042 l 5.464,0.007 -0.068,-9.482 -0.104,-1.108 c -2.410,-2.131 -3.028,-3.449 -3.152,-7.083 l -12.460,13.179 c -0.773,0.813 -2.977,0.599 -3.483,-0.428 L 26.920,35.416 26.866,29.159 11.471,14.513 c -0.813,-0.773 -0.599,-2.977 0.428,-3.483 l 14.971,14.428 0.150,-5.614 c -0.042,-1.324 1.075,-4.784 3.391,-5.633 0.686,-0.251 2.131,-0.293 3.033,0.008 2.349,0.783 3.433,4.309 3.391,5.633 l 0.073,4.400 12.573,-12.763 c 0.779,-0.807 2.977,-0.599 3.483,0.428 L 37.054,28.325 37.027,35.027 52.411,49.365 c 0.813,0.773 0.599,2.977 -0.428,3.483 L 36.992,38.359 c -0.124,3.634 -0.742,5.987 -3.152,8.118 l -0.104,1.108 -0.068,9.482 5.321,-0.068 c 0.101,-1.150 1.546,-1.057 1.481,0.042 -0.113,1.925 -0.032,5.772 -0.593,5.761 -0.412,-0.008 -0.861,-2.142 -0.861,-2.142 l -5.387,-0.011 0.085,9.377 -1.094,2.059 -1.386,-0.018 -1.093,-2.049 0.085,-9.377 z',
  },
  cessna: {
    viewBox: [0, -1, 32, 31],
    path: 'M16.36 20.96l2.57.27s.44.05.4.54l-.02.63s-.03.47-.45.54l-2.31.34-.44-.74-.22 1.63-.25-1.62-.38.73-2.35-.35s-.44-.1-.43-.6l-.02-.6s0-.5.48-.5l2.5-.27-.56-5.4-3.64-.1-5.83-1.02h-.45v-2.06s-.07-.37.46-.34l5.8-.17 3.55.12s-.1-2.52.52-2.82l-1.68-.04s-.1-.06 0-.14l1.94-.03s.35-1.18.7 0l1.91.04s.11.05 0 .14l-1.7.02s.62-.09.56 2.82l3.54-.1 5.81.17s.51-.04.48.35l-.01 2.06h-.47l-5.8 1-3.67.11z',
  },
  jet_swept: {
    viewBox: [-1, -1, 20, 26],
    path: 'M9.44,23c-.1.6-.35.6-.44.6s-.34,0-.44-.6l-3,.67V22.6A.54.54,0,0,1,6,22.05l2.38-1.12L8,19.33H6.69l0-.2a8.23,8.23,0,0,1-.14-3.85l.06-.18H7.73V13.19h-2L.26,14.29v-.93c0-.28.07-.46.22-.53l7.25-3.6V3.85A4.47,4.47,0,0,1,8.83.49L9,.34l.17.15a4.47,4.47,0,0,1,1.1,3.36V9.23l7.25,3.6c.14.07.22.25.22.53v.93l-5.51-1.1h-2V15.1h1.17l.06.18a8.24,8.24,0,0,1-.15,3.84l0,.2H10l-.36,1.6,2.43,1.14a.52.52,0,0,1,.35.53v1.08Z',
  },
};

function drawIconFromShape(shape) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const [vx, vy, vw, vh] = shape.viewBox;
  const padding = 2;
  const available = size - padding * 2;
  const scale = Math.min(available / vw, available / vh);
  const offsetX = padding + (available - vw * scale) / 2 - vx * scale;
  const offsetY = padding + (available - vh * scale) / 2 - vy * scale;

  ctx.fillStyle = '#ffffff';
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  ctx.fill(new Path2D(shape.path));

  return canvas;
}

function initMap() {
  map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/light-v11',
    center: [CENTER_LON, CENTER_LAT],
    zoom: 8.5,
  });

  map.on('load', () => {
    const jetCanvas = drawIconFromShape(ICON_SHAPES.airliner);
    const heliCanvas = drawIconFromShape(ICON_SHAPES.helicopter);
    const gaCanvas = drawIconFromShape(ICON_SHAPES.cessna);
    const bizjetCanvas = drawIconFromShape(ICON_SHAPES.jet_swept);

    Promise.all([
      createImageBitmap(jetCanvas),
      createImageBitmap(heliCanvas),
      createImageBitmap(gaCanvas),
      createImageBitmap(bizjetCanvas),
    ]).then(([jetBitmap, heliBitmap, gaBitmap, bizjetBitmap]) => {
      map.addImage('icon-jet', jetBitmap, { sdf: true });
      map.addImage('icon-helicopter', heliBitmap, { sdf: true });
      map.addImage('icon-ga', gaBitmap, { sdf: true });
      map.addImage('icon-bizjet', bizjetBitmap, { sdf: true });
      addLayers();
      startPolling();
    });
  });

  // Kiosk: after someone pans or zooms and walks away, drift back home.
  map.on('movestart', (e) => { if (e.originalEvent) noteInteraction(); });
  map.on('click', noteInteraction);
  map.on('touchstart', noteInteraction);

  map.on('click', 'planes-layer', onPlaneClick);
  map.on('mouseenter', 'planes-layer', () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', 'planes-layer', () => (map.getCanvas().style.cursor = ''));

  // Dismiss panel on clicking empty map
  map.on('click', (e) => {
    const features = map.queryRenderedFeatures(e.point, { layers: ['planes-layer'] });
    if (!features.length) dismissPanel();
  });
}

const HOME_VIEW = { center: [CENTER_LON, CENTER_LAT], zoom: 8.5, bearing: 0, pitch: 0 };
const IDLE_RECENTER_MS = 90 * 1000;
let idleTimer = null;

function noteInteraction() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(recenterHome, IDLE_RECENTER_MS);
}

function recenterHome() {
  idleTimer = null;
  dismissPanel();
  const c = map.getCenter();
  const moved = Math.abs(c.lng - HOME_VIEW.center[0]) > 1e-4
    || Math.abs(c.lat - HOME_VIEW.center[1]) > 1e-4
    || Math.abs(map.getZoom() - HOME_VIEW.zoom) > 0.01
    || map.getBearing() !== 0 || map.getPitch() !== 0;
  if (moved) map.easeTo({ ...HOME_VIEW, duration: 1500 });
}

function addLayers() {
  // Radius circle
  map.addSource('radius-circle', {
    type: 'geojson',
    data: makeCircle(CENTER_LAT, CENTER_LON, RADIUS_KM),
  });
  map.addLayer({
    id: 'radius-circle-layer',
    type: 'line',
    source: 'radius-circle',
    paint: {
      'line-color': '#AAAAAA',
      'line-opacity': 0.6,
      'line-width': 2,
    },
  });

  // Planes source + layer
  map.addSource('planes', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addLayer({
    id: 'planes-layer',
    type: 'symbol',
    source: 'planes',
    layout: {
      'icon-image': ['get', 'iconName'],
      'icon-size': ['case', ['get', 'onGround'], 0.5, 0.7],
      'icon-rotate': ['get', 'trueTrack'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      // Callsign labels
      'text-field': ['get', 'label'],
      'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 7, 0, 8, 12, 12, 14],
      'text-offset': [0, 1.8],
      'text-max-width': 12,
      'text-rotation-alignment': 'viewport',
      'text-allow-overlap': false,
      'text-optional': true,
    },
    paint: {
      'icon-color': ['get', 'color'],
      'icon-opacity': [
        'interpolate', ['linear'], ['zoom'],
        9, ['case', ['get', 'onGround'], 0, 1.0],
        10, ['case', ['get', 'onGround'], 0.5, 1.0],
      ],
      // Label styling
      'text-color': '#333333',
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.5,
      'text-opacity': [
        'interpolate', ['linear'], ['zoom'],
        7, 0,
        8, ['case', ['get', 'onGround'], 0, 1],
      ],
    },
  });

  // Track line (lineMetrics enables line-gradient paint property)
  map.addSource('track', {
    type: 'geojson',
    lineMetrics: true,
    data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } },
  });
  map.addLayer({
    id: 'track-layer',
    type: 'line',
    source: 'track',
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-width': 5,
      'line-gradient': [
        'interpolate', ['linear'], ['line-progress'],
        0, '#9B9B9B',
        1, '#0039A6',
      ],
    },
  });
}

function updatePlanes(geojson) {
  if (map.getSource('planes')) {
    map.getSource('planes').setData(geojson);
  }
}

function makeCircle(lat, lon, radiusKm) {
  const points = 64;
  const coords = [];
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const dLat = (radiusKm / 111.32) * Math.cos(angle);
    const dLon = (radiusKm / (111.32 * Math.cos(toRad(lat)))) * Math.sin(angle);
    coords.push([lon + dLon, lat + dLat]);
  }
  return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } };
}

async function onPlaneClick(e) {
  const feature = e.features[0];
  const props = feature.properties;
  const planeCoord = feature.geometry.coordinates;
  const clickedIcao = props.icao24;
  selectedIcao = clickedIcao;

  // Store the category color for gradient building
  trackBaseColor = props.onGround ? '#9B9B9B' : categoryColor(props.category);

  // Reset gradient to a default while loading (will be overwritten by altitude gradient)
  map.setPaintProperty('track-layer', 'line-gradient', [
    'interpolate', ['linear'], ['line-progress'],
    0, '#9B9B9B',
    1, trackBaseColor,
  ]);

  showInfoPanel(props);

  // Clear old track immediately, then accumulate new one
  trackHistoryCoords = [];
  trackLiveCoords = [];
  trackHistoryLoaded = false;
  map.getSource('track').setData({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [] },
  });

  // Fetch full historical track — guard against stale responses if user clicked another plane
  try {
    const trackData = await fetchTrack(clickedIcao);
    if (selectedIcao !== clickedIcao) return; // user clicked a different plane, discard
    if (trackData.path && trackData.path.length > 2) {
      const raw = trackData.path.map((wp) => [wp[2], wp[1], wp[3] || 0]); // [lon, lat, altitude]
      const smoothed = smoothPath(raw);
      // Search the ENTIRE smoothed path for the closest point to the aircraft.
      // trimPathAheadOfAircraft's limited window can miss when the path extends
      // far ahead — here we only run once per click so cost is trivial.
      let bestIdx = smoothed.length - 1;
      let bestDist = Infinity;
      for (let i = 0; i < smoothed.length; i++) {
        const dx = smoothed[i][0] - planeCoord[0];
        const dy = smoothed[i][1] - planeCoord[1];
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }
      trackHistoryCoords = smoothed.slice(0, bestIdx + 1);
    }
  } catch (err) {
    console.warn('Track fetch failed:', err.message);
  }
  // Mark loaded (even on failure) so live coords render going forward
  if (selectedIcao === clickedIcao) {
    trackHistoryLoaded = true;
  }
}

function showInfoPanel(props) {
  const panel = document.getElementById('plane-info-panel');

  panel.innerHTML = `
    <button id="panel-close" aria-label="Close">&times;</button>
    <div class="panel-body">
      <div id="info-photo-wrap" class="info-photo-wrap"></div>
      <div class="panel-details">
        <h2>${props.callsign || props.icao24}</h2>
        <div class="info-grid">
          <div class="info-item"><span class="label">ICAO24</span><span class="value">${props.icao24}</span></div>
          <div class="info-item"><span class="label">Registration</span><span class="value" id="info-reg">—</span></div>
          <div class="info-item"><span class="label">Country</span><span class="value">${props.originCountry}</span></div>
          <div class="info-item"><span class="label">Type</span><span class="value" id="info-type">—</span></div>
          <div class="info-item"><span class="label">Route</span><span class="value" id="info-route">—</span></div>
          <div class="info-item"><span class="label">Altitude</span><span class="value" id="info-altitude">${metersToFeet(props.altitude)} ft</span></div>
          <div class="info-item"><span class="label">Speed</span><span class="value" id="info-speed">${msToKnots(props.velocity)} kts</span></div>
          <div class="info-item"><span class="label">Vert Rate</span><span class="value" id="info-vrate">${verticalRateDisplay(props.verticalRate)}</span></div>
          <div class="info-item"><span class="label">Heading</span><span class="value" id="info-heading">${props.trueTrack != null ? props.trueTrack.toFixed(0) + '°' : '—'}</span></div>
        </div>
      </div>
    </div>
  `;
  panel.classList.add('visible');

  document.getElementById('panel-close').addEventListener('click', dismissPanel);

  // Show type from tar1090-db cache immediately, fall back to adsbdb
  const cached = typeCache[props.icao24];
  if (cached?.type) {
    const el = document.getElementById('info-type');
    if (el) el.textContent = cached.type;
    if (cached.reg) {
      const regEl = document.getElementById('info-reg');
      if (regEl) regEl.textContent = cached.reg;
    }
  } else {
    fetchAircraftInfo(props.icao24).then((ac) => {
      if (!ac || selectedIcao !== props.icao24) return;
      const el = document.getElementById('info-type');
      if (el) el.textContent = ac.type || ac.icao_type || '—';
      if (ac.registration) {
        const regEl = document.getElementById('info-reg');
        if (regEl) regEl.textContent = ac.registration;
        loadPhoto(ac.registration);
      }
    }).catch(() => {});
  }

  const knownRoute = routeCache[props.callsign];
  if (knownRoute) {
    document.getElementById('info-route').textContent = knownRoute;
  } else if (knownRoute === undefined && props.callsign) {
    fetchRouteInfo(props.callsign).then((route) => {
      const el = document.getElementById('info-route');
      if (el && route) {
        const orig = route.origin?.iata_code || route.origin?.icao_code || '?';
        const dest = route.destination?.iata_code || route.destination?.icao_code || '?';
        el.textContent = `${orig} → ${dest}`;
      }
    }).catch(() => {});
  }

  // Fetch aircraft photo via JetAPI (needs registration)
  if (cached?.reg) loadPhoto(cached.reg);
}

function loadPhoto(reg) {
  fetchAircraftPhoto(reg).then((photo) => {
    const wrap = document.getElementById('info-photo-wrap');
    if (!wrap || !photo) return;
    wrap.innerHTML = `
      <a href="${photo.link}" target="_blank" rel="noopener">
        <img src="${photo.thumbnail}" alt="${photo.aircraft || 'Aircraft photo'}">
        <span class="photo-credit">${photo.photographer || ''}</span>
      </a>
    `;
  }).catch(() => {});
}

// Update the dynamic values in the info panel (called from animation loop)
function updateInfoPanel(props) {
  const alt = document.getElementById('info-altitude');
  const spd = document.getElementById('info-speed');
  const vr = document.getElementById('info-vrate');
  const hdg = document.getElementById('info-heading');
  if (alt) alt.textContent = `${metersToFeet(props.altitude)} ft`;
  if (spd) spd.textContent = `${msToKnots(props.velocity)} kts`;
  if (vr) vr.textContent = verticalRateDisplay(props.verticalRate);
  if (hdg) hdg.textContent = props.trueTrack != null ? props.trueTrack.toFixed(0) + '°' : '—';
}

// Called from the animation loop — the live coord IS the plane's displayed position.
// liveCoord: [lon, lat], altitude: meters (separate param for gradient coloring)
function updateTrackLine(liveCoord, altitude) {
  if (!map.getSource('track')) return;

  const liveCoord3 = [liveCoord[0], liveCoord[1], altitude || 0];

  // Trim stale live coords that overshot past the plane (e.g. extrapolation
  // followed by a correction). Find the closest existing point to the plane's
  // current position and discard everything after it, THEN append liveCoord.
  if (trackLiveCoords.length > 1) {
    const searchLen = Math.min(30, trackLiveCoords.length);
    const startIdx = trackLiveCoords.length - searchLen;
    let bestIdx = trackLiveCoords.length - 1;
    let bestDist = Infinity;
    for (let i = startIdx; i < trackLiveCoords.length; i++) {
      const dx = trackLiveCoords[i][0] - liveCoord[0];
      const dy = trackLiveCoords[i][1] - liveCoord[1];
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    if (bestIdx < trackLiveCoords.length - 1) {
      trackLiveCoords.length = bestIdx + 1;
    }
  }

  // Append current position — increased minimum spacing (~50m) for smoother live trail
  const last = trackLiveCoords[trackLiveCoords.length - 1]
    || trackHistoryCoords[trackHistoryCoords.length - 1];
  if (!last || Math.abs(liveCoord[0] - last[0]) > 0.0005 || Math.abs(liveCoord[1] - last[1]) > 0.0005) {
    trackLiveCoords.push(liveCoord3);
  } else if (trackLiveCoords.length > 0) {
    // Update altitude of last point even if position didn't change enough
    trackLiveCoords[trackLiveCoords.length - 1][2] = altitude || 0;
  }

  // Don't render until history fetch completes (avoids partial → full flash)
  if (!trackHistoryLoaded) return;

  // Smooth the live portion with light Catmull-Rom (4 segments, not 16)
  const smoothedLive = trackLiveCoords.length >= 4
    ? smoothPath(trackLiveCoords, 4)
    : trackLiveCoords;
  const coords = [...trackHistoryCoords, ...smoothedLive];

  // Build and apply altitude-lightness gradient using the plane's category color
  if (coords.length >= 2) {
    const gradient = buildTrailGradient(coords, trackBaseColor);
    map.setPaintProperty('track-layer', 'line-gradient', gradient);
  }

  map.getSource('track').setData({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: coords.map(c => [c[0], c[1]]) },
  });
}

function dismissPanel() {
  document.getElementById('plane-info-panel').classList.remove('visible');
  selectedIcao = null;
  trackHistoryCoords = [];
  trackLiveCoords = [];
  trackHistoryLoaded = false;
  trackBaseColor = '#9B9B9B';
  if (map.getSource('track')) {
    map.getSource('track').setData({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [] },
    });
  }
}
