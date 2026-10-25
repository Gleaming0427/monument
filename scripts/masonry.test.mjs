#!/usr/bin/env node
// Masonry as real surfaces (kit/masonry.js). A wall of patches must be the wall it says it is: its skin cut by the true
// outline of its openings (no step, no gap), its faces turned the way their normals say, every patch held in the box
// that is its matrix, and the whole laid course by course from the bottom up. And in a real browser the same wall
// stands, grows, shows its opening as glass and not as stone.
import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadEngine} from './lib/engine.mjs';
import {startViewer, openBrowser} from './lib/browser.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const engine = await loadEngine();

// A wall 12 m long and 8 high, 1.2 thick, facing +v, with a pointed opening 3 m wide, its sill at 2 m, its springing at 5 m.
const OPENING = {kind: 'pointed', w: 3, sill: 2, spring: 5, rise: 2.6, s: 6, glass: false, margin: 0}, WALL = {len: 12, height: 8, thick: 1.2};
engine.generators.meshWall = (k, e, P) => {
  const G = engine.gothic(k, e, P);
  G.wall([0, 0], [WALL.len, 0], 0, WALL.height, WALL.thick, [0, 1], [{...OPENING}], G.phase);
};
const build = () => engine.buildPieces({phases: [{id: 'a'}], masonry: 'mesh', elements: [{type: 'meshWall', phase: 'a', color: '#cfc6b1'}]});

// Triangles of every patch in the scene's frame.
function triangles(pieces) {
  const out = [];
  for (const piece of pieces) {
    if (!piece.mesh) continue;
    const {position, normal, index} = piece.mesh, e = piece.matrix.elements, size = [Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10])];
    const at = i => [e[0] * position[i * 3] + e[4] * position[i * 3 + 1] + e[8] * position[i * 3 + 2] + e[12], e[1] * position[i * 3] + e[5] * position[i * 3 + 1] + e[9] * position[i * 3 + 2] + e[13], e[2] * position[i * 3] + e[6] * position[i * 3 + 1] + e[10] * position[i * 3 + 2] + e[14]];
    // The normals are held bent by the box's scale: bend them back (a patch is not rotated at this stage).
    const into = i => { const n = [normal[i * 3] / size[0], normal[i * 3 + 1] / size[1], normal[i * 3 + 2] / size[2]], l = Math.hypot(...n); return n.map(v => v / l); };
    for (let i = 0; i < index.length; i += 3) out.push({piece, p: [at(index[i]), at(index[i + 1]), at(index[i + 2])], n: into(index[i])});
  }
  return out;
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const area = t => Math.hypot(...cross(sub(t.p[1], t.p[0]), sub(t.p[2], t.p[0]))) / 2;

test('arches are sampled to a few millimetres of their true outline', () => {
  const o = {kind: 'pointed', s: 6, w: 3, spring: 5, rise: 2.6, sill: 2}, R = engine.archRadius(o.w, o.rise), c = R - o.w / 2;
  const path = engine.outline(o, {tol: .005});
  // Each chord of the left arc lies within 5 mm of the circle, centred on the springing line at s + c.
  let worst = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const [a, b] = [path[i], path[i + 1]];
    if (a[1] <= o.spring || b[1] <= o.spring || a[0] > o.s || b[0] > o.s) continue;
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    worst = Math.max(worst, Math.abs(Math.hypot(mid[0] - (o.s + c), mid[1] - o.spring) - R));
  }
  assert.ok(worst < .0051, `chord error ${worst}`);
  const apex = path.reduce((best, p) => p[1] > best[1] ? p : best);
  assert.ok(Math.abs(apex[0] - o.s) < 1e-9 && Math.abs(apex[1] - (o.spring + o.rise)) < 1e-6, `apex ${apex}`);
  assert.ok(path.length > 12, 'the arch is more than a few chords');
});

test('a wall of patches is the wall: cut by the opening\'s own outline, faces turned the right way, laid from the bottom up', () => {
  const {pieces} = build(), tris = triangles(pieces);
  assert.ok(pieces.length > 20 && pieces.every(p => p.mesh && !p.shape), `${pieces.length} pieces, all patches`);
  // Every vertex lies inside the box the matrix says, and the box's top is the piece's top.
  for (const p of pieces) {
    const e = p.matrix.elements, half = [Math.hypot(e[0], e[1], e[2]) / 2, Math.hypot(e[4], e[5], e[6]) / 2, Math.hypot(e[8], e[9], e[10]) / 2];
    assert.ok(p.mesh.position.every(v => Math.abs(v) <= .5 + 1e-5), 'a vertex is outside its patch\'s unit cube');
    assert.ok(p.top <= e[13] + half[1] + 1e-4 && p.top > e[13] + half[1] - .0201, `top ${p.top} against its box`);
    assert.ok([...p.mesh.position, ...p.mesh.normal].every(Number.isFinite));
  }
  // The outer skin (the faces looking out, in the plane of the wall's face): its area is the wall's, less the opening's.
  const face = tris.filter(t => t.n[2] > .99 && t.p.every(v => Math.abs(v[2] - WALL.thick / 2) < 1e-6));
  const skin = face.reduce((s, t) => s + area(t), 0);
  // The opening's area by its own formula: straight sides up to the springing, then two arcs up to the apex.
  const R = engine.archRadius(OPENING.w, OPENING.rise), c = R - OPENING.w / 2, steps = 200;
  let opening = (OPENING.spring - OPENING.sill) * OPENING.w;
  for (let i = 0; i < steps; i++) { const y = OPENING.spring + OPENING.rise * (i + .5) / steps, hw = Math.sqrt(R * R - (y - OPENING.spring) ** 2) - c; opening += 2 * hw * OPENING.rise / steps; }
  const expected = WALL.len * WALL.height - opening;
  assert.ok(Math.abs(skin - expected) / expected < .004, `the skin is ${skin.toFixed(3)} m², the wall less its opening ${expected.toFixed(3)} m²`);
  // No piece of the skin stands in the opening, and the skin comes right up to its edge.
  for (const t of face) {
    const x = (t.p[0][0] + t.p[1][0] + t.p[2][0]) / 3, y = (t.p[0][1] + t.p[1][1] + t.p[2][1]) / 3;
    const inside = y > OPENING.sill && y < OPENING.spring + OPENING.rise && Math.abs(x - OPENING.s) < (y <= OPENING.spring ? OPENING.w / 2 : Math.sqrt(R * R - (y - OPENING.spring) ** 2) - c) - 1e-3;
    assert.ok(!inside, `a triangle of the skin lies in the opening at (${x.toFixed(2)}, ${y.toFixed(2)})`);
  }
  // The back of the wall faces the other way; the sides of the opening face into it.
  assert.ok(tris.some(t => t.n[2] < -.99), 'the inner face');
  const reveals = tris.filter(t => Math.abs(t.n[2]) < .2 && Math.abs(t.n[1]) < .99 && t.p.every(v => v[0] > OPENING.s - OPENING.w / 2 - 1e-3 && v[0] < OPENING.s + OPENING.w / 2 + 1e-3 && v[1] > OPENING.sill - 1e-6 && Math.abs(v[2]) <= WALL.thick / 2 + 1e-6));
  assert.ok(reveals.length > 20, `${reveals.length} triangles in the opening's reveals`);
  for (const t of reveals) {
    const centre = [(t.p[0][0] + t.p[1][0] + t.p[2][0]) / 3 - OPENING.s, (t.p[0][1] + t.p[1][1] + t.p[2][1]) / 3];
    assert.ok(t.n[0] * -Math.sign(centre[0]) >= -1e-6 || Math.abs(centre[0]) < .05, `a reveal at x ${centre[0].toFixed(2)} faces ${t.n.map(v => v.toFixed(2))}, away from the opening`);
  }
  // The geometric winding agrees with the normals everywhere.
  const bad = tris.filter(t => { const g = cross(sub(t.p[1], t.p[0]), sub(t.p[2], t.p[0])); return g[0] * t.n[0] + g[1] * t.n[1] + g[2] * t.n[2] < 0; });
  assert.equal(bad.length, 0, `${bad.length} triangles are wound against their normals`);
  // Laid from the bottom up: the order is the height.
  engine.layPieces(pieces, 1);
  const sorted = [...pieces].sort((a, b) => a.birth - b.birth);
  assert.ok(sorted.every((p, i) => i === 0 || p.order >= sorted[i - 1].order - 1e-9), 'births follow heights');
  assert.ok(sorted[0].top < 3 && sorted.at(-1).top > WALL.height - .01, 'it begins at the foot and ends at the top');
});

test('a moulding is a section run along a path: its depth, its width, and mitred corners', () => {
  const emit = [], layers = new engine.Layers(null, 100);
  // A path that goes along 4 m, then turns up 3 m (clockwise seen from outside, so "outwards" is to its left), a fillet 0.2 wide
  // and 0.1 proud of the face, in the plane z = 0 of the frame (s, y, off).
  engine.sweep(layers, engine.frameOf((s, y, off) => [s, y, off]), [[0, 0], [4, 0], [4, 3]], engine.moulding.fillet(.2, .1), {base: 0, caps: true});
  layers.flush(soup => emit.push(soup));
  assert.equal(emit.length, 1);
  const P = emit[0].pos, xs = [], ys = [], zs = [];
  for (let i = 0; i < P.length; i += 3) { xs.push(P[i]); ys.push(P[i + 1]); zs.push(P[i + 2]); }
  assert.ok(Math.max(...zs) <= .1 + 1e-9 && Math.min(...zs) >= -1e-9, 'the section stands .1 out of the face');
  // Travelling along +s, "outwards" (to the left) is +y; turning up, it is -x. At the corner the two offsets meet in a mitre:
  // the outer edge of the section is at y = .2 along the first leg, at x = 3.8 along the second, and they meet at (3.8, .2).
  assert.ok(xs.some((x, i) => Math.abs(x - 3.8) < 1e-9 && Math.abs(ys[i] - .2) < 1e-9), 'the corner is mitred');
  assert.ok(Math.max(...ys) > 3 - 1e-6, 'the path is followed to its end');
});

test('in a browser a mesh wall stands, is stone where it is wall and glass where it is not, and is not there before its phase', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'monument-masonry-')), id = 'mesh-wall';
  try {
    const data = JSON.parse(await readFile(resolve(root, 'examples', 'leaning-tower-of-pisa.json'), 'utf8'));
    const wall = {...OPENING, glass: true, w: 3};
    await writeFile(join(dir, `${id}.bricks.js`), `import {gothic} from '../kit/builder.js';\nexport default {meshWall(k, e, P) { const G = gothic(k, e, P); G.wall([0, 0], [12, 0], 0, 8, 1.2, [0, 1], [${JSON.stringify(wall)}], G.phase); }};\n`);
    const phases = data.phases.slice(0, 2), elements = [{type: 'meshWall', name: 'A wall', provenance: 'measured', phase: phases[0].id, color: '#cfc6b1', glass: '#1d2733'}];
    await writeFile(join(dir, `${id}.json`), JSON.stringify({...data, id, masonry: 'mesh', bricks: `${id}.bricks.js`, phases, elements, rotate: 0, scan: undefined, view: {...data.view, target: [6, 4, 0], radius: 12, distance: 30, width: 16, direction: [0, .1, 1]}}));
    const viewer = await startViewer(dir, 4199), browser = await openBrowser({width: 800, height: 560});
    try {
      await browser.open(`${viewer.base}?t=1.5&cam=180,2,26,6,4,0&clean#${id}`);
      await browser.settle(); await browser.settle();
      const colour = async (point, size = 6) => {
        const at = await browser.run(`monument.project(${JSON.stringify(point)})`), png = (await browser.shot('png')).toString('base64');
        return browser.run(`(async () => {
          const image = new Image(); image.src = 'data:image/png;base64,${png}'; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
          const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
          const {x, y} = ${JSON.stringify(at)}, data = context.getImageData(Math.round(x) - ${size}, Math.round(y) - ${size}, ${size * 2}, ${size * 2}).data;
          let r = 0, g = 0, b = 0, n = 0; for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
          return [r / n, g / n, b / n];
        })()`);
      };
      const luminance = ([r, g, b]) => (.2126 * r + .7152 * g + .0722 * b) / 255;
      const stone = luminance(await colour([1.6, 4, .6])), glass = luminance(await colour([6, 3.4, .6]));
      assert.ok(stone > .4, `the wall is stone-coloured where it stands (${stone.toFixed(2)})`);
      assert.ok(glass < stone - .15, `the opening shows glass, darker than the wall (${glass.toFixed(2)} against ${stone.toFixed(2)})`);
      await browser.run('monument.seek(.05)'); await browser.settle(); await browser.settle();
      const before = luminance(await colour([1.6, 4, .6]));
      assert.ok(before > .85 || before < stone - .15 || Math.abs(before - stone) > .1, `before its phase the wall is not there (${before.toFixed(2)})`);
      console.log(`mesh wall in a browser: stone ${stone.toFixed(2)}, glass ${glass.toFixed(2)}, before its phase ${before.toFixed(2)}`);
    } finally { await browser.close(); viewer.stop(); }
  } finally { await rm(dir, {recursive: true, force: true}); }
});
