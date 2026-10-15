// Measures how well a model sits on its real plan. The measured outline (evidence.plan.outline, local
// metres: x east, z south, same origin as the model) is compared with the finished model seen from above,
// as outlines are traced on aerial views: in each 2° sector around the centre of the outline's bounding
// box, the farthest point of the model against the farthest point of the outline. Also draws the control
// plan (model in grey, outline in gold).
import {readFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {loadEngine} from './engine.mjs';

const SECTORS = 180, CORNERS = [];
for (const x of [-.5, .5]) for (const y of [-.5, .5]) for (const z of [-.5, .5]) CORNERS.push([x, y, z]);

export async function measurePlan(file) {
  const d = JSON.parse(await readFile(file, 'utf8')), dir = dirname(file);
  const plan = d.evidence?.plan;
  if (!plan?.outline) throw new Error('evidence.plan.outline is missing');
  const outline = JSON.parse(await readFile(join(dir, plan.outline), 'utf8'));
  const {buildPieces} = await loadEngine(d.bricks ? join(dir, d.bricks) : undefined);
  const last = d.phases.length - 1, {pieces} = buildPieces(d);
  // The finished building seen from above: every piece laid by the last phase, never taken down and
  // standing above the ground (footings at grade are not traced on aerial views), its corners and
  // points every 0.75 m along its edges.
  const points = [];
  for (const p of pieces.filter(p => p.phase <= last && p.until === undefined && p.top > 1)) {
    const e = p.matrix.elements, c = CORNERS.map(([x, y, z]) => [e[0] * x + e[4] * y + e[8] * z + e[12], e[2] * x + e[6] * y + e[10] * z + e[14]]);
    for (const [i, j] of [[0, 1], [0, 2], [0, 4], [3, 1], [3, 2], [5, 1], [5, 4], [6, 2], [6, 4], [7, 3], [7, 5], [7, 6]]) {
      const [ax, az] = c[i], [bx, bz] = c[j], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / .75));
      for (let k = 0; k <= n; k++) points.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
    }
  }
  // Outline points every half metre along each edge.
  // Closed polygons and open lines (OpenStreetMap often splits a ring into several open ways).
  const outlinePts = [], shapes = [...(outline.polygons ?? []).map(p => [p, true]), ...(outline.lines ?? []).map(l => [l, false])];
  for (const [shape, closed] of shapes) for (let i = 0; i < shape.length - (closed ? 0 : 1); i++) {
    const [ax, az] = shape[i], [bx, bz] = shape[(i + 1) % shape.length], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / .5));
    for (let j = 0; j < n; j++) outlinePts.push([ax + (bx - ax) * j / n, az + (bz - az) * j / n]);
  }
  const xs = outlinePts.map(p => p[0]), zs = outlinePts.map(p => p[1]), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const far = pts => { const r = new Array(SECTORS).fill(null); for (const [x, z] of pts) { const s = Math.floor(((Math.atan2(z - cz, x - cx) + Math.PI) / (2 * Math.PI)) * SECTORS) % SECTORS, d = Math.hypot(x - cx, z - cz); if (r[s] === null || d > r[s]) r[s] = d; } return r; };
  const ro = far(outlinePts), rm = far(points), gaps = [];
  for (let s = 0; s < SECTORS; s++) if (ro[s] !== null && rm[s] !== null) gaps.push(Math.abs(rm[s] - ro[s]));
  gaps.sort((a, b) => a - b);
  const sectors = ro.filter(r => r !== null).length;
  const result = {
    p90: gaps.length ? +gaps[Math.floor(gaps.length * .9)].toFixed(2) : null,
    max: gaps.length ? +gaps.at(-1).toFixed(2) : null,
    mean: gaps.length ? +(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(2) : null,
    coverage: sectors ? +(gaps.length / sectors).toFixed(2) : 0,
    source: outline.source,
  };
  return {result, svg: drawPlan(d, outline, points, result)};
}

function drawPlan(d, outline, points, r) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const list of [points, (outline.polygons ?? []).flat(), (outline.lines ?? []).flat()]) for (const [x, z] of list) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const pad = 6, x0 = minX - pad, z0 = minZ - pad, w = maxX - x0 + pad, h = maxZ - z0 + pad;
  const dots = points.filter((_, i) => i % Math.max(1, Math.floor(points.length / 20000)) === 0).map(([x, z]) => `M${x.toFixed(2)} ${z.toFixed(2)}h.4`).join('');
  const pts = shape => shape.map(([x, z]) => `${x.toFixed(2)},${z.toFixed(2)}`).join(' ');
  const polys = (outline.polygons ?? []).map(p => `<polygon points="${pts(p)}"/>`).join('') + (outline.lines ?? []).map(l => `<polyline points="${pts(l)}"/>`).join('');
  const size = Math.max(w, h) / 60;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0.toFixed(1)} ${(z0 - size * 3).toFixed(1)} ${w.toFixed(1)} ${(h + size * 3).toFixed(1)}" style="background:#0b0c14">
<path d="${dots}" stroke="#8d8a98" stroke-width=".45" fill="none"/>
<g fill="none" stroke="#f1b867" stroke-width="${(size / 4).toFixed(2)}">${polys}</g>
<text x="${x0.toFixed(1)}" y="${(z0 - size).toFixed(1)}" fill="#ece7de" font-family="monospace" font-size="${size.toFixed(2)}">${esc(d.name)} · model (grey) on ${esc(outline.source)} (gold) · gap p90 ${r.p90} m, max ${r.max} m, coverage ${r.coverage}</text>
</svg>
`;
}
const esc = text => String(text).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
