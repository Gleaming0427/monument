#!/usr/bin/env node
// Every monument keeps its openings in order: where the model places windows, doors and dormers by rule, the rule has to
// hold, so that nothing stands off the axis of the bays it belongs to. For the bricks that carry their openings as
// numbers (`lodgingRange` and `drumTower`, and the doors of a `doricTemple`'s walls):
//   - a wall's windows stand in regular bays, and their span is centred on the wall;
//   - arches stand on window axes, one arch to a bay;
//   - dormers stand over window axes;
//   - a door stands in the middle of its wall, or on the axis of a bay;
//   - a tower's windows stand only on walls no other building hides;
//   - no dormer stands through a chimney stack.
// A shape that is measured on a photograph, and so is not regular, is not a rule: this test holds only what a monument
// leaves to the rule. Name monuments to hold only them: node scripts/openings.test.mjs chateau-de-chambord
import assert from 'node:assert/strict';
import test from 'node:test';
import {readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {expand} from './lib/compact.mjs';

const root = fileURLToPath(new URL('..', import.meta.url)), only = process.argv.slice(2).filter(arg => !arg.startsWith('-'));
const TOL = .1, rad = a => a * Math.PI / 180;
const files = [
  ...(await readdir(join(root, 'examples'))).filter(name => name.endsWith('.json')).map(name => [name.slice(0, -5), join(root, 'examples', name)]),
  ...(await readdir(join(root, 'community'), {withFileTypes: true})).filter(entry => entry.isDirectory()).map(entry => [entry.name, join(root, 'community', entry.name, 'monument.json')]),
];
const monuments = [];
for (const [id, file] of files) {
  const raw = JSON.parse(await readFile(file, 'utf8').catch(() => 'null') ?? 'null');
  if (!raw || (only.length && !only.includes(id))) continue;
  monuments.push({id, elements: expand(raw, id).elements ?? []});
}

const sideLength = (e, side) => side[0] === 'u' ? e.depth : e.length;
const hasWindows = spec => spec && spec.windows?.[0] !== false && spec !== false;
// The window axes of a side, along it from its start, as the brick lays them (renaissance.js: `bays` between `from` and `to`).
const axes = (e, side) => {
  const spec = e.sides?.[side], L = sideLength(e, side), from = spec?.from ?? 0, to = spec?.to ?? L, n = spec?.bays ?? Math.max(1, Math.round((to - from) / 5));
  return Array.from({length: n}, (_, j) => from + (j + .5) * (to - from) / n);
};
// Where a side's dormers stand along it: `at`, or `count` spread evenly over the whole side.
const dormersOn = (e, d) => d.at ?? Array.from({length: d.count}, (_, i) => (i + .5) * sideLength(e, d.side) / d.count);
// The ground the dormer's body covers, in the monument's frame: from just in front of the wall to where its cheeks meet the roof.
const dormerBox = (e, d, s) => {
  const [cx, cz] = e.center, L = e.length, D = e.depth, w = d.w ?? 2.4, run = Math.max(1.4, (d.h ?? 3.4) / ((e.roof.rise ?? 9) / ((e.roof.axis === 'v' ? L : D) / 2)) + .6);
  const [u, v, ou, ov] = d.side === 'v-' ? [cx - L / 2 + s, cz - D / 2, 0, -1] : d.side === 'u+' ? [cx + L / 2, cz - D / 2 + s, 1, 0] : d.side === 'v+' ? [cx + L / 2 - s, cz + D / 2, 0, 1] : [cx - L / 2, cz + D / 2 - s, -1, 0];
  return ou ? [Math.min(u + ou * .3, u - ou * run), Math.max(u + ou * .3, u - ou * run), v - w / 2, v + w / 2] : [u - w / 2, u + w / 2, Math.min(v + ov * .3, v - ov * run), Math.max(v + ov * .3, v - ov * run)];
};
const stacks = elements => elements.flatMap(e => e.type === 'drumTower' && e.top?.chimneys ? e.top.chimneys.map(c => ({x: e.center[0] + (c.r ?? 6.5) * Math.cos(rad(c.a)), z: e.center[1] + (c.r ?? 6.5) * Math.sin(rad(c.a)), w: c.w ?? 1.5, d: c.d ?? 1.1}))
  : e.type === 'lodgingRange' && e.roof?.chimneys ? e.roof.chimneys.map(c => ({x: e.center[0] + c.at[0], z: e.center[1] + c.at[1], w: c.w ?? 1.6, d: c.d ?? 1.1})) : []);
// Is the wall of tower `i` at `angle` (degrees) covered by another building? Only what stands as high as the tower hides it.
const hidden = (elements, i, angle) => {
  const t = elements[i], x = t.center[0] + (t.radius + .6) * Math.cos(rad(angle)), z = t.center[1] + (t.radius + .6) * Math.sin(rad(angle)), top = (t.y0 ?? 0) + (t.height ?? 0);
  return elements.some((o, j) => j !== i && ((o.type === 'lodgingRange' && (o.y0 ?? 0) < top - 1 && Math.abs(x - o.center[0]) < o.length / 2 && Math.abs(z - o.center[1]) < o.depth / 2)
    || (o.type === 'drumTower' && Math.hypot(x - o.center[0], z - o.center[1]) < o.radius)));
};

for (const {id, elements} of monuments) {
  const ranges = elements.map((e, i) => [e, i]).filter(([e]) => e.type === 'lodgingRange'), towers = elements.map((e, i) => [e, i]).filter(([e]) => e.type === 'drumTower');
  const temples = elements.map((e, i) => [e, i]).filter(([e]) => e.type === 'doricTemple' && e.walls);
  if (!ranges.length && !towers.length && !temples.length) continue;

  test(`${id}: a wall's windows stand in regular bays centred on it`, () => {
    for (const [e, i] of ranges) for (const [side, spec] of Object.entries(e.sides ?? {})) {
      if (!hasWindows(spec)) continue;
      const L = sideLength(e, side), from = spec.from ?? 0, to = spec.to ?? L;
      assert.ok(Math.abs(from - (L - to)) <= TOL, `element ${i}, side ${side}: its windows span ${from}..${to} on a ${L} m wall, ${from.toFixed(2)} m from one end and ${(L - to).toFixed(2)} m from the other: centre them`);
    }
  });

  test(`${id}: arches stand on window axes, one to a bay`, () => {
    for (const [e, i] of ranges) for (const [side, spec] of Object.entries(e.sides ?? {})) {
      if (!spec?.arches?.length || !hasWindows(spec)) continue;
      const ax = axes(e, side);
      assert.equal(spec.arches.length, ax.length, `element ${i}, side ${side}: ${spec.arches.length} arches against ${ax.length} bays of windows`);
      for (const a of spec.arches) assert.ok(ax.some(x => Math.abs(x - a.s) <= TOL), `element ${i}, side ${side}: the arch at ${a.s} is on no window axis (${ax.map(x => x.toFixed(2)).join(', ')})`);
    }
  });

  test(`${id}: dormers stand over window axes`, () => {
    for (const [e, i] of ranges) for (const d of e.roof?.dormers ?? []) {
      if (!hasWindows(e.sides?.[d.side])) continue;
      const ax = axes(e, d.side);
      for (const s of dormersOn(e, d)) assert.ok(ax.some(x => Math.abs(x - s) <= TOL), `element ${i}, roof dormer on ${d.side} at ${s.toFixed(2)} is on no window axis (${ax.map(x => x.toFixed(2)).join(', ')})`);
    }
    for (const [e, i] of towers) {
      const d = e.top?.dormers; if (!d?.angles) continue;
      const wins = new Set((e.windows ?? []).flatMap(g => g.angles ?? []).map(a => ((a % 360) + 360) % 360));
      for (const a of d.angles) assert.ok([...wins].some(w => Math.abs(((a - w + 540) % 360) - 180) <= .6), `tower ${i}: the dormer at ${a} degrees is over no window`);
    }
  });

  test(`${id}: a door stands in the middle of its wall or on a window axis`, () => {
    for (const [e, i] of ranges) for (const [side, spec] of Object.entries(e.sides ?? {})) for (const o of spec?.openings ?? []) {
      const L = sideLength(e, side), at = [L / 2, ...(hasWindows(spec) ? axes(e, side) : [])];
      assert.ok(at.some(x => Math.abs(x - o.s) <= TOL), `element ${i}, side ${side}: the opening at ${o.s} is neither in the middle of the ${L} m wall nor on a window axis`);
    }
    for (const [e, i] of temples) for (const [j, w] of e.walls.entries()) {
      if (!w.door || w.door.at === undefined) continue;
      const len = Math.hypot(w.to[0] - w.from[0], w.to[1] - w.from[1]);
      assert.ok(Math.abs(w.door.at - len / 2) <= TOL, `element ${i}, wall ${j}: the door is ${w.door.at} m along a ${len.toFixed(2)} m wall, not in its middle`);
    }
  });

  test(`${id}: a tower's windows stand only on walls no other building hides`, () => {
    for (const [e, i] of towers) for (const g of e.windows ?? []) for (const a of g.angles ?? []) assert.ok(!hidden(elements, i, a), `tower ${i}: a window at ${a} degrees stands on a wall another building hides`);
  });

  test(`${id}: no dormer stands through a chimney stack`, () => {
    const all = stacks(elements);
    for (const [e, i] of ranges) for (const d of e.roof?.dormers ?? []) for (const s of dormersOn(e, d)) {
      const [u0, u1, v0, v1] = dormerBox(e, d, s);
      for (const st of all) assert.ok(!(u0 < st.x + st.w / 2 && st.x - st.w / 2 < u1 && v0 < st.z + st.d / 2 && st.z - st.d / 2 < v1), `element ${i}: the roof dormer on ${d.side} at ${s.toFixed(2)} stands through the stack at (${st.x.toFixed(1)}, ${st.z.toFixed(1)})`);
    }
    for (const [e, i] of towers) {
      const d = e.top?.dormers; if (!d) continue;
      const angles = d.angles ?? Array.from({length: d.count}, (_, k) => d.arc[0] + (k + .5) * (d.arc[1] - d.arc[0]) / d.count);
      for (const a of angles) {
        const x = e.center[0] + (d.r ?? 7.4) * Math.cos(rad(a)), z = e.center[1] + (d.r ?? 7.4) * Math.sin(rad(a));
        for (const st of all) assert.ok(Math.hypot(x - st.x, z - st.z) >= (d.w ?? 2.4) / 2 + Math.hypot(st.w, st.d) / 2, `tower ${i}: the dormer at ${a} degrees stands through the stack at (${st.x.toFixed(1)}, ${st.z.toFixed(1)})`);
      }
    }
  });
}
test('the openings test holds at least one monument', () => assert.ok(monuments.length > 0, 'no monument was read'));
