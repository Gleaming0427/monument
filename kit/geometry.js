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

export function profiledGeometry({profile = [[0, 1], [1, 1]], flutes = 0, fluteDepth = .07, flutePower = .82, radialSegments = 32, diameter = 1, height = 1, maxChordErrorMm = 3, maxProfileRows = 28, openEnded = false} = {}) {
  const sampled = sampleProfile(profile, {diameter, maxChordErrorMm, maxRows: maxProfileRows});
  const outline = sampled.map(([t, d]) => new T.Vector2(d * .5, t - .5));
  if (!openEnded) outline.unshift(new T.Vector2(0, -.5));
  if (!openEnded) outline.push(new T.Vector2(0, .5));
  const geometry = new T.LatheGeometry(outline, radialSegments), positions = geometry.attributes.position;
  if (flutes > 0) for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i), radius = Math.hypot(x, z);
    if (radius < 1e-7) continue;
    const phase = ((Math.atan2(z, x) / (2 * Math.PI) * flutes) % 1 + 1) % 1;
    const modulation = 1 - fluteDepth * Math.sin(Math.PI * phase) ** flutePower;
    positions.setX(i, x * modulation); positions.setZ(i, z * modulation);
  }
  // Normals come from the profile, not from the triangles. computeVertexNormals can only see the piece it
  // is given, so every drum of a column derived its own field and the change showed at every joint: rays
  // inside each drum and a shadow line where one drum met the next. The profile is a known curve, so its
  // normal is known too — and two drums cut from one curve agree at the place they meet.
  const stride = radialSegments + 1, rings = outline.length, normals = geometry.attributes.normal;
  for (let j = 0; j < rings; j++) {
    const radius = outline[j].x, before = outline[Math.max(0, j - 1)], after = outline[Math.min(rings - 1, j + 1)];
    const dr = after.x - before.x, dy = after.y - before.y, length = Math.hypot(dr, dy);
    // With a flat end (radius 0) the surface is the cap; elsewhere the normal is perpendicular to the profile.
    const nr = radius < 1e-7 ? 0 : dy / (length || 1), ny = radius < 1e-7 ? (j === 0 ? -1 : 1) : -dr / (length || 1);
    for (let i = 0; i < stride; i++) {
      const x = positions.getX(j * stride + i), z = positions.getZ(j * stride + i), angle = Math.atan2(z, x) || 0;
      normals.setXYZ(j * stride + i, Math.cos(angle) * nr, ny, Math.sin(angle) * nr);
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
  return {context, key: `${radialSegments}:${context.maxProfileRows}:${JSON.stringify(spec)}`};
}

