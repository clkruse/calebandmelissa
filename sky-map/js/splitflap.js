// Split-flap departure board — Solari-style overlay
// Shows info about the nearest aircraft to the map's visual center.
// Animation inspired by github.com/third774/split-flap-display + codepen.io/jh3y/pen/dPyBXOG

const SPLITFLAP_ROWS = [
  { id: 'sf-flight', label: 'FLIGHT', chars: 8 },
  { id: 'sf-type',   label: 'TYPE',   chars: 20 },
  { id: 'sf-data',   label: 'DATA',   chars: 22 },
];

// Character alphabet — cells cycle through this sequence to reach the target
const SF_ALPHABET = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-→°·.';
const SF_CHAR_INDEX = {};
for (let i = 0; i < SF_ALPHABET.length; i++) SF_CHAR_INDEX[SF_ALPHABET[i]] = i;

const SF_FLIP_MIN_MS = 50;   // fastest flip speed (mid-cycle)
const SF_FLIP_MAX_MS = 200;  // slowest flip speed (settling)
const SF_DECEL_ZONE = 8;     // start decelerating this many steps from target
const SF_STAGGER_MS = 80;    // cascade delay per character position

function _sfEaseOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

let _sfCells = {};        // rowId -> array of cell state objects
let _sfValues = {};       // rowId -> current target string
let _sfLastUpdate = 0;    // throttle timestamp
let _sfCachedNearest = null;

function initSplitFlap() {
  const board = document.getElementById('splitflap');
  if (!board) return;

  const title = document.createElement('div');
  title.className = 'sf-title';
  title.textContent = 'Nearest Aircraft';
  board.appendChild(title);

  for (const row of SPLITFLAP_ROWS) {
    const rowEl = document.createElement('div');
    rowEl.className = 'sf-row';

    const labelEl = document.createElement('span');
    labelEl.className = 'sf-label';
    labelEl.textContent = row.label;
    rowEl.appendChild(labelEl);

    const cellsWrap = document.createElement('div');
    cellsWrap.className = 'sf-cells';

    const cells = [];
    for (let i = 0; i < row.chars; i++) {
      const cell = document.createElement('div');
      cell.className = 'sf-cell';

      // 4-layer structure: static top/bottom + animated flap top/bottom
      const staticTop = document.createElement('div');
      staticTop.className = 'sf-half sf-static-top';
      const staticTopSpan = document.createElement('span');
      staticTopSpan.textContent = ' ';
      staticTop.appendChild(staticTopSpan);

      const staticBottom = document.createElement('div');
      staticBottom.className = 'sf-half sf-static-bottom';
      const staticBottomSpan = document.createElement('span');
      staticBottomSpan.textContent = ' ';
      staticBottom.appendChild(staticBottomSpan);

      cell.appendChild(staticTop);
      cell.appendChild(staticBottom);
      cellsWrap.appendChild(cell);

      cells.push({
        el: cell,
        staticTop: staticTopSpan,
        staticBottom: staticBottomSpan,
        currentIdx: 0,
        targetIdx: 0,
        flipping: false,
        colIndex: i,  // for stagger delay
      });
    }

    rowEl.appendChild(cellsWrap);
    board.appendChild(rowEl);
    _sfCells[row.id] = cells;
    _sfValues[row.id] = ''.padEnd(row.chars);
  }
}

function updateSplitFlap(geojson) {
  if (!geojson || !geojson.features) return;

  const now = Date.now();
  if (now - _sfLastUpdate < 300) return;
  _sfLastUpdate = now;

  const center = map.getCenter();
  let nearest = null;
  let nearestDist = Infinity;

  for (const f of geojson.features) {
    const [lon, lat] = f.geometry.coordinates;
    const dx = lon - center.lng;
    const dy = lat - center.lat;
    const dist = dx * dx + dy * dy;
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = f;
    }
  }

  _sfCachedNearest = nearest;

  if (!nearest) {
    _sfSetRow('sf-flight', '--------');
    _sfSetRow('sf-type',   '--------------------');
    _sfSetRow('sf-data',   '----------------------');
    return;
  }

  _sfRenderPlane(nearest);
}

function _sfRenderPlane(feature) {
  const p = feature.properties;

  const flight = (p.callsign || p.icao24 || '').toUpperCase().padEnd(8).slice(0, 8);
  const cached = typeCache[p.icao24];
  const typeName = (cached?.type || '').toUpperCase().padEnd(20).slice(0, 20);

  const altFt = p.altitude != null ? Math.round(p.altitude * 3.28084 / 100) * 100 : 0;
  const spdKt = p.velocity != null ? Math.round(p.velocity * 1.94384) : 0;
  const hdg = p.trueTrack != null ? Math.round(p.trueTrack) : 0;
  const data = `${altFt}FT ${spdKt}KT ${hdg}\u00B0`.padEnd(22).slice(0, 22);

  _sfSetRow('sf-flight', flight);
  _sfSetRow('sf-type', typeName);
  _sfSetRow('sf-data', data);
}

function _sfSetRow(rowId, newValue) {
  const cells = _sfCells[rowId];
  if (!cells) return;

  const oldValue = _sfValues[rowId];
  if (newValue === oldValue) return;
  _sfValues[rowId] = newValue;

  for (let i = 0; i < cells.length; i++) {
    const ch = newValue[i] || ' ';
    const targetIdx = SF_CHAR_INDEX[ch] ?? 0;
    const cell = cells[i];

    if (targetIdx !== cell.targetIdx) {
      cell.targetIdx = targetIdx;
      if (!cell.flipping) {
        // Stagger: delay start based on column position
        setTimeout(() => _sfStartCycling(cell), cell.colIndex * SF_STAGGER_MS);
      }
    }
  }
}

// Calculate how many steps from current to target (always forward/wrap)
function _sfStepsRemaining(cell) {
  if (cell.currentIdx === cell.targetIdx) return 0;
  if (cell.targetIdx > cell.currentIdx) return cell.targetIdx - cell.currentIdx;
  return SF_ALPHABET.length - cell.currentIdx + cell.targetIdx;
}

// Get flip duration for this step — fast at start, decelerates near target
function _sfFlipDuration(cell) {
  const remaining = _sfStepsRemaining(cell);
  if (remaining > SF_DECEL_ZONE) return SF_FLIP_MIN_MS;
  // Ease out: slow down as we approach target
  const t = 1 - (remaining / SF_DECEL_ZONE);
  return SF_FLIP_MIN_MS + (SF_FLIP_MAX_MS - SF_FLIP_MIN_MS) * _sfEaseOutCubic(t);
}

function _sfStartCycling(cell) {
  if (cell.currentIdx === cell.targetIdx) {
    cell.flipping = false;
    return;
  }
  cell.flipping = true;

  const prevChar = SF_ALPHABET[cell.currentIdx] || ' ';
  cell.currentIdx = (cell.currentIdx + 1) % SF_ALPHABET.length;
  const nextChar = SF_ALPHABET[cell.currentIdx] || ' ';
  const duration = _sfFlipDuration(cell);

  _sfFlipOnce(cell, prevChar, nextChar, duration, () => {
    _sfStartCycling(cell);
  });
}

function _sfFlipOnce(cell, prevChar, nextChar, duration, onDone) {
  const el = cell.el;

  // Static layers
  cell.staticTop.textContent = nextChar;
  cell.staticBottom.textContent = prevChar;

  // Animated flap overlays — using WAAPI for brightness + rotation
  const flapTop = document.createElement('div');
  flapTop.className = 'sf-half sf-flap-top';
  const flapTopSpan = document.createElement('span');
  flapTopSpan.textContent = prevChar;
  flapTop.appendChild(flapTopSpan);

  const flapBottom = document.createElement('div');
  flapBottom.className = 'sf-half sf-flap-bottom';
  const flapBottomSpan = document.createElement('span');
  flapBottomSpan.textContent = nextChar;
  flapBottom.appendChild(flapBottomSpan);

  el.appendChild(flapTop);
  el.appendChild(flapBottom);

  // WAAPI: fold top down with darkening
  const topAnim = flapTop.animate([
    { transform: 'rotateX(0deg)', filter: 'brightness(1)' },
    { transform: 'rotateX(-180deg)', filter: 'brightness(0.5)' },
  ], { duration, easing: 'ease-in', fill: 'forwards' });

  // WAAPI: unfold bottom up with brightening
  const bottomAnim = flapBottom.animate([
    { transform: 'rotateX(180deg)', filter: 'brightness(0.5)' },
    { transform: 'rotateX(0deg)', filter: 'brightness(1)' },
  ], { duration, easing: 'ease-out', fill: 'forwards' });

  // When both finish, clean up and continue
  Promise.all([topAnim.finished, bottomAnim.finished]).then(() => {
    cell.staticBottom.textContent = nextChar;
    flapTop.remove();
    flapBottom.remove();
    onDone();
  });
}
