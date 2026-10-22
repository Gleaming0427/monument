import * as T from 'three';

// Architectural curves are defined once, in real units, then meshed to a bounded chord error. Rendering
// quality changes only the tessellation: it never changes the profile, flute count or measured dimensions.
export const CURVE_QUALITY = {
  basic: {maxChordErrorMm: 8, minSegments: 12, maxSegments: 48, fluteSamples: 4, maxProfileRows: 18},
  standard: {maxChordErrorMm: 3, minSegments: 16, maxSegments: 72, fluteSamples: 6, maxProfileRows: 28},
  cinematic: {maxChordErrorMm: 1, minSegments: 24, maxSegments: 96, fluteSamples: 8, maxProfileRows: 40},
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const roundUp = (value, multiple) => Math.ceil(value / multiple) * multiple;
const scaleOf = matrix => {
  const e = matrix?.elements;
  if (!e) return {diameter: 1, height: 1};
  const x = Math.hypot(e[0], e[1], e[2]), y = Math.hypot(e[4], e[5], e[6]), z = Math.hypot(e[8], e[9], e[10]);
  return {diameter: Math.max(x, z), height: y};
};

export const chordError = (radius, segments, sweep = Math.PI * 2) => radius * (1 - Math.cos(sweep / (2 * segments)));

export function segmentsForChordError(radius, maxChordErrorMm, {sweep = Math.PI * 2, min = 12, max = 96, multiple = 2} = {}) {
  const error = Math.max(1e-6, maxChordErrorMm / 1000), r = Math.max(1e-6, radius);
  const angle = 2 * Math.acos(clamp(1 - error / r, -1, 1));
  const needed = Number.isFinite(angle) && angle > 0 ? Math.ceil(sweep / angle) : max;
  return clamp(roundUp(Math.max(min, needed), Math.max(1, multiple)), min, max);
}

// Catmull–Rom through measured profile stations. Values are diameter ratios; t runs bottom to top.
export function profileAt(profile, t) {
  const points = [...profile].sort((a, b) => a[0] - b[0]);
  if (t <= points[0][0]) return points[0][1];
  if (t >= points.at(-1)[0]) return points.at(-1)[1];
  let i = 1;
  while (t > points[i][0]) i++;
  const p0 = points[Math.max(0, i - 2)], p1 = points[i - 1], p2 = points[i], p3 = points[Math.min(points.length - 1, i + 1)];
  const u = (t - p1[0]) / (p2[0] - p1[0]), u2 = u * u, u3 = u2 * u;
  const value = .5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * u + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * u2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * u3);
  // A measured spline must not invent a bulge larger than its neighbouring stations.
  return clamp(value, Math.min(p1[1], p2[1]), Math.max(p1[1], p2[1]));
}

export function sampleProfile(profile, {diameter = 1, maxChordErrorMm = 3, maxRows = 28} = {}) {
  const stations = [...new Set(profile.map(point => point[0]))].sort((a, b) => a - b), tolerance = maxChordErrorMm / 1000 / Math.max(1e-6, diameter);
  const out = [[stations[0], profileAt(profile, stations[0])]];
  const split = (a, b, depth = 0) => {
    const m = (a + b) / 2, ra = profileAt(profile, a), rb = profileAt(profile, b), rm = profileAt(profile, m), linear = (ra + rb) / 2;
    if (out.length < maxRows - 1 && depth < 12 && Math.abs(rm - linear) > tolerance) { split(a, m, depth + 1); split(m, b, depth + 1); }
    else out.push([b, rb]);
  };
  for (let i = 1; i < stations.length; i++) split(stations[i - 1], stations[i]);
  return out;
}

export function profiledGeometry({profile = [[0, 1], [1, 1]], master, span, flutes = 0, fluteDepth = .07, flutePower = .82, radialSegments = 32, diameter = 1, height = 1, maxChordErrorMm = 3, maxProfileRows = 28, openEnded = false} = {}) {
  const sampled = sampleProfile(profile, {diameter, maxChordErrorMm, maxRows: maxProfileRows});
  const outline = sampled.map(([t, d]) => new T.Vector2(d * .5, t - .5));
  if (!openEnded) outline.unshift(new T.Vector2(0, -.5));
  if (!openEnded) outline.push(new T.Vector2(0, .5));
  const geometry = new T.LatheGeometry(outline, radialSegments), positions = geometry.attributes.position;
  // The flute is a channel cut around the shaft, so it deepens and shallows with the angle: one modulation,
  // read once, drives both the vertices and their normal.
  const groove = angle => {
    const phase = ((angle / (2 * Math.PI) * flutes) % 1 + 1) % 1;
    return 1 - fluteDepth * Math.sin(Math.PI * phase) ** flutePower;
  };
  if (flutes > 0) for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i), radius = Math.hypot(x, z);
    if (radius < 1e-7) continue;
    const modulation = groove(Math.atan2(z, x));
    positions.setX(i, x * modulation); positions.setZ(i, z * modulation);
  }
  // The normal belongs to the surface, not to the mesh that happens to draw it, so it is read from the curve
  // every piece of a member is cut from rather than from this piece's own triangles — computeVertexNormals only
  // ever sees the piece it is handed, which is why a column laid drum by drum showed rays inside each drum and
  // a dark ring where one drum met the next. `master`/`span` name the curve and the stretch of it this piece
  // covers: two drums cut from one curve then answer identically at the station they share.
  //
  // Three lays a lathe's vertices out around the axis first and along the profile second, so the vertex at
  // segment i and ring j is i * rings + j. Reading it as j * (radialSegments + 1) + i addresses a different
  // vertex for every (i, j) pair and writes the whole field across the mesh at random.
  const rings = outline.length, curve = master ?? profile, from = span?.[0] ?? 0, to = span?.[1] ?? 1;
  const station = openEnded ? sampled.map(([t]) => t) : [0, ...sampled.map(([t]) => t), 1];
  const normals = geometry.attributes.normal;
  // The surface is P(θ, t) = radius(t) · groove(θ) · (sin θ, ·, cos θ), lifted by t in y, so its normal is the
  // cross product of the two partial derivatives. Being a function of (angle, station) alone, it follows the
  // taper of the profile and the cut of a flute at once, and it cannot change with the tessellation.
  const step = 1 / 2048;
  // Two numbers per ring — the radius there, and how fast it grows — read once and then reused for every
  // vertex around the axis, so the profile is sampled once per ring rather than once per vertex.
  const section = [], radiusAt = t => profileAt(curve, from + t * (to - from)) * .5;
  for (let j = 0; j < rings; j++) section.push([radiusAt(station[j]), (radiusAt(station[j] + step) - radiusAt(station[j] - step)) / (2 * step)]);
  const cut = flutes > 0 ? groove : () => 1;
  // A ring that closes on the axis is a cap: there is no radial direction left, and the cap faces away from
  // whichever way the body lies.
  const capSign = j => {
    for (let k = 1; k < rings; k++) {
      const other = j >= k ? j - k : j + k;
      if (other < 0 || other >= rings || outline[other].x < 1e-7) continue;
      return other < j ? 1 : -1;
    }
    return j === 0 ? -1 : 1;
  };
  for (let i = 0; i <= radialSegments; i++) {
    const angle = i / radialSegments * Math.PI * 2, sin = Math.sin(angle), cos = Math.cos(angle);
    for (let j = 0; j < rings; j++) {
      const vertex = i * rings + j;
      if (outline[j].x < 1e-7) { normals.setXYZ(vertex, 0, capSign(j), 0); continue; }
      const [radius, rise] = section[j], near = cut(angle + step) * radius, far = cut(angle - step) * radius;
      const ahead = Math.sin(angle + step), back = Math.sin(angle - step);
      const aheadCos = Math.cos(angle + step), backCos = Math.cos(angle - step);
      // ∂θ across the revolution, ∂t up the profile, and their cross product: radial for a cylinder, lifted by
      // the taper of the profile, turned by the flute.
      const across = [(near * ahead - far * back) / (2 * step), 0, (near * aheadCos - far * backCos) / (2 * step)];
      const along = [rise * cut(angle) * sin, 1, rise * cut(angle) * cos];
      const n = [across[1] * along[2] - across[2] * along[1], across[2] * along[0] - across[0] * along[2], across[0] * along[1] - across[1] * along[0]];
      const length = Math.hypot(...n) || 1;
      normals.setXYZ(vertex, n[0] / length, n[1] / length, n[2] / length);
    }
  }
  geometry.userData.architecture = {profile: sampled, flutes, maxChordErrorMm, radialSegments, diameter, height};
  return geometry;
}

export const adaptive = (factory, options = {}) => {
  const wrapped = (context = {}) => {
    const base = {diameter: 1, height: 1, maxChordErrorMm: 3, maxProfileRows: 28, ...options, ...context};
    const flutes = base.flutes ?? 0, min = Math.max(options.minSegments ?? 16, flutes ? flutes * 6 : 0), max = Math.max(min, options.maxSegments ?? 72);
    const radialSegments = context.radialSegments ?? segmentsForChordError(base.diameter / 2, base.maxChordErrorMm, {min, max, multiple: Math.max(2, flutes || options.multiple || 2)});
    const resolved = {...base, radialSegments};
    const geometry = factory(resolved);
    geometry.userData.adaptive = {radialSegments: resolved.radialSegments, maxChordErrorMm: resolved.maxChordErrorMm, flutes: resolved.flutes ?? 0};
    return geometry;
  };
  return Object.assign(wrapped, {adaptive: options});
};

export function adaptiveContext(piece, factory, qualityName = 'standard') {
  const quality = CURVE_QUALITY[qualityName] ?? CURVE_QUALITY.standard, dimensions = scaleOf(piece.matrix), spec = piece.geometry ?? {}, defaults = factory.adaptive ?? {};
  const flutes = spec.flutes ?? defaults.flutes ?? 0, requestedError = spec.maxChordErrorMm ?? defaults.maxChordErrorMm ?? quality.maxChordErrorMm;
  const maxChordErrorMm = Math.min(requestedError, quality.maxChordErrorMm), multiple = Math.max(2, flutes || defaults.multiple || 2);
  const min = Math.max(defaults.minSegments ?? quality.minSegments, flutes ? flutes * quality.fluteSamples : 0), max = Math.max(min, defaults.maxSegments ?? quality.maxSegments);
  const radialSegments = segmentsForChordError(dimensions.diameter / 2, maxChordErrorMm, {min, max, multiple});
  const context = {...defaults, ...spec, ...dimensions, maxChordErrorMm, radialSegments, maxProfileRows: spec.maxProfileRows ?? quality.maxProfileRows, qualityName};
  // `master` and `span` say which curve a piece was cut from and how much of it it covers: they move the normal
  // field, not the mesh. Two drums with the same vertices stay one instanced mesh.
  const {master, span, ...shape} = spec;
  return {context, key: `${radialSegments}:${context.maxProfileRows}:${JSON.stringify(shape)}`};
}

