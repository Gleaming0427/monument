import * as T from 'three';
import {generators, gothic} from '../kit/builder.js';

// ——— Norman Gothic (Normandy, 11th–14th centuries) ———
// Bricks for the Norman Gothic cathedral and abbey church: a harmonic west front whose square towers turn
// octagonal and carry stone spires ringed with open turrets ("fillettes"); a lantern tower over the crossing,
// octagonal on pendentives, flanked by stair turrets; a stepped chevet with a double ambulatory, its levels
// rising one behind another and flying buttresses leaping over them in one span; transept fronts with tall
// lancets under a gable of blind lancets between turrets clad with shafts; square Norman turrets with stone
// cones; lateral porches; and the Romanesque church that such a building often encases. Slate roofs.
// Every brick uses the frame of the kit's Gothic bricks: u along the element's axis, v across it, y up, placed
// by `center` [x, z] and `rot`; nothing in them is specific to one building, the numbers say which.

// The kit's Gothic toolkit (kit/builder.js): walls and gables (continuous surfaces cut by the true outline of
// their openings, with `masonry: "mesh"`), arches, roses, pinnacles, roofs laid in strips, balustrades, statues and
// columns.
const gothicKit = gothic;

// Rib vaults, as the kit's basilica lays them: webs ruled between their boundary arches and the diagonal ribs.
function vaultKit(G) {
  const V3 = p => G.V(p[0], p[1], p[2]);
  const diagonal = (K, C, ys, yc, n = 6) => Array.from({length: n + 1}, (_, i) => { const th = Math.PI / 2 * i / n, f = 1 - Math.cos(th); return [K[0] + (C[0] - K[0]) * f, ys + (yc - ys) * Math.sin(th), K[1] + (C[1] - K[1]) * f]; });
  const archPoints = (A, B, ys, yw, ya, n = 8) => {
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]), rise = Math.max(.3, ya - yw), r = G.radiusOf(len, rise), pts = [[A[0], ys, A[1]]];
    if (yw > ys + .05) pts.push([A[0], yw, A[1]]);
    for (let i = 1; i < n; i++) {
      const x = -len / 2 * Math.cos(Math.PI * i / n), f = x / len + .5, y = yw + Math.sqrt(Math.max(0, r * r - (Math.abs(x) + r - len / 2) ** 2));
      pts.push([A[0] + (B[0] - A[0]) * f, y, A[1] + (B[1] - A[1]) * f]);
    }
    if (yw > ys + .05) pts.push([B[0], yw, B[1]]);
    pts.push([B[0], ys, B[1]]);
    return pts;
  };
  const resample = (pts, m) => {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
    return Array.from({length: m}, (_, j) => {
      const d = cum.at(-1) * j / (m - 1); let i = 1;
      while (i < cum.length - 1 && cum[i] < d) i++;
      const f = (d - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
      return pts[i - 1].map((v, c) => v + (pts[i][c] - v) * f);
    });
  };
  const chain = (pts, thick, ph, extra) => { if (G.mesh) return G.mesh.tube(pts, thick, ph, {...extra, orderBase: 2e4}); for (let i = 0; i < pts.length - 1; i++) G.beam('stone', pts[i], pts[i + 1], thick, G.tint(G.stone), ph, {...extra, order: 2e4 + pts[i][1]}); };
  const web = (A, B, C, ys, yc, yw, color, ph, extra = {}, archThick = .3) => {
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]), arc = archPoints(A, B, ys, yw, Math.min(yc - .15, yw + len * .866));
    const F = resample(arc, 9), Gd = resample([...diagonal(A, C, ys, yc), ...diagonal(B, C, ys, yc).reverse().slice(1)], 9);
    for (let i = 0; i < 8; i++) G.panel(V3(F[i]), V3(F[i + 1]), V3(Gd[i]), V3(Gd[i + 1]), color, ph, {...extra, order: 2e4 + F[i][1]}, 'stone', 1.6, 0);
    if (archThick) chain(arc, archThick, ph, extra);
  };
  const ribBay = (corners, ys, yc, stilts, color, ph, extra = {}, thick = [.3, .5, .3, .5]) => {
    const C = [corners.reduce((s, c) => s + c[0], 0) / 4, corners.reduce((s, c) => s + c[1], 0) / 4];
    corners.forEach((A, i) => web(A, corners[(i + 1) % 4], C, ys, yc, Math.max(ys, stilts[i] ?? ys), color, ph, extra, thick[i]));
    for (const K of corners) chain(diagonal(K, C, ys, yc), .42, ph, extra);
  };
  return {diagonal, chain, web, ribBay};
}

// Wall lines of a run, as the kit's basilica draws them: straight bays (`from`, `to`, `bays`, `sides`) or a
// polygonal apse (`apse` {sides, start, end}, degrees from +u); a station is {A: [u, v] on the axis, n: outward}.
function runLines(e) {
  if (e.apse) {
    const {sides, start = -90, end = 90} = e.apse, list = [];
    for (let i = 0; i <= sides; i++) { const a = (start + (end - start) * i / sides) * Math.PI / 180; list.push({A: [0, 0], n: [Math.cos(a), Math.sin(a)]}); }
    return [list];
  }
  return (e.sides ?? [-1, 1]).map(side => Array.from({length: e.bays + 1}, (_, i) => ({A: [e.from + (e.to - e.from) * i / e.bays, 0], n: [0, side]})));
}
const at = (s, d) => [s.A[0] + s.n[0] * d, s.A[1] + s.n[1] * d];
const mid = (s0, s1) => { const n = [s0.n[0] + s1.n[0], s0.n[1] + s1.n[1]], l = Math.hypot(...n); return [n[0] / l, n[1] / l]; };
const SLATE = '#4f5660';
// Points of a regular polygon of `n` sides round [u, v], its apothem `r`, the first face facing +u.
const polygon = (n, r, [u, v] = [0, 0], turn = 0) => Array.from({length: n}, (_, i) => { const a = (i + .5) / n * Math.PI * 2 + turn, R = r / Math.cos(Math.PI / n); return [u + Math.cos(a) * R, v + Math.sin(a) * R]; });

// A turned shaft laid course by course: an octagonal (or round) solid drum from y0 to y1 at [u, v].
function shaft(G, k, [u, v], y0, y1, d, ph, extra = {}, shape = 'octagon', course = 1.1) {
  if (G.mesh) return G.mesh.shaft([u, v], y0, y1, d, ph, extra, shape, course);
  const p = G.V(u, 0, v);
  for (let y = y0; y < y1 - .05;) { const h = Math.min(course, y1 - y); k.turned(shape, 'stone', [p.x, y + h / 2, p.z], [d, h * .97], 0, G.tint(G.stone), ph, y, extra); y += h; }
}
// A stone spirelet (an octagonal cone laid in courses) with a finial, from y0 to y1 at [u, v], `d` across.
function spirelet(G, k, [u, v], y0, y1, d, ph, extra = {}) {
  if (G.mesh) G.mesh.spirelet([u, v], y0, y1, d * .96, ph, extra);
  const p = G.V(u, 0, v), h = y1 - y0, n = Math.max(2, Math.round(h / 1.6));
  if (G.mesh) { k.turned('ball', 'stone', [p.x, y1 + .15, p.z], [Math.max(.25, d * .22), Math.max(.3, d * .25)], 0, G.tint(G.stone), ph, y1, extra); return; }
  for (let i = 0; i < n; i++) {
    const f0 = i / n, f1 = (i + 1) / n, w0 = d * (1 - f0 * .92), w1 = d * (1 - f1 * .92), hh = h * (f1 - f0);
    k.turned(i === n - 1 ? 'spike' : 'octagon', 'stone', [p.x, y0 + h * f0 + hh / 2, p.z], [i === n - 1 ? w0 : (w0 + w1) / 2, hh * .98], 0, G.tint(G.stone), ph, y0 + h * f0, extra);
  }
  k.turned('ball', 'stone', [p.x, y1 + .15, p.z], [Math.max(.25, d * .22), Math.max(.3, d * .25)], 0, G.tint(G.stone), ph, y1, extra);
}
// An open turret ("fillette"): a solid foot, slender colonnettes round an open core, a cornice with gablets,
// and a spirelet, at [u, v] from y0; `top` is the cornice, `tip` the spirelet's point.
function fillette(G, k, c, y0, top, tip, r, ph, extra = {}) {
  const p = G.V(c[0], 0, c[1]), foot = Math.min(top - 1, y0 + Math.max(1.2, (top - y0) * .12));
  shaft(G, k, c, y0, foot, 2 * r * 1.08, ph, extra);
  for (let i = 0; i < 8; i++) {
    const a = (i + .5) / 8 * Math.PI * 2, q = G.V(c[0] + Math.cos(a) * r * .82, 0, c[1] + Math.sin(a) * r * .82);
    k.turned('drum', 'stone', [q.x, (foot + top) / 2, q.z], [Math.max(.16, r * .2), top - foot], 0, G.tint(G.stone), ph, foot, extra);
  }
  shaft(G, k, c, foot, top, r * .55, ph, extra, 'drum', top - foot);
  k.turned('octagon', 'stone', [p.x, top + .2, p.z], [2 * r * 1.12, .4], 0, G.tint(G.stone), ph, top, extra);
  for (let i = 0; i < 8; i += 2) {
    const a = (i + .5) / 8 * Math.PI * 2, q = G.V(c[0] + Math.cos(a) * r, 0, c[1] + Math.sin(a) * r);
    k.turned('spike', 'stone', [q.x, top + .4 + r * .45, q.z], [r * .5, r * .9], 0, G.tint(G.stone), ph, top, extra);
  }
  spirelet(G, k, c, top + .4, tip, 2 * r * .95, ph, extra);
}
// A turret of the Norman transept fronts, as the photograph of the south front shows it: a square pier that
// batters up to a ledge, an octagonal drum ringed by slender colonnettes under a frieze of small round blind
// arches, and an octagonal cone laid in scales, with a spout at four of its corners. `c` [u, v] is its axis;
// tw {width (the drum), ledge (the top of the pier), top (the drum's cornice), tip, pier (its width at the
// ledge, default 1.1 times the drum)}.
function normanTurret(G, k, c, tw, ph) {
  const w = tw.width, ledge = tw.ledge ?? tw.top - 3, top = tw.top, pier = tw.pier ?? w, foot = pier + .5, tint = () => G.tint(G.stone);
  const wide = y => foot - (foot - pier) * Math.min(1, y / ledge);
  if (G.mesh) {
    const ys = []; for (let y = 0; y < ledge - .05; y += 1.2) ys.push(y); ys.push(ledge);
    G.mesh.loft(c, ys, y => wide(y) / 2 * Math.SQRT2, ph, {}, {sides: 4, turn: 0, course: .35, step: 1.2});
    G.mesh.loft(c, [ledge, ledge + .3], y => (pier + .4 - (y - ledge) / .3 * .25) / 2 * Math.SQRT2, ph, {}, {sides: 4, turn: 0, course: .35, step: .3});
  } else for (let y = 0; y < ledge - .05;) { const h = Math.min(1, ledge - y); G.box('stone', c, y + h / 2, [wide(y + h / 2), h * .96, wide(y + h / 2)], [1, 0], tint(), ph); y += h; }
  const y0 = ledge + .3, y1 = top - .5, apothem = w / 2 * Math.cos(Math.PI / 8), face = Math.PI / 4;
  shaft(G, k, c, y0, y1, w, ph);
  shaft(G, k, c, y1 - .05, top, w * 1.08, ph);
  // Colonnettes on every face and on every arris, the frieze of blind arches between them.
  for (let i = 0; i < 16; i++) {
    const a = i * face / 2, r = i % 2 ? w / 2 : apothem + .05, q = G.V(c[0] + Math.cos(a) * r, 0, c[1] + Math.sin(a) * r);
    k.turned('drum', 'stone', [q.x, (y0 + y1 - .5) / 2, q.z], [.18, y1 - .5 - y0], 0, tint(), ph, y0);
    k.turned('drum', 'stone', [q.x, y0 + .12, q.z], [.27, .24], 0, tint(), ph, y0);
    k.turned('drum', 'stone', [q.x, y1 - .56, q.z], [.27, .2], 0, tint(), ph, y1 - .66);
  }
  if (G.mesh) for (let j = 0; j < 8; j++) {
    const phi = j * face, n = [Math.cos(phi), Math.sin(phi)], tg = [-n[1], n[0]], F = (ss, y, off) => [c[0] + n[0] * (apothem + off) + tg[0] * ss, y, c[1] + n[1] * (apothem + off) + tg[1] * ss];
    for (const ss of [-.24, .24]) G.arch(F, ss, .38, y1 - .78, .03, .1, ph, {}, 'round', 3);
  }
  k.turned('octagon', 'stone', G.V(c[0], top + .2, c[1]).toArray(), [w * 1.2, .4], 0, tint(), ph, top);
  spirelet(G, k, c, top + .4, tw.tip, w * 1.15, ph);
  for (let j = 0; j < 4; j++) {
    const a = (j + .5) * Math.PI / 2 + Math.PI / 4, r = w * .6, y = top + .6;
    G.beam('stone', [c[0] + Math.cos(a) * r * .85, y, c[1] + Math.sin(a) * r * .85], [c[0] + Math.cos(a) * (r + .32), y - .12, c[1] + Math.sin(a) * (r + .32)], .2, tint(), ph);
  }
}

export default {
  // A Gothic church body (the kit's `basilica`) under slate roofs, as in Normandy and Brittany: the same
  // parameters, every roof covering laid in slate instead of lead.
  slateBasilica(k, e, P) {
    const before = k.pieces.length;
    generators.basilica(k, e, P);
    for (const piece of k.pieces.slice(before)) if (piece.kind === 'lead') piece.kind = 'slate';
  },

  // One level of a stepped Gothic choir (or of any aisled run): a wall line, straight bays or a polygonal apse
  // (stations as the basilica's), standing on an arcade of round columns or rising from the ground, its windows,
  // a balustrade on the eave, rib vaults over the space it bounds, and the roof that covers that space: a
  // lean-to up to an inner line, or a gable to the axis (a half cone round an apse). Several levels, one inside
  // another, make a pyramidal elevation: a double ambulatory round a tall vessel.
  //   half      the wall's line (distance from the axis); `thick` its thickness; `wall` its top (the eave)
  //   base      the arcade the wall stands on: {spring (the capitals), rise, columns (diameter), twin (two
  //             columns one behind the other, as a double ring), ends: [first, last] (false: no column there)}
  //   windows   {width, sill, spring, rise, twin, kind}, or a list of them (a tribune's openings, a clerestory)
  //   arch      'pointed' (default) or 'round' (Romanesque): the shape of the arcade and of the windows
  //   roof      {inner, top} for a lean-to rising to the line `inner` at height `top`; {ridge} for a gable or a
  //             half cone; color, phase, until, rebuild, overhang
  //   vault     {spring, crown, inner, end, trim}: rib vaults from the line `inner` (default: the axis) to the wall; `end:
  //             false` leaves out the arches at the two ends of a run that another wall closes, and `trim` [first, last]
  //             draws the vault back from those ends by that many metres (the thickness of the wall that closes them)
  //   skip      bays (indices) with no wall (where a chapel or a crossing opens); `rail: false` drops the balustrade
  //   keepBelow, upper {until}, lower {until}: the wall above that height is taken down at `upper.until` (a
  //             Romanesque clerestory replaced when the building is recast), the rest at `lower.until`
  //   ends      ['from', 'to']: the run closed there by a wall and a gable (a half gable under a lean-to);
  //             `door` {at, w, spring} a doorway in that wall
  chevetLevel(k, e, P) {
    const G = gothicKit(k, e, P), X = vaultKit(G), roof = e.roof ?? {}, t = e.thick ?? 1.1, color = roof.color ?? SLATE, base = e.base, kind = e.arch ?? 'pointed';
    const all = runLines(e), windows = [e.windows ?? []].flat(), upper = e.upper ? {until: P(e.upper.until)} : null, lower = e.lower ? {until: P(e.lower.until)} : {}, keep = e.keepBelow ?? Infinity;
    for (const line of all) {
      for (let i = 0; i < line.length - 1; i++) {
        const s0 = line[i], s1 = line[i + 1], out = mid(s0, s1), a = at(s0, e.half), b = at(s1, e.half), len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (!(e.skip ?? []).includes(i)) {
          const openings = windows.map(w => ({kind, ...w, w: Math.min(w.width ?? 2, len - 1.2)}));
          if (base) openings.push({kind, w: len - (base.columns ?? 1) * (base.twin ? .6 : .8), sill: 0, spring: base.spring, rise: base.rise, glass: false, margin: 0});
          if (upper && keep < e.wall) { G.wall(a, b, 0, keep, t, out, openings, G.phase, lower, e.course ?? .8); G.wall(a, b, keep, e.wall, t, out, openings, G.phase, upper, e.course ?? .8); }
          else G.wall(a, b, 0, e.wall, t, out, openings, G.phase, lower, e.course ?? .8);
          if (G.mesh) G.mesh.string(a, b, e.wall - .55, t, out, G.phase, upper ?? lower);
          if (e.rail !== false) G.rail(at(s0, e.half + t / 2 - .2), at(s1, e.half + t / 2 - .2), e.wall, G.phase, upper ?? lower);
        }
        G.life(roof, (ph, extra) => {
          if (roof.ridge) {
            const eo = e.half + (roof.overhang ?? .9);
            G.quad(at(s0, eo), at(s1, eo), e.wall, s0.A, s1.A, roof.ridge, color, ph, extra, 'slate');
            if (!e.apse && roof.crest !== false) G.beam('slate', [s0.A[0], roof.ridge + .3, s0.A[1]], [s1.A[0], roof.ridge + .3, s1.A[1]], .35, G.tint(color), ph, extra);
          } else if (roof.top) G.quad(at(s0, e.half + t / 2 + .3), at(s1, e.half + t / 2 + .3), e.wall + .1, at(s0, roof.inner), at(s1, roof.inner), roof.top, color, ph, extra, 'slate');
        });
        if (e.vault) {
          const v = e.vault, d1 = e.half - t / 2 - .05, sill = windows.find(w => w.sill > v.spring), yw = sill ? Math.max(v.spring, Math.min(sill.spring, v.crown - 1)) : v.spring, vc = v.color ?? G.stone;
          if (v.inner === undefined) {
            if (e.apse) { X.web(at(s0, d1), at(s1, d1), s0.A, v.spring, v.crown, yw, vc, G.phase, lower); X.chain(X.diagonal(at(s0, d1), s0.A, v.spring, v.crown), .42, G.phase, lower); }
            else if (line === all[0]) { const dir = Math.sign(e.to - e.from) || 1, last = i === line.length - 2, u0 = s0.A[0] + (i === 0 ? (v.trim?.[0] ?? 0) * dir : 0), u1 = s1.A[0] - (last ? (v.trim?.[1] ?? 0) * dir : 0); X.ribBay([[u0, -d1], [u1, -d1], [u1, d1], [u0, d1]], v.spring, v.crown, [yw, v.spring, yw, v.spring], vc, G.phase, lower, [.3, i === line.length - 2 && v.end === false ? 0 : .5, .3, i === 0 && v.end !== false ? .5 : 0]); }
          } else X.ribBay([at(s0, v.inner), at(s1, v.inner), at(s1, d1), at(s0, d1)], v.spring, v.crown, [v.spring, v.spring, yw, v.spring], vc, G.phase, lower, [.3, .4, .3, i === 0 ? .4 : 0]);
        }
      }
      // `ends` ['from', 'to']: the run closed at that end, by a wall and a gable (a half gable under a lean-to).
      if (!e.apse) for (const which of e.ends ?? []) {
        const s = line[which === 'from' ? 0 : line.length - 1], o = [which === 'from' ? -1 : 1, 0], u = s.A[0];
        if (roof.ridge) { if (line === all[0]) { G.wall([u, -e.half - t / 2], [u, e.half + t / 2], 0, e.wall, t, o, e.door && which === e.door.at ? [{kind, w: e.door.w, sill: 0, spring: e.door.spring, glass: false, margin: 0}] : [], G.phase, lower); G.gable([u, -e.half - t / 2], [u, e.half + t / 2], e.wall, roof.ridge, t, o, G.phase, lower); } }
        else if (roof.top) {
          const side = s.n[1], d0 = roof.inner, d1 = e.half + t / 2;
          G.wall([u, side * d0], [u, side * d1], 0, e.wall, t, o, [], G.phase, lower);
          for (let y = e.wall; y < roof.top - .1; y += .8) { const f = (y + .4 - e.wall) / (roof.top - e.wall), dd = d1 - (d1 - d0) * f; if (dd - d0 > .3) G.box('stone', [u, side * (d0 + dd) / 2], y + .4, [t, .76, dd - d0], [1, 0], G.tint(G.stone), G.phase, lower); }
        }
      }
      if (base) for (const [i, s] of line.entries()) {
        if ((i === 0 && base.ends?.[0] === false) || (i === line.length - 1 && base.ends?.[1] === false)) continue;
        const D = base.columns ?? 1;
        for (const dd of base.twin ? [-.55, .55] : [0]) G.column(at(s, e.half + dd * D), 0, base.spring, D, G.phase, lower, kind === 'round' ? 'romanesque' : 'gothic', .9, s.n);
      }
    }
  },

  // Buttress piers standing out from an aisle's outer wall, crowned by pinnacles, and the flying buttresses
  // that leap from them in one span over the lower roofs to the high vessel's wall, along a run's stations
  // (straight bays or an apse, as `chevetLevel`).
  //   pier     {from (its inner face, in the wall), to (its outer face), width, top, steps: [[height, set back], …]}
  //   pinnacle the pinnacle's height on the pier; `flyer` {to (the vessel's wall line), foot (its upper edge on
  //            the pier), head (its upper edge on the wall), drop, thick, phase}; `skip` stations left out
  flyingButtresses(k, e, P) {
    const G = gothicKit(k, e, P), {pier, flyer} = e, w = pier.width ?? 1.6;
    for (const line of runLines(e)) for (const [i, s] of line.entries()) {
      if ((e.skip ?? []).includes(i) || (e.ends === false && (i === 0 || i === line.length - 1))) continue;
      const setAt = y => (pier.steps ?? []).filter(([yy]) => y > yy).reduce((m, [, d]) => Math.max(m, d), 0);
      if (G.mesh) {
        // Each setback is one run of ashlar from the wall out to its face.
        const marks = [0, ...(pier.steps ?? []).map(([yy]) => yy).filter(yy => yy > 0 && yy < pier.top), pier.top];
        for (let q = 0; q < marks.length - 1; q++) G.mesh.pier(at, s, pier.from, pier.to - setAt((marks[q] + marks[q + 1]) / 2), w, marks[q], marks[q + 1], G.phase);
      } else for (let y = 0; y < pier.top - .05;) {
        const h = Math.min(1.1, pier.top - y), d1 = pier.to - setAt(y + h / 2);
        G.box('stone', at(s, (pier.from + d1) / 2), y + h / 2, [d1 - pier.from, h * .96, w], s.n, G.tint(G.stone), G.phase);
        y += h;
      }
      const outer = pier.to - setAt(pier.top - .1);
      if (e.pinnacle) G.pinnacle(at(s, outer - w / 2), pier.top, e.pinnacle, w * .9, G.phase);
      if (flyer) {
        const ph = flyer.phase ? P(flyer.phase) : G.phase, dA = Math.min(outer - w / 2, pier.from + 1), dB = flyer.to, m = 10, drop = flyer.drop ?? 3;
        const top = f => flyer.foot + (flyer.head - flyer.foot) * f + .3, low = f => flyer.foot - drop + (flyer.head - 1.6 - flyer.foot + drop) * Math.sin(f * Math.PI / 2);
        if (G.mesh) G.mesh.flyer(at, s, dA, dB, top, f => Math.min(low(f), top(f) - .6), flyer.thick ?? .8, ph);
        else for (let j = 0; j < m; j++) {
          const f = (j + .5) / m, yt = top(f), yb = low(f);
          G.box('stone', at(s, dA + (dB - dA) * f), (yt + yb) / 2, [Math.abs(dB - dA) / m * 1.04, Math.max(.6, yt - yb), flyer.thick ?? .8], s.n, G.tint(G.stone), ph);
        }
        const pa = at(s, dA), pb = at(s, dB);
        G.beam('stone', [pa[0], top(0) + .25, pa[1]], [pb[0], top(1) + .25, pb[1]], .45, G.tint(G.stone), ph);
      }
    }
  },

  // A Norman Gothic tower with a stone spire. A square shaft (`size` [along u, along v]) faced with tall blind
  // lancets in registers between clasping corner buttresses turns octagonal at `shaft.top`: the belfry, a
  // twin opening on every face; open turrets (fillettes) stand on three corners and a stair turret ringed by
  // three smaller fillettes on the fourth (`stair.corner` [±1, ±1], the corner turned away from the church);
  // a gabled niche (lucarne) opens at the foot of the spire on each of the four free faces; the octagonal
  // spire is laid in courses dressed with pointed scales, crowned by a stone bouquet and an iron cross.
  //   shaft    {top, registers: [heights of the arcades' heads], arches (lancets per face), buttress (width)}
  //   belfry   {top, r (apothem), openings {width, sill, spring}}; fillettes {r, top, tip}
  //   stair    {corner, r, from, top, tip, small {r, top, tip}}; lucarnes {width, height}; spire {top, cross}
  //   portal   {face: [±1, 0] or [0, ±1], w, spring}: a doorway in the foot of one face
  //   bands    [{to, phase}]: phases by height; `inner`: the faces against the church ([du, dv] …) left plain
  spiredTower(k, e, P) {
    const G = gothicKit(k, e, P), [lu, lv] = e.size, hu = lu / 2, hv = lv / 2, S = e.shaft, B = e.belfry, t = e.thick ?? 1.8;
    const ph = y => P((e.bands ?? []).find(b => y < b.to)?.phase ?? e.phase), bw = S.buttress ?? 2.2;
    const faces = [[[-hu, -hv], [-hu, hv], [-1, 0]], [[hu, -hv], [hu, hv], [1, 0]], [[-hu, -hv], [hu, -hv], [0, -1]], [[-hu, hv], [hu, hv], [0, 1]]];
    const plain = o => (e.inner ?? []).some(([a, b]) => a === o[0] && b === o[1]);
    // The square shaft: four walls, the portal in one; the blind lancets on the free faces, register by register.
    for (const [a, b, o] of faces) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), dir = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      // Portals: on the face `face`, centred on the tower's axis or `at` metres along the face from its middle.
      const P0 = [e.portal ?? []].flat().find(q => q.face[0] === o[0] && q.face[1] === o[1]), ax0 = e.axis ?? [0, 0];
      const ps = P0 ? len / 2 + (P0.at ?? ax0[0] * dir[0] + ax0[1] * dir[1]) : 0, pw = P0?.window;
      const portal = P0 ? [{kind: 'rect', s: ps, w: P0.doorWidth ?? P0.w * .55, sill: 0, spring: P0.door ?? 3, door: '#4a3b2f', margin: 0}, ...(pw ? [{kind: 'pointed', twin: true, s: ps, w: pw.w, sill: pw.sill, spring: pw.spring, margin: 0}] : [])] : [];
      const regs = [0, ...S.registers], skin = .45, n0 = S.arches ?? 3, inner0 = len - 2 * bw, aw0 = inner0 / n0;
      const shiftIn = (p, d) => [p[0] - o[0] * d, p[1] - o[1] * d], shiftOut = (p, d) => [p[0] + o[0] * d, p[1] + o[1] * d];
      for (let r = 0; r < regs.length - 1; r++) {
        // On a free face each register is an inner wall and a skin cut by the tall blind lancets (recessed).
        const y0 = regs[r], y1 = regs[r + 1], low = r === 0 && portal.length ? P0.spring + (P0.rise ?? 2) + 1.5 : y0 + .4, spring = y1 - aw0 * .9 - .4;
        if (plain(o) || spring - low < 1.5) { G.wall(a, b, y0, y1, t, o, r === 0 ? portal : [], ph(y0)); continue; }
        G.wall(shiftIn(a, skin / 2), shiftIn(b, skin / 2), y0, y1, t - skin, o, r === 0 ? portal : [], ph(y0));
        const blind = Array.from({length: n0}, (_, j) => ({kind: 'pointed', s: bw + aw0 * (j + .5), w: aw0 - .55, sill: low, spring, glass: false, margin: 0}));
        G.wall(shiftOut(a, (t - skin) / 2), shiftOut(b, (t - skin) / 2), y0, y1, skin, o, [...(r === 0 ? portal : []), ...blind], ph(y0));
      }
      if (S.top > regs.at(-1)) G.wall(a, b, regs.at(-1), S.top, t, o, [], ph(regs.at(-1)));
      if (portal.length) {
        // The portal's archivolts framing the door and the window above it, stepping out from the wall.
        const F = (s, y, off) => [a[0] + dir[0] * s + o[0] * off, y, a[1] + dir[1] * s + o[1] * off];
        for (let i = 0; i < 3; i++) G.arch(F, ps, P0.w + i * .55, P0.spring, t / 2 + .1 + i * .02, .42, ph(0), {}, 'pointed', 5, P0.rise ? P0.rise + i * .3 : undefined);
        for (const side of [-1, 1]) G.beam('stone', F(ps + side * (P0.w / 2 + .2), 0, t / 2 + .15), F(ps + side * (P0.w / 2 + .2), P0.spring, t / 2 + .15), .45, G.tint(G.stone), ph(0));
      }
      if (e.balcony && e.balcony.face[0] === o[0] && e.balcony.face[1] === o[1]) {
        G.rail([a[0] + o[0] * .8, a[1] + o[1] * .8], [b[0] + o[0] * .8, b[1] + o[1] * .8], e.balcony.y, ph(e.balcony.y));
        G.box('stone', [(a[0] + b[0]) / 2 + o[0] * .5, (a[1] + b[1]) / 2 + o[1] * .5], e.balcony.y - .2, [len, .4, 1.2], dir, G.tint(G.stone), ph(e.balcony.y));
      }
      if (plain(o)) continue;
      const n = S.arches ?? 3, inner = len - 2 * bw, F = (s, y, off) => [a[0] + dir[0] * s + o[0] * off, y, a[1] + dir[1] * s + o[1] * off];
      for (let r = 0; r < regs.length - 1; r++) {
        const y0 = regs[r] + (r === 0 && portal.length ? P0.spring + (P0.rise ?? 2) + 1.5 : .4), y1 = regs[r + 1], aw = inner / n, spring = y1 - aw * .9 - .4;
        if (spring - y0 < 1.5) continue;
        for (let j = 0; j <= n; j++) { const s = bw + aw * j, p0 = F(s, y0, t / 2 + .1), p1 = F(s, spring, t / 2 + .1); G.beam('stone', p0, p1, .22, G.tint(G.stone), ph(y0)); }
        if (G.mesh) G.mesh.string(a, b, y1 - .1, t, o, ph(y1));
        else G.beam('stone', F(0, y1 + .1, t / 2 + .2), F(len, y1 + .1, t / 2 + .2), .35, G.tint(G.stone), ph(y1));
      }
    }
    // Clasping buttresses at the corners, setting back as they rise, up to the foot of the belfry.
    for (const [su, sv] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      for (let y = 0; y < S.top - .05;) {
        const h = Math.min(1.1, S.top - y), k2 = S.registers.filter(rr => rr <= y + .01).length, s = bw * (1.25 - .14 * k2);
        // Each buttress is an L of two strips, one along each face, standing out from the corner.
        G.box('stone', [su * (hu + s * .12), sv * (hv - s * .3)], y + h / 2, [s * .9, h * .96, s * 1.1], [1, 0], G.tint(G.stone), ph(y));
        G.box('stone', [su * (hu - s * .3), sv * (hv + s * .12)], y + h / 2, [s * 1.1, h * .96, s * .9], [1, 0], G.tint(G.stone), ph(y));
        y += h;
      }
      for (const yy of S.registers) G.box('stone', [su * (hu + bw * .2), sv * (hv + bw * .2)], yy + .3, [bw * 1.3, .6, bw * 1.3], [1, 0], G.tint(G.stone), ph(yy));
    }
    // A cornice where the shaft ends.
    for (const [a, b, o] of faces) G.rail([a[0] + o[0] * .4, a[1] + o[1] * .4], [b[0] + o[0] * .4, b[1] + o[1] * .4], S.top, ph(S.top));
    // The octagonal belfry: eight walls with a twin opening each, colonnettes on its angles.
    const ax = e.axis ?? [0, 0], oct = polygon(8, B.r, ax), oo = B.openings ?? {width: 2.4, sill: S.top + 2, spring: B.top - 4};
    for (let i = 0; i < 8; i++) {
      const a = oct[(i + 7) % 8], b = oct[i], m = [(a[0] + b[0]) / 2 - ax[0], (a[1] + b[1]) / 2 - ax[1]], l = Math.hypot(...m), o = [m[0] / l, m[1] / l];
      G.wall(a, b, S.top, B.top, 1.3, o, [{kind: 'pointed', twin: true, w: oo.width, sill: oo.sill, spring: oo.spring, louvres: '#57534d', margin: .6}], ph(S.top));
      const q = [ax[0] + (b[0] - ax[0]) * 1.02, ax[1] + (b[1] - ax[1]) * 1.02];
      G.beam('stone', [q[0], S.top, q[1]], [q[0], B.top, q[1]], .4, G.tint(G.stone), ph(S.top));
    }
    // Fillettes on three corners; the stair turret with its three small fillettes on the fourth.
    const st = e.stair, f = e.fillettes, ins = f.inset ?? 1.1;
    for (const [su, sv] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const c = [su * (hu - ins), sv * (hv - ins)];
      if (st && st.corner[0] === su && st.corner[1] === sv) {
        const sc = [su * (hu - st.r * .6), sv * (hv - st.r * .6)];
        shaft(G, k, sc, st.from ?? S.top, st.top, 2 * st.r, ph(st.from ?? S.top));
        spirelet(G, k, sc, st.top + .3, st.tip, 2 * st.r * .9, ph(st.top));
        k.turned('octagon', 'stone', G.V(sc[0], st.top + .15, sc[1]).toArray(), [2 * st.r * 1.15, .3], 0, G.tint(G.stone), ph(st.top), st.top);
        const sm = st.small;
        if (sm) for (const [du, dv] of [[-su, 0], [0, -sv], [su * .7, sv * .7]]) {
          const cc = [sc[0] + du * (st.r + sm.r * .7), sc[1] + dv * (st.r + sm.r * .7)];
          fillette(G, k, cc, st.top - (sm.below ?? 6), sm.top, sm.tip, sm.r, ph(st.top));
        }
      } else fillette(G, k, c, S.top, f.top, f.tip, f.r, ph(S.top));
    }
    // The belfry's cornice, then the spire: eight faces in courses dressed with pointed scales, rolls on its arrises.
    const ring8 = polygon(8, B.r * 1.04 + .1, ax);
    for (let i = 0; i < 8; i++) { const a = ring8[(i + 7) % 8], b = ring8[i]; G.beam('stone', [a[0], B.top + .2, a[1]], [b[0], B.top + .2, b[1]], .5, G.tint(G.stone), ph(B.top)); }
    const sp = e.spire, y0 = B.top + .4, H = sp.top - y0, r0 = B.r - .25, rows = Math.max(8, Math.round(H / .85));
    const corner = (i, rr, y) => { const c = polygon(8, rr, ax)[i]; return G.V(c[0], y, c[1]); };
    // A continuous spire, its faces covered in rows of scales; the phase follows the height (`bands`).
    if (G.mesh) {
      const edges = [y0, ...(e.bands ?? []).map(b => b.to).filter(y => y > y0 && y < sp.top), sp.top];
      for (let b = 0; b < edges.length - 1; b++) {
        const n = Math.max(1, Math.round((edges[b + 1] - edges[b]) / 2.4)), ys = Array.from({length: n + 1}, (_, q) => edges[b] + (edges[b + 1] - edges[b]) * q / n);
        G.mesh.loft(ax, ys, y => (r0 * (1 - (y - y0) / H) + .12) / Math.cos(Math.PI / 8), ph(edges[b]), {}, {sides: 8, turn: 0, course: -.85, step: 2.4});
      }
    }
    for (let j = 0; j < rows; j++) {
      const ya = y0 + H * j / rows, yb = y0 + H * (j + 1) / rows, ra = r0 * (1 - j / rows) + .12, rb = r0 * (1 - (j + 1) / rows) + .12;
      if (!G.mesh) for (let i = 0; i < 8; i++) {
        const A = corner((i + 7) % 8, ra, ya), Bq = corner(i, ra, ya), C = corner((i + 7) % 8, rb, yb), D = corner(i, rb, yb);
        // A course of scales: the face's strip split into tiles, every other course shifted by half a tile.
        const len = A.distanceTo(Bq), n = Math.max(1, Math.round(len / .9)), shift = j % 2 ? .5 : 0;
        for (let q = 0; q < n + (shift ? 1 : 0); q++) {
          const f0 = Math.max(0, (q - shift) / n), f1 = Math.min(1, (q + 1 - shift) / n);
          if (f1 - f0 < .05) continue;
          G.panel(A.clone().lerp(Bq, f0), A.clone().lerp(Bq, f1), C.clone().lerp(D, f0 + .02), C.clone().lerp(D, f1 - .02), G.stone, ph(ya), {}, 'stone', 2, .02 + (q + j) % 2 * .05);
        }
      }
      if (j % 3 === 1) for (let i = 0; i < 8; i++) { const p = corner(i, ra + .15, ya); k.turned('ball', 'stone', p.toArray(), [.32, .38], 0, G.tint(G.stone), ph(ya), ya); }
    }
    for (const c of polygon(8, r0 + .12, ax)) G.beam('stone', [c[0], y0, c[1]], [ax[0], sp.top - .2, ax[1]], .3, G.tint(G.stone), ph(y0));
    // The lucarnes: a gabled niche on each free face at the spire's foot.
    const L = e.lucarnes;
    if (L) for (let i = 0; i < 8; i += 2) {
      const a = oct[(i + 7) % 8], b = oct[i], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], l = Math.hypot(m[0] - ax[0], m[1] - ax[1]), o = [(m[0] - ax[0]) / l, (m[1] - ax[1]) / l], side = [-o[1], o[0]], c = [m[0] - o[0] * .4, m[1] - o[1] * .4];
      for (const sd of [-1, 1]) shaft(G, k, [c[0] + side[0] * sd * L.width / 2, c[1] + side[1] * sd * L.width / 2], y0, y0 + L.height * .6, .45, ph(y0), {}, 'drum', L.height * .6);
      G.arch((s, y, off) => [c[0] + side[0] * (s - L.width / 2) + o[0] * off, y, c[1] + side[1] * (s - L.width / 2) + o[1] * off], L.width / 2, L.width, y0 + L.height * .6, 0, .3, ph(y0), {}, 'pointed', 3);
      G.gable([c[0] - side[0] * (L.width / 2 + .4), c[1] - side[1] * (L.width / 2 + .4)], [c[0] + side[0] * (L.width / 2 + .4), c[1] + side[1] * (L.width / 2 + .4)], y0 + L.height * .6, y0 + L.height, .5, o, ph(y0));
      G.box('stone', [c[0] - o[0] * .6, c[1] - o[1] * .6], y0 + L.height * .5, [L.width * .9, L.height, 1.2], side, G.tint(G.stone), ph(y0));
    }
    // The bouquet and the iron cross.
    const top = G.V(ax[0], 0, ax[1]);
    k.turned('flare', 'stone', [top.x, sp.top + .3, top.z], [1.1, .8], 0, G.tint(G.stone), ph(sp.top), sp.top);
    k.turned('ball', 'stone', [top.x, sp.top + .9, top.z], [.8, .7], 0, G.tint(G.stone), ph(sp.top), sp.top);
    if (sp.cross) {
      G.box('metal', ax, (sp.top + 1.2 + sp.cross) / 2, [.14, sp.cross - sp.top - 1.2, .14], [1, 0], G.tint('#3b3b3b', .05), ph(sp.top));
      G.box('metal', ax, sp.cross - .7, [1.1, .12, .12], [1, 0], G.tint('#3b3b3b', .05), ph(sp.top));
    }
  },

  // The middle of a Norman harmonic front, between its towers, facing -u from the front line (u = 0): a deep
  // portal with a trumeau and archivolts on colonnettes, a terrace with its balustrade, the great window of the
  // nave (lancets under a rose of `rose.spokes` branches) between two pinnacled buttresses, then an open gallery
  // of twin arcades under gablets pierced with roses, a balustrade on top, and the nave's gable behind.
  //   width, thick, portal {w, spring, rise, archivolts, relief}, terrace (height), window {w, sill, spring,
  //   rise, lights, rose}, gallery {from, to, count, depth}, clochetons {top, pinnacle}, gable {at, half, eave, ridge}
  westCentre(k, e, P) {
    const G = gothicKit(k, e, P), hw = e.width / 2, t = e.thick ?? 2.4, out = [-1, 0], W = e.window, Gl = e.gallery, p = e.portal;
    const ph = y => P((e.bands ?? []).find(b => y < b.to)?.phase ?? e.phase), F = (s, y, off) => [t / 2 - off, y, s];
    const holes = [{kind: 'pointed', s: hw, w: p.w, sill: 0, spring: p.spring, rise: p.rise, glass: false, margin: 0}];
    G.wall([t / 2, -hw], [t / 2, hw], 0, e.terrace, t, out, holes, ph(0));
    // With `window.relief` its tracery is a photo relief: the opening keeps only its glass, set back.
    G.wall([t / 2, -hw], [t / 2, hw], e.terrace, Gl.to, t, out, [{kind: 'pointed', s: hw, w: W.w, sill: W.sill, spring: W.spring, rise: W.rise, glass: true, photo: W.relief, margin: 0}], ph(e.terrace));
    // The portal: archivolts stepping in on colonnettes, the trumeau and two doors, the tympanum above.
    const n = p.archivolts ?? 5, dp = p.depth ?? t;
    // With `portal.relief` the carving is a photo relief folded into the splay (its `recess`): the brick keeps
    // the opening, the back wall with its doors (`inner` width, `doors` height) and a plain socle below `foot`.
    if (p.relief) {
      const D = p.depth ?? 2, iw = p.inner ?? p.w * .5, foot = p.foot ?? .3;
      G.wall([D + .3, -p.w / 2], [D + .3, p.w / 2], 0, p.spring + (p.rise ?? p.w * .866), .6, out, [-1, 1].map(side => ({kind: 'rect', s: p.w / 2 + side * iw / 4, w: iw * .46, sill: 0, spring: p.doors ?? 3.6, door: p.doorColor ?? '#5e2b27', margin: 0})), ph(0));
      for (const side of [-1, 1]) G.wall([.2, side * (p.w / 2 - .2)], [D, side * iw / 2], 0, foot, .45, out, [], ph(0));
    }
    if (!p.relief) for (let i = 0; i < n; i++) {
      const u = -.3 + i * (dp - .3) / n, w = p.w - i * .42;
      G.arch((s, y, off) => [u, y, s], 0, w, p.spring, 0, .5, ph(0), {}, 'pointed', 6, p.rise ? p.rise * w / p.w : undefined);
      for (const side of [-1, 1]) G.column([u, side * (w / 2 - .1)], 0, p.spring, .3, ph(0));
    }
    // A photo relief preserves the sculpted tympanum and tracery, but its principal archivolts and
    // colonnettes must still have real depth: silhouettes are not enough when the visitor comes close.
    // These four visible orders sit just forward of the relief, with distinct shafts, capitals and arches.
    if (p.relief) for (let i = 0; i < (p.orders ?? 4); i++) {
      const u = .08 + i * .23, w = p.w - i * .38, rise = p.rise ? p.rise * w / p.w : undefined;
      G.arch((s, y, off) => [u + off, y, s], 0, w, p.spring, .05, .26, ph(0), {}, 'pointed', 8, rise);
      for (const side of [-1, 1]) G.column([u, side * (w / 2 - .1)], 0, p.spring, .24 + i * .015, ph(0), {}, 'gothic', 0, [0, side]);
    }
    const inner = p.w - n * .42, lintel = p.lintel ?? p.spring * .62;
    if (!p.relief) {
      G.wall([dp, -inner / 2], [dp, inner / 2], 0, p.spring + (p.rise ?? inner * .87), .6, out, [-1, 1].map(side => ({kind: 'rect', s: inner / 2 + side * inner * .24, w: inner * .4, sill: 0, spring: lintel, door: '#4a3b2f', margin: 0})), ph(0));
      if (p.trumeau !== false) G.column([dp - .4, 0], 0, lintel, .5, ph(0));
      G.box('stone', [dp - .4, 0], lintel + .3, [.6, .6, inner], [1, 0], G.tint(G.stone), ph(0));
    }
    // The terrace over the portal and its balustrade; the window's lights and its rose.
    G.rail([-.5, -hw], [-.5, hw], e.terrace, ph(e.terrace));
    G.box('stone', [-.2, 0], e.terrace - .2, [1.4, .4, 2 * hw], [1, 0], G.tint(G.stone), ph(e.terrace));
    const lights = W.relief ? 0 : W.lights ?? 4, lw = W.w / Math.max(1, lights), spring = W.spring;
    for (let i = 1; i < lights; i++) G.beam('stone', F(-W.w / 2 + i * lw, W.sill, 0), F(-W.w / 2 + i * lw, spring + (i === lights / 2 ? W.w * .25 : .2), 0), i === lights / 2 ? .34 : .24, G.tint(G.stone), ph(W.sill));
    for (let i = 0; i < lights; i += 2) G.arch(F, -W.w / 2 + (i + 1) * lw, 2 * lw - .1, spring, 0, .28, ph(spring), {}, 'pointed', 3);
    for (let i = 0; i < lights; i++) G.arch(F, -W.w / 2 + (i + .5) * lw, lw - .08, spring, 0, .18, ph(spring), {}, 'pointed', 2);
    if (W.rose && !W.relief) {
      const ry = W.roseY ?? spring + W.w * .52, rr = W.rose;
      G.ring(F, 0, ry, rr, 0, .3, 18, ph(ry));
      G.ring(F, 0, ry, rr * .3, 0, .22, 10, ph(ry));
      for (let i = 0; i < (W.spokes ?? 6); i++) { const a = i / (W.spokes ?? 6) * Math.PI * 2; G.beam('stone', F(Math.cos(a) * rr * .3, ry + Math.sin(a) * rr * .3, 0), F(Math.cos(a) * rr, ry + Math.sin(a) * rr, 0), .2, G.tint(G.stone), ph(ry)); }
    }
    // Pinnacled buttresses either side of the window.
    const cl = e.clochetons;
    if (cl) for (const side of [-1, 1]) {
      const v = side * (hw - (cl.inset ?? .9));
      for (let y = e.terrace; y < cl.top - .05; y += 1.1) G.box('stone', [-.5, v], y + .55, [1.3, 1.06, 1.3], [1, 0], G.tint(G.stone), ph(y));
      G.pinnacle([-.5, v], cl.top, cl.pinnacle ?? 4, 1.1, ph(cl.top));
    }
    // The gallery of roses: twin arcades on colonnettes before the wall, each under a gablet pierced with a rose,
    // and a balustrade on top.
    const c = Gl.count ?? 6, aw = (2 * hw - 1) / c, gy = Gl.from, gt = Gl.to, gu = -(Gl.depth ?? .9), spr = gy + (gt - gy) * .42;
    G.box('stone', [gu + .3, 0], gy - .2, [1.6, .4, 2 * hw], [1, 0], G.tint(G.stone), ph(gy));
    G.rail([gu - .3, -hw], [gu - .3, hw], gy, ph(gy));
    // With `gallery.relief` the arcades are a photo relief in the gallery's front plane: only ledges and rails stay.
    for (let i = 0; i < (Gl.relief ? 0 : c); i++) {
      const s = -hw + .5 + aw * (i + .5), Fg = (ss, y, off) => [gu, y, ss];
      for (const dv of [-.5, 0, .5]) G.column([gu, s + dv * (aw - .3)], gy + .9, spr - gy - .9, dv ? .26 : .2, ph(gy));
      G.arch(Fg, s, aw - .3, spr, 0, .26, ph(spr), {}, 'pointed', 3);
      for (const dv of [-.25, .25]) G.arch(Fg, s + dv * (aw - .3), (aw - .3) / 2 - .05, spr, 0, .18, ph(spr), {}, 'pointed', 2);
      G.ring(Fg, s, spr + (aw - .3) * .55, (aw - .3) * .22, 0, .16, 10, ph(spr));
      // The gablet over the arcade, its rose and its finial.
      const apex = gt - .6, foot = spr + (aw - .3) * .3;
      G.beam('stone', Fg(s - aw / 2 + .1, foot, 0), Fg(s, apex, 0), .28, G.tint(G.stone), ph(foot));
      G.beam('stone', Fg(s + aw / 2 - .1, foot, 0), Fg(s, apex, 0), .28, G.tint(G.stone), ph(foot));
      G.ring(Fg, s, (foot + apex) / 2 + .6, (aw - .3) * .17, 0, .14, 10, ph(foot));
      G.box('stone', [gu, s], apex + .45, [.3, .9, .3], [1, 0], G.tint(G.stone), ph(apex));
    }
    G.rail([gu - .1, -hw], [gu - .1, hw], gt, ph(gt));
    G.box('stone', [gu + .5, 0], gt - .15, [2, .3, 2 * hw], [1, 0], G.tint(G.stone), ph(gt));
    // The nave's gable behind the gallery.
    const g = e.gable;
    if (g) {
      if (g.eave > gt) G.wall([g.at, -g.half], [g.at, g.half], gt, g.eave, 1.1, out, [], ph(gt));
      G.gable([g.at, -g.half], [g.at, g.half], g.eave, g.ridge, 1, out, ph(g.eave));
    }
  },

  // A lantern tower over a crossing: four great arches on the crossing piers carry square walls that turn
  // octagonal on pendentives; the octagon rises above the roofs, a gallery of twin openings and a tier of
  // lancets lighting the crossing below its rib vault (`vault`: {spring, crown, ribs}, a ring left open at the
  // crown), then a closed upper storey with tall twin openings, colonnettes on its angles, a pierced parapet and a
  // low roof; four stair turrets with stone cones stand at the corners of the square.
  //   half (the square's half side, outside), arches {spring, rise, piers (diameter)}, square (top of the square
  //   walls), octagon {r (apothem), top, lower {sill, spring, width}, upper {sill, spring, width}}, parapet,
  //   roof {top, color, until, rebuild}, turrets {r, from, top, tip, at (distance of their axes from the centre lines)}
  lanternTower(k, e, P) {
    const G = gothicKit(k, e, P), X = vaultKit(G), h = e.half, t = e.thick ?? 1.6, A = e.arches, O = e.octagon, roof = e.roof ?? {};
    const ph = y => P((e.bands ?? []).find(b => y < b.to)?.phase ?? e.phase);
    const sides = [[[-h, -h], [-h, h], [-1, 0]], [[h, -h], [h, h], [1, 0]], [[-h, -h], [h, -h], [0, -1]], [[-h, h], [h, h], [0, 1]]];
    for (const [a, b, o] of sides) {
      G.wall([a[0] - o[0] * t / 2, a[1] - o[1] * t / 2], [b[0] - o[0] * t / 2, b[1] - o[1] * t / 2], 0, e.square, t, o, [{kind: 'pointed', w: 2 * h - (A.piers ?? 3) - t, sill: 0, spring: A.spring, rise: A.rise, glass: false, margin: 0}], ph(0));
    }
    // The crossing piers: clusters of shafts at the four inner corners.
    for (const [su, sv] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const c = [su * (h - t - (A.piers ?? 3) * .3), sv * (h - t - (A.piers ?? 3) * .3)];
      G.column(c, 0, A.spring, (A.piers ?? 3) * .7, ph(0), {}, 'gothic', 1.1, [-su, -sv]);
      for (const [du, dv] of [[-su, 0], [0, -sv]]) G.column([c[0] + du * (A.piers ?? 3) * .42, c[1] + dv * (A.piers ?? 3) * .42], 0, A.spring, .55, ph(0), {}, 'gothic', 0, [du, dv]);
      // The pendentive: courses corbelling out across the corner, from the arches' crown to the octagon.
      const p0 = A.spring + (A.rise ?? 6), steps = Math.max(2, Math.round((e.square - p0) / 1.1));
      for (let j = 0; j < steps; j++) {
        const f = (j + 1) / steps, d = (h - t) * .3 * f + .4, cc = [su * (h - t - d * .5), sv * (h - t - d * .5)];
        G.box('stone', cc, p0 + (e.square - p0) * (j + .5) / steps, [d * 1.4, (e.square - p0) / steps * .96, .9], [su, -sv], G.tint(G.stone), ph(p0));
      }
    }
    // The octagon: lower tier of twin openings and lancets (lighting the crossing), the upper storey above the vault.
    const oct = polygon(8, O.r), lo = O.lower, up = O.upper;
    for (let i = 0; i < 8; i++) {
      const a = oct[(i + 7) % 8], b = oct[i], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], l = Math.hypot(...m), o = [m[0] / l, m[1] / l];
      const holes = [{kind: 'pointed', twin: true, oculus: false, w: lo.width, sill: lo.sill, spring: lo.spring, margin: .5}, {kind: 'pointed', twin: true, w: up.width, sill: up.sill, spring: up.spring, louvres: up.louvres ?? '#5a5650', margin: .5}];
      G.wall(a, b, e.square, O.top, 1.4, o, holes, ph(e.square));
      // Engaged colonnettes either side of the openings, up the whole storey, as the photographs show.
      if (G.mesh) {
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]), tan = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], ys = []; for (let y = e.square; y < O.top - .1; y += 2.9) ys.push(y); ys.push(O.top);
        for (const side of [-1, 1]) for (let q = 0; q < 3; q++) {
          const off = side * (up.width / 2 + .32 + q * .3), c = [m[0] + o[0] * .75 + tan[0] * off, m[1] + o[1] * .75 + tan[1] * off];
          G.mesh.loft(c, ys, () => .09, ph(e.square), {}, {sides: 8, smooth: true, step: 2.9});
        }
      }
      // Colonnettes running up the angles, and bands at the storeys.
      G.beam('stone', [b[0] * 1.03, e.square, b[1] * 1.03], [b[0] * 1.03, O.top, b[1] * 1.03], .45, G.tint(G.stone), ph(e.square));
      for (const y of [lo.sill - .3, up.sill - .5]) G.beam('stone', [a[0] * 1.04, y, a[1] * 1.04], [b[0] * 1.04, y, b[1] * 1.04], .35, G.tint(G.stone), ph(y));
      // The pierced parapet.
      G.rail([a[0] * 1.03, a[1] * 1.03], [b[0] * 1.03, b[1] * 1.03], O.top, ph(O.top));
      G.box('stone', [m[0] * 1.02, m[1] * 1.02], O.top + .2, [.6, .4, Math.hypot(b[0] - a[0], b[1] - a[1])], o, G.tint(G.stone), ph(O.top));
    }
    // Inside: the vault of sixteen ribs, open in a ring at the crown, and the floor of the closed storey above.
    const V = e.vault;
    if (V) {
      const n = V.ribs ?? 16, ri = O.r - .8, ring = V.ring ?? 1.2, wp = [];
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2, pts = [];
        for (let j = 0; j <= 6; j++) { const th = j / 6 * Math.PI / 2, r = ring + (ri - ring) * Math.cos(th); pts.push([Math.cos(a) * r, V.spring + (V.crown - V.spring) * Math.sin(th), Math.sin(a) * r]); }
        wp.push(pts.reverse());
        X.chain(pts, .38, ph(V.spring), {});
      }
      for (let i = 0; i < n; i++) for (let j = 0; j < 6; j++) { const A0 = wp[i][j], A1 = wp[(i + 1) % n][j], B0 = wp[i][j + 1], B1 = wp[(i + 1) % n][j + 1]; G.panel(G.V(A0[0], A0[1], A0[2]), G.V(A1[0], A1[1], A1[2]), G.V(B0[0], B0[1], B0[2]), G.V(B1[0], B1[1], B1[2]), V.color ?? G.stone, ph(V.spring), {order: 2e4 + A0[1]}, 'stone', 1.6, 0); }
      for (let i = 0; i < 8; i++) { const a = oct[(i + 7) % 8], b = oct[i]; G.box('wood', [(a[0] + b[0]) / 4, (a[1] + b[1]) / 4], V.crown + 1.2, [O.r * .9, .25, Math.hypot(b[0] - a[0], b[1] - a[1]) * .55], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], G.tint('#6b4f35'), ph(V.crown)); }
    }
    // The low roof inside the parapet, burnt and remade if asked.
    G.life(roof, (p, extra) => {
      for (let i = 0; i < 8; i++) {
        const a = polygon(8, O.r - .5)[(i + 7) % 8], b = polygon(8, O.r - .5)[i];
        G.panel(G.V(a[0], O.top + .3, a[1]), G.V(b[0], O.top + .3, b[1]), G.V(0, roof.top, 0), G.V(0, roof.top, 0), roof.color ?? SLATE, p, extra, 'slate', 1, .1);
      }
      G.box('metal', [0, 0], roof.top + .9, [.12, 1.8, .12], [1, 0], G.tint('#3b3b3b', .05), p, extra);
      G.box('metal', [0, 0], roof.top + 1.3, [.8, .1, .1], [1, 0], G.tint('#3b3b3b', .05), p, extra);
    });
    // The four stair turrets at the corners of the square, with their stone cones.
    const tu = e.turrets;
    if (tu) for (const [su, sv] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const c = [su * (tu.at ?? h - tu.r * .55), sv * (tu.at ?? h - tu.r * .55)];
      shaft(G, k, c, tu.from, tu.top, 2 * tu.r, ph(tu.from));
      for (let i = 0; i < 8; i++) { const a = (i + .5) / 8 * Math.PI * 2, q = [c[0] + Math.cos(a) * tu.r * 1.04, c[1] + Math.sin(a) * tu.r * 1.04]; G.beam('stone', [q[0], tu.from, q[1]], [q[0], tu.top, q[1]], .22, G.tint(G.stone), ph(tu.from)); }
      k.turned('octagon', 'stone', G.V(c[0], tu.top + .2, c[1]).toArray(), [2 * tu.r * 1.18, .4], 0, G.tint(G.stone), ph(tu.top), tu.top);
      spirelet(G, k, c, tu.top + .4, tu.tip, 2 * tu.r * .95, ph(tu.top));
      G.box('metal', c, tu.tip + .8, [.1, 1.4, .1], [1, 0], G.tint('#3b3b3b', .05), ph(tu.top));
    }
  },

  // The end of a Norman transept arm, facing -u from the front line (u = 0): tall lancets side by side (their
  // sill raised where an annex stands before them), a gable with blind lancets rising to its apex, and two
  // turrets (a pier, a drum of colonnettes and blind arches, a scaled cone).
  //   width, thick, eave, apex, windows {count, width, sill, spring}, gable {count},
  //   turrets {width (the drum), ledge (the top of the pier), top (the drum's cornice), tip, pier, offset (of the axis beyond the front's end, in drum widths), depth (of the axis behind the front face)}
  transeptFront(k, e, P) {
    const G = gothicKit(k, e, P), hw = e.width / 2, t = e.thick ?? 1.8, out = [-1, 0], W = e.windows, n = W.count ?? 3, step = (2 * hw - 2) / n;
    G.wall([t / 2, -hw], [t / 2, hw], 0, e.eave, t, out, Array.from({length: n}, (_, i) => ({kind: 'pointed', s: 1 + step * (i + .5), w: W.width ?? step - 1, sill: W.sill, spring: W.spring + (i === (n - 1) / 2 ? W.middle ?? 0 : 0), twin: W.twin ?? false, margin: 0})), G.phase);
    if (G.mesh) G.mesh.string([t / 2, -hw], [t / 2, hw], e.eave - .55, t, out, G.phase);
    G.rail([-.3, -hw], [-.3, hw], e.eave, G.phase);
    G.gable([t / 2, -hw], [t / 2, hw], e.eave, e.apex, t * .8, out, G.phase);
    // Blind lancets in the gable, stepping up towards the apex.
    const g = e.gable?.count ?? 7, gw = (2 * hw - 3) / g;
    for (let i = 0; i < g; i++) {
      const s = -hw + 1.5 + gw * (i + .5), top = e.apex - (e.apex - e.eave) * Math.abs(s) / hw - 1.6, spring = top - gw * .87;
      if (spring - e.eave < .8) continue;
      const F = (ss, y, off) => [-.15 - off, y, ss];
      G.beam('stone', F(s - gw / 2 + .1, e.eave + .6, 0), F(s - gw / 2 + .1, spring, 0), .24, G.tint(G.stone), G.phase);
      G.beam('stone', F(s + gw / 2 - .1, e.eave + .6, 0), F(s + gw / 2 - .1, spring, 0), .24, G.tint(G.stone), G.phase);
      G.arch(F, s, gw - .2, spring, 0, .24, G.phase, {}, 'pointed', 3);
    }
    const tw = e.turrets;
    if (tw) for (const side of [-1, 1]) normanTurret(G, k, [tw.depth ?? 1.1, side * (hw + tw.width * (tw.offset ?? .3))], tw, G.phase);
  },

  // A square Norman turret with a stone cone: a shaft laid course by course with a blind arcade on each face and
  // slits for its stair, a corbelled cornice, and an octagonal stone spire; `at` [u, v], `y0`, `top`, `tip`, `size`.
  turret(k, e, P) {
    const G = gothicKit(k, e, P), c = e.at ?? [0, 0], s = e.size ?? 2.4, y0 = e.y0 ?? 0;
    for (let y = y0; y < e.top - .05;) { const h = Math.min(1, e.top - y); G.box('stone', c, y + h / 2, [s, h * .96, s], [1, 0], G.tint(G.stone), G.phase); y += h; }
    for (const o of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const F = (ss, y, off) => [c[0] + o[0] * (s / 2 + off) - o[1] * ss, y, c[1] + o[1] * (s / 2 + off) + o[0] * ss];
      const spring = e.top - s * .8;
      for (const ss of [-s / 2 + .2, s / 2 - .2]) G.beam('stone', F(ss, Math.max(y0, e.top - (e.arcade ?? 6)), .08), F(ss, spring, .08), .2, G.tint(G.stone), G.phase);
      G.arch(F, 0, s - .4, spring, .08, .2, G.phase, {}, 'pointed', 3);
    }
    G.box('stone', c, e.top + .2, [s * 1.18, .4, s * 1.18], [1, 0], G.tint(G.stone), G.phase);
    spirelet(G, k, c, e.top + .4, e.tip, s * 1.05, G.phase);
  },

  // A lateral porch before a tower or an aisle, facing -u from its front (u = 0) and `depth` deep: a wide
  // pointed doorway, side walls opening in `bays` arches, a gallery (balustrade) over the doorway, niches either
  // side, and a slate roof along its depth (or a flat terrace, `roof: false`).
  //   width, depth, eave, apex, opening {w, spring, rise}, bays, niches
  porch(k, e, P) {
    const G = gothicKit(k, e, P), hw = e.width / 2, d = e.depth, o = e.opening, t = e.thick ?? 1, out = [-1, 0];
    G.wall([t / 2, -hw], [t / 2, hw], 0, e.eave, t, out, [{kind: 'pointed', w: o.w, sill: 0, spring: o.spring, rise: o.rise, glass: false, margin: 0}], G.phase);
    for (let i = 1; i < 4; i++) G.arch((s, y, off) => [i * .18 - .25 - off, y, s], 0, o.w + i * .5, o.spring, 0, .36, G.phase, {}, 'pointed', 5, o.rise ? o.rise + i * .25 : undefined);
    for (const side of [-1, 1]) {
      G.wall([0, side * hw], [d, side * hw], 0, e.eave, t, [0, side], Array.from({length: e.bays ?? 1}, (_, i) => ({kind: 'pointed', s: d / (e.bays ?? 1) * (i + .5), w: d / (e.bays ?? 1) - 1.4, sill: 1, spring: o.spring * .75, glass: false, margin: 0})), G.phase);
      if (e.niches) { const v = side * (o.w / 2 + (hw - o.w / 2) / 2); G.arch((s, y, off) => [-.1 - off, y, s], v, Math.min(1.2, hw - o.w / 2 - .4), o.spring * .8, 0, .2, G.phase, {}, 'pointed', 3); }
    }
    if (e.gallery !== false) G.rail([-.4, -hw], [-.4, hw], o.spring + (o.rise ?? o.w * .87) + .4, G.phase);
    if (e.roof !== false) {
      G.gable([t / 2, -hw], [t / 2, hw], e.eave, e.apex, t, out, G.phase);
      for (const side of [-1, 1]) G.quad([0, side * (hw + .4)], [d, side * (hw + .4)], e.eave, [0, 0], [d, 0], e.apex, e.roofColor ?? SLATE, G.phase, {}, 'slate');
    } else G.rail([-.2, -hw], [-.2, hw], e.eave, G.phase);
  },

  // Round columns standing free (a tribune's, a porch's), each with its base and the capital of its order:
  // `columns` [[u, y0, v, height, diameter], …], `order` (corinthian, gothic…), `kind` (wood, stone), `color`.
  columns(k, e, P) {
    const G = gothicKit(k, e, P);
    for (const [u, y0, v, h, d] of e.columns ?? []) { const p = G.V(u, y0, v); k.column(e.kind ?? 'stone', [p.x, y0, p.z], {height: h, diameter: d, order: e.order ?? 'gothic', drum: e.drum ?? 0, taper: e.taper ?? .08}, e.color ?? G.stone, G.phase); }
  },

  // Free-standing pinnacles on buttresses or parapets: `at` [[u, v, foot, height, width], …].
  pinnacles(k, e, P) {
    const G = gothicKit(k, e, P);
    for (const [u, v, y0, h, w] of e.at ?? []) G.pinnacle([u, v], y0, h, w, G.phase);
  },

  // A Romanesque tower in stages, square then octagonal, each stage lit by round-headed openings, under a low
  // pyramid roof: `stages` [{shape: "square" | "octagon", half (half side or apothem), top, openings {count,
  // width, sill, spring}}], roof {top, color}; `keepBelow`, `upper` {until} and `lower` {until}: what is taken down, and when.
  romanesqueTower(k, e, P) {
    const G = gothicKit(k, e, P);
    let y = e.y0 ?? 0;
    const lifeOf = yy => e.upper && yy >= (e.keepBelow ?? 0) ? {until: P(e.upper.until)} : e.lower ? {until: P(e.lower.until)} : {};
    for (const st of e.stages) {
      const pts = st.shape === 'octagon' ? polygon(8, st.half) : [[-st.half, -st.half], [st.half, -st.half], [st.half, st.half], [-st.half, st.half]];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], l = Math.hypot(...m), o = [m[0] / l, m[1] / l], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const op = st.openings, holes = op ? Array.from({length: op.count ?? 1}, (_, j) => ({kind: 'round', s: len / (op.count ?? 1) * (j + .5), w: op.width, sill: op.sill, spring: op.spring, louvres: op.louvres, glass: op.louvres ? undefined : false, margin: 0})) : [];
        G.wall(a, b, y, st.top, st.thick ?? 1.4, o, holes, G.phase, lifeOf(y));
      }
      y = st.top;
    }
    const r = e.roof;
    if (r) {
      const last = e.stages.at(-1), pts = last.shape === 'octagon' ? polygon(8, last.half + .4) : [[-last.half - .4, -last.half - .4], [last.half + .4, -last.half - .4], [last.half + .4, last.half + .4], [-last.half - .4, last.half + .4]];
      for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; G.panel(G.V(a[0], y, a[1]), G.V(b[0], y, b[1]), G.V(0, r.top, 0), G.V(0, r.top, 0), r.color ?? SLATE, G.phase, lifeOf(y), 'slate', 1.2, .1); }
    }
  },
};
