#!/usr/bin/env node
// A roof is a covering on a frame, and a building has no roof without one. In the model the frame is the pieces laid for the
// role `frame` (and the rafters of the gilded eaves), the covering is the shingles. Three things go wrong when it is drawn by
// hand, and none of them is caught by the golden baselines, which hold positions and counts of pieces, not how they sit:
//   poke-through  a strut or a purlin laid as high as the roof's top stands up through the shingles where the roof is lower;
//   order         the shingles appear before the frame they lie on, so that the film shows a roof hanging in the air;
//   coverage      a stretch of roof has nothing under it at all: shingles on posts, as the gabled annex of the Golden Pavilion had.
// This reads the pieces the engine lays for Kinkaku-ji, the building whose roofs are timber frames under shingles, and holds each
// of the three. A frame member is sampled along its axis and across its section, a vertical line through each sample is cut
// by the shingle boards (oriented boxes), and what the line meets is the roof at that place.
import assert from 'node:assert/strict';
import test from 'node:test';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadEngine} from './lib/engine.mjs';
import {readMonument} from './lib/compact.mjs';

const root = fileURLToPath(new URL('..', import.meta.url)), file = resolve(root, process.env.ROOF_MONUMENT ?? 'community/kinkaku-ji/monument.json');
const data = await readMonument(file), engine = await loadEngine(resolve(dirname(file), data.bricks));
const {pieces} = engine.buildPieces(data);
engine.layPieces(pieces, data.phases.length);
const {DEATH} = engine;

// A piece's matrix as three columns (its axes, scaled by its size), its centre and the 3×3 inverse of the columns.
function frame(piece) {
  const m = piece.matrix.elements, X = [m[0], m[1], m[2]], Y = [m[4], m[5], m[6]], Z = [m[8], m[9], m[10]], c = [m[12], m[13], m[14]];
  const det = X[0] * (Y[1] * Z[2] - Y[2] * Z[1]) - Y[0] * (X[1] * Z[2] - X[2] * Z[1]) + Z[0] * (X[1] * Y[2] - X[2] * Y[1]);
  const inv = Math.abs(det) < 1e-12 ? null : [
    [(Y[1] * Z[2] - Y[2] * Z[1]) / det, (Z[0] * Y[2] - Y[0] * Z[2]) / det, (Y[0] * Z[1] - Z[0] * Y[1]) / det],
    [(Z[1] * X[2] - X[1] * Z[2]) / det, (X[0] * Z[2] - Z[0] * X[2]) / det, (Z[0] * X[1] - X[0] * Z[1]) / det],
    [(X[1] * Y[2] - Y[1] * X[2]) / det, (Y[0] * X[2] - X[0] * Y[2]) / det, (X[0] * Y[1] - Y[0] * X[1]) / det],
  ];
  const half = [0, 1, 2].map(a => (Math.abs(X[a]) + Math.abs(Y[a]) + Math.abs(Z[a])) / 2);
  return {X, Y, Z, c, inv, box: {x0: c[0] - half[0], x1: c[0] + half[0], z0: c[2] - half[2], z1: c[2] + half[2]}};
}
// Where a vertical line at plan point (x, z) crosses the box: [lowest y, highest y], or null.
function crossing(f, x, z) {
  let lo = -Infinity, hi = Infinity;
  for (let i = 0; i < 3; i++) {
    const a = f.inv[i][0] * (x - f.c[0]) + f.inv[i][1] * (-f.c[1]) + f.inv[i][2] * (z - f.c[2]), b = f.inv[i][1];
    if (Math.abs(b) < 1e-9) { if (a < -.5 || a > .5) return null; continue; }
    const y0 = (-.5 - a) / b, y1 = (.5 - a) / b;
    lo = Math.max(lo, Math.min(y0, y1)); hi = Math.min(hi, Math.max(y0, y1));
  }
  return lo <= hi ? [lo, hi] : null;
}

// The shingle boards: shingles laid as flat boxes (a thin box on a plan of at least 30 × 30 cm), not the caps and the eave boards,
// which are beams.
const boards = pieces.filter(piece => piece.kind === 'shingle').map(piece => ({piece, f: frame(piece)}))
  .filter(({f}) => f.inv && Math.hypot(...f.Y) <= .13 && Math.hypot(...f.X) >= .3 && Math.hypot(...f.Z) >= .3);
const CELL = 2, grid = new Map(), cellKey = (i, j) => `${i},${j}`;
for (const board of boards) for (let i = Math.floor(board.f.box.x0 / CELL); i <= Math.floor(board.f.box.x1 / CELL); i++) for (let j = Math.floor(board.f.box.z0 / CELL); j <= Math.floor(board.f.box.z1 / CELL); j++) {
  const key = cellKey(i, j); (grid.get(key) ?? grid.set(key, []).get(key)).push(board);
}
const covering = (x, z) => (grid.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []).map(board => ({board, y: crossing(board.f, x, z)})).filter(hit => hit.y);
// The roof a sample belongs to, when a vertical line through it meets several (the annex roof lies under the skirt roof): the one
// nearest to it in height, and none at all if that is more than a metre away. `bottom` and `top` are the sample's own extent.
function roofOver(s) {
  const gap = hit => Math.max(0, hit.y[0] - s.top, s.bottom - hit.y[1]);
  const near = covering(s.x, s.z).filter(hit => gap(hit) <= 1);
  if (!near.length) return null;
  const best = Math.min(...near.map(gap));
  return near.filter(hit => gap(hit) - best < 1e-6 || hit.y[0] - Math.min(...near.map(h => h.y[0])) < .3);
}

// Samples of a beam (a piece laid by `beam`: its length along the local y axis): along the axis and at the four sides of its section.
function samples(piece) {
  const {X, Y, Z, c} = frame(piece), length = Math.hypot(...Y), out = [], n = Math.max(1, Math.ceil(length / .15));
  const vertical = (Math.abs(X[1]) + Math.abs(Z[1])) / 2;
  for (let i = 0; i <= n; i++) {
    const f = i / n - .5, p = [c[0] + Y[0] * f, c[1] + Y[1] * f, c[2] + Y[2] * f];
    for (const [a, b] of [[0, 0], [.5, 0], [-.5, 0], [0, .5], [0, -.5]]) out.push({x: p[0] + X[0] * a + Z[0] * b, z: p[2] + X[2] * a + Z[2] * b, top: p[1] + vertical, bottom: p[1] - vertical});
  }
  return out;
}
// A piece stands from its birth until the phase after the one that took it down (and a little more: a piece is taken down at a
// random moment of that phase).
const stands = piece => ({from: piece.birth, to: piece.until === undefined ? Infinity : piece.until + DEATH.from + DEATH.span});

const framing = pieces.filter(piece => piece.role === 'frame');

test('the pavilion lays a frame for each roof: the two storey roofs, and the gabled annex', () => {
  assert.ok(framing.length > 300, `${framing.length} frame pieces`);
  assert.ok(boards.length > 4000, `${boards.length} shingle boards`);
  // The annex roof is the low gable at the west of the pavilion: its frame is rafters on the eave beams under the boards.
  const annex = framing.filter(piece => piece.matrix.elements[12] < -7 && piece.matrix.elements[13] < 3.5);
  assert.ok(annex.length >= 40, `${annex.length} frame pieces under the annex roof`);
});

test('no member of a roof frame stands up into the shingles it carries', () => {
  const bad = [];
  let tested = 0;
  for (const piece of framing) for (const s of samples(piece)) {
    const hits = roofOver(s);
    if (!hits) continue;
    tested++;
    const under = Math.min(...hits.map(hit => hit.y[0]));
    if (s.top > under + .02) bad.push({piece, over: s.top - under, x: s.x, z: s.z, y: s.top});
  }
  assert.ok(tested > 5000, `${tested} samples under shingles`);
  bad.sort((a, b) => b.over - a.over);
  const worst = bad.slice(0, 3).map(b => `${(b.over * 100).toFixed(1)} cm at (${b.x.toFixed(2)}, ${b.y.toFixed(2)}, ${b.z.toFixed(2)}), element ${b.piece.element}`).join('; ');
  assert.equal(bad.length, 0, `${bad.length} samples of the frame reach into the shingles over them: ${worst}`);
});

test('the frame is raised before the shingles that lie on it', () => {
  const late = [];
  for (const piece of framing) {
    const life = stands(piece), seen = new Set();
    for (const s of samples(piece)) for (const hit of roofOver(s) ?? []) {
      const roof = hit.board.piece;
      // What is built in the same phase: an older roof still being taken down while its frame is rebuilt is a replacement, not a roof
      // without its frame.
      if (roof.phase !== piece.phase || seen.has(roof)) continue;
      seen.add(roof);
      const other = stands(roof);
      // The shingles were there first, and they were still standing when the frame was put under them.
      if (roof.birth < life.from && life.from < other.to) late.push({piece, roof});
    }
  }
  const sample = late.slice(0, 2).map(({piece, roof}) => `a frame piece of element ${piece.element} at birth ${piece.birth.toFixed(3)} under shingles of element ${roof.element} at ${roof.birth.toFixed(3)}`).join('; ');
  assert.equal(late.length, 0, `${late.length} pairs of frame and shingles where the shingles came first: ${sample}`);
});

test('every shingle board has a timber member within reach under it: a roof is not shingles on posts', () => {
  // The members that carry a board: the frame and the rafters of the eaves (gilded timber), sampled along their axes. A board is
  // carried when one of them passes within 70 cm of its centre in plan, under it by no more than a metre, while both stand.
  const wood = pieces.filter(piece => piece.kind === 'wood').flatMap(piece => samples(piece).filter((_, i) => i % 5 === 0).map(s => ({...s, piece})));
  const cells = new Map();
  for (const w of wood) { const key = cellKey(Math.floor(w.x / CELL), Math.floor(w.z / CELL)); (cells.get(key) ?? cells.set(key, []).get(key)).push(w); }
  const bare = new Map();
  for (const {piece, f} of boards) {
    const x = f.c[0], z = f.c[2], hit = crossing(f, x, z), life = stands(piece);
    if (!hit) continue;
    let carried = false;
    for (let i = -1; i <= 1 && !carried; i++) for (let j = -1; j <= 1 && !carried; j++) {
      for (const w of cells.get(cellKey(Math.floor(x / CELL) + i, Math.floor(z / CELL) + j)) ?? []) {
        if (Math.hypot(w.x - x, w.z - z) > .7 || w.top > hit[0] + .03 || w.top < hit[0] - 1) continue;
        const other = stands(w.piece);
        if (other.from < life.to && life.from < other.to) { carried = true; break; }
      }
    }
    if (!carried) bare.set(piece.element, (bare.get(piece.element) ?? 0) + 1);
  }
  const total = [...bare.values()].reduce((a, b) => a + b, 0);
  assert.equal(total, 0, `${total} shingle boards have nothing under them, by element: ${[...bare].map(([element, n]) => `${element}: ${n}`).join(', ')}`);
});
