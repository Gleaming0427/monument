import * as T from 'three';

// Bricks for a Japanese castle: the keep (tenshu) of the Momoyama manner. Like the Gothic bricks they stand on a frame
// placed by `center` and `rot`; x runs along the keep's width, z along its depth (z+ is the front, the south), y up.
//
// A keep is a stack of tiers: a plastered wall, then a curved hip roof (copper or clay tiles in columns) that rises from
// its eaves to the wall of the next tier. A gable may stand on any roof face, with its own tiled slopes, a white
// plastered face (a lattice of battens, a row of windows, a black board at its foot) and gilt fittings. The top tier may
// be of black lacquer with a gilt balustrade, a glazed storey under a hip-and-gable roof and gilded ridge ornaments.
const FACES = {s: [0, 1, 1, 0], n: [0, -1, -1, 0], e: [1, 0, 0, -1], w: [-1, 0, 0, 1]}, ALL = ['s', 'n', 'e', 'w'];
const alongX = f => f === 's' || f === 'n';
const UP = new T.Vector3(0, 1, 0);

export function japanese() {
  // A keep: `tiers` from the foot (each `plan` [width, depth] of its wall, `height` from the eave line below to its own,
  // `eave` the overhang of its roof, [x, z] or one figure) and, last, the `top` tier.
  function tenshu(k, e, P) {
    const {center: [cx, cz], rot = 0, y0 = 0, tiers, top} = e, ph = P(e.phase);
    const co = Math.cos(rot), si = Math.sin(rot), pitch = Math.tan((e.pitch ?? 34) * Math.PI / 180), flare = e.flare ?? .9;
    const C = {wall: '#f4f2ec', trim: '#ebe8df', tile: '#6aa793', cap: '#a8d3c2', lacquer: '#16171b', gilt: '#d4a42a', glass: '#26333c', wood: '#2b2825', ...e.colors};
    const tileKind = e.tileKind ?? 'lead', COL = e.column ?? .62;
    const at = (x, y, z) => new T.Vector3(cx + x * co + z * si, y, cz - x * si + z * co);
    const vec = (x, y, z) => new T.Vector3(x * co + z * si, y, -x * si + z * co);
    const onFace = (f, along, out, y) => { const [nx, nz, tx, tz] = FACES[f]; return at(nx * out + tx * along, y, nz * out + tz * along); };
    const faceRot = f => rot + Math.atan2(-FACES[f][3], FACES[f][2]);
    const tint = (hex, j = .02) => k.tint(hex, j);
    // What is fixed to a wall or a gable face is laid with it: while `host` is set, pieces take its height as their order, so a window is never up before the wall behind it.
    let host = null;
    const put = (kind, p, size, r, color, extra) => k.box(kind, [p.x, p.y, p.z], size, r, color, ph, host ?? p.y, extra);
    const beam = (kind, a, b, thick, color, extra) => k.beam(kind, a, b, thick, color, ph, extra);
    // A slab lying on a roof: `du` across it, `ds` down the slope; size [across, thickness, down].
    const lay = (kind, p, du, ds, size, color, extra) => {
      const x = du.clone().normalize(), n = new T.Vector3().crossVectors(ds, du).normalize();
      if (n.y < 0) n.negate();
      k.oriented(kind, p, x, n, new T.Vector3().crossVectors(x, n).normalize(), size, color, ph, host ?? p.y, extra);
    };
    // A flat plate on a face, w × h and `thick` deep, turned by `turn` radians in its plane (a gilt fitting).
    const plate = (kind, f, along, out, y, w, h, thick, color, turn = 0, extra) => {
      const [nx, nz, tx, tz] = FACES[f], t = vec(tx, 0, tz), n = vec(nx, 0, nz);
      const x = t.clone().multiplyScalar(Math.cos(turn)).addScaledVector(UP, Math.sin(turn)), z = new T.Vector3().crossVectors(x, n);
      k.oriented(kind, onFace(f, along, out, y), x, n, z, [w, thick, h], color, ph, host ?? y, extra);
    };
    // A disc facing out of a face (a gilt boss).
    const boss = (f, along, out, y, d, color, extra) => { const [nx, nz] = FACES[f]; k.lying('drum', 'gilt', onFace(f, along, out, y), vec(nx, 0, nz), [d, .07], color, ph, host ?? y, extra); };
    const gilt = () => tint(C.gilt, .03), ORN = {ornament: true};

    // A gilded fish crowning a ridge end (tail up, the head to the front along `fwd`).
    const shachi = (p, fwd, s = 1) => {
      const f = fwd.clone().normalize(), up = (y, d = 0) => p.clone().add(new T.Vector3(0, y * s, 0)).addScaledVector(f, d * s);
      beam('gilt', up(0), up(1.05, .22), .62 * s, gilt(), ORN);
      beam('gilt', up(.95, .22), up(1.85, -.12), .42 * s, gilt(), ORN);
      beam('gilt', up(1.75, -.12), up(2.45, -.5), .22 * s, gilt(), ORN);
      beam('gilt', up(.3, .05), up(.9, .75), .14 * s, gilt(), ORN);
    };
    // A plastered ridge with its tile cap.
    const ridge = (a, b, w = .5) => {
      beam('plaster', a, b, w, tint(C.wall), undefined);
      beam(tileKind, a.clone().add(new T.Vector3(0, .24, 0)), b.clone().add(new T.Vector3(0, .24, 0)), w * .5, tint(C.tile, .04));
    };

    // Curved hip roof from the eave outline (half-sizes ao, bo) up to the rectangle (ai, bi), `base` high at the eaves.
    // lift(t) is the rise at the fraction t of the run; the corners of the eaves sweep up by `flare`. Returns the
    // roof's surface, for the gables that stand on it.
    function skirt({ao, bo, ai, bi, base, lift, wall}) {
      const shape = f => { const x = alongX(f); return {A0: x ? ao : bo, A1: x ? ai : bi, B0: x ? bo : ao, B1: x ? bi : ai, W: x ? wall[1] : wall[0]}; };
      const y = (f, along, t) => {
        const {A0, A1} = shape(f), half = A0 + (A1 - A0) * t, u = Math.min(1, Math.abs(along) / half);
        return base + lift(t) + flare * u ** 6 * (1 - t) ** 2;
      };
      const point = (f, along, t) => { const {B0, B1} = shape(f); return onFace(f, along, B0 + (B1 - B0) * t, y(f, along, t)); };
      for (const f of ALL) {
        const {A0, A1, B0, B1, W} = shape(f), rows = Math.max(3, Math.ceil((B0 - B1) / .75)), n = Math.ceil(2 * A0 / COL);
        for (let r = 0; r < rows; r++) {
          const t0 = r / rows, t1 = (r + 1) / rows, tm = (t0 + t1) / 2, half = A0 + (A1 - A0) * tm;
          let edge = 0;
          for (let c = 0; c < n; c++) {
            const along = (c - (n - 1) / 2) * COL;
            if (Math.abs(along) + COL / 2 > half) continue;
            edge = Math.max(edge, Math.abs(along) + COL / 2);
            const p = point(f, along, tm), du = point(f, along + COL / 2, tm).sub(point(f, along - COL / 2, tm)), ds = point(f, along, t1).sub(point(f, along, t0));
            lay(tileKind, p, du, ds, [COL * .8, .2, ds.length() * 1.06], tint(C.tile, .05));
            lay(tileKind, point(f, along + COL / 2, tm), du, ds, [COL * .2, .26, ds.length() * 1.06], tint(C.cap, .03));
          }
          // Strips between the last full column and the hip line.
          for (const side of [-1, 1]) if (half - edge > .05) {
            const along = side * (edge + half) / 2, p = point(f, along, tm), ds = point(f, along, t1).sub(point(f, along, t0)), du = point(f, side * half, tm).sub(point(f, side * edge, tm));
            lay(tileKind, p, du, ds, [du.length() * 1.05, .2, ds.length() * 1.06], tint(C.tile, .05));
          }
        }
        // White plastered soffit between the eave and the wall, the eave board, its tile edge, and the rafter ends.
        const tw = Math.min(1, (B0 - W) / (B0 - B1));
        host = base - 1.2; // the soffit rests on the wall, ahead of the eave board and the tiles that rest on it
        for (let along = -A0 + .6; along < A0; along += 1.2) {
          const a = Math.min(along, A0 - .6), p = point(f, a, tw / 2), ds = point(f, a, tw).sub(point(f, a, 0)), du = point(f, a + .6, tw / 2).sub(point(f, a - .6, tw / 2));
          const nrm = new T.Vector3().crossVectors(ds, du).normalize(); if (nrm.y < 0) nrm.negate();
          lay('plaster', p.addScaledVector(nrm, -.32), du, ds, [1.26, .14, ds.length()], tint(C.wall));
        }
        host = null;
        for (let along = -A0; along < A0 - .01; along += .8) {
          const a0 = point(f, along, 0), a1 = point(f, Math.min(A0, along + .8), 0);
          beam('plaster', a0.clone().add(new T.Vector3(0, -.22, 0)), a1.clone().add(new T.Vector3(0, -.22, 0)), .42, tint(C.trim));
          beam(tileKind, a0.clone().add(new T.Vector3(0, .1, 0)), a1.clone().add(new T.Vector3(0, .1, 0)), .26, tint(C.cap, .03));
        }
        for (let along = -A0 + .45; along < A0; along += .9) {
          const p = point(f, along, 0), [nx, nz] = FACES[f];
          host = p.y; // under the eave board, so after it
          put('plaster', p.clone().add(new T.Vector3(0, -.62, 0)).add(vec(nx * -.15, 0, nz * -.15)), [.22, .28, .5], faceRot(f), tint(C.trim));
          host = null;
        }
      }
      // Hip ridges along the four diagonals, each ending in a gilt fitting at the eaves.
      for (const f of ['s', 'n']) for (const side of [-1, 1]) {
        const {A0, A1} = shape(f), a = t => side * (A0 + (A1 - A0) * t);
        for (let i = 0; i < 4; i++) ridge(point(f, a(i / 4), i / 4), point(f, a((i + 1) / 4), (i + 1) / 4), .42);
        const end = point(f, a(0), 0);
        put('gilt', end.clone().add(new T.Vector3(0, .35, 0)), [.38, .5, .38], faceRot(f) + Math.PI / 4, gilt(), ORN);
      }
      return {y, point, shape};
    }

    // The white face of a gable: a stack of plaster, a lattice of battens, a row of windows, a black board at its foot with gilt plates.
    function gableFace(f, at0, out, base, width, height, g = {}) {
      const half = width / 2, apex = base + height, r = faceRot(f);
      const widthAt = y => half * (1 - (y - base) / height);
      for (let i = 0; i < 12; i++) { const q = (i + .5) / 12; put('plaster', onFace(f, at0, out - .2, base - .4 + (height + .4) * q), [2 * half * (1 - q) + .3, (height + .4) / 12 + .02, .3], r, tint(C.wall)); }
      if (g.battens !== false) for (let y = base + .55, row = 0; y < apex - .9; y += .5, row++) {
        const w = widthAt(y + .25) - .35, pitch = .42;
        for (let a = -w + (row % 2) * pitch / 2; a < w; a += pitch) put('plaster', onFace(f, at0 + a, out - .02, y), [.2, .38, .1], r, tint(C.trim, .04));
      }
      const wn = g.windows ?? 4, wy = base + height * .27;
      for (let i = 0; i < wn; i++) {
        const a = (i - (wn - 1) / 2) * 1.55;
        put('wood', onFace(f, at0 + a, out + .06, wy), [1.0, 1.0, .12], r, tint(C.wood, .05));
        for (let b = 0; b < 3; b++) put('plaster', onFace(f, at0 + a - .33 + b * .33, out + .1, wy), [.06, 1.0, .06], r, tint(C.trim));
      }
      if (g.board !== false) {
        put('wood', onFace(f, at0, out + .12, base - .15), [width * 1.06, .6, .24], r, tint(C.lacquer, .03));
        for (const a of [-.34, 0, .34]) plate('gilt', f, at0 + a * width, out + .27, base - .15, 1.7, .36, .06, gilt(), 0, ORN);
      }
      plate('gilt', f, at0, out + .5, apex - .85, 1.8, 1.4, .08, gilt(), Math.PI / 4, ORN);
      return apex;
    }

    // A gable on a roof face: its white face, its tiled slopes, bargeboards with gilt bosses and a gilded ornament on its front ridge.
    function gable(sk, g, backTo) {
      const f = g.face, {B0, B1} = sk.shape(f), t = g.slope ?? .3, out = B0 + (B1 - B0) * t, base = sk.y(f, g.at, t) - .2;
      const half = g.width / 2, depth = Math.max(1.5, out - backTo + .4);
      host = base;
      const apex = gableFace(f, g.at, out, base, g.width, g.height, g);
      for (const side of [-1, 1]) {
        const pt = (a, b) => onFace(f, g.at + side * a * (half + .45), out + .55 - b * (depth + .55), apex + .2 - a * (g.height + .4));
        const rowsA = Math.ceil((half + .45) / .7), colsB = Math.ceil((depth + .55) / COL);
        for (let i = 0; i < rowsA; i++) for (let j = 0; j < colsB; j++) {
          const a = (i + .5) / rowsA, b = (j + .5) / colsB, p = pt(a, b), ds = pt((i + 1) / rowsA, b).sub(pt(i / rowsA, b)), du = pt(a, (j + 1) / colsB).sub(pt(a, j / colsB));
          lay(tileKind, p, du, ds, [du.length() * .8, .2, ds.length() * 1.06], tint(C.tile, .05));
          lay(tileKind, pt(a, (j + 1) / colsB), du, ds, [du.length() * .2, .26, ds.length() * 1.06], tint(C.cap, .03));
          if (a > .35) { const nrm = new T.Vector3().crossVectors(ds, du).normalize(); if (nrm.y < 0) nrm.negate(); lay('plaster', p.clone().addScaledVector(nrm, -.3), du, ds, [du.length() * 1.02, .12, ds.length() * 1.04], tint(C.wall)); }
        }
        beam('plaster', pt(0, 0).add(new T.Vector3(0, -.1, 0)), pt(1, 0).add(new T.Vector3(0, -.25, 0)), .5, tint(C.trim));
        beam(tileKind, pt(0, 0).add(new T.Vector3(0, .12, 0)), pt(1, 0), .24, tint(C.cap, .03));
        for (let a = .22; a < .9; a += .26) { const q = pt(a, 0); k.lying('drum', 'gilt', q.clone().add(new T.Vector3(0, -.3, 0)), vec(FACES[f][0], 0, FACES[f][1]), [.4, .08], gilt(), ph, q.y, ORN); }
        plate('gilt', f, g.at + side * half * .9, out + .62, base + .45, 2.8, .7, .08, gilt(), side * -.5, ORN);
      }
      const front = onFace(f, g.at, out + .55, apex + .2);
      ridge(front, onFace(f, g.at, out - depth, apex + .2));
      if (g.shachi !== false) shachi(front, vec(FACES[f][0], 0, FACES[f][1]), .8);
      host = null;
    }

    // Windows with their lattice, in groups, and the row of small square openings along the foot of a wall.
    function windows(f, half, out, from, to, tier, skip) {
      const W = tier.windows ?? {}, pitchW = W.pitch ?? 4.2, n = Math.max(1, Math.floor(2 * half / pitchW)), r = faceRot(f), count = W.group ?? 2, gap = W.gap ?? .28;
      const w = W.w ?? .84, h = W.h ?? 1.45, yc = from + (to - from) * (W.at ?? .5);
      if (W.none) return;
      for (let i = 0; i < n; i++) {
        const along = (i - (n - 1) / 2) * pitchW;
        if (skip.some(s => s.face === f && Math.abs(along - s.at) < s.width / 2 + w * count / 2 + .4)) continue;
        for (let j = 0; j < count; j++) {
          const dx = (j - (count - 1) / 2) * (w + gap);
          put('wood', onFace(f, along + dx, out + .03, yc), [w, h, .08], r, tint(C.wood, .05));
          for (let b = 0; b < 4; b++) put('plaster', onFace(f, along + dx - w / 2 + (b + .5) * w / 4, out + .08, yc), [.07, h, .06], r, tint(C.trim, .01));
          put('plaster', onFace(f, along + dx, out + .05, yc - h / 2 - .06), [w + .14, .1, .12], r, tint(C.trim, .01));
        }
      }
    }
    function ports(f, half, out, y, tier, skip) {
      const p = tier.ports; if (!p) return;
      const n = Math.floor(2 * half / p.pitch);
      for (let i = 0; i < n; i++) {
        const along = (i - (n - 1) / 2) * p.pitch;
        if (skip.some(s => s.face === f && Math.abs(along - s.at) < s.width / 2 + .6)) continue;
        put('wood', onFace(f, along, out + .03, y), [p.w ?? .36, p.w ?? .36, .08], faceRot(f), tint(C.wood, .05));
      }
    }
    // A bay projecting from a wall (a white box with its slats and a little roof).
    function bay(f, b, out, y, h) {
      const w = b.width, r = faceRot(f), depth = b.depth ?? 1.1;
      put('plaster', onFace(f, b.at, out + depth / 2, y), [w, h, depth], r, tint(C.wall));
      put('plaster', onFace(f, b.at, out + depth + .02, y + h * .1), [w * .8, h * .55, .06], r, tint(C.trim));
      put(tileKind, onFace(f, b.at, out + depth / 2 + .1, y + h / 2 + .15), [w + .5, .2, depth + .6], r, tint(C.tile, .04));
    }


    // A gilt tiger crossing a wall, head towards `s` (±1) along the face, about 2.5 m from tail to nose: a flat silhouette of plates.
    function tiger(f, along, out, y, s) {
      const K = .62, part = (u, v, w, h, turn = 0) => plate('gilt', f, along + s * u * K, out, y + v * K, w * K, h * K, .07, gilt(), s * turn, ORN);
      part(0, .1, 2.2, .62); part(-.85, .15, .8, .85, -.15); part(.7, .15, .85, .85, .1); part(1.4, .0, .8, .62, -.3); part(1.55, .3, .3, .22, .4);
      part(1.0, -.5, .26, .7, .25); part(.5, -.45, .26, .6); part(-.95, -.5, .26, .7, -.2); part(-.55, -.45, .26, .6);
      part(-1.4, .45, .65, .2, .5); part(-1.8, .75, .45, .18, 1.0); part(-1.95, 1.05, .3, .16, 1.45);
    }

    // ——— The tiers ———
    const E = [y0];
    tiers.forEach(t => E.push(E.at(-1) + t.height));
    let shown = y0;
    tiers.forEach((tier, i) => {
      const yb = E[i], Ey = E[i + 1], hw = tier.plan[0] / 2, hd = tier.plan[1] / 2, [ox, oz] = Array.isArray(tier.eave) ? tier.eave : [tier.eave ?? 2.2, tier.eave ?? 2.2];
      const gables = (tier.gables ?? []).map(g => ({...g}));
      const skip = (tier.bays ?? []).map(b => ({face: b.face, at: b.at, width: b.width}));
      host = yb;
      for (const f of ALL) {
        const x = alongX(f), half = x ? hw : hd, out = x ? hd : hw, h = Ey - yb;
        put('plaster', onFace(f, 0, out - .25, yb + h / 2), [x ? 2 * half : 2 * half - 1, h, .5], faceRot(f), tint(C.wall, .012));
        windows(f, half, out, shown, Ey - .6, tier, skip);
        ports(f, half, out, yb + (tier.ports?.y ?? 1.0), tier, skip);
        for (const b of (tier.bays ?? []).filter(b => b.face === f)) bay(f, b, out, yb + (b.y ?? 2), b.height ?? 3);
      }
      host = null;
      const next = tiers[i + 1] ?? top;
      const ai = next.plan[0] / 2, bi = next.plan[1] / 2, rise = tier.rise ?? pitch * ((ox + hw - ai) + (oz + hd - bi)) / 2;
      const sk = skirt({ao: hw + ox, bo: hd + oz, ai, bi, base: Ey - .35, lift: t => rise * t ** 1.3, wall: [hw, hd]});
      for (const g of gables) gable(sk, g, alongX(g.face) ? bi : ai);
      shown = Ey - .35 + rise;
    });

    // ——— The top tier: black lacquer, a gilt balustrade, a glazed storey and the hip-and-gable roof ———
    if (top) {
      const hw = top.plan[0] / 2, hd = top.plan[1] / 2, floorY = y0 + top.floor, eaveY = y0 + top.eaveY, G = top.gallery ?? {}, gOut = G.out ?? .6, rail = G.rail ?? 1.05;
      const [ox, oz] = Array.isArray(top.eave) ? top.eave : [top.eave ?? 2.2, top.eave ?? 2.2], R = top.ridge ?? 4.6, sg = top.hip ?? .45, axis = top.axis ?? 'z';
      const lacquer = () => tint(C.lacquer, .03), wallH = floorY - shown;
      // The black wall, its corner stars and the gilt squares of its upper band.
      host = shown;
      for (const f of ALL) {
        const x = alongX(f), half = x ? hw : hd, out = x ? hd : hw, r = faceRot(f);
        put('wood', onFace(f, 0, out - .25, shown + wallH / 2), [x ? 2 * half : 2 * half - 1, wallH, .5], r, lacquer());
        for (const side of [-1, 1]) {
          put('wood', onFace(f, side * (half - .12), out + .04, shown + wallH / 2), [.34, wallH, .12], r, lacquer());
          plate('gilt', f, side * (half - .12), out + .16, shown + wallH * .72, 1.0, 1.0, .06, gilt(), Math.PI / 4, ORN);
          plate('gilt', f, side * (half - .12), out + .16, shown + wallH * .2, 1.0, 1.0, .06, gilt(), Math.PI / 4, ORN);
        }
        for (let a = -half + 1.6; a < half - 1; a += 2.1) plate('gilt', f, a, out + .08, floorY - .55, .55, .4, .05, gilt(), 0, ORN);
        for (const s of [-1, 1]) tiger(f, s * half * .5, out + .08, shown + wallH * .43, -s);
      }
      host = null;
      // The gallery: a floor, brackets, posts with gilt knobs, two rails.
      const ring = (d, y, thick, kind, color) => {
        const X = hw + d, Z = hd + d, c = [[-X, -Z], [X, -Z], [X, Z], [-X, Z]];
        for (let i = 0; i < 4; i++) { const a = c[i], b = c[(i + 1) % 4]; beam(kind, at(a[0], y, a[1]), at(b[0], y, b[1]), thick, color); }
      };
      ring(gOut, floorY - .1, .34, 'wood', lacquer());
      ring(gOut, floorY + rail, .16, 'wood', lacquer());
      ring(gOut, floorY + rail * .5, .1, 'wood', lacquer());
      for (const f of ALL) {
        const x = alongX(f), half = (x ? hw : hd) + gOut, out = (x ? hd : hw) + gOut, n = Math.ceil(2 * half / 1.35);
        for (let i = 0; i <= n; i++) {
          const a = -half + i * 2 * half / n;
          put('wood', onFace(f, a, out, floorY + rail / 2), [.14, rail, .14], faceRot(f), lacquer());
          if (i % 2 === 0) k.turned('ball', 'gilt', [onFace(f, a, out, floorY + rail + .1).x, floorY + rail + .1, onFace(f, a, out, floorY + rail + .1).z], [.24, .26, .24], 0, gilt(), ph, floorY + rail, ORN);
        }
        for (let a = -half + .9; a < half - .6; a += 2.7) put('wood', onFace(f, a, out - .25, floorY - .45), [.3, .7, .6], faceRot(f), lacquer());
      }
      // The glazed storey, between black posts, up to the eaves.
      for (const f of ALL) {
        const x = alongX(f), half = x ? hw : hd, out = (x ? hd : hw) - .05, n = Math.ceil(2 * half / 1.35), r = faceRot(f), h = eaveY - floorY - .5;
        put('glass', onFace(f, 0, out, floorY + h / 2), [2 * half - .3, h, .05], r, tint(C.glass, .06));
        for (let i = 0; i <= n; i++) put('wood', onFace(f, -half + i * 2 * half / n, out + .02, floorY + h / 2), [.1, h, .1], r, lacquer());
      }
      // The roof: a hip below, a gable above; the ridge runs along `axis`.
      const A = (a, y, b) => axis === 'z' ? at(b, y, a) : at(a, y, b);
      const ao = hw + ox, bo = hd + oz, lift = s => R * s ** 1.3, base = eaveY - .35;
      const across = axis === 'z' ? ao : bo, along = axis === 'z' ? bo : ao, ridgeHalf = along - across * sg, spanHalf = across * (1 - sg);
      const [xg, zg] = axis === 'z' ? [spanHalf, ridgeHalf] : [ridgeHalf, spanHalf];
      const sk = skirt({ao, bo, ai: xg, bi: zg, base, lift: t => lift(t * sg), wall: [hw, hd]});
      const rs = ridgeHalf + .7, rows = 5, cols = Math.ceil(2 * rs / COL), h0 = lift(sg);
      for (const side of [-1, 1]) {
        const b = s => side * across * (1 - s);
        for (let rr = 0; rr < rows; rr++) for (let c = 0; c < cols; c++) {
          const s0 = sg + (1 - sg) * rr / rows, s1 = sg + (1 - sg) * (rr + 1) / rows, sm = (s0 + s1) / 2, a = -rs + (c + .5) * 2 * rs / cols;
          const p = A(a, base + lift(sm), b(sm)), ds = A(a, base + lift(s1), b(s1)).sub(A(a, base + lift(s0), b(s0))), du = A(a + COL / 2, 0, 0).sub(A(a - COL / 2, 0, 0));
          lay(tileKind, p, du, ds, [COL * .8, .2, ds.length() * 1.06], tint(C.tile, .05));
          lay(tileKind, A(a + COL / 2, base + lift(sm), b(sm)), du, ds, [COL * .2, .26, ds.length() * 1.06], tint(C.cap, .03));
        }
      }
      // The gable ends: a white face under bargeboards, with the same lattice and windows as the others.
      for (const side of [-1, 1]) {
        const f = axis === 'z' ? (side > 0 ? 's' : 'n') : (side > 0 ? 'e' : 'w'), faceOut = ridgeHalf - .15;
        host = base + h0;
        gableFace(f, 0, faceOut, base + h0, 2 * spanHalf * .98, R - h0, top.gable ?? {});
        host = null;
        for (const sgn of [-1, 1]) {
          beam('plaster', A(side * rs, base + h0 - .25, sgn * spanHalf), A(side * rs, base + R - .1, 0), .5, tint(C.trim));
          beam(tileKind, A(side * rs, base + h0 - .1, sgn * spanHalf), A(side * rs, base + R, 0), .26, tint(C.cap, .03));
        }
        shachi(A(side * (rs - .2), base + R - .1, 0), axis === 'z' ? vec(0, 0, side) : vec(side, 0, 0), 1);
      }
      ridge(A(-rs - .7, base + R - .1, 0), A(rs + .7, base + R - .1, 0), .6);
    }

    return {E, shown};
  }

  return {tenshu};
}
