"""
Local dev server: serves static files and proxies /api/ requests to OpenSky
with OAuth2 token management. No dependencies beyond Python 3 stdlib.

Usage: python3 proxy.py
Then open http://localhost:8000
"""

import http.server
import gzip
import json
import os
import time
import urllib.request
import urllib.parse
import urllib.error
from concurrent.futures import ThreadPoolExecutor

DB_CACHE_DIR = os.path.join(os.path.dirname(__file__) or '.', 'db-cache')
TAR1090_DB_BASE = 'https://raw.githubusercontent.com/wiedehopf/tar1090-db/master/db'

PORT = 8000
OPENSKY_BASE = 'https://opensky-network.org'
TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token'

# Load credentials
with open(os.path.join(os.path.dirname(__file__) or '.', 'credentials.json')) as f:
    creds = json.load(f)

cached_token = None
token_expiry = 0


def get_token():
    global cached_token, token_expiry
    if cached_token and time.time() < token_expiry - 60:
        return cached_token

    body = urllib.parse.urlencode({
        'grant_type': 'client_credentials',
        'client_id': creds['clientId'],
        'client_secret': creds['clientSecret'],
    }).encode()

    req = urllib.request.Request(TOKEN_URL, data=body, headers={
        'Content-Type': 'application/x-www-form-urlencoded',
    })
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read())

    cached_token = data['access_token']
    token_expiry = time.time() + data['expires_in']
    print(f"Token acquired, expires in {data['expires_in']}s")
    return cached_token


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.end_headers()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == '/lookup/aircraft/batch':
            self.proxy_lookup_batch()
        else:
            self.send_response(404)
            self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith('/api/'):
            self.proxy_api()
        elif parsed.path.startswith('/db/'):
            self.serve_db_chunk()
        elif parsed.path.startswith('/jetapi/'):
            self.proxy_jetapi()
        elif parsed.path.startswith('/lookup/'):
            self.proxy_lookup()
        else:
            super().do_GET()

    def proxy_api(self):
        try:
            token = get_token()
            url = OPENSKY_BASE + self.path
            print(f"Proxying: {url}")

            req = urllib.request.Request(url, headers={
                'Authorization': f'Bearer {token}',
            })
            with urllib.request.urlopen(req) as resp:
                body = resp.read()
                self.send_response(resp.status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                # Forward rate-limit headers
                for h in ('X-Rate-Limit-Remaining', 'X-Rate-Limit-Retry-After-Seconds'):
                    val = resp.getheader(h)
                    if val:
                        self.send_header(h, val)
                self.end_headers()
                self.wfile.write(body)

        except urllib.error.HTTPError as e:
            body = e.read()
            self.send_response(e.code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(body)

        except Exception as e:
            print(f"Proxy error: {e}")
            self.send_response(502)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    def proxy_lookup_batch(self):
        """Fetch multiple aircraft from adsbdb in parallel."""
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length))
            icao24s = body.get('icao24s', [])
            print(f"Batch lookup: {len(icao24s)} aircraft")

            def fetch_one(icao24):
                try:
                    url = f'https://api.adsbdb.com/v0/aircraft/{icao24}'
                    req = urllib.request.Request(url, headers={
                        'User-Agent': 'sky-map/1.0',
                    })
                    with urllib.request.urlopen(req, timeout=2) as resp:
                        return icao24, json.loads(resp.read())
                except Exception:
                    return icao24, None

            results = {}
            with ThreadPoolExecutor(max_workers=min(len(icao24s), 20)) as pool:
                for icao24, data in pool.map(lambda i: fetch_one(i), icao24s):
                    results[icao24] = data

            out = json.dumps(results).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(out)

        except Exception as e:
            print(f"Batch lookup error: {e}")
            self.send_response(502)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    def proxy_jetapi(self):
        """Proxy requests to jetapi.dev for aircraft photos."""
        try:
            parsed = urllib.parse.urlparse(self.path)
            reg = parsed.path.split('/jetapi/')[-1]
            if not reg:
                self.send_response(400)
                self.end_headers()
                return

            url = f'https://www.jetapi.dev/api?reg={urllib.parse.quote(reg)}&photos=1&flights=0'
            print(f"JetAPI lookup: {url}")
            req = urllib.request.Request(url, headers={
                'User-Agent': 'sky-map/1.0',
            })
            with urllib.request.urlopen(req, timeout=5) as resp:
                body = resp.read()
                self.send_response(resp.status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(body)

        except Exception as e:
            print(f"JetAPI error: {e}")
            self.send_response(502)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    def serve_db_chunk(self):
        """Serve tar1090-db chunk files, caching to disk on first fetch."""
        try:
            # Extract filename from /db/<name>.js
            parsed = urllib.parse.urlparse(self.path)
            name = parsed.path[len('/db/'):]  # e.g. "A0.js" or "icao_aircraft_types.js"
            if not name.endswith('.js') or '/' in name or '..' in name:
                self.send_response(400)
                self.end_headers()
                return

            os.makedirs(DB_CACHE_DIR, exist_ok=True)
            cache_path = os.path.join(DB_CACHE_DIR, name)

            if not os.path.exists(cache_path):
                url = f'{TAR1090_DB_BASE}/{name}'
                print(f"Fetching db chunk: {url}")
                req = urllib.request.Request(url, headers={
                    'User-Agent': 'sky-map/1.0',
                })
                with urllib.request.urlopen(req, timeout=10) as resp:
                    raw = resp.read()
                    # tar1090-db files are pre-gzipped in the repo (magic bytes 1f 8b)
                    if raw[:2] == b'\x1f\x8b':
                        data = raw
                    else:
                        data = gzip.compress(raw)
                    with open(cache_path, 'wb') as f:
                        f.write(data)

            with open(cache_path, 'rb') as f:
                body = f.read()

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Encoding', 'gzip')
            self.send_header('Cache-Control', 'public, max-age=86400')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(body)

        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': f'Upstream {e.code}'}).encode())

        except Exception as e:
            print(f"DB chunk error: {e}")
            self.send_response(502)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    def proxy_lookup(self):
        """Proxy requests to adsbdb.com for aircraft type and route lookups."""
        try:
            # /lookup/aircraft/ICAO24 -> https://api.adsbdb.com/v0/aircraft/ICAO24
            # /lookup/callsign/CS     -> https://api.adsbdb.com/v0/callsign/CS
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path.replace('/lookup/', '', 1)
            url = f'https://api.adsbdb.com/v0/{path}'
            print(f"Lookup: {url}")

            req = urllib.request.Request(url, headers={
                'User-Agent': 'sky-map/1.0',
            })
            with urllib.request.urlopen(req, timeout=5) as resp:
                body = resp.read()
                self.send_response(resp.status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(body)

        except Exception as e:
            print(f"Lookup error: {e}")
            self.send_response(502)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())


if __name__ == '__main__':
    os.chdir(os.path.dirname(__file__) or '.')
    server = http.server.ThreadingHTTPServer(('', PORT), Handler)
    print(f"Serving on http://localhost:{PORT}")
    server.serve_forever()
