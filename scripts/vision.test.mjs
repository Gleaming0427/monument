#!/usr/bin/env node
// Every monument's windows and doors, seen as a picture. scripts/openings.test.mjs holds the numbers to their rules; this holds
// what the viewer draws to them. Each wall that carries openings is photographed head on, from its outward normal and level
// with its middle, and the openings the monument's numbers declare are projected into that picture by the viewer itself.
// Then, for every opening nothing stands in front of:
//   - a window's glass reads dark, in each third of its height (at Chambord the dimmest third of 106 sound windows measures 0.48 to 1.0;
//     a window with a panel laid over its foot or a block in front of it measures 0.0 to 0.27): a window whose pane is covered (a blind arch's panel laid over it, a wall standing behind
//     its hole) shows stone where it should show glass;
//   - it stands where the numbers put it, within 0.3 m, so that windows centred in their bays are centred in the picture too;
//   - a door reads as an opening, dark, in the middle of the wall or of its bay.
// A review picture of every wall is kept in $VISION_DIR when it is set. $VISION_REPORT=1 prints every measure.
// Name monuments to hold only them: node scripts/vision.test.mjs chateau-de-chambord
import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {readdir, readFile, writeFile, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startViewer, openBrowser} from './lib/browser.mjs';
import {expand} from './lib/compact.mjs';
import {decodePng, darkness, wallOpenings, hiddenBy, FRAME} from './lib/vision.mjs';

const root = fileURLToPath(new URL('..', import.meta.url)), only = process.argv.slice(2).filter(arg => !arg.startsWith('-'));
const MIN_GLASS = .4, MIN_DOOR = .6, WITHIN = .3, REPORT = process.env.VISION_REPORT === '1', DIR = process.env.VISION_DIR;
const files = [
  ...(await readdir(join(root, 'examples'))).filter(name => name.endsWith('.json')).map(name => [name.slice(0, -5), join(root, 'examples', name)]),
  ...(await readdir(join(root, 'community'), {withFileTypes: true})).filter(entry => entry.isDirectory()).map(entry => [entry.name, join(root, 'community', entry.name, 'monument.json')]),
];
const monuments = [];
for (const [id, file] of files) {
  const raw = JSON.parse(await readFile(file, 'utf8').catch(() => 'null') ?? 'null');
  if (!raw || (only.length && !only.includes(id))) continue;
  const d = expand(raw, id), ranges = d.elements.map((e, i) => [e, i]).filter(([e]) => e.type === 'lodgingRange' && (e.y0 ?? 0) < 5 && e.sides);
  if (ranges.some(([e]) => wallOpenings(e).length)) monuments.push({id, d, ranges});
}

// The model's frame to the world's: the whole monument is turned by `rotate` degrees about the vertical.
const turn = (d, u, v) => { const t = (d.rotate ?? 0) * Math.PI / 180; return [u * Math.cos(t) + v * Math.sin(t), -u * Math.sin(t) + v * Math.cos(t)]; };
const CORNER = {'v-': ([L, D]) => [[-L / 2, -D / 2], [1, 0]], 'u+': ([L, D]) => [[L / 2, -D / 2], [0, 1]], 'v+': ([L, D]) => [[L / 2, D / 2], [-1, 0]], 'u-': ([L, D]) => [[-L / 2, D / 2], [0, -1]]};

const results = [], SEGMENT = 40;
// The camera is a pinhole on the wall's outward normal, level with its middle and `dist` from the point it looks at, so that a
// point's place in the picture follows from its offset to the camera: sideways and up over the depth, times the focal length.
const pinhole = (az, dist, target, fov) => {
  const a = az * Math.PI / 180, n = [Math.sin(a), -Math.cos(a)], f = [-n[0], -n[1]], right = [-f[1], f[0]], focal = FRAME[1] / 2 / Math.tan(fov * Math.PI / 360);
  const eye = [target[0] + n[0] * dist, target[2] + n[1] * dist];
  return ([x, y, z]) => { const dx = x - eye[0], dz = z - eye[1], depth = dx * f[0] + dz * f[1]; return {x: FRAME[0] / 2 + focal * (dx * right[0] + dz * right[1]) / depth, y: FRAME[1] / 2 - focal * (y - target[1]) / depth}; };
};
if (monuments.length) {
  const viewer = await startViewer(join(root, 'examples'), 4233), browser = await openBrowser({width: FRAME[0], height: FRAME[1]});
  after(async () => { await browser.close(); viewer.stop(); });
  for (const {id, d, ranges} of monuments) {
    await browser.open(`${viewer.base}?t=99&clean#${id}`);
    for (const [e, i] of ranges) for (const wall of wallOpenings(e)) {
      const [start, dir] = CORNER[wall.side]([e.length, e.depth]), [nu, nv] = wall.normal;
      const face = s => [e.center[0] + start[0] + dir[0] * s, e.center[1] + start[1] + dir[1] * s];
      const H = wall.top - wall.y0, level = wall.y0 + H / 2, [nx, nz] = turn(d, nu, nv), az = (Math.atan2(nx, -nz) * 180 / Math.PI + 360) % 360;
      // A long wall is looked at in stretches, so that a window is always a few pixels wide at least.
      const stretches = Math.max(1, Math.ceil(wall.length / SEGMENT)), width = wall.length / stretches;
      for (let k = 0; k < stretches; k++) {
        const centre = (k + .5) * width, mid = face(centre), fov = 18, t = Math.tan(fov * Math.PI / 360), dist = Math.max(width * 1.12 / (2 * 1.6 * t), H * 1.25 / (2 * t)) + 2;
        const [wx, wz] = turn(d, ...mid), camera = [mid[0] + nu * dist, mid[1] + nv * dist], look = pinhole(az, dist, [wx, level, wz], fov);
        await browser.run(`monument.silhouette({t: 99, cam: [${az}, 0, ${dist}, ${wx}, ${level}, ${wz}], fov: ${fov}}), true`);
        await browser.settle(); await browser.sleep(400);
        const shot = await browser.shot('png'), img = decodePng(shot);
        if (DIR) { await mkdir(DIR, {recursive: true}); await writeFile(join(DIR, `${id}-${i}${wall.side}-${k}.png`), shot); }
        const rectOf = (s, y0, y1, w) => {
          const q = [[s - w / 2, y0], [s + w / 2, y0], [s - w / 2, y1], [s + w / 2, y1]].map(([u, y]) => { const [x, z] = turn(d, ...face(u)); return look([x, y, z]); }), xs = q.map(p => p.x), ys = q.map(p => p.y);
          return {x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys)};
        };
        const mine = o => Math.abs(o.s - centre) <= width / 2 - 1.2, hidden = (s, y) => hiddenBy(d.elements, i, camera, face(s), y) !== null;
        for (const o of wall.windows.filter(mine)) {
          const r = rectOf(o.s, o.sill, o.head, o.w), cx = (r.x0 + r.x1) / 2, pxm = (r.x1 - r.x0) / o.w, ix = (r.x1 - r.x0) * .2, iy = (r.y1 - r.y0) * .12;
          // The pane is read in thirds of its height: a panel laid over the foot of a window leaves its head dark and the rest stone.
          const inner = darkness(img, [r.x0 + ix, r.y0 + iy, r.x1 - ix, r.y1 - iy]), around = darkness(img, [r.x0 - .15 * (r.x1 - r.x0), r.y0, r.x1 + .15 * (r.x1 - r.x0), r.y1]);
          const third = (r.y1 - r.y0 - 2 * iy) / 3, thirds = [0, 1, 2].map(n => darkness(img, [r.x0 + ix, r.y0 + iy + n * third, r.x1 - ix, r.y0 + iy + (n + 1) * third]).share);
          results.push({id, wall: `${i}${wall.side}`, kind: 'window', level: o.level, s: o.s, hidden: hidden(o.s, (o.sill + o.head) / 2) || r.x0 < 4 || r.x1 > FRAME[0] - 4 || r.y0 < 4 || r.y1 > FRAME[1] - 4, share: Math.min(...thirds), whole: inner.share, offset: (around.cx - cx) / pxm, px: r.x1 - r.x0});
        }
        for (const o of wall.doors.filter(mine)) {
          const r = rectOf(o.s, o.sill, o.head, o.w), cx = (r.x0 + r.x1) / 2, pxm = (r.x1 - r.x0) / o.w, ix = (r.x1 - r.x0) * .3;
          const inner = darkness(img, [r.x0 + ix, r.y0 + (r.y1 - r.y0) * .25, r.x1 - ix, r.y1 - .3 * pxm]), around = darkness(img, [r.x0, r.y0, r.x1, r.y1]);
          results.push({id, wall: `${i}${wall.side}`, kind: 'door', s: o.s, hidden: hidden(o.s, (o.sill + o.head) / 2), share: inner.share, offset: (around.cx - cx) / pxm, px: r.x1 - r.x0, centred: Math.abs(o.s - wall.length / 2) <= .1 || wall.windows.some(win => Math.abs(win.s - o.s) <= .1)});
        }
      }
    }
  }
}
if (REPORT) for (const r of results) console.log(`${r.id} ${r.wall.padEnd(5)} ${r.kind.padEnd(6)} s=${r.s.toFixed(2).padStart(6)} ${r.hidden ? 'hidden ' : 'visible'} dark ${r.share.toFixed(2)}${r.whole === undefined ? '' : ` (${r.whole.toFixed(2)} whole)`} offset ${Number.isNaN(r.offset) ? '  n/a' : r.offset.toFixed(2).padStart(5)} m  (${r.px.toFixed(0)} px wide)`);

for (const {id} of monuments) {
  const mine = results.filter(r => r.id === id), seen = kind => mine.filter(r => r.kind === kind && !r.hidden && r.px >= 8);
  test(`${id}: the windows' glass reads dark in a frontal view`, () => {
    assert.ok(seen('window').length >= 20, `only ${seen('window').length} windows could be looked at head on`);
    for (const r of seen('window')) assert.ok(r.share >= MIN_GLASS, `${id} wall ${r.wall}: the window at ${r.s.toFixed(2)} (storey ${r.level}) shows dark glass over only ${Math.round(r.share * 100)}% of its dimmest third, under ${MIN_GLASS * 100}%: a panel laid over it, or a wall standing behind its hole`);
  });
  test(`${id}: the windows stand in the picture where the numbers put them`, () => {
    for (const r of seen('window').filter(r => r.share >= MIN_GLASS)) assert.ok(Math.abs(r.offset) <= WITHIN, `${id} wall ${r.wall}: the window at ${r.s.toFixed(2)} (storey ${r.level}) is ${r.offset.toFixed(2)} m from its place in the picture`);
  });
  test(`${id}: a door reads as an opening, in the middle of its bay`, () => {
    for (const r of seen('door')) {
      assert.ok(r.share >= MIN_DOOR, `${id} wall ${r.wall}: the door at ${r.s} is dark over ${Math.round(r.share * 100)}% of its leaf, under ${MIN_DOOR * 100}%`);
      assert.ok(r.centred, `${id} wall ${r.wall}: the door at ${r.s} is neither in the middle of its wall nor on a window axis`);
      assert.ok(Math.abs(r.offset) <= WITHIN, `${id} wall ${r.wall}: the door at ${r.s} is ${r.offset.toFixed(2)} m from its place in the picture`);
    }
  });
}
test('the vision test looked at at least one monument', () => assert.ok(monuments.length > 0, 'no monument with openings was read'));
