// Sky-map API proxy for the kiosk server. Node port of sky-map/proxy.py.
//
// Handles the same routes the Cloudflare worker does, so the sky map works
// entirely from the laptop:
//   GET  /api/*                   OpenSky (OAuth2 if sky-map/credentials.json exists, else anonymous)
//   GET  /db/<name>.js            tar1090-db chunks, cached on disk in sky-map/db-cache
//   GET  /lookup/*                adsbdb aircraft / callsign lookups
//   POST /lookup/aircraft/batch   several adsbdb aircraft lookups at once
//   GET  /jetapi/<reg>            jetapi.dev aircraft photos
//
// Needs Node 18+ (global fetch).

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OPENSKY_BASE = 'https://opensky-network.org';
const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const ADSBDB_BASE = 'https://api.adsbdb.com/v0';
const TAR1090_DB_BASE = 'https://raw.githubusercontent.com/wiedehopf/tar1090-db/master/db';
const JETAPI_BASE = 'https://www.jetapi.dev/api';
const UA = { 'User-Agent': 'sky-map/1.0' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

let skyDir, credsPath, cacheDir;
let creds = null;
let cachedToken = null;
let tokenExpiry = 0;
let warnedAnonymous = false;

function init(root) {
  skyDir = path.join(root, 'sky-map');
  credsPath = path.join(skyDir, 'credentials.json');
  cacheDir = path.join(skyDir, 'db-cache');
  try {
    creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    console.log('sky-map: using OpenSky credentials from', path.relative(root, credsPath));
  } catch {
    creds = null;
    console.log('sky-map: no credentials.json, OpenSky requests will be anonymous (lower rate limit)');
  }
}

function sendJson(res, status, body, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS, ...extra });
  res.end(JSON.stringify(body));
}

async function getToken() {
  if (!creds) return null;
  if (cachedToken && Date.now() / 1000 < tokenExpiry - 60) return cachedToken;
  try {
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`token request failed: ${r.status}`);
    const data = await r.json();
    cachedToken = data.access_token;
    tokenExpiry = Date.now() / 1000 + data.expires_in;
    console.log(`sky-map: OpenSky token acquired, expires in ${data.expires_in}s`);
    return cachedToken;
  } catch (e) {
    if (!warnedAnonymous) {
      console.warn('sky-map: OpenSky auth failed, falling back to anonymous:', e.message);
      warnedAnonymous = true;
    }
    return null;
  }
}

async function pipeUpstream(res, upstreamUrl, opts = {}, forwardHeaders = []) {
  const r = await fetch(upstreamUrl, { ...opts, signal: AbortSignal.timeout(opts.timeout || 15000) });
  const body = Buffer.from(await r.arrayBuffer());
  const headers = { 'Content-Type': 'application/json', ...CORS };
  for (const h of forwardHeaders) {
    const v = r.headers.get(h);
    if (v) headers[h] = v;
  }
  res.writeHead(r.status, headers);
  res.end(body);
}

async function handleApi(res, url) {
  const token = await getToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  await pipeUpstream(res, OPENSKY_BASE + url.pathname + url.search, { headers },
    ['X-Rate-Limit-Remaining', 'X-Rate-Limit-Retry-After-Seconds']);
}

async function handleDb(res, url) {
  const name = url.pathname.slice('/db/'.length);
  if (!name.endsWith('.js') || name.includes('/') || name.includes('..')) {
    return sendJson(res, 400, { error: 'bad request' });
  }
  fs.mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, name);
  if (!fs.existsSync(file)) {
    const r = await fetch(`${TAR1090_DB_BASE}/${name}`, { headers: UA, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return sendJson(res, r.status, { error: `upstream ${r.status}` });
    let raw = Buffer.from(await r.arrayBuffer());
    // tar1090-db files are pre-gzipped in the repo (magic bytes 1f 8b)
    if (!(raw[0] === 0x1f && raw[1] === 0x8b)) raw = zlib.gzipSync(raw);
    fs.writeFileSync(file, raw);
    console.log('sky-map: cached db chunk', name);
  }
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Encoding': 'gzip',
    'Cache-Control': 'public, max-age=86400',
    ...CORS,
  });
  res.end(fs.readFileSync(file));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleLookupBatch(req, res) {
  const { icao24s } = JSON.parse(await readBody(req) || '{}');
  if (!Array.isArray(icao24s)) return sendJson(res, 400, { error: 'icao24s must be array' });
  const results = {};
  await Promise.all(icao24s.map(async icao24 => {
    try {
      const r = await fetch(`${ADSBDB_BASE}/aircraft/${encodeURIComponent(icao24)}`,
        { headers: UA, signal: AbortSignal.timeout(5000) });
      results[icao24] = r.ok ? await r.json() : null;
    } catch {
      results[icao24] = null;
    }
  }));
  sendJson(res, 200, results);
}

async function handleLookup(res, url) {
  const rest = url.pathname.replace('/lookup/', '');
  await pipeUpstream(res, `${ADSBDB_BASE}/${rest}`, { headers: UA, timeout: 8000 });
}

async function handleJetApi(res, url) {
  const reg = url.pathname.split('/jetapi/').pop();
  if (!reg) return sendJson(res, 400, { error: 'missing registration' });
  await pipeUpstream(res, `${JETAPI_BASE}?reg=${encodeURIComponent(reg)}&photos=1&flights=0`,
    { headers: UA, timeout: 8000 });
}

// Returns true if the request was one of ours (and has been answered).
function handle(req, res, url) {
  const p = url.pathname;
  let job;
  if (req.method === 'OPTIONS' && /^\/(api|db|lookup|jetapi)\//.test(p)) {
    res.writeHead(204, CORS); res.end(); return true;
  }
  if (p.startsWith('/api/')) job = handleApi(res, url);
  else if (p.startsWith('/db/')) job = handleDb(res, url);
  else if (p === '/lookup/aircraft/batch' && req.method === 'POST') job = handleLookupBatch(req, res);
  else if (p.startsWith('/lookup/')) job = handleLookup(res, url);
  else if (p.startsWith('/jetapi/')) job = handleJetApi(res, url);
  else return false;

  job.catch(e => {
    console.warn('sky-map proxy error:', p, e.message);
    if (!res.headersSent) sendJson(res, 502, { error: e.message });
    else res.end();
  });
  return true;
}

module.exports = { init, handle };
