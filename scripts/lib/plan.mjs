// Measures how well a model sits on its real plan, as an aerial trace sees it. The measured outline
// (evidence.plan.outline, local metres: x east, z south, same origin as the model) and the finished model
// seen from above are drawn on a half-metre grid and filled to their outer envelope:
// - the outline's polygons and lines close the area they surround (OpenStreetMap often splits a ring into
//   several open ways);
// - the model's pieces standing above the ground are closed over gaps narrower than 3 m (lattice bays, open
//   arcades, the joints between blocks), as a mapper tracing an aerial photo would.
// The gap is the distance between the edges of the two envelopes, both ways: every outline edge to the
// nearest model edge, and every model edge to the nearest outline edge. A wing too short, a pier too wide,
// a corner too sharp or a footprint turned the wrong way all show. Also draws the control plan: the model
// in grey, the outline in gold, the edges further apart than the tolerance in red.
import {readFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {loadEngine} from './engine.mjs';
import {expand} from './compact.mjs';

const RES = .5, CLOSE = 1.5, CORNERS = [];
for (const x of [-.5, .5]) for (const y of [-.5, .5]) for (const z of [-.5, .5]) CORNERS.push([x, y, z]);

export async function measurePlan(file) {
  const d = expand(JSON.parse(await readFile(file, 'utf8')), file), dir = dirname(file);
  const plan = d.evidence?.plan;
  if (!plan?.outline) throw new Error('evidence.plan.outline is missing');
  const outline = JSON.parse(await readFile(join(dir, plan.outline), 'utf8'));
  const shapes = [...(outline.polygons ?? []).map(p => [p, true]), ...(outline.lines ?? []).map(l => [l, false])];
  if (!shapes.length) throw new Error(`${plan.outline} has no polygons or lines`);
  const {buildPieces} = await loadEngine(d.bricks ? join(dir, d.bricks) : undefined);
  const last = d.phases.length - 1, {pieces} = buildPieces(d);
  // The finished building seen from above: every piece laid by the last phase, never taken down and
  // standing above the ground (footings at grade are not traced on aerial views), as its projected outline.
  const hulls = [];
  for (const p of pieces) {
    if (p.phase > last || p.until !== undefined || !(p.top > 1)) continue;
    const e = p.matrix.elements, at = (x, y, z) => [e[0] * x + e[4] * y + e[8] * z + e[12], e[2] * x + e[6] * y + e[10] * z + e[14]];
    // A patch of real surface (kit/masonry.js) stands where its triangles do, not in its bounding box.
    const points = p.mesh ? Array.from({length: p.mesh.position.length / 3}, (_, i) => at(p.mesh.position[i * 3], p.mesh.position[i * 3 + 1], p.mesh.position[i * 3 + 2])) : CORNERS.map(([x, y, z]) => at(x, y, z));
    hulls.push(hull(points));
  }
  if (!hulls.length) throw new Error('the model has no piece above the ground');

  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const list of [...hulls, ...shapes.map(s => s[0])]) for (const [x, z] of list) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const pad = CLOSE + 4, x0 = minX - pad, z0 = minZ - pad, W = Math.ceil((maxX - x0 + pad) / RES), H = Math.ceil((maxZ - z0 + pad) / RES);
  const g = {x0, z0, W, H};

  // The outline's envelope: its edges, then everything they enclose.
  const stroke = new Uint8Array(W * H);
  for (const [shape, closed] of shapes) for (let i = 0; i < shape.length - (closed ? 0 : 1); i++) line(g, stroke, shape[i], shape[(i + 1) % shape.length]);
  const O = fillHoles(g, stroke);
  // The model's envelope: its pieces, closed over narrow gaps, then everything they enclose.
  const raw = new Uint8Array(W * H);
  for (const h of hulls) fillConvex(g, raw, h);
  const M = fillHoles(g, close(g, raw, CLOSE / RES));

  const edgeO = edges(g, O), edgeM = edges(g, M), toO = distance(g, edgeO), toM = distance(g, edgeM);
  const gaps = [];
  for (let c = 0; c < W * H; c++) {
    if (edgeO[c]) gaps.push(toM[c] * RES);
    if (edgeM[c]) gaps.push(toO[c] * RES);
  }
  const tolerance = Math.min(5, plan.tolerance ?? 3), marks = [];
  for (let c = 0; c < W * H; c++) if ((edgeO[c] && toM[c] * RES > tolerance) || (edgeM[c] && toO[c] * RES > tolerance)) marks.push(c);
  let inO = 0, both = 0, onlyM = 0;
  for (let c = 0; c < W * H; c++) { if (O[c]) { inO++; if (M[c]) both++; } else if (M[c]) onlyM++; }
  gaps.sort((a, b) => a - b);
  const result = {
    p90: +gaps[Math.floor(gaps.length * .9)].toFixed(2),
    max: +gaps.at(-1).toFixed(2),
    mean: +(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(2),
    // Share of the outline's area the model covers, and the area it adds outside, as a share of the outline.
    coverage: +(both / inO).toFixed(2),
    overflow: +(onlyM / inO).toFixed(2),
    tolerance,
    source: outline.source,
  };
  return {result, svg: drawPlan(d, outline, g, M, marks, result)};
}

// Convex hull of a few points (monotone chain), counter-clockwise.
function hull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length > 1 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length > 1 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// Marks every cell whose centre lies in the polygon or within half a cell of it, so thin members count.
function fillConvex({x0, z0, W, H}, mask, poly) {
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
  for (const [x, z] of poly) { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, z); d = Math.max(d, z); }
  const i0 = Math.max(0, Math.floor((a - x0) / RES - .5)), i1 = Math.min(W - 1, Math.ceil((b - x0) / RES)), j0 = Math.max(0, Math.floor((c - z0) / RES - .5)), j1 = Math.min(H - 1, Math.ceil((d - z0) / RES));
  const n = poly.length, reach = (RES / 2) ** 2;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const px = x0 + (i + .5) * RES, pz = z0 + (j + .5) * RES;
    let inside = n > 2, near = false;
    for (let k = 0; k < n; k++) {
      const [ax, az] = poly[k], [bx, bz] = poly[(k + 1) % n], ex = bx - ax, ez = bz - az;
      if (ex * (pz - az) - ez * (px - ax) < 0) inside = false;
      const len = ex * ex + ez * ez, t = len ? Math.max(0, Math.min(1, ((px - ax) * ex + (pz - az) * ez) / len)) : 0;
      if ((px - ax - t * ex) ** 2 + (pz - az - t * ez) ** 2 <= reach) near = true;
    }
    if (inside || near) mask[j * W + i] = 1;
  }
}

// An unbroken line of cells from a to b (no diagonal step the fill below could slip through).
function line({x0, z0, W, H}, mask, [ax, az], [bx, bz]) {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (RES / 4)));
  let pi = -1, pj = -1;
  for (let k = 0; k <= n; k++) {
    const i = Math.min(W - 1, Math.max(0, Math.floor((ax + (bx - ax) * k / n - x0) / RES))), j = Math.min(H - 1, Math.max(0, Math.floor((az + (bz - az) * k / n - z0) / RES)));
    if (pi >= 0 && i !== pi && j !== pj) mask[pj * W + i] = 1;
    mask[j * W + i] = 1; pi = i; pj = j;
  }
}

// Everything the outside cannot reach without crossing the mask.
function fillHoles({W, H}, mask) {
  const out = new Uint8Array(W * H), stack = [];
  for (let i = 0; i < W; i++) stack.push(i, (H - 1) * W + i);
  for (let j = 0; j < H; j++) stack.push(j * W, j * W + W - 1);
  while (stack.length) {
    const c = stack.pop();
    if (out[c] || mask[c]) continue;
    out[c] = 1;
    const i = c % W;
    if (i > 0) stack.push(c - 1);
    if (i < W - 1) stack.push(c + 1);
    if (c >= W) stack.push(c - W);
    if (c < (H - 1) * W) stack.push(c + W);
  }
  const filled = new Uint8Array(W * H);
  for (let c = 0; c < W * H; c++) filled[c] = out[c] ? 0 : 1;
  return filled;
}

// Morphological closing with a disc of r cells: grow by r, then shrink by r.
function close(g, mask, r) {
  const grow = distance(g, mask), empty = new Uint8Array(mask.length);
  for (let c = 0; c < mask.length; c++) empty[c] = grow[c] <= r ? 0 : 1;
  const shrink = distance(g, empty), closed = new Uint8Array(mask.length);
  for (let c = 0; c < mask.length; c++) closed[c] = shrink[c] > r ? 1 : 0;
  return closed;
}

// Cells of the mask with a neighbour outside it.
function edges({W, H}, mask) {
  const e = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const c = j * W + i;
    if (mask[c] && (i === 0 || j === 0 || i === W - 1 || j === H - 1 || !mask[c - 1] || !mask[c + 1] || !mask[c - W] || !mask[c + W])) e[c] = 1;
  }
  return e;
}

// Euclidean distance (in cells) from every cell to the nearest marked cell (Felzenszwalb & Huttenlocher).
function distance({W, H}, mask) {
  const INF = 1e20, f = new Float64Array(W * H);
  for (let c = 0; c < W * H; c++) f[c] = mask[c] ? 0 : INF;
  const n = Math.max(W, H), v = new Int32Array(n), z = new Float64Array(n + 1), src = new Float64Array(n), out = new Float64Array(n);
  const pass = len => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s;
      while ((s = ((src[q] + q * q) - (src[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])) <= z[k]) k--;
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; out[q] = (q - v[k]) ** 2 + src[v[k]]; }
  };
  for (let i = 0; i < W; i++) { for (let j = 0; j < H; j++) src[j] = f[j * W + i]; pass(H); for (let j = 0; j < H; j++) f[j * W + i] = out[j]; }
  for (let j = 0; j < H; j++) { for (let i = 0; i < W; i++) src[i] = f[j * W + i]; pass(W); for (let i = 0; i < W; i++) f[j * W + i] = out[i]; }
  for (let c = 0; c < W * H; c++) f[c] = Math.sqrt(f[c]);
  return f;
}

function drawPlan(d, outline, {x0, z0, W, H}, M, marks, r) {
  // The model's envelope as horizontal runs of cells.
  let model = '';
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (!M[j * W + i] || (i && M[j * W + i - 1])) continue;
    let n = 1; while (i + n < W && M[j * W + i + n]) n++;
    model += `M${(x0 + i * RES).toFixed(1)} ${(z0 + j * RES).toFixed(1)}h${(n * RES).toFixed(1)}v${RES}h-${(n * RES).toFixed(1)}z`;
  }
  const red = marks.map(c => `M${(x0 + (c % W + .5) * RES).toFixed(1)} ${(z0 + (Math.floor(c / W) + .5) * RES).toFixed(1)}h.01`).join('');
  const pts = shape => shape.map(([x, z]) => `${x.toFixed(2)},${z.toFixed(2)}`).join(' ');
  const polys = (outline.polygons ?? []).map(p => `<polygon points="${pts(p)}"/>`).join('') + (outline.lines ?? []).map(l => `<polyline points="${pts(l)}"/>`).join('');
  const w = W * RES, h = H * RES, size = Math.max(w, h) / 60;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0.toFixed(1)} ${(z0 - size * 3).toFixed(1)} ${w.toFixed(1)} ${(h + size * 3).toFixed(1)}" style="background:#0b0c14">
<path d="${model}" fill="#5d5a68"/>
<g fill="none" stroke="#f1b867" stroke-width="${(size / 5).toFixed(2)}">${polys}</g>
<path d="${red}" stroke="#ff4d4d" stroke-width="${(RES * 1.4).toFixed(2)}" stroke-linecap="round"/>
<text x="${x0.toFixed(1)}" y="${(z0 - size).toFixed(1)}" fill="#ece7de" font-family="monospace" font-size="${size.toFixed(2)}">${esc(d.name)} · model (grey) on ${esc(outline.source)} (gold) · edge gap p90 ${r.p90} m, max ${r.max} m · red: more than ${r.tolerance} m</text>
</svg>
`;
}
const esc = text => String(text).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
