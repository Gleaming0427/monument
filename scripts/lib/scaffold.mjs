const EARTH_X = 111320;
const EARTH_Z = 110540;

const clean = value => String(value ?? '').trim();
const words = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const number = value => {
  const match = clean(value).replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
};
const round = (value, precision = 2) => +value.toFixed(precision);

export function slugify(value) {
  return words(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'monument';
}

export function sourceUrl(result) {
  const kind = clean(result.osm_type).toLowerCase();
  const id = clean(result.osm_id);
  return kind && id ? `https://www.openstreetmap.org/${kind}/${id}` : 'https://www.openstreetmap.org/';
}

function polygonArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
    area += ax * by - bx * ay;
  }
  return Math.abs(area / 2);
}

export function extractRing(geojson) {
  if (!geojson) return null;
  const rings = geojson.type === 'Polygon'
    ? (geojson.coordinates?.slice(0, 1) ?? [])
    : geojson.type === 'MultiPolygon'
      ? (geojson.coordinates ?? []).map(polygon => polygon?.[0]).filter(Boolean)
      : [];
  const ring = rings.sort((a, b) => polygonArea(b) - polygonArea(a))[0];
  if (!ring || ring.length < 4) return null;
  const cleanRing = ring.map(point => point.slice(0, 2).map(Number)).filter(point => point.every(Number.isFinite));
  if (cleanRing.length > 1 && cleanRing[0][0] === cleanRing.at(-1)[0] && cleanRing[0][1] === cleanRing.at(-1)[1]) cleanRing.pop();
  return cleanRing.length >= 3 ? cleanRing : null;
}

function resultText(result) {
  return words([
    result.display_name,
    result.name,
    result.type,
    result.category,
    ...Object.values(result.namedetails ?? {}),
    ...Object.values(result.extratags ?? {}),
  ].join(' '));
}

function overlapScore(query, result) {
  const target = new Set(words(query).split(/\s+/).filter(word => word.length > 2));
  const text = resultText(result);
  let score = 0;
  for (const token of target) if (text.includes(token)) score += 2;
  return score;
}

export function selectResult(results, query) {
  if (!Array.isArray(results) || !results.length) throw new Error(`No OpenStreetMap result found for "${query}".`);
  return [...results].sort((a, b) => {
    const score = result => {
      const ring = extractRing(result.geojson);
      const span = ring ? Math.max(...ring.map(point => point[0])) - Math.min(...ring.map(point => point[0])) + Math.max(...ring.map(point => point[1])) - Math.min(...ring.map(point => point[1])) : 0;
      return overlapScore(query, result)
      + (ring ? 12 : 0)
      + (/building|historic|tourism|amenity/.test(words(`${result.category} ${result.type}`)) ? 4 : 0)
      + (result.osm_type === 'way' || result.osm_type === 'relation' ? 2 : 0)
      + Number(result.importance ?? 0)
      - (/boundary|place/.test(words(`${result.category} ${result.type}`)) ? 40 : 0)
      - (span > .05 ? 100 : 0);
    };
    return score(b) - score(a);
  })[0];
}

export function toLocalRing(ring) {
  const lons = ring.map(point => point[0]), lats = ring.map(point => point[1]);
  const origin = [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
  const cos = Math.cos(origin[1] * Math.PI / 180);
  const points = ring.map(([lon, lat]) => [round((lon - origin[0]) * EARTH_X * cos), round(-(lat - origin[1]) * EARTH_Z)]);
  return {origin: origin.map(value => round(value, 7)), points};
}

const normalizeAngle = angle => {
  while (angle <= -Math.PI) angle += Math.PI * 2;
  while (angle > Math.PI) angle -= Math.PI * 2;
  return angle;
};

function measureAt(points, rot) {
  const co = Math.cos(rot), si = Math.sin(rot);
  const local = points.map(([x, z]) => [x * co - z * si, x * si + z * co]);
  const xs = local.map(point => point[0]), zs = local.map(point => point[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const mx = (minX + maxX) / 2, mz = (minZ + maxZ) / 2;
  return {
    rot: normalizeAngle(rot), width: maxX - minX, depth: maxZ - minZ,
    center: [mx * co + mz * si, -mx * si + mz * co],
    area: (maxX - minX) * (maxZ - minZ),
  };
}

export function orientedRectangle(points) {
  if (!Array.isArray(points) || points.length < 3) throw new Error('The footprint needs at least three points.');
  const candidates = [];
  for (let i = 0; i < points.length; i++) {
    const [ax, az] = points[i], [bx, bz] = points[(i + 1) % points.length];
    if (Math.hypot(bx - ax, bz - az) < .2) continue;
    candidates.push(measureAt(points, -Math.atan2(bz - az, bx - ax)));
  }
  let rect = candidates.sort((a, b) => a.area - b.area)[0] ?? measureAt(points, 0);
  if (rect.width > rect.depth) rect = measureAt(points, rect.rot + Math.PI / 2);
  return {
    center: rect.center.map(value => round(value)),
    width: round(Math.max(1, rect.width)),
    depth: round(Math.max(1, rect.depth)),
    rot: round(normalizeAngle(rect.rot), 6),
  };
}

export const FAMILIES = ['block', 'civic', 'religious', 'castle', 'tower', 'amphitheatre', 'japanese-keep', 'modern', 'bridge'];

export function chooseFamily(result, query, requested = 'auto') {
  if (requested !== 'auto') {
    if (!FAMILIES.includes(requested)) throw new Error(`Unknown family "${requested}". Choose ${FAMILIES.join(', ')} or auto.`);
    return {family: requested, reason: 'selected with --family'};
  }
  const haystack = resultText({...result, display_name: `${query} ${result.display_name ?? ''}`});
  const country = words(result.address?.country ?? '');
  const hit = (pattern, family, reason) => pattern.test(haystack) ? {family, reason} : null;
  return hit(/amphitheat|amphithéât|colosse|arena\b/, 'amphitheatre', 'the name or OpenStreetMap tags identify an amphitheatre')
    ?? hit(/bridge\b|pont\b|puente\b|brucke\b|brücke\b|viaduc/, 'bridge', 'the name or OpenStreetMap tags identify a bridge')
    ?? ((/japan|japon/.test(country) || /japan|japon/.test(haystack)) && /castle|chateau|château|\bjo\b|城/.test(haystack) ? {family: 'japanese-keep', reason: 'a Japanese castle is identified'} : null)
    ?? hit(/cathedral|cathédrale|church\b|église|eglise|basilic|abbey|abbaye|chapel|chapelle|mosque|mosquée|temple|synagogue|monastery|monastère/, 'religious', 'the name or OpenStreetMap tags identify a religious building')
    ?? hit(/castle|chateau|château|fortress|forteresse|citadel|citadelle|donjon|\bfort\b/, 'castle', 'the name or OpenStreetMap tags identify a fortified building')
    ?? hit(/tower\b|tour\b|torre\b|turm\b|minaret|campanile|skyscraper|gratte-ciel/, 'tower', 'the name or OpenStreetMap tags identify a tower')
    ?? hit(/palace|palais|town hall|city hall|hôtel de ville|hotel de ville|consulaire|courthouse|opera|opéra|museum|musée|station|gare|university|université/, 'civic', 'the name or OpenStreetMap tags identify a civic or ceremonial building')
    ?? hit(/modern|contemporary|office|bureau|hotel\b|hôtel\b|apartments|residential/, 'modern', 'the name or OpenStreetMap tags suggest a modern building')
    ?? {family: 'block', reason: 'no more specific family was supported by the available tags'};
}

function parseLevels(tags) {
  const value = number(tags['building:levels'] ?? tags.levels);
  return value && value > 0 ? Math.round(value) : null;
}

function defaultProfile(family) {
  return ({
    block: {floors: 3, floorHeight: 3.4, color: '#b9a58b', roof: true},
    civic: {floors: 3, floorHeight: 4, color: '#c2aa8d', roof: true},
    religious: {floors: 4, floorHeight: 4, color: '#b4a78f', roof: true},
    castle: {floors: 3, floorHeight: 4, color: '#a5967d', roof: false},
    tower: {floors: 7, floorHeight: 3.5, color: '#aaa08b', roof: false},
    amphitheatre: {floors: 3, floorHeight: 4, color: '#c4aa84', roof: false},
    'japanese-keep': {floors: 5, floorHeight: 3.4, color: '#e0ded4', roof: true},
    modern: {floors: 5, floorHeight: 3.2, color: '#9ca8ad', roof: false},
    bridge: {floors: 1, floorHeight: 4, color: '#96928b', roof: false},
  })[family];
}

export function inferDimensions(result, family, overrides = {}) {
  const tags = result.extratags ?? {};
  const profile = defaultProfile(family);
  const taggedHeight = number(tags.height ?? result.height);
  const taggedLevels = parseLevels(tags);
  const floors = Math.max(1, Math.round(overrides.floors ?? taggedLevels ?? profile.floors));
  const height = Math.max(2, overrides.height ?? taggedHeight ?? floors * profile.floorHeight);
  return {
    height: round(height),
    floors,
    floorHeight: round(height / floors),
    estimatedHeight: overrides.height == null && taggedHeight == null,
    estimatedFloors: overrides.floors == null && taggedLevels == null,
    profile,
  };
}

function baseFootprint(points, dims, phase, extras = {}) {
  return {
    type: 'footprintBuilding', phase, points,
    height: dims.height, floors: dims.floors, floorHeight: dims.floorHeight,
    color: dims.profile.color, roof: {kind: 'flat', color: '#716d68'},
    ...extras,
  };
}

export function familyElements(family, points, rect, dims) {
  const phase = 'survey';
  const base = baseFootprint(points, dims, phase);
  if (family === 'modern') return [baseFootprint(points, dims, phase, {color: '#9ca8ad', trim: '#d7dfe1', roof: {kind: 'flat', color: '#697278'}, windowRatio: .64})];
  if (family === 'castle') return [baseFootprint(points, dims, phase, {thickness: 1.5, color: '#9c8d76', roof: null, crenel: {h: 1.2, w: 1.4, gap: 1.1}})];
  if (family === 'amphitheatre') return [
    {type: 'wall', phase, points, closed: true, height: 2, thickness: 1.2, block: [1.4, .8], color: '#bca17b'},
    {type: 'amphitheatre', part: 'facade', phase, center: rect.center, radii: [round(rect.width * .48), round(rect.depth * .48)], rot: rect.rot, storeys: Array.from({length: dims.floors}, () => ({height: dims.floorHeight, column: true})), bays: Math.max(24, Math.round(Math.PI * (rect.width + rect.depth) / 6)), color: '#c4aa84'},
  ];
  if (family === 'tower') return [baseFootprint(points, dims, phase, {thickness: 1.1, windowRatio: .28, trim: '#cfc6b5', roof: null})];
  if (family === 'religious') {
    return [baseFootprint(points, dims, phase, {windowRatio: .3, trim: '#d6cdbd', roof: {kind: 'flat', color: '#53575e'}})];
  }
  if (family === 'japanese-keep') return [
    baseFootprint(points, {...dims, height: Math.max(2.5, dims.height * .16)}, phase, {color: '#8e8a82', roof: null}),
    {type: 'building', phase, center: rect.center, size: [round(rect.width * .78), round(rect.depth * .78)], height: round(dims.height * .72), y0: round(dims.height * .16), rot: rect.rot, color: '#e0ded4', roof: {height: round(Math.min(7, rect.width * .32)), color: '#353a40', kind: 'slate'}},
  ];
  if (family === 'bridge') return [baseFootprint(points, {...dims, height: Math.max(2, dims.height * .35), floors: 1, floorHeight: Math.max(2, dims.height * .35)}, phase, {color: '#96928b', roof: null})];
  if (family === 'civic') return [baseFootprint(points, dims, phase, {trim: '#e3cfad', windowRatio: .5, roof: {kind: 'flat', color: '#76534a'}})];
  if (family === 'block') return [baseFootprint(points, dims, phase, {trim: '#d9cab3', roof: {kind: 'flat', color: '#716d68'}})];
  return [base];
}

function nameOf(result, query) {
  return clean(result._requestedName?.split(',')[0] ?? result.namedetails?.name ?? result.name ?? clean(query).split(',')[0]);
}

function placeOf(result) {
  const address = result.address ?? {};
  const locality = address.city ?? address.town ?? address.village ?? address.municipality ?? address.county;
  return [locality, address.country].filter(Boolean).join(', ') || clean(result.display_name).split(',').slice(1, 3).map(part => part.trim()).join(', ');
}

function seedOf(value) {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function visualStyleForFamily(family) {
  if (family === 'religious') return {quality: 'standard', materialPreset: 'gothic-limestone', environmentPreset: 'gothic-urban', vegetation: false};
  if (family === 'amphitheatre') return {quality: 'standard', materialPreset: 'roman-weathered', environmentPreset: 'roman-ruins', vegetation: false};
  if (family === 'modern' || family === 'bridge') return {quality: 'standard', materialPreset: 'industrial-iron', environmentPreset: 'museum-neutral', vegetation: false};
  if (family === 'tower') return {quality: 'standard', materialPreset: 'historic-masonry', environmentPreset: 'museum-neutral', vegetation: false};
  return {quality: 'standard', materialPreset: 'historic-masonry', environmentPreset: 'gothic-urban', vegetation: false};
}

export function createDraft({query, result, ring, requestedFamily = 'auto', id, height, floors}) {
  const local = toLocalRing(ring), rect = orientedRectangle(local.points);
  if (Math.max(rect.width, rect.depth) > 2500) throw new Error(`The selected map object spans ${Math.round(rect.width)} × ${Math.round(rect.depth)} m, so it is not a plausible single building. Add a more precise name or address.`);
  const choice = chooseFamily(result, query, requestedFamily);
  const dims = inferDimensions(result, choice.family, {height, floors});
  const monumentId = id ? slugify(id) : slugify(nameOf(result, query));
  const source = sourceUrl(result);
  const radius = Math.max(rect.width, rect.depth) / 2;
  const uncertainties = [
    'This is an automatically generated geometry draft. Facades, roofs and distinctive details still need to be checked against photographs.',
    'Construction phases and dates have not been researched yet; the single phase describes the current mapped state only.',
  ];
  if (dims.estimatedHeight) uncertainties.unshift(`The ${dims.height} m height is a family-based working estimate because the map has no usable height tag.`);
  if (dims.estimatedFloors) uncertainties.unshift(`The ${dims.floors}-storey split is a family-based working estimate because the map has no usable building:levels tag.`);
  const outlineFile = `${monumentId}.evidence/outline.json`;
  return {
    id: monumentId,
    name: nameOf(result, query),
    place: placeOf(result),
    seed: seedOf(monumentId),
    view: {target: [round(rect.center[0]), round(dims.height * .42), round(rect.center[1])], distance: round(Math.max(dims.height * 2.2, radius * 3.4, 32)), width: round(rect.width), radius: round(radius), height: dims.height, light: 'day'},
    visualStyle: visualStyleForFamily(choice.family),
    live: [{label: 'draft height', kind: 'height', unit: 'm'}],
    facts: [{value: `${rect.width} × ${rect.depth} m`, label: 'oriented footprint box'}, {value: choice.family, label: 'automatic architecture family'}],
    modelNote: `Automatic starting volume fitted to the mapped outline. The footprint is measured from OpenStreetMap; the family choice is ${choice.reason}. Height, facades, roof and construction history must be verified before this draft is presented as a reconstruction.`,
    evidence: {
      size: 'building',
      identity: clean(result.display_name) || `${nameOf(result, query)}, ${placeOf(result)}`,
      sources: [{url: source, read: 'OpenStreetMap feature used for the present-day footprint and the tags stored with this generated draft.'}],
      plan: {source: 'OpenStreetMap', url: source, outline: outlineFile, tolerance: 3},
      references: [], features: [], comparisons: [], uncertainties,
      generated: {query, family: choice.family, familyReason: choice.reason, heightSource: dims.estimatedHeight ? 'family estimate' : height != null ? 'CLI override' : 'OpenStreetMap height tag', levelsSource: dims.estimatedFloors ? 'family estimate' : floors != null ? 'CLI override' : 'OpenStreetMap building:levels tag'},
    },
    phases: [{id: 'survey', when: 'Current mapped state', title: 'Measured base volume', text: 'The mapped footprint is raised as a coarse present-day volume. Historical construction phases and recognisable architectural details still need sourced research.', source, moments: []}],
    // Footprint measured, everything above it estimated: interpreted until the research replaces it.
    elements: familyElements(choice.family, local.points, rect, dims).map(element => ({provenance: 'interpreted', note: 'Generated on the OpenStreetMap footprint; height, roof and facades are family estimates until replaced by sourced measurements.', ...element})),
    _scaffold: {family: choice.family, rectangle: rect, origin: local.origin},
  };
}

function decodeXml(value) {
  return value.replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

function attributes(text) {
  return Object.fromEntries([...text.matchAll(/([\w:-]+)="([^"]*)"/g)].map(match => [match[1], decodeXml(match[2])]));
}

export function parseOsmWays(xml) {
  const nodes = new Map();
  for (const match of xml.matchAll(/<node\b([^>]*?)(?:\/>|>[\s\S]*?<\/node>)/g)) {
    const attr = attributes(match[1]);
    if (attr.id && Number.isFinite(+attr.lon) && Number.isFinite(+attr.lat)) nodes.set(attr.id, [+attr.lon, +attr.lat]);
  }
  const ways = [];
  for (const match of xml.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way>/g)) {
    const attr = attributes(match[1]), body = match[2];
    const refs = [...body.matchAll(/<nd\b([^>]*)\/>/g)].map(item => attributes(item[1]).ref).filter(Boolean);
    const tags = Object.fromEntries([...body.matchAll(/<tag\b([^>]*)\/>/g)].map(item => { const tag = attributes(item[1]); return [tag.k, tag.v]; }).filter(([key]) => key));
    const ring = refs.map(ref => nodes.get(ref)).filter(Boolean);
    if (ring.length > 3 && refs[0] === refs.at(-1)) ring.pop();
    if (ring.length >= 3) ways.push({id: attr.id, tags, ring});
  }
  return ways;
}

function distanceMeters(a, b) {
  const lat = (a[1] + b[1]) / 2 * Math.PI / 180;
  return Math.hypot((a[0] - b[0]) * EARTH_X * Math.cos(lat), (a[1] - b[1]) * EARTH_Z);
}

export function selectOsmWay(ways, query, center) {
  if (!ways.length) return null;
  const queryWords = new Set(words(query).split(/\s+/).filter(word => word.length > 2));
  const score = way => {
    const name = words(`${way.tags.name ?? ''} ${way.tags['name:fr'] ?? ''} ${way.tags.alt_name ?? ''}`);
    let match = 0;
    for (const token of queryWords) if (name.includes(token)) match += 5;
    const centroid = way.ring.reduce((sum, point) => [sum[0] + point[0] / way.ring.length, sum[1] + point[1] / way.ring.length], [0, 0]);
    return match + (way.tags.building ? 8 : 0) + (way.tags.historic ? 3 : 0) - distanceMeters(centroid, center) / 20;
  };
  return [...ways].sort((a, b) => score(b) - score(a))[0];
}

export function resultFromWay(result, way) {
  return {
    ...result,
    osm_type: 'way', osm_id: way.id, geojson: {type: 'Polygon', coordinates: [[...way.ring, way.ring[0]]]},
    name: way.tags.name ?? result.name,
    display_name: way.tags.name ? `${way.tags.name}, ${result.display_name ?? ''}` : result.display_name,
    extratags: {...(result.extratags ?? {}), ...way.tags},
  };
}
