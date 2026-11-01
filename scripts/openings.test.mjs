#!/usr/bin/env node
// Every monument keeps its openings in order: where the model places windows, doors and dormers by rule, the rule has to
// hold, so that nothing stands off the axis of the bays it belongs to. For the bricks that carry their openings as
// numbers (`lodgingRange` and `drumTower`, and the doors of a `doricTemple`'s walls):
//   - a wall's windows stand in regular bays, and their span is centred on the wall;
//   - a window's glass ends under the string course or the cornice above it, on a range or a tower;
//   - no window or dormer of a range stands where another building stands (its walls, its roof, a tower and its cone);
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

// Does another building stand at [x, y, z] (the monument's frame): a range's walls (or its terrace's balustrade, or under
// the slopes of its roof), a tower's drum and cornice, or under its roof's profile? A roof gone by the end (`until`) is
// not counted.
const topOf = e => (e.y0 ?? 0) + (e.levels ?? [6.5, 6.5, 6]).reduce((a, b) => a + b, 0);
const along = (profile, dy) => { for (let i = 1; i < profile.length; i++) if (dy <= profile[i][1]) { const [r0, y0] = profile[i - 1], [r1, y1] = profile[i]; return r0 + (r1 - r0) * (dy - y0) / (y1 - y0); } return -1; };
const standsAt = (o, [x, y, z]) => {
  if (y < (o.y0 ?? 0)) return false;
  if (o.type === 'drumTower') {
    const r = Math.hypot(x - o.center[0], z - o.center[1]), top = (o.y0 ?? 0) + (o.height ?? 0);
    if (y <= top) return r < o.radius + (y > top - (o.cornice?.height ?? 0) ? o.cornice?.out ?? 0 : 0);
    return Boolean(o.roof?.profile) && r < along(o.roof.profile, y - top);
  }
  if (o.type !== 'lodgingRange') return false;
  const u = Math.abs(x - o.center[0]), v = Math.abs(z - o.center[1]), L = o.length, D = o.depth, top = topOf(o);
  if (y <= top) return u < L / 2 && v < D / 2;
  return (o.roofs ?? (o.roof ? [o.roof] : [])).some(r => {
    if (r.until) return false;
    if (r.kind === 'terrace') return y <= top + 1.1 && u < L / 2 && v < D / 2;
    const f = (y - top) / (r.rise ?? 9), over = r.overhang ?? .45, hu = L / 2 + over, hv = D / 2 + over, axis = r.axis ?? (L >= D ? 'u' : 'v');
    if (f > 1) return false;
    if (r.kind === 'hip') return u < hu * (1 - f) + (axis === 'u' ? Math.max(0, (L - D) / 2) * f : 0) && v < hv * (1 - f) + (axis === 'v' ? Math.max(0, (D - L) / 2) * f : 0);
    return axis === 'u' ? u < hu && v < hv * (1 - f) : v < hv && u < hu * (1 - f);
  });
};
// A point `s` metres along a side of a range, `ahead` metres out of its face, in the monument's frame.
const SIDES = {'v-': [[-1, -1], [1, -1], [0, -1]], 'u+': [[1, -1], [1, 1], [1, 0]], 'v+': [[1, 1], [-1, 1], [0, 1]], 'u-': [[-1, 1], [-1, -1], [-1, 0]]};
const onSide = (e, side, s, ahead) => {
  const [a, b, out] = SIDES[side], ax = e.center[0] + a[0] * e.length / 2, az = e.center[1] + a[1] * e.depth / 2, bx = e.center[0] + b[0] * e.length / 2, bz = e.center[1] + b[1] * e.depth / 2, len = Math.hypot(bx - ax, bz - az);
  return [ax + (bx - ax) / len * s + out[0] * ahead, az + (bz - az) / len * s + out[1] * ahead];
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

  // renaissance.js lays a string course 0.5 m high at every floor, and the cornice `corniceHeight` (1.3 m) under the top of
  // the wall: a window's glass ends under them, or the stone runs across its head.
  test(`${id}: a window's glass ends under the string course or the cornice above it`, () => {
    for (const [e, i] of ranges) {
      const levels = e.levels ?? [6.5, 6.5, 6], y0 = e.y0 ?? 0, floors = levels.reduce((acc, h) => (acc.push((acc.at(-1) ?? y0) + h), acc), []);
      for (const [side, spec] of Object.entries(e.sides ?? {})) {
        if (spec === false) continue;
        const grid = spec?.windows ?? e.windows ?? [{head: 4.7}, {head: 4.7}, {head: 4.3}];
        levels.forEach((h, level) => {
          const g = grid[Math.min(level, grid.length - 1)];
          if (!g) return;
          const head = (level ? floors[level - 1] : y0) + g.head, last = level === levels.length - 1, stone = last ? floors[level] - (e.corniceHeight ?? 1.3) : floors[level];
          assert.ok(head <= stone + TOL, `element ${i}, side ${side}, storey ${level}: its windows' glass rises to ${head.toFixed(2)} m, into the ${last ? 'cornice' : 'string course'} from ${stone.toFixed(2)} m`);
        });
      }
    }
  });

  // A tower's windows end under its cornice, and no string course runs across them (renaissance.js turns a course from
  // 0.12 m under its height to 0.16 m above it, and the cornice from `cornice.height` under the head of the drum).
  test(`${id}: a tower's window glass ends under its cornice, and no string course crosses it`, () => {
    for (const [e, i] of towers) for (const level of e.windows ?? []) {
      const top = (e.y0 ?? 0) + (e.height ?? 0), cornice = e.cornice ? top - (e.cornice.height ?? 1.6) : top;
      assert.ok(level.head <= cornice + TOL, `element ${i}: its windows' glass rises to ${level.head} m, into the cornice from ${cornice.toFixed(2)} m`);
      for (const c of e.courses ?? []) assert.ok(level.head <= c - .12 + TOL || level.sill >= c + .16 - TOL, `element ${i}: the string course at ${c} m runs across its windows (${level.sill} to ${level.head} m)`);
    }
  });

  // A window that another building stands in front of, or a dormer in another building's roof, opens onto a wall: the
  // bay is skipped (`skip`), the dormer left out. Its foot, middle and head, at its middle and 15 cm inside either edge,
  // are held 0.6 m out of its wall.
  test(`${id}: no window or dormer of a range stands where another building stands`, () => {
    for (const [e, i] of ranges) {
      const levels = e.levels ?? [6.5, 6.5, 6], y0 = e.y0 ?? 0, floors = levels.reduce((acc, h) => (acc.push((acc.at(-1) ?? y0) + h), acc), []);
      const blocked = (side, s, w, ys) => elements.findIndex((o, j) => j !== i && [s - w / 2 + .15, s, s + w / 2 - .15].some(at => ys.some(y => { const [x, z] = onSide(e, side, at, .6); return standsAt(o, [x, y, z]); })));
      for (const [side, spec] of Object.entries(e.sides ?? {})) {
        if (spec === false) continue;
        const grid = spec?.windows ?? e.windows ?? [{sill: 1.5, head: 4.7}, {sill: 1.5, head: 4.7}, {sill: 1.5, head: 4.3}];
        levels.forEach((h, level) => {
          const g = grid[Math.min(level, grid.length - 1)], base = level ? floors[level - 1] : y0;
          if (!g) return;
          axes(e, side).forEach((s, bay) => {
            if ((spec?.skip ?? []).some(([l, b]) => l === level && b === bay)) return;
            const j = blocked(side, s, g.w ?? 1.5, [base + g.sill + .3, base + (g.sill + g.head) / 2, base + g.head - .3]);
            assert.ok(j < 0, `element ${i}, side ${side}, storey ${level}, bay ${bay} (${s.toFixed(2)} m along): element ${j} stands in front of the window`);
          });
        });
      }
      for (const r of e.roofs ?? (e.roof ? [e.roof] : [])) for (const d of r.dormers ?? []) for (const s of dormersOn(e, d)) {
        const j = blocked(d.side, s, d.w ?? 2.4, [floors.at(-1) + (d.h ?? 3.4) / 2]);
        assert.ok(j < 0, `element ${i}: the dormer ${s} m along side ${d.side} stands in element ${j}`);
      }
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
