import * as T from 'three';
import {SHAPES} from '../kit/builder.js';
import {adaptive, profiledGeometry} from '../kit/geometry.js';

// ——— Doric temple (peripteral, Classical Greek) ———
// A temple of the Doric order on its stepped base (krepis): a peristyle of fluted columns laid drum by drum,
// with entasis, inward lean and thicker corner columns; architrave with taenia, regulae and guttae; a frieze of
// triglyphs and metopes with the corner triglyphs pushed out to the corners; a cornice (geison) with its
// mutules; pediments with raking cornices and sima; a roof of pan and cover tiles with antefixes along the
// eaves. Inside the peristyle: the coffered ceilings of the pterons and the cella building (sekos) raised on
// two steps, with prostyle porches, coursed walls on their orthostates, doors, the porches' architraves with
// regulae under a continuous Ionic frieze; inside, a two-storey colonnade round the cult statue, a back room
// with Ionic columns, a timber ceiling and roof frame. The earlier, unfinished temple on the same platform
// can be laid with `older` (its steps and the first drums of its columns, unfluted as they were set).
//
// Frame: u along the temple's axis (+u: the front with the main door), v across it (+v: south when +u is
// east), y up from the euthynteria. Like the
// other bricks it is placed by `center` [x, z] and `rot`; a monument may also turn it with `rotate`.
//
// One element is one life of a group of parts: `parts` picks what it lays (krepis, columns, entablature,
// pediments, roof, cellaRoof, ceiling, sekos, porch, porchTop, naos, westRoom, innerCeiling, frame, statue,
// basin, floor, older-krepis, older-columns, debris) and the selectors say which members:
//   columns   peristyle columns: n1–n17 and s1–s17 along the flanks counted from the front (+u), e1–e8 on
//             the front and w1–w8 on the back counted from the left-hand flank (−v); corners have two names.
//             "n4-n11 s6", or "all".
//   porch     porch columns: p1–p6 (front porch, from −v), o1–o6 (back porch).
//   drums     {"s6": [0, 4]}: only drums 0–3 of that column (no capital); [4] from drum 4 to the top.
//   fresh     {"share", "color", "flutes"}: drums of new material in a restoration (new marble, cement),
//             their flutes carved or not yet.
//   bays      entablature segments per side, between column numbers: {"n": [[1, 3], [12, 17]], "e": [[1, 8]]};
//             a segment that starts or ends at a corner runs on to the corner.
//   fronts    the pediments laid: ["e", "w"]; `pediment` {front, gap: [v0, v1]} leaves out a stretch of one
//             front, {front, only: [v0, v1]} keeps only that stretch.
//   walls     sekos wall runs: [{"from": [u, v], "to": [u, v], "top": metres above the sekos floor or "full",
//             "door": {"at", "width", "height"}}]; a full wall carries the Ionic frieze and its crown.
// The dimensions are in `spec` (metres): stylobate, steps, curvature, columns, entablature, pediment, roof,
// sekos, naos, westRoom, statue, older. Nothing is specific to one building: the numbers say which temple.

const ECHINUS = [[0, -.5], [.36, -.5], [.385, -.34], [.43, -.12], [.475, .14], [.497, .36], [.5, .5], [0, .5]];
const GUTTA = [[0, -.5], [.31, -.5], [.46, -.3], [.5, .24], [.4, .5], [0, .5]];
// A drum of a fluted shaft: 20 concave flutes meeting in sharp arrises, narrowing a little to its top as one
// drum of a tapering shaft does. These monument-specific names are exported explicitly: the gallery copies
// them into the active renderer's shape registry, so an unknown shape can never silently fall back to a box.
export const shapes = {
  parthenonFlutedDrum: adaptive(context => profiledGeometry({...context, profile: context.profile ?? [[0, 1], [1, .988]], flutes: context.flutes ?? 20, fluteDepth: .07, flutePower: .82}), {flutes: 20, maxChordErrorMm: 2, maxSegments: 160}),
  parthenonDoricDrum: adaptive(context => profiledGeometry({...context, profile: context.profile ?? [[0, 1], [1, .988]]}), {maxChordErrorMm: 2, maxSegments: 128}),
  parthenonDoricRing: adaptive(context => profiledGeometry({...context, profile: [[0, 1], [1, 1]]}), {maxChordErrorMm: 2, maxSegments: 128}),
  parthenonEchinus: adaptive(context => profiledGeometry({...context, profile: ECHINUS.filter(([r]) => r > 0).map(([r, y]) => [y + .5, r * 2])}), {maxChordErrorMm: 2, maxSegments: 96}),
  parthenonDoricGutta: adaptive(context => profiledGeometry({...context, profile: GUTTA.filter(([r]) => r > 0).map(([r, y]) => [y + .5, r * 2])}), {maxChordErrorMm: 2, maxSegments: 48}),
  parthenonCoverTile: adaptive(context => {
    // Convex half-cylinder used for the marble or terracotta cover tiles. Rotate the open cylinder so its
    // crown follows the roof normal when `lying` aligns its long axis with the fall of the roof.
    const g = new T.CylinderGeometry(.5, .5, 1, Math.max(8, Math.round(context.radialSegments / 2)), 1, true, 0, Math.PI);
    g.rotateY(Math.PI / 2); g.computeVertexNormals(); return g;
  }, {maxChordErrorMm: 2, maxSegments: 64}),
  parthenonAnthemion: () => {
    const s = new T.Shape();
    s.moveTo(-.5, -.5); s.lineTo(-.46, -.08); s.lineTo(-.3, .18); s.lineTo(-.42, .42);
    s.lineTo(-.18, .34); s.lineTo(0, .5); s.lineTo(.18, .34); s.lineTo(.42, .42);
    s.lineTo(.3, .18); s.lineTo(.46, -.08); s.lineTo(.5, -.5); s.closePath();
    const g = new T.ExtrudeGeometry(s, {depth: 1, bevelEnabled: true, bevelSegments: 2, bevelSize: .035, bevelThickness: .035, curveSegments: 2});
    g.translate(0, 0, -.5); g.computeVertexNormals(); return g;
  },
  parthenonLionSpout: () => {
    // Frontal silhouette of the leonine water spouts fixed to the sima: pointed ears, a broad mane and jaw.
    // The projecting muzzle is a separate turned member below, so this is not a token sphere at the eave.
    const s = new T.Shape();
    s.moveTo(-.18, -.5); s.lineTo(-.38, -.38); s.lineTo(-.48, -.12); s.lineTo(-.4, .15);
    s.lineTo(-.5, .46); s.lineTo(-.2, .36); s.lineTo(0, .5); s.lineTo(.2, .36);
    s.lineTo(.5, .46); s.lineTo(.4, .15); s.lineTo(.48, -.12); s.lineTo(.38, -.38);
    s.lineTo(.18, -.5); s.closePath();
    const g = new T.ExtrudeGeometry(s, {depth: 1, bevelEnabled: true, bevelSegments: 3, bevelSize: .045, bevelThickness: .045, curveSegments: 3});
    g.translate(0, 0, -.5); g.computeVertexNormals(); return g;
  },
};
Object.assign(SHAPES, shapes);

// Axis positions of n columns over a length: normal spacing a, corner spacing c (the contraction).
const axes = (n, a, c, len) => {
  const span = (n - 3) * a + 2 * c, out = [-span / 2];
  for (let i = 1; i < n; i++) out.push(out[i - 1] + (i === 1 || i === n - 1 ? c : a));
  return out;
};
// "n4-n11 s6 e2-e7" → ids; "all" → every name of the list.
function pick(spec, names) {
  if (!spec) return new Set();
  if (spec === 'all') return new Set(names);
  const out = new Set();
  for (const token of String(spec).split(/[\s,]+/).filter(Boolean)) {
    const m = /^([a-z]+)(\d+)(?:-[a-z]*(\d+))?$/.exec(token);
    if (!m) continue;
    for (let i = +m[2]; i <= +(m[3] ?? m[2]); i++) out.add(m[1] + i);
  }
  return out;
}

function doricTemple(k, e, P) {
  const S = e.spec, ph = P(e.phase), parts = new Set(e.parts ?? []);
  const [cx, cz] = e.center ?? [0, 0], rot = e.rot ?? 0, co = Math.cos(rot), si = Math.sin(rot);
  const color = e.color ?? S.color ?? '#dcc9a6', tint = (c = color, j = .05) => k.tint(c, j);
  const [L, B] = S.stylobate, hL = L / 2, hB = B / 2;
  const st = S.steps ?? {count: 3, rise: .52, tread: .72}, base = st.count * st.rise;
  // The curvature of the stylobate: it rises towards the middle of every side, and all that stands on it.
  const [cl, cs] = S.curvature ?? [0, 0];
  const lift = (u, v) => cl * Math.max(0, 1 - (u / hL) ** 2) + cs * Math.max(0, 1 - (v / hB) ** 2);
  const W = (u, y, v) => new T.Vector3(cx + u * co + v * si, y, cz - u * si + v * co);
  const D = (du, dy, dv) => new T.Vector3(du * co + dv * si, dy, -du * si + dv * co);
  const extra = e.extra ?? {};
  // A box at (u, y, v) (its centre), [length along u, height, width along v], turned by yaw in the frame.
  const box = (kind, u, y, v, size, c = tint(), yaw = 0, order, tag) => {
    const p = W(u, y + lift(u, v), v);
    k.box(kind, [p.x, p.y, p.z], size, rot + yaw, c, ph, order ?? p.y, {...extra, ...tag});
  };
  // `tag` names the architectural member a piece belongs to; scripts/check.mjs measures the temple from it.
  const turned = (shape, kind, u, y, v, size, c = tint(), order, geometry, tag) => {
    const p = W(u, y + lift(u, v), v);
    k.turned(shape, kind, [p.x, p.y, p.z], size, rot, c, ph, order ?? p.y - size[1] / 2, {...extra, ...tag, ...(geometry ? {geometry} : {})});
  };
  const lying = (shape, kind, u, y, v, axis, size, c = tint(), order, geometry, tag) => {
    const p = W(u, y + lift(u, v), v), a = D(...axis).normalize();
    k.lying(shape, kind, p, a, size, c, ph, order ?? p.y - size[0] / 2, {...extra, ...tag, ...(geometry ? {geometry} : {})});
  };
  const beam = (kind, a, b, t, c = tint()) => k.beam(kind, W(a[0], a[1] + lift(a[0], a[2]), a[2]), W(b[0], b[1] + lift(b[0], b[2]), b[2]), t, c, ph, extra);
  // A box laid along a slope: x along `dir` [du, dy, dv], y its normal pointing up, z across.
  const sloped = (kind, centre, dir, normal, size, c = tint()) => {
    const x = D(...dir).normalize(), y = D(...normal).normalize(), z = new T.Vector3().crossVectors(x, y);
    const p = W(centre[0], centre[1] + lift(centre[0], centre[2]), centre[2]);
    k.oriented(kind, p, x, y, z, size, c, ph, p.y, extra);
  };

  const C = S.columns, E = S.entablature;
  const us = axes(C.flank, C.spacing, C.cornerSpacing, L), vs = axes(C.front, C.spacing, C.cornerSpacing, B);
  const dTop = C.diameter * (C.taper ?? .78), out = dTop / 2 + .03;
  const yArch = base + C.height, yFrieze = yArch + E.architrave, yGeison = yFrieze + E.frieze, yTop = yGeison + E.geison;
  // Faces of the entablature: its outer plane, `out` beyond the column axes.
  const faceU = us.at(-1) + out, faceV = vs.at(-1) + out;

  // ——— Columns ———
  // Peristyle: id → {u, v, D, lean [du, dv]}. Corners carry two names and one column.
  const peristyle = new Map(), alias = {};
  const add = (id, u, v, corner, lean) => { const key = `${u.toFixed(3)},${v.toFixed(3)}`; alias[id] = key; if (!peristyle.has(key)) peristyle.set(key, {u, v, D: corner ? C.corner : C.diameter, lean, corner, faces: new Set()}); peristyle.get(key).faces.add(id[0]); };
  for (let i = 1; i <= C.flank; i++) {
    const u = us[C.flank - i], corner = i === 1 || i === C.flank, du = i === 1 ? 1 : i === C.flank ? -1 : 0;
    add(`n${i}`, u, vs[0], corner, [du, -1]); add(`s${i}`, u, vs.at(-1), corner, [du, 1]);
  }
  for (let j = 1; j <= C.front; j++) {
    const v = vs[j - 1], corner = j === 1 || j === C.front, dv = j === 1 ? -1 : j === C.front ? 1 : 0;
    add(`e${j}`, us.at(-1), v, corner, [1, dv]); add(`w${j}`, us[0], v, corner, [-1, dv]);
  }
  const rng = () => k.rand();
  // One Doric column standing at (u, v) on y0: drums with entasis and lean, then the capital.
  function doricColumn(u, v, y0, {D: Dm, height, drums: n, capital = .86, abacus, taper = .78, lean = [0, 0], leanBy = 0, range, fresh, flutes = true, c0 = color, member, part, faces}) {
    const cap = capital, shaft = height - cap, hd = shaft / n, dt = Dm * taper;
    // A tagged column carries its own identity into the pieces. scripts/check.mjs then measures the temple that
    // was actually built — its axes, its diameters, its drums — instead of re-reading the spec that asked for it.
    const mine = member ? {...extra, part, member, faces} : extra;
    // Shaft and capital are tagged apart: a checker that can see both can measure the column's whole height.
    const shaftTag = mine && {...mine, role: 'shaft'}, capTag = mine && {...mine, role: 'capital'};
    const diameterAt = t => Dm * (1 - (1 - taper) * Math.max(0, (t - .08) / .92) ** 1.18);
    const [from, to] = [range?.[0] ?? 0, range?.[1] ?? n + 1];
    // The lean: the top of the column stands `leanBy` metres in from its foot, along each way it faces out.
    const shift = y => { const f = leanBy * (y - y0) / height; return [-lean[0] * f, -lean[1] * f]; };
    if (!range && !fresh) {
      // At rest, a complete colonnade is one smooth optical surface. The construction chronology still uses
      // individual drums below, but the finished state shares one sampled entasis and one normal field, so the
      // joints cannot read as eleven swollen cylinders. The slight inward lean is carried by the shaft axis.
      const [su, sv] = shift(y0 + shaft / 2), [tu, tv] = shift(y0 + shaft);
      const axis = [tu, shaft, tv], len = Math.hypot(...axis);
      const profile = [[0, 1], [.08, 1], [.22, diameterAt(.22) / Dm], [.45, diameterAt(.45) / Dm], [.7, diameterAt(.7) / Dm], [1, diameterAt(1) / Dm]];
      const shape = flutes ? 'parthenonFlutedDrum' : 'parthenonDoricDrum';
      lying(shape, 'stone', u + su, y0 + shaft / 2, v + sv, axis, [Dm, len], tint(c0, .045), y0,
        {profile, flutes: flutes ? 20 : 0, maxChordErrorMm: 2}, shaftTag);
    } else for (let i = from; i < Math.min(n, to); i++) {
      const y = y0 + hd * (i + .5), [su, sv] = shift(y), isNew = fresh && rng() < (fresh.share ?? .3);
      const shape = flutes && (!isNew || fresh.flutes !== false) ? 'parthenonFlutedDrum' : 'parthenonDoricDrum';
      const d0 = diameterAt(i / n), dm = diameterAt((i + .5) / n), d1 = diameterAt((i + 1) / n);
      // The real drums meet on dressed beds: keep the authored pieces for the construction sequence, but
      // overlap them by one millimetre per metre so raster precision cannot turn the joints into black bands.
      turned(shape, 'stone', u + su, y, v + sv, [d0, hd * 1.002, d0], tint(isNew ? fresh.color : c0, isNew ? .025 : .055), undefined,
        {profile: [[0, 1], [.5, dm / d0], [1, d1 / d0]], flutes: shape === 'parthenonFlutedDrum' ? 20 : 0, maxChordErrorMm: 2}, shaftTag);
    }
    if (to <= n) return;
    const yc = y0 + shaft, [su, sv] = shift(yc + cap / 2), ab = abacus ?? Dm * 1.08;
    // Annulets, echinus and abacus.
    for (let a = 0; a < 3; a++) turned('parthenonDoricRing', 'stone', u + su, yc + .02 + a * .035, v + sv, [dt * 1.035, .028, dt * 1.035], tint(c0, .03), undefined, undefined, capTag);
    turned('parthenonEchinus', 'stone', u + su, yc + .11 + cap * .21, v + sv, [ab * .985, cap * .42, ab * .985], tint(c0, .04), undefined, undefined, capTag);
    box('stone', u + su, yc + .11 + cap * .42 + (cap - .11 - cap * .42) / 2, v + sv, [ab, cap - .11 - cap * .42, ab], tint(c0, .04), 0, undefined, capTag);
  }
  const freshFor = id => e.fresh && (!e.fresh.only || pick(e.fresh.only, [id]).has(id)) ? e.fresh : null;
  if (parts.has('columns')) {
    const chosen = new Set([...pick(e.columns ?? 'all', Object.keys(alias))].map(id => alias[id]).filter(Boolean));
    for (const [key, col] of peristyle) {
      if (!chosen.has(key)) continue;
      const id = Object.keys(alias).find(n => alias[n] === key && e.drums?.[n]) ?? Object.keys(alias).find(n => alias[n] === key);
      doricColumn(col.u, col.v, base, {D: col.D, height: C.height, drums: C.drums, capital: C.capital, abacus: C.abacus, taper: C.taper, lean: col.lean, leanBy: C.lean ?? 0, range: e.drums?.[id], fresh: freshFor(id), c0: e.columnColor ?? color, part: 'peristyle', member: id, faces: [...col.faces].sort()});
    }
  }

  // ——— Krepis and stylobate ———
  if (parts.has('krepis')) {
    for (let s = 0; s < st.count; s++) {
      const grow = (st.count - 1 - s) * st.tread, l = L + 2 * grow, b = B + 2 * grow, y = s * st.rise + st.rise / 2, h = st.rise * .97;
      // The step's blocks round the edge (a band one tread and a half deep), joints staggered course by course.
      const band = s === st.count - 1 ? 2.2 : st.tread * 1.6;
      for (const side of [-1, 1]) {
        for (let u = -l / 2 + (s % 2) * .6; u < l / 2 - .05;) { const len = 1.2 + rng() * .5, a = Math.max(-l / 2, u), z = Math.min(l / 2, u + len); if (z - a > .1) box('stone', (a + z) / 2, y, side * (b / 2 - band / 2), [z - a - .02, h, band], tint(), 0, undefined, {part: 'stylobate', member: `step-${s}`}); u += len; }
        for (let v = -b / 2 + band + (s % 2) * .5; v < b / 2 - band - .05;) { const len = 1.1 + rng() * .5, a = Math.max(-b / 2 + band, v), z = Math.min(b / 2 - band, v + len); if (z - a > .1) box('stone', side * (l / 2 - band / 2), y, (a + z) / 2, [band, h, z - a - .02], tint(), 0, undefined, {part: 'stylobate', member: `step-${s}`}); v += len; }
      }
      // The core under the stylobate: big slabs.
      const inner = [l - 2 * band, b - 2 * band];
      if (s === st.count - 1) for (let u = -inner[0] / 2; u < inner[0] / 2 - .1; u += 2.4) for (let v = -inner[1] / 2; v < inner[1] / 2 - .1; v += 1.8)
        box('stone', u + Math.min(2.4, inner[0] / 2 - u) / 2, y, v + Math.min(1.8, inner[1] / 2 - v) / 2, [Math.min(2.4, inner[0] / 2 - u) - .02, h, Math.min(1.8, inner[1] / 2 - v) - .02], tint(color, .035));
      else box('stone', 0, y, 0, [inner[0], h, inner[1]], tint(color, .02));
    }
  }

  // ——— Entablature ———
  const sides = {
    n: {n: C.flank, along: i => us[C.flank - i], face: -faceV, dir: [1, 0], out: [0, -1]},
    s: {n: C.flank, along: i => us[C.flank - i], face: faceV, dir: [1, 0], out: [0, 1]},
    e: {n: C.front, along: i => vs[i - 1], face: faceU, dir: [0, 1], out: [1, 0]},
    w: {n: C.front, along: i => vs[i - 1], face: -faceU, dir: [0, 1], out: [-1, 0]},
  };
  // A point at `t` along a side (u or v) and `d` metres in from its face, at height y.
  const at = (sd, t, d) => sd.dir[0] ? [t, sd.face - sd.out[1] * d] : [sd.face - sd.out[0] * d, t];
  // `tag` names what the piece is: a checker reads these tags to measure the entablature the way a source
  // describes it — architrave, frieze, triglyph, metope, cornice — without guessing at geometry.
  const sideBox = (sd, t, len, y, h, d, depth, c = tint(), kind = 'stone', tag) => { const [u, v] = at(sd, t, d + depth / 2); box(kind, u, y + h / 2, v, sd.dir[0] ? [len, h, depth] : [depth, h, len], c, 0, undefined, tag); };
  // The extent along a side of a segment between column numbers a and b (to the corner when it starts there).
  const extent = (sd, [a, b]) => {
    const p = [sd.along(a), sd.along(b)], lo = Math.min(...p), hi = Math.max(...p), cornerLo = Math.min(sd.along(1), sd.along(sd.n)), cornerHi = Math.max(sd.along(1), sd.along(sd.n));
    const reach = sd.dir[0] ? faceU : faceV;
    return [lo <= cornerLo + .01 ? -reach : lo, hi >= cornerHi - .01 ? reach : hi];
  };
  // `layers` picks architrave, frieze and cornice (all three by default); `cornice: "corners"` keeps only the
  // cornice within `cornerReach` metres of each corner, `"middle"` only the rest, for flanks that lost it.
  if (parts.has('entablature')) {
    const tw = E.triglyph ?? .845, depthA = E.depth ?? 1.96, layers = new Set(e.layers ?? ['architrave', 'frieze', 'cornice']);
    const R = e.cornerReach ?? 3, keepCornice = (t, reach) => !e.cornice || (e.cornice === 'corners') === (Math.abs(t) > reach - R);
    for (const [name, sd] of Object.entries(sides)) {
      // Without `bays` every side is laid whole; with it, only the sides it names.
      for (const seg of e.bays ? e.bays[name] ?? [] : [[1, sd.n]]) {
        const [t0, t1] = extent(sd, seg);
        // Architrave: three courses of beams joined over the column axes, the taenia on top.
        const joints = [t0, ...Array.from({length: sd.n}, (_, i) => sd.along(i + 1)).filter(t => t > t0 + .3 && t < t1 - .3).sort((a, b) => a - b), t1];
        if (layers.has('architrave')) {
          for (let j = 0; j < joints.length - 1; j++) {
            const len = joints[j + 1] - joints[j], mid = (joints[j] + joints[j + 1]) / 2;
            for (const [d, depth] of [[0, .62], [.64, .66], [1.32, depthA - 1.32]]) sideBox(sd, mid, len - .02, yArch, E.architrave - .1, d, depth, tint(), 'stone', {part: 'entablature', member: 'architrave', face: name});
          }
          sideBox(sd, (t0 + t1) / 2, t1 - t0, yFrieze - .1, .1, -.06, .5, tint(), 'stone', {part: 'entablature', member: 'architrave', face: name});
        }
        // Triglyphs over every axis and every middle of a bay, the corner ones at the corner; metopes between.
        const cols = Array.from({length: sd.n}, (_, i) => sd.along(i + 1)).sort((a, b) => a - b), centres = [];
        for (let i = 0; i < cols.length; i++) { centres.push(cols[i]); if (i < cols.length - 1) centres.push((cols[i] + cols[i + 1]) / 2); }
        centres[0] = -(sd.dir[0] ? faceU : faceV) + tw / 2;
        centres[centres.length - 1] = (sd.dir[0] ? faceU : faceV) - tw / 2;
        // The corner triglyphs pushed out to the corners: the next ones sit halfway to the triglyph over the
        // second column, so the metopes at the ends are only a little narrower than the others.
        centres[1] = (centres[0] + centres[2]) / 2; centres[centres.length - 2] = (centres.at(-1) + centres.at(-3)) / 2;
        const inSeg = t => t >= t0 - .01 && t <= t1 + .01;
        for (let i = 0; i < centres.length; i++) {
          const t = centres[i];
          if (inSeg(t) && layers.has('frieze')) {
            // The triglyph: its block, three upright bars with two grooves between (and half grooves at the
            // edges), its capital band; under it on the architrave, the regula and its six guttae.
            sideBox(sd, t, tw, yFrieze, E.frieze - .12, .02, .5, tint(), 'stone', {part: 'entablature', member: 'triglyph', face: name});
            for (const o of [-.28, 0, .28]) sideBox(sd, t + o * tw, tw * .19, yFrieze, E.frieze - .14, -.03, .06, tint(color, .04), 'stone', {part: 'entablature', member: 'triglyphBar', face: name});
            sideBox(sd, t, tw + .02, yGeison - .12, .12, -.04, .5, tint(), 'stone', {part: 'entablature', member: 'triglyphCap', face: name});
          }
          if (inSeg(t) && layers.has('architrave')) {
            sideBox(sd, t, tw, yFrieze - .17, .06, -.05, .06);
            for (let g = 0; g < 6; g++) { const [u, v] = at(sd, t + (g - 2.5) / 6 * tw * .86, -.02); turned('parthenonDoricGutta', 'stone', u, yFrieze - .215, v, [.075, .09, .075], tint(color, .03)); }
          }
          if (i < centres.length - 1 && layers.has('frieze')) {
            const a = Math.max(t0, t + tw / 2), b = Math.min(t1, centres[i + 1] - tw / 2);
            if (b - a > .1) { sideBox(sd, (a + b) / 2, b - a, yFrieze, E.frieze - .12, .07, .26, tint(e.metopeColor ?? color), 'stone', {part: 'entablature', member: 'metope', face: name}); sideBox(sd, (a + b) / 2, b - a, yGeison - .12, .12, .02, .3, tint(), 'stone', {part: 'entablature', member: 'metopeCap', face: name}); }
          }
        }
        // Backing of the frieze, then the geison: its soffit with a mutule over every triglyph and metope.
        if (layers.has('frieze')) sideBox(sd, (t0 + t1) / 2, t1 - t0, yFrieze, E.frieze, .33, depthA - .33, tint(color, .03), 'stone', {part: 'entablature', member: 'frieze', face: name});
        if (layers.has('cornice')) {
          const pr = E.projection ?? .65, reach = sd.dir[0] ? faceU : faceV;
          for (let t = t0; t < t1 - .05;) { const len = Math.min(1.25 + rng() * .3, t1 - t); if (keepCornice(t + len / 2, reach)) sideBox(sd, t + len / 2, len - .015, yGeison, E.geison, -pr, pr + 1.4, tint(), 'stone', {part: 'entablature', member: 'cornice', face: name}); t += len; }
          const mutules = centres.flatMap((t, i) => i < centres.length - 1 ? [t, (t + centres[i + 1]) / 2] : [t]);
          for (const t of mutules) if (inSeg(t) && keepCornice(t, reach)) {
            sideBox(sd, t, tw * .96, yGeison - .055, .055, -pr + .08, pr - .1, tint(color, .04));
            // Eighteen pendant guttae under each mutule, in the canonical three rows of six.
            for (let row = 0; row < 3; row++) for (let g = 0; g < 6; g++) {
              const along = t + (g - 2.5) / 6 * tw * .82, depth = -pr + .16 + row * Math.max(.12, (pr - .28) / 2), [u, v] = at(sd, along, depth);
              turned('parthenonDoricGutta', 'stone', u, yGeison - .125, v, [.055, .085, .055], tint(color, .025));
            }
          }
        }
      }
    }
  }

  // ——— Pediments, roof ———
  // The raking cornice's soffit runs from the corners of the pediment's field up to its apex; the roof lies
  // under the sima, down to the eaves on the horizontal cornices.
  const P2 = S.pediment, pr = E.projection ?? .65, half = faceV + pr, slope = P2.height / (P2.width / 2);
  const yRidge = yTop + P2.height + .55, yEave = yRidge - half * slope;
  if (parts.has('pediments')) {
    for (const f of e.fronts ?? ['e', 'w']) {
      // `pediment.gap` [v0, v1] leaves out a stretch of the `pediment.front` one, `pediment.only` keeps only it.
      const sgn = f === 'e' ? 1 : -1, uFace = sgn * (faceU - P2.depth + .02), mine = f === e.pediment?.front, gap = mine ? e.pediment.gap : null, only = mine ? e.pediment.only : null;
      const skip = v => (gap && v > gap[0] && v < gap[1]) || (only && !(v > only[0] && v < only[1]));
      // The tympanum: courses set back behind the floor of the pediment.
      for (let y = yTop, row = 0; y < yTop + P2.height - .25; row++) {
        // Each course reaches up under the raking cornice at its foot, so no step shows beneath the soffit.
        const h = Math.min(.62, yTop + P2.height - y), hw = (P2.width / 2) * (1 - (y - yTop) / P2.height);
        for (let v = -hw + (row % 2) * .6; v < hw - .05;) { const len = 1.3 + rng() * .5, a = Math.max(-hw, v), b = Math.min(hw, v + len); if (b - a > .1 && !skip((a + b) / 2)) box('stone', uFace - sgn * .3, y + h / 2, (a + b) / 2, [.6, h * .97, b - a - .02]); v += len; }
        y += h;
      }
      // Raking geison and sima, segment by segment up each slope, with a lion's head at each foot.
      for (const side of [-1, 1]) {
        const n = 12;
        for (let i = 0; i < n; i++) {
          const v0 = side * half * (1 - i / n), v1 = side * half * (1 - (i + 1) / n), vm = (v0 + v1) / 2;
          if (skip(vm)) continue;
          const y0 = yTop + (P2.width / 2 - Math.abs(vm)) * slope, len = Math.hypot(half / n, half / n * slope);
          const dir = [0, slope, -side], nrm = [0, 1, side * slope];
          sloped('stone', [sgn * (faceU + pr - 1), y0 + .3, vm], dir, nrm, [len * 1.01, .6, 2]);
          sloped('stone', [sgn * (faceU + pr - .2), y0 + .78, vm], dir, nrm, [len * 1.01, .36, .42], tint(color, .04));
        }
        if (!skip(side * (half - .2))) {
          const u = sgn * (faceU + pr - .1), y = yTop + (P2.width / 2 - half) * slope + .9, v = side * (half - .2), p = W(u, y + lift(u, v), v), c = tint(color, .04);
          k.turned('parthenonLionSpout', 'stone', [p.x, p.y, p.z], [.52, .48, .32], rot + Math.PI / 2, c, ph, p.y - .24, extra);
          const muzzle = W(u + sgn * .2, y - .08 + lift(u, v), v);
          k.lying('parthenonDoricGutta', 'stone', muzzle, D(sgn, 0, 0), [.22, .3], c, ph, muzzle.y - .11, extra);
        }
      }
      // The floor of the pediment (the horizontal geison's top, where the statues stand).
      if (!gap && !only) box('stone', sgn * (faceU - P2.depth / 2 + .1), yTop + .04, 0, [P2.depth, .08, P2.width]);
    }
  }
  if (parts.has('roof')) {
    const [tw, tl] = S.roof?.tile ?? [.73, .64], u0 = -(faceU - P2.depth), u1 = faceU - P2.depth, nu = Math.round((u1 - u0) / tw);
    const roofColor = S.roof?.color ?? color, kind = S.roof?.kind ?? 'stone', ns = Math.ceil(Math.hypot(half, half * slope) / tl);
    for (const side of [-1, 1]) {
      const dir = [0, -slope, side], nrm = [0, 1, side * slope];
      for (let j = 0; j < ns; j++) {
        const f = (j + .5) / ns, v = side * half * f, y = yRidge - half * f * slope + .1;
        for (let i = 0; i < nu; i++) {
          const u = u0 + (i + .5) * (u1 - u0) / nu;
          sloped(kind, [u, y, v], [1, 0, 0], nrm, [(u1 - u0) / nu * .97, .07, tl * 1.04], tint(roofColor, .04));
          lying('parthenonCoverTile', kind, u0 + i * (u1 - u0) / nu, y + .09, v, [0, -slope, side], [.17, tl * 1.04], tint(roofColor, .05));
        }
      }
      // Antefixes along the eave, one at the foot of every row of cover tiles.
      for (let i = 0; i <= nu; i++) turned('parthenonAnthemion', 'stone', u0 + i * (u1 - u0) / nu, yEave + .27, side * (half - .04), [.34, .44, .09], tint(color, .045));
    }
    for (let i = 0; i < nu; i++) box(kind, u0 + (i + .5) * (u1 - u0) / nu, yRidge + .2, 0, [(u1 - u0) / nu * .98, .2, .5], tint(roofColor, .05));
  }

  // ——— Sekos (the cella building) ———
  const K = S.sekos ?? {}, yFloor = base + (K.rise ?? .7);
  const sekosTop = yFloor + (K.wall ?? 11.16), friezeTop = sekosTop + (K.frieze ?? 1.02), crownTop = friezeTop + (K.crown ?? .2);
  // A coursed wall from a to b ([u, v]), thickness t, its first course an orthostate; a rect door cut out.
  function wall(a, b, y0, y1, t, door, full) {
    const du = b[0] - a[0], dv = b[1] - a[1], len = Math.hypot(du, dv), dir = [du / len, dv / len];
    const yaw = Math.atan2(-dv, du);
    for (let y = y0, row = 0; y < y1 - .05; row++) {
      const h = Math.min(row === 0 && y0 <= yFloor + .01 ? (K.orthostate ?? 1.15) : (K.course ?? .52), y1 - y);
      let spans = [[0, len]];
      if (door && y < y0 + door.height) spans = [[0, door.at - door.width / 2], [door.at + door.width / 2, len]].filter(([p, q]) => q - p > .05);
      for (const [p, q] of spans) for (let s = p - (row % 2) * .6; s < q - .05;) {
        const l = row === 0 ? .9 + rng() * .3 : 1.15 + rng() * .45, from = Math.max(p, s), to = Math.min(q, s + l);
        if (to - from > .08) { const m = (from + to) / 2; box('stone', a[0] + dir[0] * m, y + h / 2, a[1] + dir[1] * m, [to - from - .02, h * .97, t], tint(), yaw); }
        s += l;
      }
      y += h;
    }
    if (door) {
      // The door's frame: jambs and lintel standing proud of the wall face on both sides.
      for (const s of [door.at - door.width / 2 - .25, door.at + door.width / 2 + .25]) box('stone', a[0] + dir[0] * s, y0 + door.height / 2, a[1] + dir[1] * s, [.5, door.height, t + .12], tint(), yaw);
      box('stone', a[0] + dir[0] * door.at, y0 + door.height + .4, a[1] + dir[1] * door.at, [door.width + 1, .8, t + .14], tint(), yaw);
    }
    if (full) {
      // Band of regulae under the frieze is on the porches only; the walls carry the frieze and its crown.
      for (let s = 0; s < len - .05;) { const l = Math.min(1.2 + rng() * .3, len - s), m = s + l / 2; box('stone', a[0] + dir[0] * m, sekosTop + (friezeTop - sekosTop) / 2, a[1] + dir[1] * m, [l - .02, friezeTop - sekosTop - .02, t], tint(e.friezeColor ?? color), yaw); s += l; }
      box('stone', (a[0] + b[0]) / 2, friezeTop + (crownTop - friezeTop) / 2, (a[1] + b[1]) / 2, [len + .1, crownTop - friezeTop, t + .2], tint(color, .03), yaw);
    }
  }
  if (parts.has('sekos')) for (const w of e.walls ?? []) {
    const top = w.top === 'full' ? sekosTop : yFloor + w.top;
    wall(w.from, w.to, w.base !== undefined ? yFloor + w.base : yFloor, top, w.thickness ?? K.thickness ?? 1.25, w.door, w.top === 'full');
  }
  // The sekos platform, raised on two steps at the porch ends, and its paving.
  if (parts.has('floor')) {
    const [fu, fv] = K.platform ?? [61.2, 22.4], steps = K.steps ?? 2, r = (yFloor - base) / steps;
    for (let s = 0; s < steps; s++) {
      const grow = (steps - 1 - s) * (K.tread ?? .35), l = fu + 2 * grow;
      for (let u = -l / 2; u < l / 2 - .05; u += 1.6) for (let v = -fv / 2; v < fv / 2 - .05; v += 1.6) {
        const lu = Math.min(1.6, l / 2 - u), lv = Math.min(1.6, fv / 2 - v);
        if (s < steps - 1 && Math.abs(u + lu / 2) < l / 2 - 1.7) continue;
        box('stone', u + lu / 2, base + s * r + r / 2, v + lv / 2, [lu - .02, r * .97, lv - .02], tint(color, .035));
      }
    }
  }
  // Porch columns (prostyle), and over them the architrave with its regulae, the Ionic frieze and its crown.
  const Q = K.porch;
  const porchCols = Q ? Object.fromEntries([...Array(Q.columns).keys()].flatMap(i => { const v = -Q.span / 2 + i * Q.span / (Q.columns - 1); return [[`p${i + 1}`, [Q.axis, v]], [`o${i + 1}`, [-Q.axis, v]]]; })) : {};
  if (parts.has('porch')) for (const id of pick(e.porch ?? 'all', Object.keys(porchCols))) {
    const [u, v] = porchCols[id] ?? [];
    if (u === undefined) continue;
    doricColumn(u, v, yFloor, {D: Q.diameter, height: Q.height, drums: Q.drums ?? 10, capital: Q.capital ?? .78, abacus: Q.abacus, taper: C.taper, range: e.drums?.[id], fresh: freshFor(id), c0: e.columnColor ?? color});
  }
  if (parts.has('porchTop') && Q) for (const f of e.porchFronts ?? ['e', 'w']) {
    const sgn = f === 'e' ? 1 : -1, uo = sgn * (Q.axis + .8), w = K.width / 2, yA = yFloor + Q.height;
    const run = (a, b, y, h, d, c = tint()) => { const len = Math.hypot(b[0] - a[0], b[1] - a[1]), yaw = Math.atan2(-(b[1] - a[1]), b[0] - a[0]); for (let s = 0; s < len - .05;) { const l = Math.min(1.5 + rng() * .3, len - s), m = s + l / 2, du = (b[0] - a[0]) / len, dv = (b[1] - a[1]) / len; box('stone', a[0] + du * m, y + h / 2, a[1] + dv * m, [l - .02, h * .97, d], c, yaw); s += l; } };
    // Across the front, and back along each side to the anta.
    const ends = [[[uo, -w], [uo, w]], [[uo, -w + .8], [sgn * K.anta, -w + .8]], [[uo, w - .8], [sgn * K.anta, w - .8]]];
    for (const [a, b] of ends) {
      run(a, b, yA, sekosTop - yA - .08, 1.6);
      run(a, b, sekosTop, friezeTop - sekosTop, 1.0, tint(e.friezeColor ?? color));
      run(a, b, friezeTop, crownTop - friezeTop, 1.25, tint(color, .03));
    }
    // The regulae and guttae along the porch front's architrave, a Doric touch under the Ionic frieze.
    for (let v = -w + .6; v < w - .5; v += 1.06) { box('stone', uo + sgn * .82, sekosTop - .1, v, [.06, .06, .7], tint(color, .03)); for (let g = 0; g < 6; g++) turned('parthenonDoricGutta', 'stone', uo + sgn * .82, sekosTop - .17, v + (g - 2.5) * .11, [.065, .08, .065], tint(color, .03)); }
  }

  // ——— Ceilings and roof frame ———
  if (parts.has('ceiling')) {
    // The pterons' marble ceiling: beams from the entablature to the sekos, coffered slabs between them.
    const yc = yGeison - .3, inV = vs.at(-1) - out - .2, wallV = K.width / 2, inU = us.at(-1) - out - .2;
    const wanted = new Set(e.ceilings ?? ['n', 's', 'e', 'w']);
    for (const side of [-1, 1]) {
      if (!wanted.has(side < 0 ? 'n' : 's')) continue;
      for (let u = -hL + 3; u < hL - 3; u += C.spacing / 2) { beam('stone', [u, yc, side * wallV], [u, yc, side * inV], .5, tint(color, .04)); box('stone', u + C.spacing / 4, yc + .32, side * (wallV + inV) / 2, [C.spacing / 2 - .05, .14, inV - wallV - .1], tint(color, .03)); }
    }
    for (const sgn of [-1, 1]) {
      if (!wanted.has(sgn > 0 ? 'e' : 'w')) continue;
      const a = Q ? Q.axis + .9 : hL - 5;
      for (let v = -K.width / 2; v < K.width / 2; v += 1.8) { beam('stone', [sgn * a, yc, v], [sgn * inU, yc, v], .5, tint(color, .04)); box('stone', sgn * (a + inU) / 2, yc + .32, v + .9, [inU - a - .1, .14, 1.75], tint(color, .03)); }
    }
  }
  const N = S.naos;
  if (parts.has('innerCeiling')) {
    // A timber ceiling over the rooms, on beams across from wall to wall.
    for (let u = (S.westRoom?.from ?? -21) + .5; u < (N?.to ?? 23) - .3; u += 2.4) { box('wood', u, sekosTop + .9, 0, [.45, .6, K.width - 2.4], tint('#6e5136', .07)); box('wood', u + 1.2, sekosTop + 1.25, 0, [2.3, .12, K.width - 2.4], tint('#7a5b3e', .07)); }
  }
  if (parts.has('frame')) {
    // Rafters from the eaves to the ridge, purlins along the roof and the ridge beam.
    const u0 = -(faceU - P2.depth) + .5, u1 = faceU - P2.depth - .5, yb = yEave - .25;
    for (let u = u0; u <= u1 + .01; u += 2.4) for (const side of [-1, 1]) beam('wood', [u, yb, side * (half - .6)], [u, yRidge - .25, 0], .3, tint('#6e5136', .08));
    for (const f of [0, .25, .5, .75]) for (const side of [-1, 1]) { const v = side * (half - .6) * (1 - f), y = yb + (yRidge - .25 - yb) * f + .25; beam('wood', [u0, y, v], [u1, y, v], .26, tint('#6e5136', .08)); }
  }

  // A later roof over the sekos alone (`cellaRoof`: from, to along u, half width, pitch in degrees), on its
  // rafters, covered with clay pan and cover tiles: the peristyle's wings left open to the sky.
  if (parts.has('cellaRoof') && S.cellaRoof) {
    const R = S.cellaRoof, sl = Math.tan(R.pitch * Math.PI / 180), ye = crownTop + .3, yr = ye + R.half * sl, [tw, tl] = R.tile ?? [.5, .45];
    const nu = Math.round((R.to - R.from) / tw), ns = Math.ceil(Math.hypot(R.half, R.half * sl) / tl);
    for (let u = R.from + .3; u <= R.to - .3; u += 1.8) for (const side of [-1, 1]) beam('wood', [u, ye - .2, side * (R.half - .3)], [u, yr - .2, 0], .26, tint('#6a4e34', .08));
    for (const side of [-1, 1]) for (let j = 0; j < ns; j++) {
      const f = (j + .5) / ns, v = side * R.half * f, y = yr - R.half * f * sl, nrm = [0, 1, side * sl];
      for (let i = 0; i < nu; i++) {
        const u = R.from + (i + .5) * (R.to - R.from) / nu;
        sloped('tile', [u, y, v], [1, 0, 0], nrm, [(R.to - R.from) / nu * .97, .05, tl * 1.05], tint(R.color ?? '#a8613f', .06));
        lying('parthenonCoverTile', 'tile', R.from + i * (R.to - R.from) / nu, y + .07, v, [0, -sl, side], [.13, tl * 1.05], tint(R.color ?? '#a8613f', .07));
      }
    }
    for (let i = 0; i < nu; i++) box('tile', R.from + (i + .5) * (R.to - R.from) / nu, yr + .1, 0, [(R.to - R.from) / nu * .98, .16, .35], tint(R.color ?? '#a8613f', .06));
    // Its gables, closing the roof at both ends.
    for (const u of [R.from, R.to]) for (let y = ye - .3, row = 0; y < yr - .2; row++) { const h = Math.min(.5, yr - y), hw = R.half * (1 - (y + h / 2 - ye) / (yr - ye)); if (hw > .3) box('stone', u, y + h / 2, 0, [.6, h * .96, 2 * hw], tint(color, .06)); y += h; }
  }

  // ——— Inside: the naos colonnade, the back room, the statue ———
  if (parts.has('naos') && N) {
    const rows = [], y0 = yFloor, lo = N.lower, up = N.upper, reused = e.naosStyle === 'reused';
    for (let i = 0; i < N.side; i++) { const u = N.to - i * (N.to - N.back) / (N.side - 1); rows.push([u, -N.axis], [u, N.axis]); }
    for (let i = 1; i <= N.across; i++) rows.push([N.back, -N.axis + i * 2 * N.axis / (N.across + 1)]);
    const ccol = reused ? (e.columnColor ?? '#cbbfa8') : color;
    for (const [u, v] of rows) {
      doricColumn(u, v, y0, {D: lo.diameter, height: lo.height, drums: reused ? 1 : 5, capital: lo.diameter * .45, taper: .8, flutes: !reused, c0: ccol});
      doricColumn(u, v, y0 + lo.height + N.architrave, {D: up.diameter, height: up.height, drums: reused ? 1 : 4, capital: up.diameter * .45, taper: .82, flutes: !reused, c0: ccol});
    }
    // The architraves of both storeys, on the Π of columns.
    for (const y of [y0 + lo.height, y0 + lo.height + N.architrave + up.height]) {
      for (const v of [-N.axis, N.axis]) box('stone', (N.to + N.back) / 2, y + N.architrave / 2, v, [N.to - N.back + 1, N.architrave * .97, .8], tint(ccol));
      box('stone', N.back, y + N.architrave / 2, 0, [.8, N.architrave * .97, 2 * N.axis], tint(ccol));
    }
  }
  if (parts.has('westRoom') && S.westRoom) for (const [u, v] of S.westRoom.columns) {
    const p = W(u, yFloor, v);
    k.column('stone', [p.x, yFloor + lift(u, v), p.z], {height: S.westRoom.height, diameter: S.westRoom.diameter, order: 'ionic', drum: 1.6, out: [D(1, 0, 0).x, D(1, 0, 0).z]}, color, ph, extra);
  }
  if (parts.has('statue') && S.statue) {
    // The cult statue, simplified: its pedestal, the robe and the body in gold, face and arms in ivory, the
    // helmet, the shield at its left side, the spear, and the Victory standing on its right hand.
    const Z = S.statue, [bu, bv] = Z.at, [bl, bh, bw] = Z.base, y0 = yFloor + bh, H = Z.height - bh, gold = Z.gold ?? '#d4ab52', ivory = Z.ivory ?? '#efe3c8';
    box('stone', bu, yFloor + bh / 2, bv, [bl, bh, bw], tint(Z.baseColor ?? '#a99c86', .03));
    turned('shaft', 'gilt', bu, y0 + H * .27, bv, [H * .26, H * .54, H * .2], tint(gold, .03));
    turned('shaft', 'gilt', bu, y0 + H * .66, bv, [H * .2, H * .24, H * .14], tint(gold, .03));
    turned('ball', 'gilt', bu, y0 + H * .79, bv, [H * .24, H * .07, H * .15], tint(gold, .03));
    turned('ball', 'stone', bu + H * .01, y0 + H * .86, bv, [H * .085, H * .1, H * .085], tint(ivory, .02));
    turned('bell', 'gilt', bu, y0 + H * .915, bv, [H * .11, H * .08, H * .11], tint(gold, .03));
    box('gilt', bu, y0 + H * .975, bv, [H * .12, H * .05, H * .02], tint(gold, .03));
    // Right arm forward with the Victory, left hand on the rim of the shield.
    beam('stone', [bu, y0 + H * .74, bv + H * .09], [bu + H * .15, y0 + H * .62, bv + H * .14], H * .035, tint(ivory, .02));
    turned('shaft', 'gilt', bu + H * .16, y0 + H * .69, bv + H * .15, [H * .045, H * .13, H * .04], tint(gold, .03));
    turned('ball', 'gilt', bu + H * .16, y0 + H * .775, bv + H * .15, [H * .03, H * .035, H * .03], tint(gold, .03));
    box('gilt', bu + H * .16, y0 + H * .72, bv + H * .15, [H * .01, H * .06, H * .1], tint(gold, .03));
    const sh = W(bu + H * .02, 0, bv - H * .24);
    k.lying('drum', 'gilt', new T.Vector3(sh.x, y0 + H * .2 + lift(bu, bv), sh.z), D(0, 0, 1), [H * .4, H * .04], tint(gold, .03), ph, y0, extra);
    beam('gilt', [bu - H * .06, y0, bv - H * .13], [bu - H * .02, y0 + H * 1.02, bv - H * .1], H * .018, tint(gold, .03));
    beam('stone', [bu, y0 + H * .74, bv - H * .09], [bu + H * .02, y0 + H * .42, bv - H * .2], H * .035, tint(ivory, .02));
  }
  if (parts.has('basin') && S.basin) {
    // The shallow basin of water in front of the statue, in its stone rim.
    const [u0, v0, u1, v1] = S.basin;
    box('stone', (u0 + u1) / 2, yFloor + .06, (v0 + v1) / 2, [u1 - u0, .12, v1 - v0], tint('#8f8577', .03));
    box('glass', (u0 + u1) / 2, yFloor + .1, (v0 + v1) / 2, [u1 - u0 - .5, .06, v1 - v0 - .5], tint('#3a4a52', .03));
  }

  // ——— The older temple, begun on the same platform ———
  const O = S.older;
  if (O && (parts.has('older-krepis') || parts.has('older-columns'))) {
    const [ol, ob] = O.stylobate, [ou, ov] = O.offset ?? [0, 0], oc = O.color ?? '#c3b798', r = O.rise ?? .5;
    if (parts.has('older-krepis')) for (let s = 0; s < 3; s++) {
      const grow = (2 - s) * (O.tread ?? .7), l = ol + 2 * grow, b = ob + 2 * grow, y = s * r + r / 2;
      for (const side of [-1, 1]) {
        for (let u = -l / 2 + (s % 2) * .6; u < l / 2 - .05; u += 1.4) box('stone', ou + u + Math.min(1.4, l / 2 - u) / 2, y, ov + side * (b / 2 - .7), [Math.min(1.4, l / 2 - u) - .03, r * .96, 1.4], tint(s === 2 ? (O.top ?? oc) : oc, .05));
        for (let v = -b / 2 + 1.4; v < b / 2 - 1.45; v += 1.4) box('stone', ou + side * (l / 2 - .7), y, ov + v + Math.min(1.4, b / 2 - 1.4 - v) / 2, [1.4, r * .96, Math.min(1.4, b / 2 - 1.4 - v) - .03], tint(s === 2 ? (O.top ?? oc) : oc, .05));
      }
      box('stone', ou, y, ov, [l - 2.8, r * .96, b - 2.8], tint(oc, .02));
    }
    if (parts.has('older-columns')) {
      const ou2 = axes(O.flank, (ol - 2) / (O.flank - 1), (ol - 2) / (O.flank - 1), ol), ov2 = axes(O.front, (ob - 2) / (O.front - 1), (ob - 2) / (O.front - 1), ob);
      for (let i = 0; i < O.flank; i++) for (let j = 0; j < O.front; j++) {
        if (i > 0 && i < O.flank - 1 && j > 0 && j < O.front - 1) continue;
        for (let d = 0; d < (O.drums ?? 2); d++) turned('parthenonDoricDrum', 'stone', ou + ou2[i], 3 * r + d * (O.drum ?? 1.05) + (O.drum ?? 1.05) / 2, ov + ov2[j], [O.diameter, (O.drum ?? 1.05) * .99, O.diameter], tint('#e7dcc6', .04));
      }
    }
  }

  // ——— Fallen members round the ruin ———
  if (parts.has('debris')) for (const zone of e.debris ?? []) {
    const [u0, v0, u1, v1] = zone.area;
    for (let i = 0; i < zone.count; i++) {
      const u = u0 + rng() * (u1 - u0), v = v0 + rng() * (v1 - v0), p = W(u, 0, v);
      // `drums`: the share of fallen drums; `low`: the highest a block lies (under a metre, a ground course).
      if (rng() < (zone.drums ?? .4)) {
        const d = C.diameter * (.8 + rng() * .2), len = .7 + rng() * .4, a = rng() * Math.PI;
        k.lying(rng() < .6 ? 'parthenonFlutedDrum' : 'parthenonDoricDrum', 'stone', new T.Vector3(p.x, (zone.y ?? 0) + d / 2, p.z), new T.Vector3(Math.cos(a), 0, Math.sin(a)), [d, len], tint(color, .07), ph, 0, extra);
      } else {
        const l = .8 + rng() * 1.2, h = .35 + rng() * ((zone.low ?? 1) - .4), w = .5 + rng() * .7;
        k.box('stone', [p.x, (zone.y ?? 0) + h / 2, p.z], [l, h, w], rng() * Math.PI, tint(color, .08), ph, 0, extra);
      }
    }
  }
}

// ——— Apse ———
// A semicircular apse of coursed masonry under a half dome, open on its chord: `center` [x, z] is the middle
// of the chord, `rot` turns it (it opens towards −u of its frame), `radius` to the wall's middle, `thickness`,
// `height` to the springing of the half dome, `y0`; `windows` (count) under the springing.
function apse(k, e, P) {
  const [cx, cz] = e.center, rot = e.rot ?? 0, y0 = e.y0 ?? 0, r = e.radius, t = e.thickness ?? .9, h = e.height, ph = P(e.phase), c = e.color ?? '#c9bca2';
  const W = (u, y, v) => [cx + u * Math.cos(rot) + v * Math.sin(rot), y, cz - u * Math.sin(rot) + v * Math.cos(rot)];
  const n = Math.max(8, Math.round(Math.PI * r / .9)), win = e.windows ?? 0;
  for (let y = y0, row = 0; y < y0 + h - .05; row++) {
    const hh = Math.min(.45, y0 + h - y);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i + (row % 2) * .5) / n * Math.PI;
      if (a > Math.PI / 2) continue;
      const wi = win ? Math.round((a + Math.PI / 2) / Math.PI * (win + 1)) : 0, wa = -Math.PI / 2 + wi * Math.PI / (win + 1);
      if (win && wi > 0 && wi <= win && Math.abs(a - wa) < .9 / r && y > y0 + h * .45 && y < y0 + h * .85) continue;
      const p = W(Math.cos(a) * r, y + hh / 2, Math.sin(a) * r);
      k.box('stone', p, [t, hh * .96, Math.PI * r / n * 1.02], rot - a, k.tint(c, .07), ph, y, e.extra);
    }
    y += hh;
  }
  // The half dome: rings of stones closing towards the crown.
  for (let j = 0; j < 7; j++) {
    const b0 = j / 7 * Math.PI / 2, b1 = (j + 1) / 7 * Math.PI / 2, rr = r * Math.cos((b0 + b1) / 2), yy = y0 + h + r * Math.sin((b0 + b1) / 2), m = Math.max(3, Math.round(Math.PI * rr / .8));
    for (let i = 0; i < m; i++) {
      const a = -Math.PI / 2 + (i + .5) / m * Math.PI, p = W(Math.cos(a) * rr, yy, Math.sin(a) * rr);
      k.box('stone', p, [t * .8, r * (b1 - b0) * .98, Math.PI * rr / m * 1.05], rot - a, k.tint(c, .07), ph, yy, e.extra);
    }
  }
}

// ——— Minaret ———
// A tower in stages at `at` [x, z] from `y0`: a square base (`square`: width, height), a round shaft
// (`shaft`: radius, height), a balcony on corbels (`balcony`: height above the shaft's foot, radius) and a
// pointed cap (`cap`: height). Any stage may be left out, so that a base can outlive its shaft.
function minaret(k, e, P) {
  const [x, z] = e.at, ph = P(e.phase), c = e.color ?? '#d2c6ad';
  let y = e.y0 ?? 0;
  if (e.square) {
    const {width: w, height: h} = e.square;
    for (let yy = y, row = 0; yy < y + h - .05; row++) {
      const hh = Math.min(.45, y + h - yy);
      for (const [dx, dz, l, d] of [[0, -w / 2 + .35, w, .7], [0, w / 2 - .35, w, .7], [-w / 2 + .35, 0, .7, w - 1.4], [w / 2 - .35, 0, .7, w - 1.4]])
        k.box('stone', [x + dx, yy + hh / 2, z + dz], [l - .02, hh * .96, d - .02], e.rot ?? 0, k.tint(c, .07), ph, yy, e.extra);
      yy += hh;
    }
    y += h;
    if (e.square.roof) k.turned('spike', 'tile', [x, y + e.square.roof / 2, z], [w * 1.25, e.square.roof, w * 1.25], (e.rot ?? 0) + Math.PI / 4, k.tint('#9c6b4f', .05), ph, y, e.extra);
  }
  if (e.shaft) {
    const {radius: r, height: h} = e.shaft;
    k.turned('octagon', 'stone', [x, y + .4, z], [r * 2.5, .8, r * 2.5], 0, k.tint(c, .05), ph, y, e.extra);
    for (let yy = y + .8; yy < y + h - .05; yy += .6) k.turned('drum', 'stone', [x, yy + .3, z], [r * 2, .59, r * 2], 0, k.tint(c, .05), ph, yy, e.extra);
    if (e.balcony) {
      const yb = y + e.balcony.height, R = e.balcony.radius ?? r * 1.8;
      k.turned('flare', 'stone', [x, yb - .45, z], [R * 2, .9, R * 2], 0, k.tint(c, .05), ph, yb, e.extra);
      for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; k.box('stone', [x + Math.cos(a) * (R - .08), yb + .5, z + Math.sin(a) * (R - .08)], [.12, 1, Math.PI * 2 * R / 16], -a, k.tint(c, .05), ph, yb, e.extra); }
    }
    y += h;
    if (e.cap) k.turned('cone', 'lead', [x, y + e.cap.height / 2, z], [r * 2.3, e.cap.height, r * 2.3], 0, k.tint(e.cap.color ?? '#6c7177', .05), ph, y, e.extra);
  }
}

// ——— Domed hall ———
// A square hall of coursed masonry under a dome on a low drum (a small mosque, a chapel): `center` [x, z],
// `rot`, `size` (side), `height` of the walls, `door` (width, height, on the −u face), `windows` per side,
// `dome` (rise as a share of the radius), `finial`.
function domedHall(k, e, P) {
  const [cx, cz] = e.center, rot = e.rot ?? 0, s = e.size, h = e.height, ph = P(e.phase), c = e.color ?? '#cdbfa3', t = e.thickness ?? .9, y0 = e.y0 ?? 0;
  const co = Math.cos(rot), si = Math.sin(rot), W = (u, y, v) => [cx + u * co + v * si, y, cz - u * si + v * co];
  for (let y = y0, row = 0; y < y0 + h - .05; row++) {
    const hh = Math.min(.45, y0 + h - y);
    for (const [side, du, dv] of [[0, -1, 0], [1, 1, 0], [2, 0, -1], [3, 0, 1]]) {
      const len = side < 2 ? s : s - 2 * t;
      for (let q = -len / 2 + (row % 2) * .5; q < len / 2 - .05;) {
        const l = .9 + k.rand() * .5, a = Math.max(-len / 2, q), b = Math.min(len / 2, q + l), m = (a + b) / 2;
        const door = side === 0 && e.door && Math.abs(m) < e.door.width / 2 && y < y0 + e.door.height;
        const win = e.windows && y > y0 + h * .45 && y < y0 + h * .8 && [-1, 0, 1].slice(0, e.windows).some(w => Math.abs(m - w * s / 3.2) < .45);
        if (b - a > .08 && !door && !win) k.box('stone', W(du ? du * (s / 2 - t / 2) : m, y + hh / 2, dv ? dv * (s / 2 - t / 2) : m), du ? [t, hh * .96, b - a - .02] : [b - a - .02, hh * .96, t], rot, k.tint(c, .07), ph, y, e.extra);
        q += l;
      }
    }
    y += hh;
  }
  const R = s / 2 - t / 2, rise = e.dome ?? 1, yd = y0 + h + .6;
  k.turned('octagon', 'stone', W(0, y0 + h + .3, 0), [s * 1.06, .6, s * 1.06], rot, k.tint(c, .05), ph, y0 + h, e.extra);
  for (let j = 0; j < 9; j++) {
    const b = (j + .5) / 9 * Math.PI / 2, rr = R * Math.cos(b), yy = yd + R * rise * Math.sin(b), m = Math.max(4, Math.round(2 * Math.PI * rr / .8));
    for (let i = 0; i < m; i++) { const a = (i + (j % 2) * .5) / m * Math.PI * 2; k.box(e.domeKind ?? 'lead', [W(0, 0, 0)[0] + Math.cos(a) * rr, yy, W(0, 0, 0)[2] + Math.sin(a) * rr], [t * .7, R * rise * Math.PI / 18 * 1.1, 2 * Math.PI * rr / m * 1.06], -a, k.tint(e.domeColor ?? '#7f868c', .04), ph, yy, e.extra); }
  }
  if (e.finial) k.turned('spike', 'metal', W(0, yd + R * rise + .6, 0), [.25, 1.2, .25], 0, k.tint('#c9a24a', .05), ph, yd + R * rise, e.extra);
}

export default {
  doricTemple(k, e, P) { doricTemple(k, e, P); },
  apse(k, e, P) { apse(k, e, P); },
  minaret(k, e, P) { minaret(k, e, P); },
  domedHall(k, e, P) { domedHall(k, e, P); },
};
