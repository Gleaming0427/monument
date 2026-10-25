import * as T from 'three';

// Masonry as real surfaces. A wall of boxes is a heap of blocks: its openings are cut in steps, its arches are
// chains of beams, and every joint is a gap one can see through at close range. Here a wall is one continuous
// skin (outer face, inner face, tops, and the sides of every opening) cut by the openings' true outlines, sampled
// to a chord error of a few millimetres; the joints are drawn by the material (kit/builder.js, attribute
// `aMason`) at the size of the courses in the photographs, and fade with distance instead of aliasing. A
// moulding is a section swept along a path, the way a mason runs a template along an arch.
//
// Everything is built in the brick's own frame (u along the element's axis, v across it, y up) and placed in
// the scene by `Soup.frame`. The result is a few thousand "patches": each a piece of the timeline like any other
// (it has a phase, an order, a birth), laid from the bottom up, whose matrix is its bounding box (so that every
// script that measures pieces keeps working) and whose triangles are held in that box's unit cube (`piece.mesh`).

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const radiusOf = (w, rise) => rise ? (w * w / 4 + rise * rise) / w : w;
const stepFor = (radius, tol) => 2 * Math.acos(clamp(1 - tol / Math.max(radius, 1e-3), -1, 1));

// ——— A triangle soup ———
export class Soup {
  // `frame` places a point or a direction of the brick's frame in the scene: {point([u, y, v]), vector([u, y, v])}.
  constructor(frame) { this.frame = frame; this.pos = []; this.nor = []; this.mas = []; this.idx = []; }
  // A vertex: point, normal and `mason` [s, y, course] (what the material draws its joints from; course 0 = none).
  vertex(point, normal, mason = [0, 0, 0]) {
    const p = this.frame ? this.frame.point(point) : point, n = this.frame ? this.frame.vector(normal) : normal, l = Math.hypot(n[0], n[1], n[2]) || 1;
    this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0] / l, n[1] / l, n[2] / l); this.mas.push(mason[0], mason[1], mason[2]);
    return this.pos.length / 3 - 1;
  }
  // A triangle, wound to face the way its vertex normals do.
  tri(a, b, c) {
    const P = this.pos, N = this.nor, ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az, vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-14) return;
    const f = nx * (N[a * 3] + N[b * 3] + N[c * 3]) + ny * (N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1]) + nz * (N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2]);
    if (f >= 0) this.idx.push(a, b, c); else this.idx.push(a, c, b);
  }
  fan(ids) { for (let i = 1; i < ids.length - 1; i++) this.tri(ids[0], ids[i], ids[i + 1]); }
  get empty() { return this.idx.length === 0; }
  // The piece the engine lays: its matrix is the bounding box (a unit cube scaled to it), the triangles are in that
  // cube, and so are the normals, bent by the box's scale so that the engine gets the right ones back.
  toPiece() {
    if (this.empty) return null;
    const P = this.pos, n = P.length / 3, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], P[i * 3 + a]); hi[a] = Math.max(hi[a], P[i * 3 + a]); }
    const size = [0, 1, 2].map(a => Math.max(hi[a] - lo[a], .02)), center = [0, 1, 2].map(a => (lo[a] + hi[a]) / 2);
    const position = new Float32Array(n * 3), normal = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      for (let a = 0; a < 3; a++) position[i * 3 + a] = (P[i * 3 + a] - center[a]) / size[a];
      const x = this.nor[i * 3] * size[0], y = this.nor[i * 3 + 1] * size[1], z = this.nor[i * 3 + 2] * size[2], l = Math.hypot(x, y, z) || 1;
      normal[i * 3] = x / l; normal[i * 3 + 1] = y / l; normal[i * 3 + 2] = z / l;
    }
    const matrix = new T.Matrix4().compose(new T.Vector3(...center), new T.Quaternion(), new T.Vector3(...size));
    return {matrix, top: hi[1], centerY: center[1], mesh: {position, normal, mason: Float32Array.from(this.mas), index: Uint32Array.from(this.idx)}};
  }
}

// ——— Sections of mouldings ———
// A section is a list of points [r, d]: r runs along the wall away from the opening, d out of the wall's face. It
// is walked so that its surface faces +d, and starts and ends on the face (d = 0) unless said otherwise.
const arcPoints = (cr, cd, radius, from, to, tol = .004) => {
  const n = Math.max(3, Math.ceil(Math.abs(to - from) / Math.max(stepFor(radius, tol), .1)));
  return Array.from({length: n + 1}, (_, i) => { const a = from + (to - from) * i / n; return [cr + Math.cos(a) * radius, cd + Math.sin(a) * radius]; });
};
export const moulding = {
  // A bead: a round roll `w` wide, standing on the face, most of a half cylinder out.
  roll: (w, stand = 0) => [[0, 0], ...(stand ? [[0, stand]] : []), ...arcPoints(w / 2, stand, w / 2, Math.PI, 0, .003)],
  // A flat band `w` wide, `h` out from the face.
  fillet: (w, h) => [[0, 0], [0, h], [w, h], [w, 0]],
  // A hollow (cavetto): a concave quarter-round `w` wide, sunk `h` below the face.
  hollow: (w, h) => { const pts = arcPoints(w / 2, 0, w / 2, Math.PI, Math.PI * 2, .004); return pts.map(([r, d]) => [r, d * h / (w / 2)]); },
  // A keeled roll ("en amande"): pointed, `w` wide and `h` out.
  keel: (w, h) => [[0, 0], [w * .1, h * .62], [w / 2, h], [w * .9, h * .62], [w, 0]],
  // A chamfer: a sloping band from the face's level out `h` over `w`, falling back at its end.
  chamfer: (w, h) => [[0, 0], [w * .98, h], [w, 0]],
  // A rounded step: a fillet whose outer arris is rounded.
  bowtell: (w, h) => [[0, 0], [0, h - w * .3], ...arcPoints(w * .3, h - w * .3, w * .3, Math.PI, 0, .003).slice(0, -1), [w * .6, h - w * .3], [w, h - w * .3], [w, 0]],
};
// Mouldings end to end along r, each starting at its own r = 0 and ending back on the base; the whole raised by
// `raise` (at least as much as the deepest hollow) so that it stands proud of the wall, with a riser at each end.
export function stack(parts, raise = 0) {
  const out = []; let r = 0;
  for (const part of parts) {
    const width = Math.max(...part.map(p => p[0]));
    for (const [pr, pd] of part) out.push([r + pr, pd + raise]);
    r += width;
  }
  if (raise > 0) { out.unshift([0, 0]); out.push([r, 0]); }
  return out;
}

// ——— The outline of an opening ———
// Points [s, y], clockwise as seen from outside, from the left foot up and over to the right foot: a pointed,
// round or flat head and its jambs down to `foot`, or the whole circle; sampled to `tol` metres of chord error.
// `grow` offsets the outline outwards (a moulding runs on a larger outline than the light it frames).
export function outline(o, {grow = 0, foot = o.sill ?? 0, tol = .005} = {}) {
  const g = grow, hw = (o.w ?? 0) / 2 + g, pts = [];
  if (o.kind === 'circle') {
    const r = o.r + g, n = Math.max(16, Math.ceil(Math.PI * 2 / stepFor(r, tol)));
    for (let i = 0; i < n; i++) { const a = Math.PI / 2 - i / n * Math.PI * 2; pts.push([o.s + Math.cos(a) * r, o.y + Math.sin(a) * r]); }
    return pts;
  }
  pts.push([o.s - hw, foot], [o.s - hw, o.spring]);
  if (o.kind === 'rect') pts.push([o.s + hw, o.spring]);
  else if (o.kind === 'round') {
    const n = Math.max(6, Math.ceil(Math.PI / stepFor(hw, tol)));
    for (let i = 1; i < n; i++) { const a = Math.PI * (1 - i / n); pts.push([o.s + Math.cos(a) * hw, o.spring + Math.sin(a) * hw]); }
    pts.push([o.s + hw, o.spring]);
  } else {
    // Two arcs of radius R, each centred on the springing line on the far side of the axis, meeting at the apex;
    // offset by `grow` they keep their centres and their radius grows.
    const R = radiusOf(o.w, o.rise), c = R - o.w / 2, Rg = R + g, end = Math.acos(clamp(-c / Rg, -1, 1)), n = Math.max(4, Math.ceil((Math.PI - end) / stepFor(Rg, tol)));
    for (let i = 1; i <= n; i++) { const a = Math.PI - (Math.PI - end) * i / n; pts.push([o.s + c + Rg * Math.cos(a), o.spring + Rg * Math.sin(a)]); }
    for (let i = n - 1; i >= 0; i--) { const a = Math.PI - (Math.PI - end) * i / n; pts.push([o.s - c - Rg * Math.cos(a), o.spring + Rg * Math.sin(a)]); }
  }
  pts.push([o.s + hw, foot]);
  return pts;
}

// The y of every sample of an opening's curved part, bottom to top, so that a wall cut by it can be sliced there.
const curveHeights = (o, tol) => [...new Set(outline(o, {tol}).map(p => +p[1].toFixed(5)))].sort((a, b) => a - b);

// ——— Surfaces made a layer at a time ———
// A piece is laid when the masonry beside it has risen to it, so a tall moulding or a window's tracery cannot be one
// piece: its triangles go to the layer (a band of `step` metres of height) their centre lies in, and each layer
// becomes its own patch, built from the bottom up like the wall beside it.
export class Layers {
  constructor(frame, step = .9) { this.frame = frame; this.step = step; this.soups = new Map(); }
  soupAt(y) { const key = Math.floor(y / this.step); if (!this.soups.has(key)) this.soups.set(key, {soup: new Soup(this.frame), seen: new Map()}); return this.soups.get(key); }
  // A vertex is {p: [u, y, v], n: [u, y, v], m: [s, y, course]}; vertices alike share one index within a layer.
  tri(a, b, c) {
    const slot = this.soupAt((a.p[1] + b.p[1] + c.p[1]) / 3), {soup, seen} = slot;
    const id = v => {
      const key = `${Math.round(v.p[0] * 5000)},${Math.round(v.p[1] * 5000)},${Math.round(v.p[2] * 5000)},${Math.round(v.n[0] * 500)},${Math.round(v.n[1] * 500)},${Math.round(v.n[2] * 500)},${Math.round(v.m[0] * 100)},${Math.round(v.m[1] * 100)},${v.m[2]}`;
      let i = seen.get(key);
      if (i === undefined) { i = soup.vertex(v.p, v.n, v.m); seen.set(key, i); }
      return i;
    };
    soup.tri(id(a), id(b), id(c));
  }
  fan(vs) { for (let i = 1; i < vs.length - 1; i++) this.tri(vs[0], vs[i], vs[i + 1]); }
  flush(emit) { for (const [, {soup}] of [...this.soups].sort((a, b) => a[0] - b[0])) if (!soup.empty) emit(soup); this.soups.clear(); }
}

const signedArea = poly => poly.reduce((sum, [x, y], i) => { const [x2, y2] = poly[(i + 1) % poly.length]; return sum + (x * y2 - x2 * y); }, 0) / 2;
const dedupe = (poly, eps = 1e-5) => poly.filter((p, i) => { const q = poly[(i + poly.length - 1) % poly.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > eps; });
// A polygon with holes as triangles (indices into contour followed by each hole), through three.js' ear clipping.
const triangulate = (contour, holes = []) => T.ShapeUtils.triangulateShape(contour.map(([x, y]) => new T.Vector2(x, y)), holes.map(h => h.map(([x, y]) => new T.Vector2(x, y))));

// A map F(s, y, off) -> [u, y, v], and the directions it implies, read back from it.
export function frameOf(F) {
  const o = F(0, 0, 0), x = F(1, 0, 0), z = F(0, 0, 1);
  const ex = [x[0] - o[0], x[2] - o[2]];
  let ez = [z[0] - o[0], z[2] - o[2]];
  // A map that ignores `off` has no depth of its own: the sweep runs on the plane, out along the normal to its s-axis.
  if (Math.hypot(ez[0], ez[1]) < 1e-9) ez = [-ex[1], ex[0]];
  return {P: F, D: (ns, ny, nz) => [ex[0] * ns + ez[0] * nz, ny, ex[1] * ns + ez[1] * nz]};
}

// ——— Sweeping a section along a path ———
// A section's vertices carry their own normals: smooth along a curve, doubled where the profile turns sharply (an
// arris), so that a roll reads as a swelling and a fillet as a step. Returns {verts: [{r, d, nr, nd}], segs}.
function prepareSection(section, crease = .6) {
  const n = section.length, segNormal = [];
  for (let i = 0; i < n - 1; i++) { const dr = section[i + 1][0] - section[i][0], dd = section[i + 1][1] - section[i][1], l = Math.hypot(dr, dd) || 1; segNormal.push([-dd / l, dr / l]); }
  const verts = [], segs = [], first = [], last = [];
  for (let i = 0; i < n; i++) {
    const a = segNormal[i - 1], b = segNormal[i];
    const smooth = a && b && a[0] * b[0] + a[1] * b[1] > crease;
    if (smooth) { const x = a[0] + b[0], y = a[1] + b[1], l = Math.hypot(x, y) || 1; verts.push({r: section[i][0], d: section[i][1], nr: x / l, nd: y / l}); first[i] = last[i] = verts.length - 1; }
    else {
      if (a) { verts.push({r: section[i][0], d: section[i][1], nr: a[0], nd: a[1]}); last[i] = verts.length - 1; }
      if (b) { verts.push({r: section[i][0], d: section[i][1], nr: b[0], nd: b[1]}); first[i] = verts.length - 1; }
      if (!a) last[i] = first[i]; if (!b) first[i] = last[i];
    }
  }
  for (let i = 0; i < n - 1; i++) segs.push([first[i], last[i + 1]]);
  return {verts, segs};
}

// Runs `section` ([r, d] points, see `moulding`) along `path` ([s, y] points, clockwise seen from outside, so that
// "outwards" is to the left of the way of travel), standing on the plane `base` out of the wall's axis. `scale`
// stretches the section along r (not d). Corners are mitred. An open path gets end caps.
export function sweep(layers, lay, path, section, {base = 0, scale = 1, closed = false, caps = true, mason = [0, 0, 0], depth = 1} = {}) {
  const pts = dedupe(path), n = pts.length;
  if (n < 2) return;
  const prep = prepareSection(section), segCount = closed ? n : n - 1;
  const tangent = [], normal = [];
  for (let i = 0; i < segCount; i++) { const a = pts[i], b = pts[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; tangent.push([(b[0] - a[0]) / l, (b[1] - a[1]) / l]); normal.push([-(b[1] - a[1]) / l, (b[0] - a[0]) / l]); }
  const frames = pts.map((_, i) => {
    const prev = closed ? normal[(i + segCount - 1) % segCount] : normal[Math.max(0, i - 1)], next = closed ? normal[i % segCount] : normal[Math.min(segCount - 1, i)];
    let x = prev[0] + next[0], y = prev[1] + next[1]; const l = Math.hypot(x, y) || 1; x /= l; y /= l;
    return {n: [x, y], miter: 1 / Math.max(.4, x * next[0] + y * next[1])};
  });
  const vertexAt = (i, v) => {
    const f = frames[i], r = v.r * scale * f.miter, off = base + v.d * depth;
    const nr = v.nr, nd = v.nd / depth, l = Math.hypot(nr, nd) || 1;
    return {p: lay.P(pts[i][0] + f.n[0] * r, pts[i][1] + f.n[1] * r, off), n: lay.D(f.n[0] * nr / l, f.n[1] * nr / l, nd / l), m: mason};
  };
  const rows = pts.map((_, i) => prep.verts.map(v => vertexAt(i, v)));
  for (let i = 0; i < segCount; i++) {
    const j = (i + 1) % n;
    for (const [a, b] of prep.segs) layers.fan([rows[i][a], rows[j][a], rows[j][b], rows[i][b]]);
  }
  if (!closed && caps) {
    const ring = [...new Set(prep.segs.flatMap(([a, b]) => [a, b]))].sort((a, b) => a - b);
    for (const [i, sign] of [[0, -1], [n - 1, 1]]) {
      const t = tangent[Math.min(i, segCount - 1)], nn = lay.D(sign * t[0], sign * t[1], 0);
      layers.fan(ring.map(k => ({...rows[i][k], n: nn})));
    }
  }
}

// ——— A plate of stone with lights cut in it ———
// Tracery is a thin slab pierced by its lights (the glazed openings): `contour` and `holes` are [s, y] polygons; the
// slab runs from `back` to `front` out of the wall's axis; its front and back faces are triangulated across the
// holes, and the sides of every hole (and of the contour edges flagged in `lit`) are ruled between them.
export function plate(layers, lay, contour, holes, {front, back, lit = null, mason = [0, 0, 0], backFace = true}) {
  const all = [...contour, ...holes.flat()], tris = triangulate(contour, holes);
  const at = (i, off, nz) => ({p: lay.P(all[i][0], all[i][1], off), n: lay.D(0, 0, nz), m: mason});
  for (const [a, b, c] of tris) {
    layers.tri(at(a, front, 1), at(b, front, 1), at(c, front, 1));
    if (backFace) layers.tri(at(a, back, -1), at(b, back, -1), at(c, back, -1));
  }
  // The sides of a light face away from the stone: into a hole, out of the contour.
  const side = (poly, flags, hole) => {
    const orient = signedArea(poly) > 0 ? 1 : -1, sign = hole ? 1 : -1;
    for (let i = 0; i < poly.length; i++) {
      if (flags && !flags[i]) continue;
      const a = poly[i], b = poly[(i + 1) % poly.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l < 1e-6) continue;
      const n = lay.D(-(b[1] - a[1]) / l * orient * sign, (b[0] - a[0]) / l * orient * sign, 0);
      layers.fan([{p: lay.P(a[0], a[1], front), n, m: mason}, {p: lay.P(b[0], b[1], front), n, m: mason}, {p: lay.P(b[0], b[1], back), n, m: mason}, {p: lay.P(a[0], a[1], back), n, m: mason}]);
    }
  };
  if (lit) side(contour, lit, false);
  holes.forEach(h => side(h, null, true));
}

// ——— Foils ———
// A cusped circle, clockwise: `lobes` arcs of equal radius round [cx, cy], each meeting the next in a point. `r` is
// the radius of the circle through the tips of the lobes' outer edges; `cusp` (0 to 1) how deep the cusps bite.
export function foil(cx, cy, r, lobes = 4, {turn = Math.PI / 2, tol = .004} = {}) {
  const half = Math.PI / lobes, rho = r * Math.sin(half) / (1 + Math.sin(half)), ring = r - rho;
  const cusp = ring * Math.cos(half) + Math.sqrt(Math.max(0, rho * rho - (ring * Math.sin(half)) ** 2));
  const reach = Math.atan2(cusp * Math.sin(half), cusp * Math.cos(half) - ring);
  const pts = [], step = Math.max(.12, stepFor(rho, tol)), count = Math.max(4, Math.ceil(2 * reach / step));
  for (let k = 0; k < lobes; k++) {
    const centre = turn - k * 2 * half, ccx = cx + Math.cos(centre) * ring, ccy = cy + Math.sin(centre) * ring;
    for (let i = 0; i < count; i++) { const a = centre + reach - 2 * reach * i / count; pts.push([ccx + Math.cos(a) * rho, ccy + Math.sin(a) * rho]); }
  }
  return pts;
}
export const circlePoints = (cx, cy, r, tol = .004) => outline({kind: 'circle', s: cx, y: cy, r}, {tol});

// ——— Toolkit ———
// env: {k (the kit), frame, rand, tint, stone, glass, phase, V, span, top, box (a block of the kit's toolkit)}.
export function masonry(env) {
  const {k, frame, rand, tint, stone, tol = .005} = env;
  const jointCourse = env.jointCourse ?? .32;
  const soup = () => new Soup(frame);
  const emit = (kind, s, color, ph, extra = {}) => k.patch(kind, s, color, ph, extra);

  // Axes of a map F(s, y, off) -> [u, y, v], read back from it: how a direction in the wall's frame is placed.
  const axes = F => { const o = F(0, 0, 0), x = F(1, 0, 0), z = F(0, 0, 1); return {origin: o, ex: [x[0] - o[0], x[1] - o[1], x[2] - o[2]], ez: [z[0] - o[0], z[1] - o[1], z[2] - o[2]]}; };
  const dirOf = (A, ns, ny, nz) => [A.ex[0] * ns + A.ez[0] * nz, ny, A.ex[2] * ns + A.ez[2] * nz];

  // Sections of intervals: [p, q] minus a list of intervals.
  const minus = ([p, q], list) => {
    let parts = [[p, q]];
    for (const [a, b] of list) parts = parts.flatMap(([x, y]) => b <= x || a >= y ? [[x, y]] : [[x, Math.min(y, a)], [Math.max(x, b), y]]).filter(([x, y]) => y - x > 1e-5);
    return parts;
  };
  const clipPolygon = (poly, f) => {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const A = poly[i], B = poly[(i + 1) % poly.length], fa = f(A), fb = f(B);
      if (fa >= 0) out.push(A);
      if ((fa >= 0) !== (fb >= 0)) { const u = fa / (fa - fb); out.push([A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u]); }
    }
    return out;
  };

  // ——— Walls ———
  // Coursed ashlar from a to b ([u, v]) between y0 and y1, thickness t, `out` its outward normal ([u, v]), with its
  // openings cut out by their true outline. `shape` {lo(y), hi(y)} bounds the solid on either side where it is
  // not a rectangle (a gable). An opening without `s` is centred and narrowed to fit the wall.
  function wall(a, b, y0, y1, t, out, openings = [], ph = env.phase, extra = {}, course = .8, shape = null) {
    const du = b[0] - a[0], dv = b[1] - a[1], len = Math.hypot(du, dv);
    if (len < .3 || y1 - y0 < .2) return;
    const dir = [du / len, dv / len];
    const F = (s, y, off) => [a[0] + dir[0] * s + out[0] * off, y, a[1] + dir[1] * s + out[1] * off];
    const holes = openings.filter(Boolean).map(o => {
      if (o.kind === 'circle') return {...o, s: o.s ?? len / 2};
      const w = Math.min(o.width ?? o.w ?? 2, len - (o.margin ?? 1.4));
      return w > .7 ? {...o, w, s: o.s ?? len / 2} : null;
    }).filter(Boolean);
    layWall({a, dir, F, len, y0, y1, t, out, holes, ph, extra, course, shape});
    for (const o of holes) env.opening(F, o, t, ph, extra);
    return F;
  }

  function layWall({F, len, y0, y1, t, holes, ph, extra, course, shape}) {
    const A = axes(F), lo = shape?.lo ?? (() => 0), hi = shape?.hi ?? (() => len), h2 = t / 2;
    const heights = [];
    for (const o of holes) {
      o.lo = o.kind === 'circle' ? o.y - o.r : o.sill; o.hi = env.top(o); heights.push(...curveHeights(o, tol), o.lo, o.hi);
    }
    // Half-width of an opening at height y, to its very sill and its very head: a circle closes at both, a pointed or
    // round head at its apex, but a window begins at its sill as wide as it is above it, and a flat head ends square.
    const hwAt = (o, y) => o.kind === 'rect' ? o.w / 2 : y >= o.hi ? 0 : Math.max(0, env.span(o, Math.max(y, o.lo)));
    // Solid spans at height y in a slice whose middle is `mid`: what lies between the bounds, round the holes the
    // slice is inside of.
    const spansAt = (y, mid) => {
      const active = holes.filter(o => env.span(o, mid) > 0).sort((p, q) => p.s - q.s);
      let p = lo(y); const res = [];
      for (const o of active) { const hw = hwAt(o, y); res.push([p, Math.max(p, o.s - hw)]); p = Math.max(p, o.s + hw); }
      res.push([p, Math.max(p, hi(y))]);
      return {spans: res, active};
    };
    // Bands, laid from the bottom up, each cut into cells along the wall; every cell is a patch.
    for (let ya = y0, row = 0; ya < y1 - .05; row++) {
      let yb = Math.min(ya + course * 1.1 * (.9 + .2 * rand()), y1);
      if (y1 - yb < course * .4) yb = y1;
      const cuts = [0]; for (let s = -(row % 2) * course * 1.6, w = course * 3.2; ;) { s += w * (.8 + .4 * rand()); if (s >= len - course * 1.2) break; if (s > 0) cuts.push(s); }
      cuts.push(len);
      const cells = cuts.slice(1).map((sb, i) => ({sa: cuts[i], sb, soup: soup()}));
      const ys = [...new Set([ya, yb, ...heights.filter(y => y > ya + 1e-4 && y < yb - 1e-4)])].sort((p, q) => p - q);
      const slices = ys.slice(0, -1).map((yl, i) => ({yl, yu: ys[i + 1]}));
      const mason = (s, y) => [s, y, jointCourse];
      const faceOf = (cell, poly) => {
        const ids = [];
        for (const [s, y] of poly) ids.push(cell.soup.vertex(F(s, y, h2), dirOf(A, 0, 0, 1), mason(s, y)));
        cell.soup.fan(ids);
        const back = poly.map(([s, y]) => cell.soup.vertex(F(s, y, -h2), dirOf(A, 0, 0, -1), mason(s, y)));
        cell.soup.fan(back);
      };
      const capOf = (cell, p, q, y, up) => {
        const s0 = Math.max(p, cell.sa), s1 = Math.min(q, cell.sb);
        if (s1 - s0 < 1e-4) return;
        const n = dirOf(A, 0, up ? 1 : -1, 0);
        cell.soup.fan([[s0, h2], [s1, h2], [s1, -h2], [s0, -h2]].map(([s, off]) => cell.soup.vertex(F(s, y, off), n, mason(s, y))));
      };
      const inCell = (cell, s, last) => s >= cell.sa - 1e-9 && (s < cell.sb - 1e-9 || last && s <= cell.sb + 1e-9);
      for (const {yl, yu} of slices) {
        const mid = (yl + yu) / 2, L = spansAt(yl, mid), U = spansAt(yu, mid);
        // What stands over and under this slice, for the caps and soffits where it does not.
        const above = yu >= yb - 1e-6 ? [] : spansAt(yu, yu + (ys[ys.indexOf(yu) + 1] - yu) / 2).spans;
        const below = yl <= ya + 1e-6 ? (yl <= y0 + 1e-6 ? null : spansAt(yl, yl - .001).spans) : spansAt(yl, yl - (yl - ys[ys.indexOf(yl) - 1]) / 2).spans;
        L.spans.forEach(([lp, lq], i) => {
          const [up, uq] = U.spans[i];
          if (lq - lp < 1e-6 && uq - up < 1e-6) return;
          cells.forEach((cell, ci) => {
            const last = ci === cells.length - 1;
            if (Math.max(lq, uq) <= cell.sa + 1e-6 || Math.min(lp, up) >= cell.sb - 1e-6) { /* no overlap with this cell's body */ }
            else {
              let poly = [[lp, yl], [lq, yl], [uq, yu], [up, yu]];
              poly = clipPolygon(clipPolygon(poly, p => p[0] - cell.sa), p => cell.sb - p[0]);
              if (poly.length >= 3) faceOf(cell, poly);
            }
            // The span's sides: the wall's ends, the reveals of the openings, the rakes of a gable.
            for (const [x0, x1, sign] of [[lp, up, -1], [lq, uq, 1]]) {
              const mx = (x0 + x1) / 2, ds = x1 - x0, dy = yu - yl, e = Math.hypot(ds, dy);
              if (!inCell(cell, mx, last) || e < 1e-6) continue;
              // Outward normal of the solid in the (s, y) plane: the left edge's is (−dy, ds)/e, the right edge's (dy, −ds)/e.
              const nn = dirOf(A, sign * dy / e, -sign * ds / e, 0);
              cell.soup.fan([[x0, yl, h2], [x1, yu, h2], [x1, yu, -h2], [x0, yl, -h2]].map(([s, y, off]) => cell.soup.vertex(F(s, y, off), nn, mason(s, y))));
            }
            // Tops and undersides where nothing continues them.
            const tops = yu >= yb - 1e-6 ? [[up, uq]] : minus([up, uq], above), bottoms = below === null ? [] : minus([lp, lq], below);
            for (const [p, q] of tops) capOf(cell, p, q, yu, true);
            for (const [p, q] of bottoms) capOf(cell, p, q, yl, false);
          });
        });
      }
      for (const cell of cells) { const piece = cell.soup; if (!piece.empty) emit('stone', piece, tint(env.stone), ph, extra); }
      ya = yb;
    }
  }

  // A triangular gable on a wall line from a to b, base at y0, apex at y1, with an optional oculus.
  function gable(a, b, y0, y1, t, out, ph = env.phase, extra = {}, oculus) {
    const du = b[0] - a[0], dv = b[1] - a[1], len = Math.hypot(du, dv), dir = [du / len, dv / len];
    const F = (s, y, off) => [a[0] + dir[0] * s + out[0] * off, y, a[1] + dir[1] * s + out[1] * off], H = y1 - y0, c = len / 2;
    const half = y => Math.max(0, c * (1 - (y - y0) / H));
    const holes = oculus ? [{kind: 'circle', s: c, y: oculus.y, r: oculus.r, spokes: 8}] : [];
    layWall({F, len, y0, y1, t, holes, ph, extra, course: .8, shape: {lo: y => c - half(y), hi: y => c + half(y)}});
    for (const o of holes) env.opening(F, o, t, ph, extra);
    return F;
  }

  // ——— Arches, rings and openings ———
  const layersFor = step => new Layers(frame, step);
  const flush = (layers, kind, color, ph, extra) => layers.flush(soup => emit(kind, soup, color, ph, extra));

  // An arch outline as a swept bead, centred at s on a wall seen through F; `thick` the bead's width.
  function arch(F, s, w, spring, off, thick, ph, extra, kind = 'pointed', segs = 4, rise) {
    const layers = layersFor(1.2), lay = frameOf(F);
    const path = kind === 'rect' ? [[s - w / 2 + thick / 2, spring], [s + w / 2 - thick / 2, spring]] : outline({kind, s, w, spring, rise, sill: spring}, {grow: -thick / 2, foot: spring, tol});
    sweep(layers, lay, path, moulding.roll(thick), {base: off - thick * .35, mason: [0, 0, 0]});
    flush(layers, 'stone', tint(stone), ph, extra);
  }
  function ring(F, s, y, r, off, thick, n, ph, extra) {
    const layers = layersFor(1.2);
    sweep(layers, frameOf(F), outline({kind: 'circle', s, y, r}, {grow: -thick / 2, tol}), moulding.roll(thick), {base: off - thick * .35, closed: true});
    flush(layers, 'stone', tint(stone), ph, extra);
  }

  // The section of the orders round an opening: a fillet, then rolls and hollows alternately, as the archivolts of
  // the great window of the west front step out in the photographs.
  const surroundSection = (orders, k) => stack([moulding.fillet(.05 * k, .02 * k), ...Array.from({length: orders}, (_, i) => i % 2 ? moulding.hollow(.11 * k, .045 * k) : moulding.roll(.17 * k, .01)), moulding.keel(.12 * k, .07 * k)], .05 * k);
  const beadSection = k => moulding.roll(.09 * k, .005);

  // Glass and tracery of one opening. F(s, y, off) is a point on the wall, `off` towards the outside.
  function opening(F, o, t, ph, extra) {
    const circle = o.kind === 'circle', W = circle ? 2 * o.r : o.w, y0 = circle ? o.y - o.r : o.sill, y1 = env.top(o), face = t / 2;
    const lay = frameOf(F), [a, b] = [F(o.s - 1, 0, 0), F(o.s + 1, 0, 0)], dir = [(b[0] - a[0]) / 2, (b[2] - a[2]) / 2];
    const k = clamp(.75 + .12 * W, .85, 1.5), glassOff = o.photo ? -t * .2 : face - Math.min(.55, t * .32);
    const light = outline(o, {foot: y0, tol});
    // The glazing: one pane of leaded glass across the whole light, set back in the wall.
    const glaze = (poly, off, panes) => {
      const layers = layersFor(1.8), pts = dedupe(poly), at = i => ({p: lay.P(pts[i][0], pts[i][1], off), n: lay.D(0, 0, 1), m: [pts[i][0], pts[i][1], panes]});
      for (const [i, j, l] of triangulate(pts)) layers.tri(at(i), at(j), at(l));
      flush(layers, 'glass', tint(o.colors ? o.colors[Math.floor(rand() * o.colors.length)] : env.glass, .2), ph, extra);
    };
    if (o.photo) { glaze(light, glassOff, o.panes ?? .4); return; }
    if (o.door) {
      const p = F(o.s, 0, t / 2 - .4);
      env.box('wood', [p[0], p[2]], (o.spring ?? 4) / 2, [W, o.spring ?? 4, .25], dir, tint(o.door, .05), ph, extra);
    } else if (o.louvres) {
      for (let y = y0 + .4; y < y1 - .3; y += .75) {
        const hw = Math.max(.2, env.span(o, y + .1)), p = F(o.s, 0, 0);
        env.box('wood', [p[0], p[2]], y, [2 * hw, .12, t * .5], dir, tint(o.louvres, .06), ph, extra);
      }
    } else if (o.glass !== false) glaze(light, glassOff, o.panes ?? .36);
    // The orders round the light, running down its jambs to the sill, standing out of the face.
    const layers = layersFor(1.2), orders = o.orders ?? (W > 4 ? 4 : W > 2.4 ? 3 : 2);
    sweep(layers, lay, light, surroundSection(orders, k), {base: face, closed: circle, caps: true});
    flush(layers, 'stone', tint(stone), ph, extra);
    if (circle) { rose(lay, o, t, ph, extra, face, glassOff, k); return; }
    if (o.twin && W > 1.6 && o.glass !== false) twin(lay, o, W, y0, face, glassOff, ph, extra, k);
  }

  // The distance from a point to a polyline.
  const distance = (p, poly) => {
    let best = Infinity;
    for (let i = 0; i < poly.length - 1; i++) {
      const a = poly[i], b = poly[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9, u = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1);
      best = Math.min(best, Math.hypot(p[0] - a[0] - dx * u, p[1] - a[1] - dy * u));
    }
    return best;
  };

  // The tracery of a window with mullions: `lights` lancets between slim mullions, and above them, in the head, either one
  // foiled light (two lights) or a net of foiled lights set in a triangular lattice (three or more), as the chapels'
  // windows have in the photographs. The lancets are open at the bottom, notched into a plate of stone; the mullions
  // are bars that run down to the sill.
  function twin(lay, o, W, y0, face, glassOff, ph, extra, k) {
    const layers = layersFor(1.2), count = o.lights ?? (W >= 5 ? 4 : W >= 3.3 ? 3 : 2), round = o.kind === 'round';
    const m = Math.max(.2, W * (count > 2 ? .045 : .07)), Wl = (W - (count - 1) * m) / count;
    const front = glassOff + .3, back = glassOff - .02, spring = o.spring, top = env.top(o);
    const lancet = c => ({kind: round ? 'round' : 'pointed', s: c, w: Wl, spring, sill: spring, rise: round ? undefined : Wl * .866});
    const centres = Array.from({length: count}, (_, i) => o.s - W / 2 + Wl / 2 + i * (Wl + m)).reverse();
    const lights = centres.map(lancet), outlines = lights.map(l => outline(l, {foot: spring, tol}));
    const head = outline(o, {foot: spring, tol});
    // The plate's contour: the main head, then the bottom edge from right to left with a notch for each lancet.
    const contour = [...head], lit = head.map(() => false);
    for (const poly of outlines) { const r = [...poly].reverse(); contour.push(...r); lit.push(...r.map(() => true)); }
    const apex = spring + (round ? Wl / 2 : Wl * .866);
    let foils = [];
    if (o.oculus !== false && o.kind !== 'rect') {
      if (count === 2) {
        const rO = Math.min(W * .17, (top - apex) * .36);
        foils = [{c: [o.s, apex + rO + .09], r: rO}];
      } else {
        // A triangular lattice of foils above the lancets, its first row over the mullions, spaced as the lights are, kept
        // inside the head and clear of the lancets' arches.
        const pitch = Wl + m, web = .17, rF = clamp((pitch - web) / 2, .24, .7), margin = .2, rise = pitch * .87;
        const fits = c => {
          const ring = Array.from({length: 12}, (_, q) => [c[0] + Math.cos(q / 12 * Math.PI * 2) * rF, c[1] + Math.sin(q / 12 * Math.PI * 2) * rF]);
          return ring.every(([x, yy]) => yy < top - margin && env.span(o, yy) > Math.abs(x - o.s) + margin) && outlines.every(poly => distance(c, poly) > rF + web * .6);
        };
        const first = [centres[0] - (Wl + m) / 2];
        let y = spring + .3;
        while (y < top && !fits([first[0], y])) y += .04;
        for (let row = 0; y + row * rise < top; row++) {
          const n = Math.ceil(W / pitch) + 1;
          for (let i = -n; i <= n; i++) {
            const c = [o.s + (i + (row % 2 ? .5 : 0)) * pitch + (count % 2 ? .5 * pitch : 0), y + row * rise];
            if (fits(c)) foils.push({c, r: rF});
          }
        }
      }
    }
    const lobes = o.foils ?? 4, holes = foils.map(f => foil(f.c[0], f.c[1], f.r, lobes));
    plate(layers, lay, dedupe(contour), holes.map(h => dedupe(h)), {front, back, lit: null});
    for (const poly of outlines) sweep(layers, lay, poly, beadSection(k), {base: front, caps: false});
    for (const h of holes) sweep(layers, lay, h, beadSection(k), {base: front, closed: true});
    // The mullions, from the sill to the plate.
    for (let q = 0; q < count - 1; q++) {
      const c = (centres[q] + centres[q + 1]) / 2, bar = [[c - m / 2, y0], [c - m / 2, spring], [c + m / 2, spring], [c + m / 2, y0]];
      plate(layers, lay, bar, [], {front, back, lit: [true, false, true, false], backFace: false});
    }
    flush(layers, 'stone', tint(stone), ph, extra);
  }

  // A rose: a ring of lights between spokes, a hub, and an outer ring of small lights, set in a plate.
  function rose(lay, o, t, ph, extra, face, glassOff, k) {
    const layers = layersFor(1.2), n = Math.max(5, Math.min(16, o.spokes ?? 8)), r = o.r, front = glassOff + .3, back = glassOff - .02;
    const holes = [], spoke = Math.max(.07, r * .05), r1 = r * .26, r2 = r * .64, r3 = r * .83, rr = r * .105;
    holes.push(foil(o.s, o.y, r * .17, Math.max(4, n / 2 | 0)));
    for (let i = 0; i < n; i++) {
      const centre = Math.PI / 2 - i * 2 * Math.PI / n, half = Math.PI / n, poly = [];
      const a0 = centre + half - spoke / (2 * r1), a1 = centre - half + spoke / (2 * r1);
      const steps = Math.max(4, Math.ceil((a0 - a1) / .15));
      // The petal: its inner arc, a straight run up its spoke, a pointed outer end.
      for (let j = 0; j <= steps; j++) { const a = a0 + (a1 - a0) * j / steps; poly.push([o.s + Math.cos(a) * r1, o.y + Math.sin(a) * r1]); }
      const b1 = centre - half + spoke / (2 * r2), b0 = centre + half - spoke / (2 * r2), tip = [o.s + Math.cos(centre) * r2 * 1.06, o.y + Math.sin(centre) * r2 * 1.06];
      poly.push([o.s + Math.cos(b1) * r2, o.y + Math.sin(b1) * r2], tip, [o.s + Math.cos(b0) * r2, o.y + Math.sin(b0) * r2]);
      holes.push(poly);
      const mid = centre - half, small = foil(o.s + Math.cos(mid) * r3, o.y + Math.sin(mid) * r3, rr, 3, {turn: mid});
      holes.push(small);
    }
    const contour = outline({kind: 'circle', s: o.s, y: o.y, r: r - .02}, {tol});
    plate(layers, lay, dedupe(contour), holes.map(h => dedupe(h)), {front, back});
    for (const h of holes) sweep(layers, lay, h, beadSection(k), {base: front, closed: true});
    flush(layers, 'stone', tint(stone), ph, extra);
  }

  // ——— Roofs ———
  // A strip roof over the quad A B / C D (eave edge A–B, ridge or upper edge C–D; C = D for a cone), laid eave to
  // ridge so that it grows with its phase: each strip a thin slab of its own, whose upper face carries the courses
  // of slates (`aMason`: s along the eave, the distance up the slope, the course height).
  function panel(A, B, C, D, color, ph, extra, kind = 'lead', strip = 1.25, lift = .12) {
    const ea = A.clone().lerp(B, .5), ra = C.clone().lerp(D, .5), slope = ea.distanceTo(ra), n = Math.max(1, Math.round(slope / strip));
    const sd = ra.clone().sub(ea).normalize(), tg0 = B.clone().sub(A).normalize(), course = kind === 'slate' || kind === 'lead' ? env.slate ?? .24 : 0;
    for (let j = 0; j < n; j++) {
      const t0 = Math.max(0, (j - .04) / n), t1 = Math.min(1, (j + 1.04) / n);
      const L0 = A.clone().lerp(C, t0), R0 = B.clone().lerp(D, t0), L1 = A.clone().lerp(C, t1), R1 = B.clone().lerp(D, t1);
      const tg = R0.clone().sub(L0).add(R1.clone().sub(L1)); if (tg.lengthSq() < 1e-8) continue; tg.normalize();
      const nrm = new T.Vector3().crossVectors(sd, tg).normalize(); if (nrm.y < 0) nrm.negate();
      const soup = new Soup(null), up = lift + .1, down = lift - .12;
      const corner = (P, k) => P.clone().addScaledVector(nrm, k);
      const top = [L0, R0, R1, L1].map(P => soup.vertex(corner(P, up).toArray(), nrm.toArray(), [P.clone().sub(A).dot(tg0), P.clone().sub(ea).dot(sd), course]))
      soup.fan(top);
      const under = [L0, R0, R1, L1].map(P => soup.vertex(corner(P, down).toArray(), nrm.clone().negate().toArray(), [0, 0, 0]));
      soup.fan(under);
      // The four edges of the slab.
      const edge = (P, Q, n) => soup.fan([P, Q].map(X => soup.vertex(corner(X, up).toArray(), n.toArray())).concat([Q, P].map(X => soup.vertex(corner(X, down).toArray(), n.toArray()))));
      edge(L0, R0, sd.clone().negate()); edge(L1, R1, sd.clone()); edge(L0, L1, tg.clone().negate()); edge(R0, R1, tg.clone());
      emit(kind === 'lead' && extra?.slateKind ? 'slate' : kind, soup, tint(color, .05), ph, extra);
    }
  }
  const quad = (e0, e1, ye, r0, r1, yr, color, ph, extra, kind) => panel(env.V(e0[0], ye, e0[1]), env.V(e1[0], ye, e1[1]), env.V(r0[0], yr, r0[1]), env.V(r1[0], yr, r1[1]), color, ph, extra, kind);

  // ——— Balustrades ———
  // A pierced parapet along a→b ([u, v]) from y: a plinth, a net of small quatrefoils in two rows (each row half a step
  // from the other, as the openwork of the photographed parapets runs), a coping.
  function rail(a, b, y, ph = env.phase, extra = {}) {
    const du = b[0] - a[0], dv = b[1] - a[1], len = Math.hypot(du, dv);
    if (len < .2) return;
    const dir = [du / len, dv / len], out = [-dir[1], dir[0]], bays = Math.max(1, Math.round(len / 1.35)), pitch = len / bays;
    const F = (s, yy, off) => [a[0] + dir[0] * s + out[0] * off, yy, a[1] + dir[1] * s + out[1] * off], lay = frameOf(F);
    const step = pitch / 3, rr = Math.min(.15, step * .36);
    for (let i0 = 0; i0 < bays; i0 += 3) {
      const layers = layersFor(6), i1 = Math.min(bays, i0 + 3), s0 = i0 * pitch, s1 = i1 * pitch;
      for (let i = i0; i < i1; i++) {
        const l = i * pitch, r = (i + 1) * pitch, holes = [];
        for (let q = 0; q < 3; q++) holes.push(foil(l + step * (q + .5), y + .39, rr, 4, {turn: Math.PI / 4, tol: .02}));
        for (let q = 0; q < 2; q++) holes.push(foil(l + step * (q + 1), y + .73, rr, 4, {turn: Math.PI / 4, tol: .02}));
        plate(layers, lay, [[l, y + .2], [l, y + .96], [r, y + .96], [r, y + .2]], holes, {front: .09, back: -.09});
      }
      sweep(layers, lay, [[s0, y + .95], [s1, y + .95]], moulding.fillet(.14, .32), {base: -.16, caps: true});
      sweep(layers, lay, [[s0, y], [s1, y]], moulding.fillet(.2, .38), {base: -.19, caps: true});
      flush(layers, 'stone', tint(stone), ph, extra);
    }
  }

  // ——— Solids of rings: shafts, cones, spires ———
  // `ys` the heights of the rings, `radius(y)` the circumradius of the regular polygon (`sides`) centred on c ([u, v]),
  // its first vertex at `turn` + half a side. Flat faces, or smooth normals for a round shaft; `mason` [s scale,
  // course] draws coursing on the faces ([_, 0] for none, a negative course for scales).
  function loft(c, ys, radius, ph, extra, {sides = 8, turn = 0, smooth = false, course = 0, cap = true, color = stone, step = 1.2} = {}) {
    const layers = layersFor(step), ring = y => Array.from({length: sides}, (_, k) => { const a = turn + (k + .5) / sides * Math.PI * 2, r = radius(y); return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, Math.cos(a), Math.sin(a)]; });
    const rings = ys.map(ring);
    for (let i = 0; i < ys.length - 1; i++) for (let k = 0; k < sides; k++) {
      const k2 = (k + 1) % sides, lo = rings[i], hi = rings[i + 1], r0 = radius(ys[i]), r1 = radius(ys[i + 1]), e0 = 2 * r0 * Math.sin(Math.PI / sides), e1 = 2 * r1 * Math.sin(Math.PI / sides);
      const pts = [[lo[k], ys[i], k * e0], [lo[k2], ys[i], (k + 1) * e0], [hi[k2], ys[i + 1], (k + 1) * e1], [hi[k], ys[i + 1], k * e1]];
      const mid = [(lo[k][2] + lo[k2][2]) / 2, (lo[k][3] + lo[k2][3]) / 2], slope = (r0 - r1) / Math.max(1e-6, ys[i + 1] - ys[i]), flat = Math.hypot(...mid) || 1;
      layers.fan(pts.map(([P, y, sm], j) => {
        const radial = smooth ? [P[2], P[3]] : [mid[0] / flat, mid[1] / flat];
        return {p: [P[0], y, P[1]], n: [radial[0], slope, radial[1]], m: [sm, y, course]};
      }));
    }
    if (cap) { const top = rings.at(-1), y = ys.at(-1); layers.fan(top.map(P => ({p: [P[0], y, P[1]], n: [0, 1, 0], m: [0, 0, 0]}))); }
    flush(layers, 'stone', tint(color), ph, extra);
  }
  // A shaft from y0 to y1, `d` across, octagonal (or round).
  function shaft(c, y0, y1, d, ph, extra = {}, shape = 'octagon', course = 1.1) {
    const round = shape === 'drum', ys = []; for (let y = y0; y < y1 - .05; y += course) ys.push(y); ys.push(y1);
    loft(c, ys, () => d / 2, ph, extra, {sides: round ? 20 : 8, turn: Math.PI / 8 * (round ? 0 : 1) - Math.PI / 8, smooth: round, course: jointCourse * 1.1, step: course});
  }
  // A spirelet: an octagonal cone from y0 to y1, `d` across at its foot, in courses; its finial is the caller's.
  function spirelet(c, y0, y1, d, ph, extra = {}) {
    const n = Math.max(2, Math.round((y1 - y0) / 1.6)), ys = Array.from({length: n + 1}, (_, i) => y0 + (y1 - y0) * i / n);
    loft(c, ys, y => d / 2 * (1 - .93 * (y - y0) / (y1 - y0)) + .02, ph, extra, {sides: 8, turn: 0, course: -jointCourse * 1.2, step: 1.6});
  }

  // ——— Ribs: a tube along a 3D polyline ———
  // `pts` [u, y, v] in the brick's frame; the section is a regular polygon of `sides` and diameter `thick`, carried along
  // by parallel transport so that it does not twist. The ends are inside the masonry they spring from.
  function tube(pts, thick, ph, extra = {}, sides = 6) {
    if (pts.length < 2) return;
    const layers = layersFor(1.2), r = thick / 2, unit = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
    const cross3 = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]], dot3 = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    const tangent = pts.map((p, i) => unit([0, 1, 2].map(c => pts[Math.min(pts.length - 1, i + 1)][c] - pts[Math.max(0, i - 1)][c])));
    let n1 = unit(cross3(Math.abs(tangent[0][1]) > .9 ? [1, 0, 0] : [0, 1, 0], tangent[0]));
    const rings = pts.map((p, i) => {
      const t = tangent[i]; n1 = unit(n1.map((x, c) => x - t[c] * dot3(n1, t)));
      const n2 = cross3(t, n1);
      return Array.from({length: sides}, (_, k) => { const a = (k + .5) / sides * Math.PI * 2, d = [0, 1, 2].map(c => n1[c] * Math.cos(a) + n2[c] * Math.sin(a)); return {p: [0, 1, 2].map(c => p[c] + d[c] * r * 1.08), n: d, m: [0, 0, 0]}; });
    });
    for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < sides; k++) layers.fan([rings[i][k], rings[i + 1][k], rings[i + 1][(k + 1) % sides], rings[i][(k + 1) % sides]]);
    flush(layers, 'stone', tint(stone), ph, extra);
  }

  // ——— A slab cut from a polygon: flying buttresses, copings ———
  // `poly` [s, y] points in the frame F, `thick` metres thick, centred on the plane.
  function extrude(F, poly, thick, ph, extra = {}) {
    const lay = frameOf(F), layers = layersFor(1.2);
    plate(layers, lay, dedupe(poly), [], {front: thick / 2, back: -thick / 2, lit: dedupe(poly).map(() => true)});
    flush(layers, 'stone', tint(stone), ph, extra);
  }

  // A string course or a cornice: a moulding run along a wall line a→b ([u, v]) at height y, standing out of the face of
  // a wall of thickness t whose outward normal is `out`; `section` (see `moulding`) runs up from y.
  function string(a, b, y, t, out, ph = env.phase, extra = {}, section = null) {
    const du = b[0] - a[0], dv = b[1] - a[1], len = Math.hypot(du, dv);
    if (len < .3) return;
    const dir = [du / len, dv / len], F = (s, yy, off) => [a[0] + dir[0] * s + out[0] * off, yy, a[1] + dir[1] * s + out[1] * off], lay = frameOf(F);
    const profile = section ?? stack([moulding.fillet(.07, .05), moulding.hollow(.12, .05), moulding.roll(.14), moulding.fillet(.1, .14)], .06);
    const pieces = Math.max(1, Math.round(len / 4));
    for (let i = 0; i < pieces; i++) {
      const layers = layersFor(2), s0 = len * i / pieces, s1 = len * (i + 1) / pieces;
      sweep(layers, lay, [[s0, y], [s1, y]], profile, {base: t / 2 - .02, caps: i === 0 || i === pieces - 1});
      flush(layers, 'stone', tint(stone), ph, extra);
    }
  }

  // A pinnacle: a square shaft in courses, an octagonal plinth, an octagonal spire, crockets up its arrises, a finial,
  // centred on [u, v].
  function pinnacle(c, y0, h, w, ph = env.phase, extra = {}) {
    const [x, , z] = env.V(c[0], 0, c[1]).toArray(), at = y => [x, y, z], ys = []; for (let y = y0; y < y0 + h * .34 - .05; y += 1.1) ys.push(y); ys.push(y0 + h * .34);
    loft(c, ys, () => w * .7071, ph, extra, {sides: 4, course: jointCourse, step: 1.1});
    k.turned('octagon', 'stone', at(y0 + h * .36), [w * 1.08, h * .04], env.rot, tint(stone), ph, y0, extra);
    const a0 = y0 + h * .38, a1 = y0 + h * .94, spire = Array.from({length: 7}, (_, i) => a0 + (a1 - a0) * i / 6);
    loft(c, spire, y => w * .46 * (1 - (y - a0) / (a1 - a0)) + .01, ph, extra, {sides: 8, turn: 0, course: -jointCourse * 1.2, step: 2});
    for (let i = 1; i < 4; i++) for (let j = 0; j < 4; j++) {
      const f = i / 4, a = env.rot + (j + .5) * Math.PI / 2, r = w * .46 * (1 - f) + .06, y = y0 + h * (.38 + f * .56);
      k.turned('ball', 'stone', [x + Math.cos(a) * r, y, z - Math.sin(a) * r], [Math.max(.14, w * .16), Math.max(.16, w * .2)], a, tint(stone), ph, y, extra);
    }
    k.turned('ball', 'stone', at(y0 + h * .97), [Math.max(.22, w * .28), Math.max(.3, h * .07)], env.rot, tint(stone), ph, y0 + h, extra);
  }

  // A buttress pier: courses of ashlar from d0 out to d1 along the normal of a station [A, n], `w` wide, stepping back by
  // `step` above `low`; and the flying buttress that leaps from it to the wall, as one slab cut to its curve.
  function pier(at, s, d0, d1, w, y0, y1, ph, extra = {}, {low = Infinity, step = 0} = {}) {
    const side = [-s.n[1], s.n[0]];
    const run = (ya, yb, d) => { if (yb - ya > .1) wall(at(s, d0), at(s, d), ya, yb, w, side, [], ph, extra, .8); };
    run(y0, Math.min(y1, low), d1);
    if (y1 > low) run(Math.max(y0, low), y1, d1 - step);
  }
  function flyer(at, s, dA, dB, top, low, thick, ph, extra = {}, samples = 14) {
    const side = [-s.n[1], s.n[0]], F = (d, y, off) => { const p = at(s, d); return [p[0] + side[0] * off, y, p[1] + side[1] * off]; };
    const up = [], down = [];
    for (let j = 0; j <= samples; j++) { const f = j / samples, d = dA + (dB - dA) * f; up.push([d, top(f)]); down.push([d, low(f)]); }
    extrude(F, [...up, ...down.reverse()], thick, ph, extra);
  }

  return {wall, gable, arch, ring, opening, panel, quad, rail, shaft, spirelet, pinnacle, pier, flyer, string, tube, loft, extrude, soup, emit, axes, dirOf};
}
