import * as T from 'three';
import {gothic} from '../kit/builder.js';

// ——— Mughal garden tomb (Agra, 17th century) ———
// Bricks for a Mughal tomb of white marble: its square plinth with round bastions at the corners; the tomb itself, a
// square with chamfered corners, a pishtaq on each long side framing a deep iwan between two storeys of arched
// balconies, the same balconies on the chamfers, guldastas on the angles; the drum and onion dome with its lotus crown
// and gilded finial; the domed kiosks (chhatris) on the roof; and the minarets at the plinth's corners. They use the
// frame of the kit's Gothic bricks: `center` [x, z] and `rot`, u along the element's axis, v across, y up; with
// `masonry: "mesh"` the walls are continuous surfaces cut by the true outline of their arches and the round forms are
// lofted surfaces laid course by course. Heights are in metres above the ground; `y0` is the element's foot. Nothing in
// them is specific to one building: the numbers say which.

const MARBLE = '#efe9de', GILT = '#c9a24a', UP = new T.Vector3(0, 1, 0);

// A smooth profile through points [[f, r], …] (Catmull-Rom; f from 0 at the foot to 1 at the top).
function curve(points) {
  return f => {
    let i = 0;
    while (i < points.length - 2 && f > points[i + 1][0]) i++;
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    const span = p2[0] - p1[0], t = Math.max(0, Math.min(1, (f - p1[0]) / span));
    const m1 = (p2[1] - p0[1]) / (p2[0] - p0[0]) * span, m2 = (p3[1] - p1[1]) / (p3[0] - p1[0]) * span, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
  };
}
// The onion, as a fraction of its widest radius: from its foot on the drum it swells to its widest a third of the way
// up, then draws in to the lotus at its tip.
const ONION = [[0, .8], [.08, .88], [.2, .97], [.32, 1], [.45, .965], [.58, .85], [.7, .66], [.8, .46], [.88, .29], [.95, .14], [1, .06]];

// A round form from y0 to y1 on [u, v] of the toolkit's frame, its radius a function of y, laid in courses `course`
// high (a drum, a shaft, a dome).
function round(G, k, [u, v], y0, y1, radius, ph, extra = {}, {sides = 32, course = .9, smooth = true, turn = 0, cap = true, color} = {}) {
  const ys = [];
  for (let y = y0; y < y1 - course * .3; y += course) ys.push(y);
  ys.push(y1);
  if (G.mesh) { G.mesh.loft([u, v], ys, radius, ph, extra, {sides, smooth, turn, course: smooth ? 0 : course, step: course, cap, color: color ?? G.stone}); return; }
  for (let i = 0; i < ys.length - 1; i++) {
    const p = G.V(u, (ys[i] + ys[i + 1]) / 2, v);
    k.turned(sides <= 8 ? 'octagon' : 'drum', 'stone', [p.x, p.y, p.z], [2 * radius(p.y), ys[i + 1] - ys[i]], 0, G.tint(color ?? G.stone, .02), ph, p.y, extra);
  }
}

// An onion dome `height` high on [u, v], its foot `foot` across and its widest `wide` across, from y, with its crown of
// lotus petals turned down round the tip. Returns the tip's height.
function onionDome(G, k, [u, v], y, height, foot, wide, ph, extra = {}, {lotus = 16, sides = 48} = {}) {
  const shape = curve(ONION), r0 = ONION[0][1];
  const radius = yy => foot / 2 + (shape((yy - y) / height) - r0) / (1 - r0) * (wide - foot) / 2;
  round(G, k, [u, v], y, y + height, radius, ph, extra, {sides, course: Math.min(1.2, height / 14), smooth: true});
  // The lotus: petals lying down the dome's shoulder round the tip, each in the plane of its meridian.
  const tip = y + height, base = G.V(u, 0, v), yc = tip - height * .06, rc = radius(yc), dh = height * .02, dr = radius(yc - dh) - radius(yc + dh);
  for (let i = 0; i < lotus; i++) {
    const a = (i + .5) / lotus * Math.PI * 2, out = new T.Vector3(Math.cos(a), 0, Math.sin(a));
    const down = out.clone().multiplyScalar(dr).add(new T.Vector3(0, -2 * dh, 0)).normalize(), normal = out.clone().multiplyScalar(2 * dh).add(new T.Vector3(0, dr, 0)).normalize();
    const across = new T.Vector3().crossVectors(down, normal).normalize(), p = base.clone().addScaledVector(out, rc).setY(yc).addScaledVector(normal, Math.max(.02, height * .002));
    k.oriented('stone', p, across, down, normal, [2 * Math.PI * rc / lotus * 1.05, height * .085, Math.max(.03, height * .004)], G.tint(G.stone, .02), ph, p.y, extra);
  }
  return tip;
}

// A finial `height` high from [x, y, z] (world): a disc, two kalash bulbs on a shaft, a smaller bulb, and a crescent
// whose horns point up, in gilt metal (or `color` in `kind`).
function finial(k, [x, y, z], height, ph, extra = {}, {color = GILT, kind = 'gilt', crescent = true} = {}) {
  const h = height, piece = (shape, f0, f1, d) => k.turned(shape, kind, [x, y + h * (f0 + f1) / 2, z], [d, h * (f1 - f0)], 0, k.tint(color, .03), ph, y + h * f0, extra);
  piece('drum', 0, .03, h * .2);
  piece('ball', .03, .19, h * .17);
  piece('drum', .19, .22, h * .1);
  piece('ball', .22, .33, h * .12);
  piece('drum', .33, .62, h * .035);
  piece('ball', .62, .7, h * .075);
  piece('drum', .7, crescent ? .79 : .95, h * .028);
  if (!crescent) return;
  // The crescent: a ring of small pieces in a vertical plane, open at the top.
  const R = h * .085, cy = y + h * .875, n = 10;
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (i / n - .5) * Math.PI * 1.5, p = new T.Vector3(x + Math.cos(a) * R, cy + Math.sin(a) * R, z);
    const along = new T.Vector3(-Math.sin(a), Math.cos(a), 0), across = new T.Vector3(0, 0, 1), normal = new T.Vector3().crossVectors(across, along);
    k.oriented(kind, p, along, normal, across, [2 * Math.PI * R / n * .78, h * .028, h * .022], k.tint(color, .03), ph, p.y, extra);
  }
}

// The outline of a pointed (four-centred) arch from its left springing to its right one, `w` wide, springing at
// `spring`, its apex `rise` above it: points [s, y] along a face, centred on s. Each half is an arc whose centre lies
// on the springing line on the far side of the axis.
function archPoints(s, w, spring, rise, n = 10) {
  const half = w / 2, R = (half * half + rise * rise) / (2 * half), pts = [];
  for (let i = 0; i <= n; i++) {
    const x = -half + w * i / n, y = Math.sqrt(Math.max(0, R * R - (Math.abs(x) + R - half) ** 2));
    pts.push([s + x, spring + Math.min(rise, y)]);
  }
  return pts;
}

const bricks = {
  // A square plinth `side` wide and `height` high from y0, faced with marble, paved on top, with a moulded base and
  // cornice, round bastions at the corners (`bastions`: {radius, inset}, the inset of their centres from each side) and
  // a stair block (`stair`).
  mughalPlinth(k, e, P) {
    const G = gothic(k, e, P), h = e.side / 2, H = e.height, t = e.thick ?? 1.6, y0 = e.y0 ?? 0, ph = G.phase;
    const sides = [[[-h, h], [h, h], [0, 1]], [[h, h], [h, -h], [1, 0]], [[h, -h], [-h, -h], [0, -1]], [[-h, -h], [-h, h], [-1, 0]]];
    for (const [a, b, out] of sides) G.wall([a[0] - out[0] * t / 2, a[1] - out[1] * t / 2], [b[0] - out[0] * t / 2, b[1] - out[1] * t / 2], y0, y0 + H, t, out, [], ph);
    const n = Math.ceil(e.side / 6);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const u = -h + (i + .5) * e.side / n, v = -h + (j + .5) * e.side / n;
      G.box('stone', [u, v], y0 + H - .2, [e.side / n * 1.002, .4, e.side / n * 1.002], [1, 0], G.tint(e.paving ?? G.stone, .02), ph);
    }
    for (const [a, b, out] of sides) {
      G.beam('stone', [a[0] + out[0] * .12, y0 + H - .5, a[1] + out[1] * .12], [b[0] + out[0] * .12, y0 + H - .5, b[1] + out[1] * .12], .45, G.tint(G.stone, .02), ph);
      G.beam('stone', [a[0] + out[0] * .08, y0 + .3, a[1] + out[1] * .08], [b[0] + out[0] * .08, y0 + .3, b[1] + out[1] * .08], .6, G.tint(G.stone, .02), ph);
    }
    const B = e.bastions;
    if (B) for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) round(G, k, [su * (h - B.inset), sv * (h - B.inset)], y0, y0 + H, () => B.radius, ph, {}, {sides: 16, smooth: false, course: .9});
    // The stair (`stair` {width, depth}): a plain block standing out of the middle of the +v side, as wide as the
    // flights it houses, to the plinth's top.
    const S = e.stair;
    if (S) {
      G.wall([-S.width / 2, h + S.depth - t / 2], [S.width / 2, h + S.depth - t / 2], y0, y0 + H, t, [0, 1], [], ph);
      for (const side of [-1, 1]) G.wall([side * (S.width / 2 - t / 2), h], [side * (S.width / 2 - t / 2), h + S.depth], y0, y0 + H, t, [side, 0], [], ph);
      G.box('stone', [0, h + S.depth / 2], y0 + H - .2, [S.width, .4, S.depth], [1, 0], G.tint(e.paving ?? G.stone, .02), ph);
    }
  },

  // The tomb: a square `width` wide, its corners cut by `chamfer` (the legs of each cut), from y0. On each long side a
  // pishtaq (`pishtaq`: {width, top, iwan: {w, spring, rise, depth}, door: {w, spring, rise}, balcony: {w, sill, spring,
  // rise}}) frames a deep iwan with a door at its back and an arched balcony above it; on either side of it (`bays`:
  // {w, lower, upper, depth, window}) two storeys of arched balconies, the same on the chamfers (`chamfers`: {w,
  // window}); a parapet (its top, `parapet`) round a flat roof (`roof`, its level); guldastas (`guldastas`: {d, rise,
  // pishtaqRise}) on every angle of the octagon and beside every pishtaq. Glass (`glass`) fills the balconies and the
  // upper window of each iwan; the doors are `doorColor`. Heights in `pishtaq`, `bays`, `parapet` and `roof` are above y0.
  mughalTomb(k, e, P) {
    const G = gothic(k, e, P), y0 = e.y0 ?? 0, W = e.width / 2, c = e.chamfer, t = e.thick ?? 1.2, Hs = y0 + e.parapet, Hr = y0 + e.roof;
    const Pq = e.pishtaq, Bq = e.bays, glass = e.glass ?? '#3d4650', ph = G.phase, rot = e.rot ?? 0;
    // The eight faces, each from a to b counterclockwise seen from above, with its outward normal; the long ones first.
    const corners = [[-W + c, W], [W - c, W], [W, W - c], [W, -W + c], [W - c, -W], [-W + c, -W], [-W, -W + c], [-W, W - c]];
    const faces = corners.map((a, i) => {
      const b = corners[(i + 1) % 8], len = Math.hypot(b[0] - a[0], b[1] - a[1]), dir = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      return {a, len, dir, out: [-dir[1], dir[0]], long: i % 2 === 0};
    });
    // A point of a face, s along it from a, d out from its outer face: [u, y, v]; and a line along it for a wall.
    const at = (f, s, y, d = 0) => [f.a[0] + f.dir[0] * s + f.out[0] * d, y, f.a[1] + f.dir[1] * s + f.out[1] * d];
    const line = (f, s0, s1, d) => [[at(f, s0, 0, d)[0], at(f, s0, 0, d)[2]], [at(f, s1, 0, d)[0], at(f, s1, 0, d)[2]]];
    const world = v => new T.Vector3(v[0], 0, v[1]).applyAxisAngle(UP, rot);
    const arch = (s, w, sill, spring, rise, extra = {}) => ({kind: 'pointed', s, w, sill, spring, rise, margin: 0, shafts: false, surround: false, ...extra});
    // The recess behind a hole of a face, `depth` from its outer face: a back wall with its own openings (`back`, centred
    // on the hole when their s is 0), the hole's jambs carried back to it, its pointed barrel vault, and the mass of the
    // wall over the vault up to `top`.
    const recess = (f, hole, depth, back, top) => {
      const s = hole.s, w = hole.w, apex = hole.spring + hole.rise, tb = .8;
      const [A, B] = line(f, s - w / 2 - .4, s + w / 2 + .4, -depth - tb / 2);
      G.wall(A, B, hole.sill, top, tb, f.out, back.map(o => ({...o, s: o.s + w / 2 + .4})), ph);
      for (const side of [-1, 1]) {
        const [a] = line(f, s + side * (w / 2 + .3), s, -t), [b] = line(f, s + side * (w / 2 + .3), s, -depth);
        G.wall(a, b, hole.sill, hole.spring + .05, .6, [-f.dir[0] * side, -f.dir[1] * side], [], ph);
      }
      // The vault: voussoirs along the arch, each as deep as the recess, their inner face on the arch's outline.
      const pts = archPoints(s, w, hole.spring, hole.rise, 14);
      for (let i = 0; i < pts.length - 1; i++) {
        const [sa, ya] = pts[i], [sb, yb] = pts[i + 1], ds = sb - sa, dy = yb - ya, len = Math.hypot(ds, dy);
        // Outward from the arch: away from its springing line's middle.
        let ns = -dy / len, ny = ds / len;
        if (ns * ((sa + sb) / 2 - s) + ny * ((ya + yb) / 2 - hole.spring) < 0) { ns = -ns; ny = -ny; }
        const mid = at(f, (sa + sb) / 2 + ns * .22, (ya + yb) / 2 + ny * .22, -(t + depth) / 2), p = G.V(mid[0], mid[1], mid[2]);
        const along = world(f.dir).multiplyScalar(ds / len).addScaledVector(UP, dy / len).normalize(), normal = world(f.dir).multiplyScalar(ns).addScaledVector(UP, ny).normalize();
        // A right-handed frame: the third axis, across the two in the face's plane, is level and runs into the wall.
        k.oriented('stone', p, along, normal, new T.Vector3().crossVectors(along, normal).normalize(), [len * 1.05, .44, depth - t + .1], G.tint(G.stone, .02), ph, p.y);
      }
      const mass = G.V(...at(f, s, (apex + top) / 2, -(t + depth) / 2));
      if (top - apex > .3) k.box('stone', [mass.x, mass.y, mass.z], [w + .6, top - apex, depth - t + .1], rot + Math.atan2(-f.dir[1], f.dir[0]), G.tint(G.stone, .02), ph, mass.y);
    };
    // Dark inlay on the marble (`inlay`: its colour): a rectangular frame round an arch, `band` wide, and a line along the
    // arch itself, laid a few millimetres proud of the face at d.
    const ink = e.inlay ?? '#2f2b28';
    const strip = (f, s0, y0b, s1, y1b, d, w) => {
      const a = G.V(...at(f, s0, y0b, d)), b = G.V(...at(f, s1, y1b, d)), mid = a.clone().lerp(b, .5), along = b.clone().sub(a), len = along.length();
      if (len < .05) return;
      along.normalize();
      const outward = world(f.out), side = new T.Vector3().crossVectors(outward, along).normalize();
      k.oriented('stone', mid, along, side, outward, [len + w, w, .04], G.tint(ink, .03), ph, mid.y);
    };
    const frame = (f, hole, d, band, margin) => {
      const s0 = hole.s - hole.w / 2 - margin, s1 = hole.s + hole.w / 2 + margin, ya = hole.sill + (hole.sill > y0 + .1 ? -margin : .4), yb = hole.spring + hole.rise + margin;
      strip(f, s0, ya, s0, yb, d, band); strip(f, s1, ya, s1, yb, d, band); strip(f, s0, yb, s1, yb, d, band);
      const pts = archPoints(hole.s, hole.w + band * 1.6, hole.spring, hole.rise + band * .6, 16);
      for (let i = 0; i < pts.length - 1; i++) strip(f, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], d, band * .55);
    };
    for (const f of faces) {
      const L = f.len;
      if (f.long) {
        // The side bays, from the face's ends to the pishtaq, and the pishtaq, standing 0.25 m proud of them.
        const p0 = (L - Pq.width) / 2, p1 = (L + Pq.width) / 2, holes = [];
        for (const sc of [p0 / 2, L - p0 / 2]) for (const lv of [Bq.lower, Bq.upper]) holes.push(arch(sc, Bq.w, y0 + lv.sill, y0 + lv.spring, lv.rise, {glass: false}));
        for (const [s0, s1] of [[0, p0], [p1, L]]) {
          const [a, b] = line(f, s0, s1, -t / 2);
          G.wall(a, b, y0, Hs, t, f.out, holes.filter(o => o.s > s0 && o.s < s1).map(o => ({...o, s: o.s - s0})), ph);
        }
        for (const o of holes) { recess(f, o, Bq.depth, [arch(0, Bq.window.w, o.sill + Bq.window.sill, o.sill + Bq.window.spring, Bq.window.rise, {glass})], o.spring + o.rise + .9); frame(f, o, .02, .14, .45); }
        const iw = Pq.iwan, hole = arch(L / 2, iw.w, y0, y0 + iw.spring, iw.rise, {glass: false});
        const [ap, bp] = line(f, p0, p1, .25 - t / 2);
        G.wall(ap, bp, y0, y0 + Pq.top, t, f.out, [{...hole, s: hole.s - p0}], ph);
        const door = Pq.door, bal = Pq.balcony;
        recess(f, hole, iw.depth, [
          {kind: 'pointed', s: 0, w: door.w, sill: y0, spring: y0 + door.spring, rise: door.rise, door: e.doorColor ?? '#6b4e2e', doorHeight: door.spring + door.rise * .8, margin: 0, shafts: false, surround: false},
          arch(0, bal.w, y0 + bal.sill, y0 + bal.spring, bal.rise, {glass}),
        ], y0 + Pq.top - 1.2);
        G.beam('stone', at(f, p0, y0 + Pq.top + .2, .3), at(f, p1, y0 + Pq.top + .2, .3), .5, G.tint(G.stone, .02), ph);
        // The pishtaq's frame of calligraphy round the iwan, and a line along its arch.
        frame(f, hole, .27, Pq.band ?? .9, (Pq.band ?? .9) + .6);
        // Inlay round the door and the balcony at the back of the iwan.
        for (const o of [{s: L / 2, w: door.w, sill: y0, spring: y0 + door.spring, rise: door.rise}, {s: L / 2, w: bal.w, sill: y0 + bal.sill, spring: y0 + bal.spring, rise: bal.rise}]) frame(f, o, -iw.depth + .02, .12, .35);
      } else {
        const holes = [Bq.lower, Bq.upper].map(lv => arch(L / 2, e.chamfers.w, y0 + lv.sill, y0 + lv.spring, lv.rise, {glass: false}));
        const [a, b] = line(f, 0, L, -t / 2);
        G.wall(a, b, y0, Hs, t, f.out, holes, ph);
        for (const o of holes) { recess(f, o, Bq.depth, [arch(0, e.chamfers.window, o.sill + Bq.window.sill, o.sill + Bq.window.spring, Bq.window.rise, {glass})], o.spring + o.rise + .9); frame(f, o, .02, .14, .4); }
      }
      // A coping along the parapet, broken by the pishtaq on a long face.
      for (const [s0, s1] of f.long ? [[0, (L - Pq.width) / 2], [(L + Pq.width) / 2, L]] : [[0, L]]) G.beam('stone', at(f, s0, Hs + .15, .1), at(f, s1, Hs + .15, .1), .42, G.tint(G.stone, .02), ph);
    }
    // The roof: a terrace over the octagon, under the parapet, open over the iwans, which rise above it under their vaults.
    const span = W - c, inner = W - Pq.iwan.depth - .3, gap = Pq.iwan.w / 2 + .6;
    G.box('stone', [0, 0], Hr - .5, [2 * inner, 1, 2 * inner], [1, 0], G.tint(G.stone, .02), ph);
    for (const [du, dv] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) for (const side of [-1, 1]) {
      // Between the central square and each long face, either side of its iwan.
      const along = (gap + span) / 2 * side, across = (inner + W - t) / 2, len = span - gap, deep = W - t - inner;
      G.box('stone', du ? [du * across, along] : [along, dv * across], Hr - .5, du ? [deep, 1, len] : [len, 1, deep], [1, 0], G.tint(G.stone, .02), ph);
    }
    for (const [su, sv] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
      const p = G.V(su * (W - c * .72), Hr - .5, sv * (W - c * .72));
      k.box('stone', [p.x, p.y, p.z], [c * 1.45, 1, c * .8], rot + (su * sv > 0 ? Math.PI / 4 : -Math.PI / 4), G.tint(G.stone, .02), ph, p.y);
    }
    // Guldastas: slender octagonal shafts on the angles and beside the pishtaqs, each under a small cap and finial.
    const Gd = e.guldastas;
    if (Gd) {
      const shafts = corners.map(cn => ({c: cn, top: Hs + Gd.rise}));
      for (const f of faces.filter(f => f.long)) for (const s of [(f.len - Pq.width) / 2, (f.len + Pq.width) / 2]) { const q = at(f, s, 0, .25); shafts.push({c: [q[0], q[2]], top: y0 + Pq.top + Gd.pishtaqRise}); }
      for (const g of shafts) {
        round(G, k, g.c, y0, g.top, () => Gd.d / 2, ph, {}, {sides: 8, smooth: false, course: 1.1});
        const p = G.V(g.c[0], g.top, g.c[1]);
        k.turned('ball', 'stone', [p.x, g.top + Gd.d * .42, p.z], [Gd.d * 1.2, Gd.d * .95], 0, G.tint(G.stone, .02), ph, g.top);
        finial(k, [p.x, g.top + Gd.d * .85, p.z], Gd.d * 1.5, ph, {}, {color: G.stone, kind: 'stone', crescent: false});
      }
    }
  },

  // The drum and onion dome over the roof, centred on the element: the drum from y0 (`drum` {height, d}) between a
  // moulded band and the twisted rope under the dome, the dome (`dome` {height, foot, wide, lotus}) and its finial
  // (`finial` {height, until}: it goes at `until`, when a copy replaces it).
  onionDome(k, e, P) {
    const G = gothic(k, e, P), y0 = e.y0 ?? 0, D = e.drum, ph = G.phase, r = D.d / 2, centre = G.V(0, 0, 0);
    round(G, k, [0, 0], y0, y0 + D.height, () => r, ph, {}, {sides: 48, course: 1.1});
    k.turned('torus', 'stone', [centre.x, y0 + .4, centre.z], [D.d + .8, .8], 0, G.tint(G.stone, .02), ph, y0);
    const n = e.rope ?? 40, ry = y0 + D.height - .3;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2, out = new T.Vector3(Math.cos(a), 0, Math.sin(a)), along = new T.Vector3(-Math.sin(a), 0, Math.cos(a));
      const up = UP.clone().applyAxisAngle(out, .6), normal = new T.Vector3().crossVectors(along, up).normalize(), p = centre.clone().addScaledVector(out, r + .12).setY(ry);
      k.oriented('stone', p, along, up, normal, [2 * Math.PI * (r + .12) / n * 1.08, .66, .5], G.tint(G.stone, .02), ph, p.y);
    }
    const tip = onionDome(G, k, [0, 0], y0 + D.height, e.dome.height, e.dome.foot, e.dome.wide, ph, {}, {lotus: e.dome.lotus ?? 24});
    if (e.finial) finial(k, [centre.x, tip - .1, centre.z], e.finial.height, ph, e.finial.until ? {until: P(e.finial.until)} : {});
  },

  // A finial on its own, `height` high at `at` [x, y, z]: the copy that replaced an earlier one.
  finial(k, e, P) {
    finial(k, e.at, e.height, P(e.phase), {}, {color: e.color ?? GILT});
  },

  // A chhatri: a domed kiosk at the element's centre, from y0: an octagonal platform (`base` {d, height}), `columns`
  // columns `columnD` thick on a circle `ring` across, `columnHeight` high, joined by pointed arches, a lintel and the
  // eaves (`eaves` {d}), a low drum and a small onion dome (`dome` {drum, height, foot, wide}), and a finial (`finial`).
  chhatri(k, e, P) {
    const G = gothic(k, e, P), y0 = e.y0 ?? 0, ph = G.phase, Bs = e.base, n = e.columns ?? 8, R = e.ring / 2, cH = e.columnHeight, cd = e.columnD ?? .5;
    const p = G.V(0, 0, 0), oct = d => d / 2 / Math.cos(Math.PI / 8);
    if (Bs.height > 0) round(G, k, [0, 0], y0, y0 + Bs.height, () => oct(Bs.d), ph, {}, {sides: 8, turn: Math.PI / 8, smooth: false, course: .8});
    const top = y0 + Bs.height;
    for (let i = 0; i < n; i++) {
      const a = (i + .5) / n * Math.PI * 2, b = (i + 1.5) / n * Math.PI * 2;
      const q = p.clone().add(new T.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R)), q2 = p.clone().add(new T.Vector3(Math.cos(b) * R, 0, Math.sin(b) * R));
      k.column('stone', [q.x, top, q.z], {height: cH, diameter: cd, order: 'gothic', drum: 0, taper: .04, out: [Math.cos(a), Math.sin(a)]}, G.stone, ph);
      const mid = q.clone().lerp(q2, .5), chord = q2.clone().sub(q), len = chord.length(); chord.normalize();
      const pts = archPoints(0, len - cd, top + cH * .72, cH * .22, 6);
      for (let j = 0; j < pts.length - 1; j++) k.beam('stone', mid.clone().addScaledVector(chord, pts[j][0]).setY(pts[j][1]), mid.clone().addScaledVector(chord, pts[j + 1][0]).setY(pts[j + 1][1]), Math.max(.14, cd * .4), G.tint(G.stone, .02), ph);
    }
    const Ey = top + cH, Ed = e.eaves.d / 2, rl = R + cd * .7;
    round(G, k, [0, 0], Ey, Ey + .5, () => oct(2 * rl), ph, {}, {sides: 8, turn: Math.PI / 8, smooth: false, course: .5});
    if (G.mesh) for (let i = 0; i < 8; i++) {
      const a0 = (i - .5) / 8 * Math.PI * 2, a1 = (i + .5) / 8 * Math.PI * 2, r1 = oct(2 * rl) * .98, r2 = oct(2 * Ed);
      G.mesh.panel(G.V(Math.cos(a0) * r1, Ey + .45, Math.sin(a0) * r1), G.V(Math.cos(a1) * r1, Ey + .45, Math.sin(a1) * r1), G.V(Math.cos(a0) * r2, Ey + .05, Math.sin(a0) * r2), G.V(Math.cos(a1) * r2, Ey + .05, Math.sin(a1) * r2), G.stone, ph, {}, 'stone', 1, 0);
    }
    const Dm = e.dome, dy = Ey + .5;
    round(G, k, [0, 0], dy, dy + Dm.drum, () => Dm.foot / 2 + .12, ph, {}, {sides: 24, course: Dm.drum});
    const tip = onionDome(G, k, [0, 0], dy + Dm.drum, Dm.height, Dm.foot, Dm.wide, ph, {}, {lotus: 12, sides: 32});
    if (e.finial) finial(k, [p.x, tip - .05, p.z], e.finial.height, ph);
  },

  // A minaret at the element's centre, from y0: an octagonal pedestal (`pedestal` {d, height}), a round shaft tapering
  // from `d` to `dTop`, in parts divided by balconies (`balconies`: their floors' heights above y0, each `out` beyond the
  // shaft, on corbels, with a parapet), the last under a chhatri (`chhatri`: as that brick's, standing on it).
  minaret(k, e, P) {
    const G = gothic(k, e, P), y0 = e.y0 ?? 0, ph = G.phase, ped = e.pedestal, top = y0 + e.balconies.at(-1), out = e.out ?? 1;
    const foot = y0 + ped.height, radius = y => (e.d + (e.dTop - e.d) * Math.max(0, Math.min(1, (y - foot) / (top - foot)))) / 2;
    round(G, k, [0, 0], y0, foot, () => ped.d / 2 / Math.cos(Math.PI / 8), ph, {}, {sides: 8, turn: Math.PI / 8, smooth: false, course: .7});
    round(G, k, [0, 0], foot, top, radius, ph, {}, {sides: 32, course: .9});
    const p = G.V(0, 0, 0);
    for (const h of e.balconies) {
      const y = y0 + h, r = radius(y);
      round(G, k, [0, 0], y - .45, y, () => r + out, ph, {}, {sides: 32, course: .45});
      round(G, k, [0, 0], y, y + .95, () => r + out - .08, ph, {}, {sides: 32, course: .95, cap: false});
      const m = Math.max(12, Math.round(2 * Math.PI * r / .75));
      for (let i = 0; i < m; i++) {
        const a = i / m * Math.PI * 2, q = p.clone().add(new T.Vector3(Math.cos(a) * (r + out * .42), 0, Math.sin(a) * (r + out * .42))).setY(y - .95);
        k.box('stone', [q.x, q.y, q.z], [.26, 1, out * .84], Math.PI / 2 - a, G.tint(G.stone, .02), ph, q.y);
      }
    }
    if (e.chhatri) bricks.chhatri(k, {...e.chhatri, center: e.center, rot: e.rot, phase: e.phase, color: e.color, y0: top}, P);
  },
};

export default bricks;
