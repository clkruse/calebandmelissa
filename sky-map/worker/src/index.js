// Cloudflare Worker — replaces proxy.py for production
// Routes: /api/*, /db/*.js, /lookup/*, /jetapi/*

const OPENSKY_BASE = 'https://opensky-network.org';
const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const ADSBDB_BASE = 'https://api.adsbdb.com/v0';
const TAR1090_DB_BASE = 'https://raw.githubusercontent.com/wiedehopf/tar1090-db/master/db';
const JETAPI_BASE = 'https://www.jetapi.dev/api';

// Module-level token cache (persists across requests in same isolate)
let cachedToken = null;
let tokenExpiry = 0;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

function corsJson(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...extraHeaders },
  });
}

async function getToken(env) {
  if (cachedToken && Date.now() / 1000 < tokenExpiry - 60) {
    return cachedToken;
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.OPENSKY_CLIENT_ID,
      client_secret: env.OPENSKY_CLIENT_SECRET,
    }),
  });

  if (!res.ok) throw new Error(`Token request failed: ${res.status}`);
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() / 1000 + data.expires_in;
  return cachedToken;
}

// --- Route handlers ---

async function handleApi(request, env) {
  const url = new URL(request.url);
  const upstream = OPENSKY_BASE + url.pathname + url.search;

  try {
    const token = await getToken(env);
    const res = await fetch(upstream, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = await res.arrayBuffer();
    const headers = { 'Content-Type': 'application/json', ...CORS_HEADERS };

    // Forward rate-limit headers
    for (const h of ['X-Rate-Limit-Remaining', 'X-Rate-Limit-Retry-After-Seconds']) {
      const val = res.headers.get(h);
      if (val) headers[h] = val;
    }

    return new Response(body, { status: res.status, headers });
  } catch (e) {
    return corsJson({ error: e.message }, 502);
  }
}

async function handleDb(request) {
  const url = new URL(request.url);
  const name = url.pathname.slice('/db/'.length); // e.g. "A0.js"

  if (!name.endsWith('.js') || name.includes('/') || name.includes('..')) {
    return corsJson({ error: 'Bad request' }, 400);
  }

  // Check CF Cache first
  const cache = caches.default;
  const cacheKey = new Request(request.url, request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const upstream = `${TAR1090_DB_BASE}/${name}`;
    const res = await fetch(upstream, {
      headers: { 'User-Agent': 'sky-map/1.0' },
    });

    if (!res.ok) {
      return corsJson({ error: `Upstream ${res.status}` }, res.status);
    }

    const body = await res.arrayBuffer();
    const response = new Response(body, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        'Cache-Control': 'public, max-age=86400',
        ...CORS_HEADERS,
      },
    });

    // Store in CF cache (won't throw if it fails)
    request.method === 'GET' && cache.put(cacheKey, response.clone());

    return response;
  } catch (e) {
    return corsJson({ error: e.message }, 502);
  }
}

async function handleLookup(request) {
  const url = new URL(request.url);
  const path = url.pathname.replace('/lookup/', '');
  const upstream = `${ADSBDB_BASE}/${path}`;

  try {
    const res = await fetch(upstream, {
      headers: { 'User-Agent': 'sky-map/1.0' },
    });
    const body = await res.arrayBuffer();
    return new Response(body, {
      status: res.status,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  } catch (e) {
    return corsJson({ error: e.message }, 502);
  }
}

async function handleLookupBatch(request) {
  try {
    const { icao24s } = await request.json();
    if (!Array.isArray(icao24s)) return corsJson({ error: 'icao24s must be array' }, 400);

    const results = {};
    const fetches = icao24s.map(async (icao24) => {
      try {
        const res = await fetch(`${ADSBDB_BASE}/aircraft/${icao24}`, {
          headers: { 'User-Agent': 'sky-map/1.0' },
        });
        results[icao24] = res.ok ? await res.json() : null;
      } catch {
        results[icao24] = null;
      }
    });

    await Promise.all(fetches);
    return corsJson(results);
  } catch (e) {
    return corsJson({ error: e.message }, 502);
  }
}

async function handleJetApi(request) {
  const url = new URL(request.url);
  const reg = url.pathname.split('/jetapi/').pop();
  if (!reg) return corsJson({ error: 'Missing registration' }, 400);

  try {
    const upstream = `${JETAPI_BASE}?reg=${encodeURIComponent(reg)}&photos=1&flights=0`;
    const res = await fetch(upstream, {
      headers: { 'User-Agent': 'sky-map/1.0' },
    });
    const body = await res.arrayBuffer();
    return new Response(body, {
      status: res.status,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  } catch (e) {
    return corsJson({ error: e.message }, 502);
  }
}

// --- Main router ---

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith('/api/')) return handleApi(request, env);
    if (path.startsWith('/db/')) return handleDb(request);
    if (path === '/lookup/aircraft/batch' && request.method === 'POST') return handleLookupBatch(request);
    if (path.startsWith('/lookup/')) return handleLookup(request);
    if (path.startsWith('/jetapi/')) return handleJetApi(request);

    if (path === '/debug/external') {
      const results = {};
      const urls = [
        'https://httpbin.org/get',
        'https://api.github.com',
        'https://opensky-network.org/api/states/all?lamin=40&lamax=42&lomin=-74&lomax=-72',
        'https://auth.opensky-network.org/auth/realms/opensky-network',
      ];
      for (const u of urls) {
        try {
          const r = await fetch(u, { headers: { 'User-Agent': 'sky-map/1.0' } });
          results[u] = r.status;
        } catch (e) {
          results[u] = e.message;
        }
      }
      return corsJson(results);
    }

    if (path === '/debug/token') {
      try {
        const body = `grant_type=client_credentials&client_id=${encodeURIComponent(env.OPENSKY_CLIENT_ID)}&client_secret=${encodeURIComponent(env.OPENSKY_CLIENT_SECRET)}`;
        const res = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'sky-map/1.0',
          },
          body,
        });
        const text = await res.text();
        return corsJson({ status: res.status, bodyPreview: text.slice(0, 200), clientIdLength: (env.OPENSKY_CLIENT_ID || '').length });
      } catch (e) {
        return corsJson({ error: e.message, stack: e.stack });
      }
    }

    return corsJson({ error: 'Not found' }, 404);
  },
};
