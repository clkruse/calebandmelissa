// OpenSky state vector indices
// https://openskynetwork.github.io/opensky-api/rest.html#all-state-vectors
function parseStateVector(sv) {
  return {
    icao24: sv[0],
    callsign: (sv[1] || '').trim(),
    originCountry: sv[2],
    timePosition: sv[3],
    lastContact: sv[4],
    lon: sv[5],
    lat: sv[6],
    baroAltitude: sv[7],
    onGround: sv[8],
    velocity: sv[9],
    trueTrack: sv[10],
    verticalRate: sv[11],
    sensors: sv[12],
    geoAltitude: sv[13],
    squawk: sv[14],
    spi: sv[15],
    positionSource: sv[16],
    category: sv[17],
  };
}

// Classify aircraft from tar1090-db record + type code database.
// record: [registration, typeCode, flags, description]
// typeCodeDb: { "C680": { desc: "L2J", wtc: "M" }, ... }
// Returns category number or null.
function classifyFromDb(record, typeCodeDb) {
  if (!record) return null;
  const [, typeCode, , desc] = record;

  if (typeCode && typeCodeDb) {
    const typeInfo = typeCodeDb[typeCode];
    if (typeInfo) {
      const airframe = typeInfo.desc?.[0];  // H, G, L, A, S, T
      const engine = typeInfo.desc?.[2];    // P, J, T
      const wtc = typeInfo.wtc;             // L, M, H

      // Rotorcraft / gyrocopter / tiltrotor
      if (airframe === 'H' || airframe === 'G' || airframe === 'T') return 8;

      // Heavy (wide-body jets, large cargo)
      if (wtc === 'H') return 6;

      // Medium + jet = large (narrow-body airliners)
      if (wtc === 'M' && engine === 'J') return 4;

      // Medium + non-jet = small (turboprop, etc.)
      if (wtc === 'M') return 3;

      // Light = GA
      if (wtc === 'L') return 2;
    }
  }

  // Fallback: try regex on the description text field
  if (desc) return classifyByDescription(desc);

  return null;
}

// Regex fallback classifier using the description text from tar1090-db or adsbdb.
function classifyByDescription(t) {
  if (!t) return null;

  // Rotorcraft
  if (/helicopter|rotorcraft/i.test(t)) return 8;
  if (/sikorsky|eurocopter|agusta|westland|airbus.h(?:eli|[0-9])|bell \d{3}|robinson r\d{2}|md.?[0-9]{3}.*helicopter|dolphin|black\s?hawk|sea\s?hawk|apache|chinook|kiowa|huey|cobra|lynx|dauphin|puma|cougar|ec[- ]?\d{3}|as[- ]?\d{3}|aw\d{3}|s-\d{2}[a-z]|uh-|ah-|ch-\d|mh-|sh-|oh-|hh-|h1[2-6]\d|h2[12]\d|r22|r44|r66|mi-\d|ka-\d/i.test(t)) return 8;

  // UAV
  if (/unmanned|uav|drone|remotely.piloted/i.test(t)) return 14;
  if (/predator|reaper|global.hawk|scan.eagle|fire.scout|triton/i.test(t)) return 14;

  // Glider / sailplane
  if (/glider|sailplane/i.test(t)) return 9;

  // Lighter-than-air
  if (/balloon|airship|blimp|zeppelin/i.test(t)) return 10;

  // Ultralight
  if (/ultralight|microlight|hang.?glider|paraglider|paramotor/i.test(t)) return 12;

  // Heavy — wide-body jets and large military cargo
  if (/747|777|787|a330|a340|a350|a380|dc-10|md-11|l-1011|il-96|an-124|c-5|c-17|kc-10/i.test(t)) return 6;

  // Large — narrow-body jets
  if (/737|757|767|a31[89]|a32[01]|717|md-[89]0|dc-9|tu-[12]\d{2}|embraer.*e?\d{3}|erj|crj|comac|arj/i.test(t)) return 4;

  // Small — turboprops, business jets
  if (/king.air|beechcraft.1900|pilatus|dash.?8|q[234]\d{2}|atr.?\d{2}|saab.\d{3}|dornier|jetstream|learjet|gulfstream|citation|falcon.\d|challenger|global.\d|hawker|phenom|legacy|praetor|hondajet|eclipse|bae.146|avro.rj/i.test(t)) return 3;

  // Light — general aviation
  if (/cessna|piper|cirrus|mooney|bonanza|baron|diamond|socata|tecnam|van.?s.rv|grumman|maule|lancair|cherokee|warrior|archer|skyhawk|skylane|stationair/i.test(t)) return 2;

  return null;
}

// Map ADS-B category number to icon name for data-driven symbol rendering.
function categoryToIcon(cat) {
  if (cat === 8) return 'icon-helicopter';
  if (cat === 3) return 'icon-bizjet';  // small — business jets, turboprops
  if (cat === 2 || cat === 9 || cat === 10 || cat === 11 || cat === 12) return 'icon-ga';
  // Categories 4, 5, 6, 7, 15 and fallback → airliner
  return 'icon-jet';
}

function filterByRadius(planes, centerLat, centerLon, radiusKm) {
  return planes.filter((p) => {
    if (p.lat == null || p.lon == null) return false;
    // Drop stationary ground targets (velocity 0, altitude 0)
    if (!p.velocity && !p.baroAltitude) return false;
    return haversineDistance(centerLat, centerLon, p.lat, p.lon) <= radiusKm;
  });
}

function planesToGeoJSON(planes) {
  return {
    type: 'FeatureCollection',
    features: planes.map((p) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [p.lon, p.lat],
      },
      properties: {
        icao24: p.icao24,
        callsign: p.callsign,
        originCountry: p.originCountry,
        altitude: p.baroAltitude,
        geoAltitude: p.geoAltitude,
        velocity: p.velocity,
        trueTrack: p.trueTrack || 0,
        verticalRate: p.verticalRate,
        onGround: p.onGround,
        squawk: p.squawk,
        category: p.category,
      },
    })),
  };
}
