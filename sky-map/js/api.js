// Served over plain http (the home kiosk server or proxy.py) the page's own
// origin proxies the data routes. On the public https site, use the worker.
const API_BASE = location.protocol === 'http:' ? '' : 'https://sky-map-api.caleb-krs.workers.dev';

let rateLimitRemaining = null;

async function fetchStates(bbox) {
  const params = new URLSearchParams({
    lamin: bbox.lamin,
    lamax: bbox.lamax,
    lomin: bbox.lomin,
    lomax: bbox.lomax,
    extended: '1',
  });

  const res = await fetch(`${API_BASE}/api/states/all?${params}`);

  const rl = res.headers.get('x-rate-limit-remaining');
  if (rl != null) rateLimitRemaining = parseInt(rl, 10);

  if (res.status === 429) {
    const err = new Error('Rate limited');
    err.retryAfter = parseInt(res.headers.get('x-rate-limit-retry-after-seconds') || '60', 10);
    throw err;
  }

  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

async function fetchTrack(icao24) {
  const params = new URLSearchParams({ icao24, time: '0' });
  const res = await fetch(`${API_BASE}/api/tracks/all?${params}`);

  if (!res.ok) throw new Error(`Track API error ${res.status}`);
  return res.json();
}

async function fetchAircraftInfo(icao24) {
  const res = await fetch(`${API_BASE}/lookup/aircraft/${icao24}`);
  if (!res.ok) return null;
  const data = await res.json();
  // adsbdb returns { response: { aircraft: { type, ... } } }
  return data.response?.aircraft || null;
}

// tar1090-db chunk loader
const _chunkCache = {};  // name -> parsed JSON (in-memory, one fetch per session)

async function fetchDbChunk(name) {
  if (_chunkCache[name]) return _chunkCache[name];
  const res = await fetch(`${API_BASE}/db/${name}.js`);
  if (!res.ok) throw new Error(`DB chunk ${name}: ${res.status}`);
  const data = await res.json();
  _chunkCache[name] = data;
  return data;
}

let _typeCodeDb = null;

async function fetchTypeCodeDb() {
  if (_typeCodeDb) return _typeCodeDb;
  const res = await fetch(`${API_BASE}/db/icao_aircraft_types.js`);
  if (!res.ok) throw new Error(`Type code DB: ${res.status}`);
  _typeCodeDb = await res.json();
  return _typeCodeDb;
}

async function fetchAircraftPhoto(reg) {
  if (!reg) return null;
  const res = await fetch(`${API_BASE}/jetapi/${encodeURIComponent(reg)}`);
  if (!res.ok) return null;
  const data = await res.json();
  const img = data?.JetPhotos?.Images?.[0];
  if (!img) return null;
  return {
    thumbnail: img.Thumbnail,
    full: img.Image,
    link: img.Link,
    photographer: img.Photographer,
    aircraft: img.Aircraft,
  };
}

async function fetchRouteInfo(callsign) {
  if (!callsign) return null;
  const res = await fetch(`${API_BASE}/lookup/callsign/${callsign}`);
  if (!res.ok) return null;
  const data = await res.json();
  // adsbdb returns { response: { flightroute: { origin: {...}, destination: {...} } } }
  return data.response?.flightroute || null;
}
