#!/usr/bin/env node
// Home kiosk server. Zero dependencies: `node kiosk/server.js`
//
// Serves this repo over plain HTTP on the local network and remembers which
// "app" (page) the iPad should be showing. Anything on the LAN can switch it:
//
//   GET /show/<name>   -> switch the iPad to that app (Matterbridge calls this)
//   GET /current       -> JSON { app, url }
//   GET /events        -> Server-Sent Events stream of app changes
//   GET /kiosk/        -> tap-to-switch control page (handy from a phone)
//
// It also proxies the sky-map's data routes (/api, /db, /lookup, /jetapi)
// so the planes page runs without the Cloudflare worker. See skyproxy.js.
//
// Add a new app: drop a page in the repo, add a line to APPS, restart.

const http = require('http');
const fs = require('fs');
const path = require('path');
const skyproxy = require('./skyproxy');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_APP = process.env.DEFAULT_APP || 'photoframe';

// name -> path on this server. Names are what you say to Google Home.
const APPS = {
  photoframe: '/photoframe.html',
  planes: '/sky-map/',
};

let current = APPS[DEFAULT_APP] ? DEFAULT_APP : Object.keys(APPS)[0];
skyproxy.init(ROOT);
const listeners = new Set();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8', '.gpx': 'application/gpx+xml', '.csv': 'text/csv',
};

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(body));
}

function state() {
  return { app: current, url: APPS[current], apps: Object.keys(APPS) };
}

function broadcast() {
  const payload = `data: ${JSON.stringify(state())}\n\n`;
  for (const res of listeners) res.write(payload);
}

function show(name) {
  if (!APPS[name]) return false;
  if (name !== current) {
    current = name;
    console.log(new Date().toISOString(), 'show', name);
    broadcast();
  }
  return true;
}

function serveStatic(req, res, urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath); } catch { return json(res, 400, { error: 'bad path' }); }
  let file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) return json(res, 403, { error: 'forbidden' });

  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) {
      if (!urlPath.endsWith('/')) {
        res.writeHead(301, { Location: urlPath + '/' });
        return res.end();
      }
      file = path.join(file, 'index.html');
    }
    fs.readFile(file, (err2, data) => {
      if (err2) return json(res, 404, { error: 'not found' });
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    });
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/current') return json(res, 200, state());

  if (p.startsWith('/show/')) {
    const name = p.slice('/show/'.length).replace(/\/+$/, '');
    if (show(name)) return json(res, 200, state());
    return json(res, 404, { error: `unknown app "${name}"`, apps: Object.keys(APPS) });
  }

  if (p === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(`retry: 2000\n`);
    res.write(`data: ${JSON.stringify(state())}\n\n`);
    listeners.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); listeners.delete(res); });
    return;
  }

  if (skyproxy.handle(req, res, url)) return;

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json(res, 405, { error: 'method not allowed' });
  }
  return serveStatic(req, res, p);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`kiosk server on http://0.0.0.0:${PORT}  (default app: ${current})`);
  console.log(`apps: ${Object.entries(APPS).map(([k, v]) => `${k} -> ${v}`).join(', ')}`);
});
