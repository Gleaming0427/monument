#!/usr/bin/env node
// Every monument's windows and doors, seen as a picture. scripts/openings.test.mjs holds the numbers to their rules; this holds
// what the viewer draws to them. Each wall that carries openings is photographed head on, from its outward normal and level
// with its middle, and the openings the monument's numbers declare are projected into that picture by the viewer itself.
// Then, for every opening nothing stands in front of:
//   - a window's glass reads dark: a window whose pane is covered (a blind arch's panel laid over it, a wall standing behind
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
const MIN_GLASS = .5, MIN_DOOR = .6, WITHIN = .3, REPORT = process.env.VISION_REPORT === '1', DIR = process.env.VISION_DIR;
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

const results = [];
if (monuments.length) {
  const viewer = await startViewer(join(root, 'examples'), 4233), browser = await openBrowser({width: FRAME[0], height: FRAME[1]});
  after(async () => { await browser.close(); viewer.stop(); });
  for (const {id, d, ranges} of monuments) {
    await browser.open(`${viewer.base}?t=99&clean#${id}`);
    for (const [e, i] of ranges) for (const wall of wallOpenings(e)) {
      const [start, dir] = CORNER[wall.side]([e.length, e.depth]), [nu, nv] = wall.normal;
      const face = s => [e.center[0] + start[0] + dir[0] * s, e.center[1] + start[1] + dir[1] * s];
      const mid = face(wall.length / 2), H = wall.top - wall.y0, W = wall.length;
      const fov = 18, t = Math.tan(fov * Math.PI / 360), dist = Math.max(W * 1.12 / (2 * 1.6 * t), H * 1.25 / (2 * t)) + 2;
      const [wx, wz] = turn(d, ...mid), [nx, nz] = turn(d, nu, nv), az = (Math.atan2(nx, -nz) * 180 / Math.PI + 360) % 360, level = wall.y0 + H / 2;
      const camera = [mid[0] + nu * dist, mid[1] + nv * dist];
      await browser.run(`monument.silhouette({t: 99, cam: [${az}, 0, ${dist}, ${wx}, ${level}, ${wz}], fov: ${fov}}), true`);
      await browser.settle();
      const shot = await browser.shot('png'), img = decodePng(shot);
      if (DIR) { await mkdir(DIR, {recursive: true}); await writeFile(join(DIR, `${id}-${i}${wall.side}.png`), shot); }
      // Project the corners of each opening into the picture, and measure what the picture shows there.
      const rectOf = async (s, y0, y1, w) => {
        const [x0, z0] = turn(d, ...face(s - w / 2)), [x1, z1] = turn(d, ...face(s + w / 2));
        const q = await browser.run(`JSON.stringify([[${x0}, ${y0}, ${z0}], [${x1}, ${y0}, ${z1}], [${x0}, ${y1}, ${z0}], [${x1}, ${y1}, ${z1}]].map(p => monument.project(p)))`).then(JSON.parse);
        const xs = q.map(p => p.x), ys = q.map(p => p.y);
        return {x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), shown: q.every(p => p.visible !== false)};
      };
      const hidden = (s, y) => hiddenBy(d.elements, i, camera, face(s), y);
      for (const o of wall.windows) {
        const r = await rectOf(o.s, o.sill, o.head, o.w), cx = (r.x0 + r.x1) / 2, pxm = (r.x1 - r.x0) / o.w, ix = (r.x1 - r.x0) * .2, iy = (r.y1 - r.y0) * .12;
        const inner = darkness(img, [r.x0 + ix, r.y0 + iy, r.x1 - ix, r.y1 - iy]), around = darkness(img, [r.x0 - .6 * pxm, r.y0, r.x1 + .6 * pxm, r.y1]);
        results.push({id, wall: `${i}${wall.side}`, kind: 'window', level: o.level, s: o.s, hidden: hidden(o.s, (o.sill + o.head) / 2) !== null || !r.shown || r.x0 < 4 || r.x1 > FRAME[0] - 4, share: inner.share, offset: (around.cx - cx) / pxm, px: r.x1 - r.x0});
      }
      for (const o of wall.doors) {
        const r = await rectOf(o.s, o.sill, o.head, o.w), cx = (r.x0 + r.x1) / 2, pxm = (r.x1 - r.x0) / o.w, ix = (r.x1 - r.x0) * .3;
        const inner = darkness(img, [r.x0 + ix, r.y0 + (r.y1 - r.y0) * .25, r.x1 - ix, r.y1 - .3 * pxm]), around = darkness(img, [r.x0, r.y0, r.x1, r.y1]);
        results.push({id, wall: `${i}${wall.side}`, kind: 'door', s: o.s, hidden: hidden(o.s, (o.sill + o.head) / 2) !== null || !r.shown, share: inner.share, offset: (around.cx - cx) / pxm, px: r.x1 - r.x0, centred: Math.abs(o.s - wall.length / 2) <= .1 || wall.windows.some(win => Math.abs(win.s - o.s) <= .1)});
      }
    }
  }
}
if (REPORT) for (const r of results) console.log(`${r.id} ${r.wall.padEnd(5)} ${r.kind.padEnd(6)} s=${r.s.toFixed(2).padStart(6)} ${r.hidden ? 'hidden ' : 'visible'} dark ${r.share.toFixed(2)} offset ${Number.isNaN(r.offset) ? '  n/a' : r.offset.toFixed(2).padStart(5)} m  (${r.px.toFixed(0)} px wide)`);

for (const {id} of monuments) {
  const mine = results.filter(r => r.id === id), seen = kind => mine.filter(r => r.kind === kind && !r.hidden && r.px >= 8);
  test(`${id}: the windows' glass reads dark in a frontal view`, () => {
    assert.ok(seen('window').length >= 20, `only ${seen('window').length} windows could be looked at head on`);
    for (const r of seen('window')) assert.ok(r.share >= MIN_GLASS, `${id} wall ${r.wall}: the window at ${r.s.toFixed(2)} (storey ${r.level}) shows dark glass over ${Math.round(r.share * 100)}% of its pane, under ${MIN_GLASS * 100}%: a panel laid over it, or a wall standing behind its hole`);
  });
  test(`${id}: the windows stand in the picture where the numbers put them`, () => {
    for (const r of seen('window')) assert.ok(Math.abs(r.offset) <= WITHIN, `${id} wall ${r.wall}: the window at ${r.s.toFixed(2)} (storey ${r.level}) is ${r.offset.toFixed(2)} m from its place in the picture`);
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
