import * as T from 'three';
import {Soup, Layers} from './masonry.js';

// Bricks for a Renaissance château: round towers, ranges of lodgings with their dormers and chimneys, a
// lantern tower over a stair. Like the Gothic bricks they stand on a frame — u along the element's axis, v
// across it, y up, placed by `center` and `rot` — and, with `"masonry": "mesh"`, build their masonry as real
// surfaces (kit/masonry.js): a curved wall is one continuous skin cut by the true outline of its windows,
// a cornice is a section turned round the tower, a roof is a surface of revolution drawn in courses of slates.
//
// `renaissance(gothic)` returns the generators: kit/builder.js hands it the Gothic toolkit, whose walls,
// roofs and string courses these bricks reuse for everything that is flat.
const TAU = Math.PI * 2;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const stepFor = (radius, tol) => 2 * Math.acos(clamp(1 - tol / Math.max(radius, 1e-3), -1, 1));
const rad = degrees => degrees * Math.PI / 180;

export function renaissance(gothic) {
  // The frame of one element: its toolkit, and how a point of the frame reaches the scene.
  function begin(e, k, P) {
    const G = gothic(k, e, P), rot = e.rot ?? 0, co = Math.cos(rot), si = Math.sin(rot);
    const frame = {point: ([u, y, v]) => G.V(u, y, v).toArray(), vector: ([a, y, b]) => [a * co + b * si, y, -a * si + b * co]};
    const tol = k.tolerance ?? .005, mesh = k.masonry === 'mesh';
    const patch = (kind, soup, color, ph = G.phase, extra = {}) => k.patch(kind, soup, G.tint(color), ph, extra);
    const layers = step => new Layers(frame, step);
    const flush = (L, kind, color, ph = G.phase, extra = {}) => L.flush(soup => patch(kind, soup, color, ph, extra));
    return {G, k, frame, rot, tol, mesh, patch, layers, flush, soup: () => new Soup(frame), tint: G.tint, V: G.V, phase: G.phase};
  }

  // A profile [[r, y], …] (bottom to top, `r` the distance from the axis) turned about the vertical axis through
  // c = [u, v] between angles a0 and a1: a cornice, a string course, a dome, a cone. `mason(s, d)` gives the
  // material's coordinates from the arc length s and the distance d along the profile; `smooth` shades the
  // profile's points with the mean of their two segments (a dome) instead of keeping its corners (a cornice).
  function lathe(L, c, profile, {a0 = 0, a1 = TAU, tol = .01, mason = () => [0, 0, 0], smooth = false, outward = 1, minSteps = 12} = {}) {
    const rMax = Math.max(...profile.map(p => p[0]), .1), n = Math.max(minSteps, Math.ceil((a1 - a0) / Math.max(stepFor(rMax, tol), .02)));
    const segs = [];
    let run = 0;
    for (let i = 0; i < profile.length - 1; i++) {
      const [r0, y0] = profile[i], [r1, y1] = profile[i + 1], dr = r1 - r0, dy = y1 - y0, len = Math.hypot(dr, dy);
      if (len < 1e-6) continue;
      segs.push({i, r0, y0, r1, y1, len, from: run, nr: dy / len * outward, ny: -dr / len * outward});
      run += len;
    }
    const mean = (a, b) => { const x = a.nr + b.nr, y = a.ny + b.ny, l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
    segs.forEach((s, j) => {
      s.n0 = smooth && j > 0 ? mean(segs[j - 1], s) : [s.nr, s.ny];
      s.n1 = smooth && j < segs.length - 1 ? mean(s, segs[j + 1]) : [s.nr, s.ny];
    });
    for (let j = 0; j < n; j++) {
      const A = a0 + (a1 - a0) * j / n, B = a0 + (a1 - a0) * (j + 1) / n;
      for (const s of segs) {
        const vert = (a, r, y, nn, d) => ({p: [c[0] + Math.cos(a) * r, y, c[1] + Math.sin(a) * r], n: [Math.cos(a) * nn[0], nn[1], Math.sin(a) * nn[0]], m: mason(a * r, d)});
        L.fan([vert(A, s.r0, s.y0, s.n0, s.from), vert(B, s.r0, s.y0, s.n0, s.from), vert(B, s.r1, s.y1, s.n1, s.from + s.len), vert(A, s.r1, s.y1, s.n1, s.from + s.len)]);
      }
    }
  }

  // Walls of a round tower: a skin cut by its windows, laid in patches from the bottom up (the engine's `order`).
  // Angles in radians about the tower's axis (u = cos, v = sin). `holes` are windows: {a, w, sill, head}, `a` the
  // angle of the window's middle, `w` its width, `sill` and `head` its heights. The skin has an outer face at radius R,
  // an inner face at R − t, the reveals and sills of the windows, and a cap on top.
  function drumWall(S, {R, t, a0 = 0, a1 = TAU, y0, y1, holes = [], row = 1.6, cell = 3.6, course = .32, color, phase, extra = {}}) {
    const {k, tol} = S, arc = R * (a1 - a0), full = Math.abs(a1 - a0 - TAU) < 1e-6;
    const stepA = Math.max(.02, stepFor(R, tol)), inner = R - t;
    const H = holes.map(h => ({...h, s: (h.a - a0) * R, lo: h.sill, hi: h.head})).map(h => ({...h, sa: h.s - h.w / 2, sb: h.s + h.w / 2}));
    const ang = s => a0 + s / R;
    const point = (r, s, y) => [Math.cos(ang(s)) * r, y, Math.sin(ang(s)) * r];
    const radial = s => [Math.cos(ang(s)), 0, Math.sin(ang(s))];
    const mason = (s, y) => [s, y, course];
    // A face between s0 and s1 and between yl and yu at radius r, facing `sign` (outwards: 1), tessellated along the arc.
    const face = (soup, s0, s1, yl, yu, r, sign) => {
      const n = Math.max(1, Math.ceil((s1 - s0) / R / stepA)), rows = [];
      for (let i = 0; i <= n; i++) {
        const s = s0 + (s1 - s0) * i / n, nn = radial(s).map(x => x * sign);
        rows.push([soup.vertex(point(r, s, yl), nn, mason(s, yl)), soup.vertex(point(r, s, yu), nn, mason(s, yu))]);
      }
      for (let i = 0; i < n; i++) soup.fan([rows[i][0], rows[i + 1][0], rows[i + 1][1], rows[i][1]]);
    };
    // A face across the wall (from r = inner to R) at arc length s: the end of a wall, the side of a window.
    const side = (soup, s, yl, yu, sign) => {
      const a = ang(s), nn = [-Math.sin(a) * sign, 0, Math.cos(a) * sign];
      soup.fan([[inner, yl], [R, yl], [R, yu], [inner, yu]].map(([r, y]) => soup.vertex(point(r, s, y), nn, mason(s, y))));
    };
    // A horizontal face (a sill, a soffit, the cap) between s0 and s1 from inner to R, facing up (`up` = 1) or down.
    const flat = (soup, s0, s1, y, up) => {
      const n = Math.max(1, Math.ceil((s1 - s0) / R / stepA)), nn = [0, up, 0], rows = [];
      for (let i = 0; i <= n; i++) { const s = s0 + (s1 - s0) * i / n; rows.push([soup.vertex(point(inner, s, y), nn, mason(s, y)), soup.vertex(point(R, s, y), nn, mason(s, y))]); }
      for (let i = 0; i < n; i++) soup.fan([rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0]]);
    };
    const cells = Math.max(1, Math.round(arc / cell)), cw = arc / cells, rows = Math.max(1, Math.round((y1 - y0) / row)), rh = (y1 - y0) / rows;
    for (let r = 0; r < rows; r++) {
      const ya = y0 + r * rh, yb = ya + rh;
      for (let c = 0; c < cells; c++) {
        const sa = c * cw, sb = (c + 1) * cw, soup = S.soup();
        const ys = [...new Set([ya, yb, ...H.flatMap(h => [h.lo, h.hi]).filter(y => y > ya + 1e-6 && y < yb - 1e-6)])].sort((p, q) => p - q);
        for (let i = 0; i < ys.length - 1; i++) {
          const yl = ys[i], yu = ys[i + 1], mid = (yl + yu) / 2;
          let spans = [[sa, sb]];
          for (const h of H) if (mid > h.lo && mid < h.hi) spans = spans.flatMap(([p, q]) => h.sb <= p || h.sa >= q ? [[p, q]] : [[p, Math.min(q, h.sa)], [Math.max(p, h.sb), q]]).filter(([p, q]) => q - p > 1e-4);
          for (const [p, q] of spans) { face(soup, p, q, yl, yu, R, 1); face(soup, p, q, yl, yu, inner, -1); }
        }
        if (r === rows - 1) flat(soup, sa, sb, yb, 1);
        if (!full && c === 0) side(soup, sa, ya, yb, -1);
        if (!full && c === cells - 1) side(soup, sb, ya, yb, 1);
        S.patch('stone', soup, color, phase, extra);
      }
    }
    // The reveals of every window: its two sides, its sill and its soffit, as one patch.
    for (const h of H) {
      const soup = S.soup();
      for (const [s, sign] of [[h.sa, 1], [h.sb, -1]]) side(soup, s, h.lo, h.hi, sign);
      flat(soup, h.sa, h.sb, h.lo, 1); flat(soup, h.sa, h.sb, h.hi, -1);
      S.patch('stone', soup, color, phase, extra);
    }
  }

  // The stone dressing of a window on a wall whose face at the window faces `out` ([du, dv] of the frame): jambs, a lintel
  // with its small cornice, a sill, and the cross of a mullion and a transom with the glass behind it.
  function dressWindow(S, {at, out, w, sill, head, wall = 1, stone, glass = '#3a4655', mullion = true, transom = true, lights = 0, phase, extra = {}, proud = .1}) {
    const {G} = S, dir = [-out[1], out[0]], h = head - sill, off = d => [at[0] + out[0] * d, at[1] + out[1] * d];
    const jamb = .26 + .02 * w, tint = c => G.tint(c, .04);
    for (const side of [-1, 1]) G.box('stone', off(proud * .6).map((x, i) => x + dir[i] * side * (w / 2 + jamb / 2 - .04)), sill + h / 2 + .06, [jamb, h + .3, .34], dir, tint(stone), phase, extra);
    G.box('stone', off(proud * .8), head + .15, [w + jamb * 2 + .1, .3, .42], dir, tint(stone), phase, extra);
    G.box('stone', off(proud * 1.5), head + .36, [w + jamb * 2 + .42, .12, .5], dir, tint(stone), phase, extra);
    G.box('stone', off(proud * .9), sill - .08, [w + jamb * 2 - .1, .16, .46], dir, tint(stone), phase, extra);
    const inset = off(-wall * .42);
    G.box('glass', inset, sill + h / 2, [w, h, .05], dir, tint(glass), phase, extra);
    if (mullion) G.box('wood', off(-wall * .42 + .05), sill + h / 2, [.1, h, .09], dir, tint('#cfc7b4'), phase, extra);
    if (transom) G.box('wood', off(-wall * .42 + .05), sill + h * .64, [w, .1, .09], dir, tint('#cfc7b4'), phase, extra);
    for (let i = 1; i <= lights; i++) G.box('wood', off(-wall * .42 + .05), sill + h * i / (lights + 1), [w, .05, .08], dir, tint('#cfc7b4'), phase, extra);
  }

  // An open lantern crowning a roof: a lead or slate spire, a ring of slim columns under a lead dome, a gilded vane.
  // `at` [u, v], `y` the foot of the spire; `spire` the height of its foot-piece, `open` the columns' height, `radius` its girth.
  function lantern(S, {at, y, radius = 1.3, spire = 4.8, open = 2.7, dome = 1.7, vane = 1.7, columns = 6, kind = 'lead', color = '#b4bdc8', stone = '#d7ccb4', gilt = '#c9a94a', phase, extra = {}}) {
    const {k, G, tol} = S, c = at;
    // The foot: a tall cone rising from a swelling base, slates or lead in courses.
    const L = S.layers(1.6), foot = [[radius * 1.55, y], [radius * 1.3, y + spire * .12], [radius * 1.02, y + spire * .45], [radius * .86, y + spire * .8], [radius * .9, y + spire]];
    lathe(L, c, foot, {tol: .02, mason: (s, d) => [s, d, .24], smooth: true});
    S.flush(L, kind === 'lead' ? 'slate' : 'slate', color, phase, extra);
    // The ring of columns and the cornice that carries the dome.
    const y1 = y + spire, rim = S.layers(1.2);
    lathe(rim, c, [[radius * 1.05, y1], [radius * 1.05, y1 + .14], [radius * 1.12, y1 + .14], [radius * 1.12, y1 + .3], [radius * .98, y1 + .3]], {tol: .02});
    S.flush(rim, 'stone', stone, phase, extra);
    for (let i = 0; i < columns; i++) {
      const a = i / columns * TAU, x = c[0] + Math.cos(a) * radius * .96, z = c[1] + Math.sin(a) * radius * .96, p = G.V(x, y1 + .3 + open / 2, z).toArray();
      k.turned('drum', 'stone', p, [radius * .17, open, radius * .17], 0, G.tint(stone, .03), phase, y1, extra);
    }
    const y2 = y1 + .3 + open;
    const cap = S.layers(1.2);
    lathe(cap, c, [[radius * 1.12, y2], [radius * 1.12, y2 + .16], [radius * 1.2, y2 + .16], [radius * 1.2, y2 + .34]], {tol: .02});
    S.flush(cap, 'stone', stone, phase, extra);
    // The dome, in lead, then the finial and the vane.
    const D = S.layers(1.2), seg = 7, prof = Array.from({length: seg + 1}, (_, i) => { const t = i / seg * Math.PI / 2; return [radius * 1.2 * Math.cos(t) + .001, y2 + .34 + dome * Math.sin(t)]; });
    lathe(D, c, prof, {tol: .02, smooth: true, mason: (s, d) => [s, d, .3]});
    S.flush(D, 'lead', '#7e8790', phase, extra);
    const top = y2 + .34 + dome, p = G.V(c[0], 0, c[1]).toArray();
    k.turned('ball', 'gilt', [p[0], top + .12, p[2]], [.34, .34, .34], 0, G.tint(gilt, .02), phase, top, extra);
    k.box('gilt', [p[0], top + vane / 2, p[2]], [.06, vane, .06], 0, G.tint(gilt, .02), phase, top, extra);
    k.box('gilt', [p[0], top + vane * .78, p[2]], [.55, .05, .05], 0, G.tint(gilt, .02), phase, top, extra);
  }

  // A round tower: a drum of ashlar in courses with string courses, flat piers and windows, a cornice turned round
  // its head, and a roof of slates in courses (a cone, or any profile) that may carry a lantern.
  function drumTower(k, e, P) {
    const S = begin(e, k, P), {G} = S;
    if (!S.mesh) throw new Error('drumTower needs "masonry": "mesh" in the monument file.');
    const R = e.radius, t = e.thickness ?? 1.4, y0 = e.y0 ?? 0, y1 = y0 + e.height, stone = e.color ?? '#f3efe1';
    const [d0, d1] = e.arc ?? [0, 360], a0 = rad(d0), a1 = rad(d1), full = Math.abs(d1 - d0 - 360) < 1e-6, phase = S.phase;
    const life = (spec, fn) => G.life(spec, fn);
    // Windows: each spec lists angles (degrees, 0 = towards +u, 90 = towards +v) or a `count` spread over the arc.
    const windows = (e.windows ?? []).flatMap(spec => {
      const angles = spec.angles ?? Array.from({length: spec.count}, (_, i) => d0 + (i + .5) * (d1 - d0) / spec.count);
      return angles.map(a => ({a: rad(a), w: spec.w ?? 1.5, sill: spec.sill, head: spec.head, spec}));
    }).filter(w => full || (w.a > a0 + .1 && w.a < a1 - .1));
    life(e.wall, (ph, extra) => {
      drumWall(S, {R, t, a0, a1, y0, y1, holes: windows, color: stone, phase: ph, extra, row: e.row ?? 1.6, cell: e.cell ?? 3.6});
      for (const w of windows) dressWindow(S, {at: [Math.cos(w.a) * R, Math.sin(w.a) * R], out: [Math.cos(w.a), Math.sin(w.a)], w: w.w, sill: w.sill, head: w.head, wall: t, stone, mullion: w.spec.mullion ?? true, transom: w.spec.transom ?? true, lights: w.spec.lights ?? 0, phase: ph, extra});
    });
    // String courses: a moulding turned round the wall at each height of `courses`.
    for (const y of e.courses ?? []) life(e.wall, (ph, extra) => {
      const L = S.layers(2);
      lathe(L, [0, 0], [[R - .02, y - .12], [R + .1, y - .12], [R + .17, y - .02], [R + .17, y + .1], [R + .08, y + .16], [R - .02, y + .16]], {a0, a1, tol: .01});
      S.flush(L, 'stone', stone, ph, extra);
    });
    // The flat piers between the bays, from foot to head, a little proud of the wall.
    if (e.piers) life(e.wall, (ph, extra) => {
      const n = e.piers, width = e.pierWidth ?? .55, ys = [y0, ...(e.courses ?? []).filter(y => y > y0 && y < y1), y1];
      for (let i = 0; i < n; i++) {
        const a = a0 + (i + (full ? 0 : .5)) / (full ? n : n) * (a1 - a0);
        if (!full && (a < a0 + .02 || a > a1 - .02)) continue;
        if (windows.some(w => Math.abs(Math.atan2(Math.sin(w.a - a), Math.cos(w.a - a))) * R < w.w / 2 + .5)) continue;
        for (let j = 0; j < ys.length - 1; j++) G.box('stone', [Math.cos(a) * R, Math.sin(a) * R], (ys[j] + ys[j + 1]) / 2, [width, ys[j + 1] - ys[j] - .2, .3], [-Math.sin(a), Math.cos(a)], G.tint(stone, .03), ph, extra);
      }
    });
    // The cornice under the head: a turned moulding on a frieze, with its modillions.
    if (e.cornice) life(e.wall, (ph, extra) => {
      const c = e.cornice, y = y1 - (c.height ?? 1.6), out = c.out ?? .8, L = S.layers(2);
      lathe(L, [0, 0], [[R + .02, y], [R + .12, y], [R + .12, y + .25], [R + .3, y + .3], [R + .3, y + .55], [R + out * .6, y + .62], [R + out * .6, y + .82], [R + out, y + .9], [R + out, y + (c.height ?? 1.6) - .2], [R + out - .1, y + (c.height ?? 1.6)], [R - .3, y + (c.height ?? 1.6)]], {a0, a1, tol: .01});
      S.flush(L, 'stone', stone, ph, extra);
      for (let i = 0; i < (c.corbels ?? 0); i++) {
        const a = a0 + (i + .5) / c.corbels * (a1 - a0);
        G.box('stone', [Math.cos(a) * (R + .38), Math.sin(a) * (R + .38)], y + .3, [.34, .36, .36], [-Math.sin(a), Math.cos(a)], G.tint(stone, .03), ph, extra);
      }
    });
    // The head of a tall tower: a paved ring inside the balustrade, dormers set round the foot of the cone, chimney stacks.
    if (e.top) life(e.top, (ph, extra) => {
      const t0 = e.top, from = t0.deck ?? 0;
      if (from) {
        const Ld = S.layers(3);
        lathe(Ld, [0, 0], [[from, y1 + .02], [R - .2, y1 + .02]], {a0, a1, tol: .02, outward: -1});
        S.flush(Ld, 'stone', t0.deckColor ?? '#d6cdb8', ph, extra);
      }
      const d = t0.dormers;
      // `angles` (degrees) sets each dormer's place when they are not evenly spread over `arc`.
      if (d) for (let i = 0; i < (d.angles?.length ?? d.count); i++) {
        const a = d.angles ? rad(d.angles[i]) : rad(d.arc[0]) + (i + .5) / d.count * (rad(d.arc[1]) - rad(d.arc[0])), r = d.r ?? 7.4;
        dormer(S, {at: [Math.cos(a) * r, Math.sin(a) * r], out: [Math.cos(a), Math.sin(a)], y: y1 + .05, w: d.w ?? 2.4, h: d.h ?? 4.2, pediment: d.pediment ?? 'triangle', slope: 1.6, stone, phase: ph, extra});
      }
      for (const c of t0.chimneys ?? []) {
        const a = rad(c.a), r = c.r ?? 6.5;
        chimney(S, {at: [Math.cos(a) * r, Math.sin(a) * r], y: y1 + .05 + (c.base ?? 5), w: c.w ?? 1.5, d: c.d ?? 1.1, h: c.h ?? 6, rot: -a, kind: c.kind, crown: c.crown, stone, phase: ph, extra});
      }
    });
    // A balustrade round the head of a low tower: plinth and coping turned, balusters between posts.
    if (e.balustrade) life(e.balustrade, (ph, extra) => {
      const y = y1, rr = R + (e.cornice?.out ?? .8) - .25, L = S.layers(3), hgt = e.balustrade.height ?? 1.05;
      lathe(L, [0, 0], [[rr - .2, y + .02], [rr + .2, y + .02], [rr + .2, y + .26], [rr - .2, y + .26]], {a0, a1, tol: .01});
      lathe(L, [0, 0], [[rr - .18, y + hgt - .16], [rr + .18, y + hgt - .16], [rr + .18, y + hgt], [rr - .18, y + hgt]], {a0, a1, tol: .01});
      S.flush(L, 'stone', stone, ph, extra);
      const n = Math.round((a1 - a0) * rr / .34), posts = Math.max(8, Math.round((a1 - a0) * rr / 4.5));
      for (let i = 0; i < n; i++) {
        const a = a0 + (i + .5) / n * (a1 - a0), post = i % Math.max(1, Math.round(n / posts)) === 0, p = G.V(Math.cos(a) * rr, 0, Math.sin(a) * rr).toArray();
        if (post) k.box('stone', [p[0], y + hgt / 2, p[2]], [.34, hgt, .34], S.rot - a - Math.PI / 2, G.tint(stone, .03), ph, y, extra);
        else k.turned('bell', 'stone', [p[0], y + .26 + (hgt - .42) / 2, p[2]], [.2, hgt - .42, .2], 0, G.tint(stone, .03), ph, y, extra);
      }
    });
    // The roof, as a surface of revolution in courses of slates.
    if (e.roof) life(e.roof, (ph, extra) => {
      const r = e.roof, base = r.y ?? y1, prof = r.profile ?? [[R + (r.overhang ?? .3), 0], [r.top ?? .4, r.height]];
      const L = S.layers(1.6);
      lathe(L, [0, 0], prof.map(([rr, dy]) => [rr, base + dy]), {a0, a1, tol: .02, smooth: r.smooth ?? true, mason: (s, d) => [s, d, .24]});
      S.flush(L, 'slate', r.color ?? '#a9b3bf', ph, extra);
      if (r.lantern) lantern(S, {at: [0, 0], y: base + prof.at(-1)[1] - .05, phase: ph, extra, stone, ...r.lantern});
    });
  }

  // ——— Flat walls: ranges of lodgings ———
  // The Gothic toolkit's walls call `opening` for the light of each window they cut. A Renaissance window is not
  // pointed: it is a rectangle with a stone cross, jambs and a lintel under a small cornice; a round-headed bay (an
  // arcade, a loggia) keeps the toolkit's own mouldings round it.
  function dressing(S, stone, original) {
    return (F, o, t, ph, extra) => {
      if (o.kind !== 'rect') { original(F, o, t, ph, extra); return; }
      const [p0, , q0] = F(o.s, 0, 0), [p1, , q1] = F(o.s, 0, 1), out = [p1 - p0, q1 - q0], at = F(o.s, 0, t / 2);
      dressWindow(S, {at: [at[0], at[2]], out, w: o.w, sill: o.sill, head: o.spring, wall: t, stone, glass: o.glass, mullion: o.mullion ?? o.cross ?? true, transom: o.transom ?? o.cross ?? true, lights: o.lights ?? 0, phase: ph, extra, proud: o.proud ?? .1});
    };
  }

  // A string course or a cornice run along a wall, as a swept section.
  function course(S, a, b, y, t, out, ph, extra, section) {
    const {G} = S, M = G.mesh;
    if (M) M.string(a, b, y, t, out, ph, extra, section);
  }
  // Sections run up the wall: [height, projection], starting and ending on the face.
  const BAND = [[0, 0], [.04, .1], [.16, .1], [.2, .2], [.3, .2], [.34, .1], [.46, .1], [.5, 0]];
  const CORNICE = (c = 1) => [[0, 0], [.05, .1], [.22, .1], [.3, .22], [.45, .22], [.52, .4], [.62, .4], [.7, .62], [.95, .62], [1.05, .85], [1.25, .85], [1.3, .7], [1.3, 0]].map(([r, d]) => [r * c, d * c]);

  // A stone balustrade between two points: a plinth, turned balusters, a coping and a post every few metres.
  function balustrade(S, a, b, y, {height = 1.05, stone, post = 5, phase, extra = {}}) {
    const {G, k} = S, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < .3) return;
    const dir = [(b[0] - a[0]) / len, (b[1] - a[1]) / len], at = s => [a[0] + dir[0] * s, a[1] + dir[1] * s], tint = c => G.tint(c, .03);
    const mid = at(len / 2);
    G.box('stone', mid, y + .12, [len, .24, .42], dir, tint(stone), phase, extra);
    G.box('stone', mid, y + height - .08, [len, .16, .36], dir, tint(stone), phase, extra);
    const n = Math.max(1, Math.round(len / .33)), step = len / n;
    for (let i = 0; i <= n; i++) {
      const s = i * step, big = post && (i % Math.round(post / step) === 0 || i === 0 || i === n), p = at(s), q = G.V(p[0], 0, p[1]).toArray();
      if (big) G.box('stone', p, y + height / 2, [.34, height, .34], dir, tint(stone), phase, extra);
      else k.turned('bell', 'stone', [q[0], y + .24 + (height - .4) / 2, q[2]], [.2, height - .4, .2], 0, tint(stone), phase, y, extra);
    }
  }

  // A chimney stack as the roofs of Chambord show it: a shaft of white stone on a moulded plinth, its four faces inlaid
  // with slate, a frieze of slate dots under a moulded cornice, and a crown. `kind` is what the faces carry: 'lozenges',
  // a lattice of tall diamonds with half-diamonds against the arrises; or 'discs', great discs (two side by side on a
  // wide face) and a half-disc hanging under the frieze. `crown`: 'gable', a pediment over each long face under a
  // small roof of slate; 'pinnacles', an attic with a pinnacle at each corner round a spire of slate; 'cap', a moulded
  // cap and a pot.
  function chimney(S, {at, y, w = 1.6, d = 1.1, h = 5, rot = 0, stone, slate = '#4b525c', phase, extra = {}, kind = 'lozenges', crown = 'gable'}) {
    const {G, k} = S, dir = [Math.cos(rot), -Math.sin(rot)], perp = [Math.sin(rot), Math.cos(rot)], tint = c => G.tint(c, .03);
    const box = (y0, [l, hh, t]) => G.box('stone', at, y0 + hh / 2, [l, hh, t], dir, tint(stone), phase, extra);
    const frieze = y + h - .55, top = y + h + .55;
    box(y, [w + .3, .6, d + .3]); box(y, [w, h, d]); box(frieze, [w + .1, .55, d + .1]);
    box(y + h, [w + .35, .3, d + .35]); box(y + h + .3, [w + .15, .25, d + .15]);
    // The slate, face by face: outlines [across the face, height] laid flat on it.
    const L = S.layers(2), y0 = y + .9, y1 = frieze - .15;
    for (const side of [-1, 1]) for (const [n, half, width] of [[perp.map(x => x * side), d / 2, w], [dir.map(x => x * side), w / 2, d]]) {
      const c = [at[0] + n[0] * (half + .015), at[1] + n[1] * (half + .015)], across = [n[1], -n[0]];
      const shape = points => inlay(L, c, across, [n[0], 0, n[1]], points);
      // The frieze: a row of dots.
      const dots = Math.max(2, Math.round(width / .34));
      for (let i = 0; i < dots; i++) shape(round((i + .5 - dots / 2) * width / dots, frieze + .27, .07, 8));
      if (kind === 'discs') {
        // Each disc set on a round plate of stone standing proud of the face, whose edge frames it and catches the light.
        const cols = width >= 2.2 ? 2 : 1, r = Math.min(width / cols * .32, .55), xs = cols === 2 ? [-width / 4, width / 4] : [0];
        const span = y1 - y0 - r * 1.6, rows = Math.min(2, Math.max(1, Math.floor(span / (r * 4.5))));
        const axis = G.V(c[0] + n[0], 0, c[1] + n[1]).sub(G.V(c[0], 0, c[1])), plate = [c[0] + n[0] * .06, c[1] + n[1] * .06];
        for (let i = 0; i < rows; i++) for (const x of xs) {
          const yc = y0 + span * (i + .5) / rows;
          inlay(L, plate, across, [n[0], 0, n[1]], round(x, yc, r, 16));
          k.lying('drum', 'stone', G.V(c[0] + across[0] * x + n[0] * .005, yc, c[1] + across[1] * x + n[1] * .005), axis, [2 * r + .16, .1], tint(stone), phase, yc, extra);
        }
        for (const x of xs) shape(round(x, y1, r * .9, 16, Math.PI));
      } else {
        // Between the slate, bands of stone cross in an X from arris to arris.
        const rows = Math.max(1, Math.round((y1 - y0) / (width * 1.9))), ph = (y1 - y0) / rows, rx = width * .22, ry = ph * .36, edge = width / 2 - .1;
        for (let i = 0; i < rows; i++) { const yc = y0 + (i + .5) * ph; shape([[-rx, yc], [0, yc - ry], [rx, yc], [0, yc + ry]]); }
        for (let i = 0; i <= rows; i++) for (const s of [-1, 1]) {
          const yb = y0 + i * ph;
          shape([[s * edge, yb - (i > 0 ? ry : 0)], [s * (edge - rx * .9), yb], [s * edge, yb + (i < rows ? ry : 0)]]);
        }
      }
    }
    S.flush(L, 'slate', slate, phase, extra);
    const P = (du, yy, dv) => G.V(at[0] + dir[0] * du + perp[0] * dv, yy, at[1] + dir[1] * du + perp[1] * dv).toArray();
    if (crown === 'gable') {
      // An attic, a pediment over each long face, and the small roof of slate between them, its ridge across.
      box(top, [w * .92, .45, d * .92]);
      const base = top + .45, run = w * .46 + .08, rise = w * .36, n = 5;
      for (let i = 0; i < n; i++) box(base + rise * i / n, [2 * run * (1 - (i + .5) / n), rise / n * 1.05, d * .92]);
      const R = S.layers(2), deep = d * .46 + .08;
      for (const s of [-1, 1]) {
        const len = Math.hypot(run, rise), nn = [dir[0] * s * rise / len, run / len, dir[1] * s * rise / len], q = (du, yy, dv) => ({p: [at[0] + dir[0] * du + perp[0] * dv, yy, at[1] + dir[1] * du + perp[1] * dv], n: nn, m: [0, 0, 0]});
        R.fan([q(s * run, base + .02, -deep), q(s * run, base + .02, deep), q(0, base + rise + .06, deep), q(0, base + rise + .06, -deep)]);
      }
      S.flush(R, 'slate', slate, phase, extra);
      k.turned('ball', 'stone', P(0, base + rise + .28, 0), [.3, .4, .3], 0, tint(stone), phase, base + rise, extra);
    } else if (crown === 'pinnacles') {
      // An attic with a pinnacle at each corner (a drum, a bulb, a spike) round a spire of slate and its finial.
      box(top, [w * .9, .7, d * .9]);
      const base = top + .7;
      for (const su of [-1, 1]) for (const sv of [-1, 1]) {
        const du = su * (w * .45 - .1), dv = sv * (d * .45 - .1);
        k.turned('drum', 'stone', P(du, base + .15, dv), [.26, .3, .26], 0, tint(stone), phase, base, extra);
        k.turned('ball', 'stone', P(du, base + .42, dv), [.24, .26, .24], 0, tint(stone), phase, base + .3, extra);
        k.turned('spike', 'stone', P(du, base + .95, dv), [.16, .85, .16], 0, tint(stone), phase, base + .55, extra);
      }
      const spire = Math.max(1.2, w * .9);
      k.turned('spike', 'slate', P(0, base + spire / 2, 0), [w * .62, spire, d * .62], rot, tint(slate), phase, base, extra);
      k.turned('ball', 'gilt', P(0, base + spire + .12, 0), [.16, .2, .16], 0, tint('#c9a94a'), phase, base + spire, extra);
    } else {
      box(top, [w * .62, .5, d * .62]);
    }
  }

  // An outline laid flat on a face: `c` its middle on the face [u, v], `across` the face's direction across, `n` its
  // outward normal; `points` [across, height] in order round it.
  function inlay(L, c, across, n, points) {
    L.fan(points.map(([du, y]) => ({p: [c[0] + across[0] * du, y, c[1] + across[1] * du], n, m: [0, 0, 0]})));
  }
  // A disc (or, from `from`, the half of it below its diameter), as an outline of `sides` points.
  const round = (x, y, r, sides, from = 0) => Array.from({length: from ? sides / 2 + 1 : sides}, (_, i) => { const a = from + i / sides * TAU; return [x + Math.cos(a) * r, y + Math.sin(a) * r]; });

  // A diamond laid flat on a face: `c` the middle of it on the face [u, v], `dir` the face's direction along the wall,
  // `n` the face's outward normal, `y` its height, `rx` and `ry` its half-width and half-height.
  function lozenge(L, c, dir, n, y, rx, ry) {
    inlay(L, c, dir, n, [[-rx, y], [0, y - ry], [rx, y], [0, y + ry]]);
  }

  // A dormer on a wall line: two cheeks, a window under a lintel, an entablature and a pediment (a triangle, or a segment).
  // `at` is the middle of its foot on the wall's face, `out` the wall's outward normal, `slope` the roof's rise for a metre
  // of run, so that its cheeks run back to meet the roof.
  function dormer(S, {at, out, y, w = 2.4, h = 3.2, pediment = 'triangle', slope = 1.6, stone, slate = '#4b525c', phase, extra = {}, window = {}}) {
    const {G, k} = S, dir = [-out[1], out[0]], tint = c => G.tint(c, .04), off = d => [at[0] + out[0] * d, at[1] + out[1] * d];
    const cheek = Math.max(.5, w * .24), depth = Math.max(1.4, h / slope + .6), top = y + h;
    for (const side of [-1, 1]) {
      const c = off(.15 - depth / 2).map((x, i) => x + dir[i] * side * (w / 2 - cheek / 2));
      G.box('stone', c, y + h / 2, [cheek, h, depth], dir, tint(stone), phase, extra);
    }
    // Under the window, a solid; the window itself, glazed behind its cross; the entablature above.
    G.box('stone', off(.25), y + .55, [w - cheek, 1.1, .7], dir, tint(stone), phase, extra);
    { // The slate lozenges the dormers of Chambord carry in their stonework: under the window and on each cheek.
      const L = S.layers(2), face = (d, side) => [at[0] + out[0] * d + dir[0] * side, at[1] + out[1] * d + dir[1] * side], n = [out[0], 0, out[1]];
      lozenge(L, face(.61, 0), dir, n, y + .55, Math.min(.42, w * .16), .42);
      for (const side of [-1, 1]) lozenge(L, face(.165, side * (w / 2 - cheek / 2)), dir, n, y + h * .55, Math.min(.2, cheek * .3), Math.min(.5, h * .14));
      S.flush(L, 'slate', slate, phase, extra);
    }
    const ww = w - 2 * cheek - .1, sill = y + 1.1, head = top - .5;
    G.box('glass', off(-.05), (sill + head) / 2, [ww, head - sill, .06], dir, tint('#3a4655'), phase, extra);
    G.box('wood', off(.0), (sill + head) / 2, [.1, head - sill, .1], dir, tint('#cfc7b4'), phase, extra);
    G.box('wood', off(.0), sill + (head - sill) * .62, [ww, .1, .1], dir, tint('#cfc7b4'), phase, extra);
    G.box('stone', off(.2), top - .2, [w + .3, .4, .9], dir, tint(stone), phase, extra);
    // The pediment: a gable of stone, framed by a moulding that follows its rake.
    const run = w / 2 + .15, rise = pediment === 'triangle' ? w * .32 : w * .18, n = 6;
    for (let i = 0; i < n; i++) {
      const f0 = i / n, f1 = (i + 1) / n, hw = run * (1 - (f0 + f1) / 2), yy = top + rise * (f0 + f1) / 2;
      G.box('stone', off(.1), yy, [hw * 2, rise / n * 1.05, .62], dir, tint(stone), phase, extra);
    }
    for (const side of [-1, 1]) {
      const a = off(.45).map((x, i) => x + dir[i] * side * run), b = off(.45);
      k.beam('stone', G.V(a[0], top + .18, a[1]), G.V(b[0], top + rise + .22, b[1]), .26, tint(stone), phase, extra);
    }
    { const q = off(.25); k.turned('ball', 'stone', G.V(q[0], top + rise + .5, q[1]).toArray(), [.34, .5, .34], 0, tint(stone), phase, top, extra); }
  }

  // The frame of a pitched roof, a pair of rafters at a time: tie beams across, rafters up to the ridge, a collar and a
  // purlin on each side. It is laid in the roof's own phase before its slates (pieces rise from the bottom up).
  function frame(S, {a, b, half, eave, ridge, color = '#9a7b55', phase, extra = {}, bays}) {
    const {G, k} = S, len = Math.hypot(b[0] - a[0], b[1] - a[1]), dir = [(b[0] - a[0]) / len, (b[1] - a[1]) / len], side = [-dir[1], dir[0]];
    const at = (s, o, y) => G.V(a[0] + dir[0] * s + side[0] * o, y, a[1] + dir[1] * s + side[1] * o);
    const n = bays ?? Math.max(2, Math.round(len / 3.2)), tint = c => G.tint(c, .05);
    for (let i = 0; i <= n; i++) {
      const s = len * i / n;
      k.beam('wood', at(s, -half, eave), at(s, half, eave), .36, tint(color), phase, extra);
      for (const sign of [-1, 1]) {
        k.beam('wood', at(s, sign * half, eave), at(s, 0, ridge), .26, tint(color), phase, extra);
        k.beam('wood', at(s, sign * half * .5, eave + (ridge - eave) * .5), at(s, -sign * half * .5, eave + (ridge - eave) * .5), .2, tint(color), phase, extra);
      }
      k.beam('wood', at(s, 0, eave), at(s, 0, eave + (ridge - eave) * .55), .26, tint(color), phase, extra);
    }
    for (const sign of [-1, 1]) {
      k.beam('wood', at(0, sign * half * .5, eave + (ridge - eave) * .5), at(len, sign * half * .5, eave + (ridge - eave) * .5), .24, tint(color), phase, extra);
      k.beam('wood', at(0, sign * half * .96, eave + (ridge - eave) * .04), at(len, sign * half * .96, eave + (ridge - eave) * .04), .24, tint(color), phase, extra);
    }
    k.beam('wood', at(0, 0, ridge), at(len, 0, ridge), .3, tint(color), phase, extra);
  }

  // A range of lodgings: four walls of ashlar with their storeys, string courses, flat piers and windows, a cornice, and a
  // roof — `gable` (a ridge along u or v), `hip`, `mansard` (a broken roof), or a `terrace` with its balustrade.
  function lodgingRange(k, e, P) {
    const S = begin(e, k, P), {G} = S;
    if (!S.mesh) throw new Error('lodgingRange needs "masonry": "mesh" in the monument file.');
    const L = e.length, D = e.depth, y0 = e.y0 ?? 0, t = e.thickness ?? 1.6, stone = e.color ?? '#f6f2e6', levels = e.levels ?? [6.5, 6.5, 6], phase = S.phase;
    const floors = levels.reduce((acc, h) => (acc.push((acc.at(-1) ?? y0) + h), acc), []), top = floors.at(-1);
    G.opening = dressing(S, stone, G.opening);
    const corners = {A: [-L / 2, -D / 2], B: [L / 2, -D / 2], C: [L / 2, D / 2], Dd: [-L / 2, D / 2]};
    const sides = {
      'v-': {a: corners.A, b: corners.B, out: [0, -1]}, 'u+': {a: corners.B, b: corners.C, out: [1, 0]},
      'v+': {a: corners.C, b: corners.Dd, out: [0, 1]}, 'u-': {a: corners.Dd, b: corners.A, out: [-1, 0]},
    };
    const wall = e.wall;
    G.life(wall, (ph, extra) => {
      for (const [name, side] of Object.entries(sides)) {
        const spec = e.sides?.[name];
        if (spec === false) continue;
        // The wall's middle line stands half a thickness inside the outline, so that its outer face is the outline.
        const shift = p => [p[0] - side.out[0] * t / 2, p[1] - side.out[1] * t / 2];
        const a = shift(side.a), b = shift(side.b), len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const s0 = spec?.from ?? 0, s1 = spec?.to ?? len, span = s1 - s0, bays = spec?.bays ?? Math.max(1, Math.round(span / 5)), holes = [];
        const grid = spec?.windows ?? e.windows ?? [{w: 1.5, sill: 1.5, head: 4.7}, {w: 1.5, sill: 1.5, head: 4.7}, {w: 1.5, sill: 1.5, head: 4.3}];
        levels.forEach((h, i) => {
          const g = grid[Math.min(i, grid.length - 1)], base = i === 0 ? y0 : floors[i - 1];
          if (g === false) return;
          for (let j = 0; j < bays; j++) {
            if ((spec?.skip ?? []).some(([lv, bay]) => lv === i && bay === j)) continue;
            holes.push({kind: 'rect', s: s0 + (j + .5) * span / bays, w: g.w, sill: base + g.sill, spring: base + g.head, cross: g.cross ?? true});
          }
        });
        for (const extraHole of spec?.openings ?? []) holes.push(extraHole.kind ? extraHole : {kind: 'rect', ...extraHole});
        const F = G.wall(a, b, y0, top, t, side.out, holes.filter(Boolean), ph, extra, e.course ?? .8);
        // Blind arcades: a round-headed bay drawn on the face by a moulded ring, with a slightly recessed pane inside it.
        for (const arch of spec?.arches ?? []) {
          const dir = [(b[0] - a[0]) / len, (b[1] - a[1]) / len], mid = [a[0] + dir[0] * arch.s + side.out[0] * (t / 2 + .02), a[1] + dir[1] * arch.s + side.out[1] * (t / 2 + .02)];
          G.arch(F, arch.s, arch.w, arch.spring, t / 2 + .03, .34, ph, extra, 'round');
          G.box('stone', mid, (arch.sill ?? y0) + arch.spring / 2 + .05, [arch.w - .5, arch.spring + .1, .06], dir, G.tint('#cfc5ac', .03), ph, extra);
        }
        // The string courses at every floor, and the cornice at the head.
        for (const y of floors.slice(0, -1)) course(S, a, b, y, t, side.out, ph, extra, e.band ?? BAND);
        course(S, a, b, top - (e.corniceHeight ?? 1.3), t, side.out, ph, extra, CORNICE(e.corniceScale ?? 1));
        // Flat piers between the bays.
        if (spec?.piers ?? e.piers ?? true) {
          const dir = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
          for (let j = 0; j <= bays; j++) {
            const s = s0 + j * span / bays, p = [a[0] + dir[0] * s + side.out[0] * (t / 2 + .05), a[1] + dir[1] * s + side.out[1] * (t / 2 + .05)];
            if (j === 0 || j === bays) continue;
            G.box('stone', p, (y0 + top) / 2, [.5, top - y0 - 1.4, .14], dir, G.tint(stone, .03), ph, extra);
          }
        }
      }
      // The floors, so that the section view reads as lodgings and not as a shell: a slab at each level.
      if (e.floors !== false) for (const y of floors.slice(0, -1)) G.box('wood', [0, 0], y - .12, [L - 2 * t, .24, D - 2 * t], [1, 0], G.tint('#a58a63', .04), ph, extra);
    });
    // The roof.
    for (const r of e.roofs ?? (e.roof ? [e.roof] : [])) {
      if (r.kind === 'terrace') {
        G.life(r, (ph, extra) => G.box('stone', [0, 0], top - .1, [L - t, .24, D - t], [1, 0], G.tint(stone, .03), ph, extra));
        // The balustrade has its own date when `balustrade` is an object ({phase, until, rebuild}); otherwise it comes with the terrace.
        if (r.balustrade !== false) G.life(typeof r.balustrade === 'object' ? r.balustrade : r, (ph, extra) => {
          for (const side of Object.values(sides)) balustrade(S, side.a, side.b, top, {stone, phase: ph, extra, post: 4.5});
        });
      }
      else roof(S, e, r, {L, D, top, t, stone, sides});
    }
  }

  // A pitched roof over the range: slates in strips from eave to ridge, a frame under them, dormers and chimneys.
  function roof(S, e, r, {L, D, top, t, stone, sides}) {
    const {G, k} = S, kind = r.kind ?? 'gable', axis = r.axis ?? (L >= D ? 'u' : 'v'), over = r.overhang ?? .45, rise = r.rise ?? 9, color = r.color ?? '#a9b3bf';
    const u2 = L / 2 + over, v2 = D / 2 + over;
    G.life(r, (ph, extra) => {
      
      const ridgeHalf = kind === 'hip' ? Math.max(0, (axis === 'u' ? L - D : D - L) / 2 - (r.ridgeInset ?? 0)) : (axis === 'u' ? L / 2 + over : D / 2 + over);
      const pt = (u, y, v) => G.V(u, y, v);
      if (kind === 'mansard') {
        // A broken roof: a steep lower slope (the household's rooms), a shallow upper one, a flat ridge.
        const along = axis === 'u', br = r.break ?? .38, steep = r.steep ?? 1.9, hv = (along ? D : L) / 2 + over, hu = (along ? L : D) / 2 + over;
        const lowRun = rise * br / steep, inner = hv - lowRun, upRise = rise * (1 - br);
        const P3 = (a, b, y) => along ? pt(a, y, b) : pt(b, y, a);
        const strip = (sgn, sx) => {
          G.panel(P3(-hu, sgn * hv, top), P3(hu, sgn * hv, top), P3(-hu, sgn * inner, top + rise * br), P3(hu, sgn * inner, top + rise * br), color, ph, extra, 'slate', 1.1);
          G.panel(P3(-hu + lowRun * .6, sgn * inner, top + rise * br), P3(hu - lowRun * .6, sgn * inner, top + rise * br), P3(-hu + lowRun * .6, 0, top + rise), P3(hu - lowRun * .6, 0, top + rise), color, ph, extra, 'slate', 1.4);
        };
        strip(-1); strip(1);
        for (const sgn of [-1, 1]) {
          G.panel(P3(sgn * hu, -hv, top), P3(sgn * hu, hv, top), P3(sgn * (hu - lowRun), -inner, top + rise * br), P3(sgn * (hu - lowRun), inner, top + rise * br), color, ph, extra, 'slate', 1.1);
          G.panel(P3(sgn * (hu - lowRun), -inner, top + rise * br), P3(sgn * (hu - lowRun), inner, top + rise * br), P3(sgn * (hu - lowRun * 1.6), 0, top + rise), P3(sgn * (hu - lowRun * 1.6), 0, top + rise), color, ph, extra, 'slate', 1.4);
        }
      }
      if (kind === 'gable' || kind === 'hip') {
        const along = axis === 'u', R = ridgeHalf, e1 = along ? [-u2, -v2] : [-u2, -v2];
        // Four planes: two long slopes, and the two ends (hips) or the end walls of a gable.
        const q = (p0, p1, q0, q1) => G.panel(pt(p0[0], top, p0[1]), pt(p1[0], top, p1[1]), pt(q0[0], top + rise, q0[1]), pt(q1[0], top + rise, q1[1]), color, ph, extra, 'slate', 1.1);
        if (along) {
          q([-u2, -v2], [u2, -v2], [-R, 0], [R, 0]);
          q([u2, v2], [-u2, v2], [R, 0], [-R, 0]);
          if (kind === 'hip') { q([u2, -v2], [u2, v2], [R, 0], [R, 0]); q([-u2, v2], [-u2, -v2], [-R, 0], [-R, 0]); }
        } else {
          q([u2, -v2], [u2, v2], [0, -R], [0, R]);
          q([-u2, v2], [-u2, -v2], [0, R], [0, -R]);
          if (kind === 'hip') { q([-u2, -v2], [u2, -v2], [0, -R], [0, -R]); q([u2, v2], [-u2, v2], [0, R], [0, R]); }
        }
        if (r.frame !== false && kind === 'gable') {
          const half = (along ? D : L) / 2 + over * .6;
          if (along) frame(S, {a: [-L / 2 + t / 2, 0], b: [L / 2 - t / 2, 0], half, eave: top + .1, ridge: top + rise * .93, phase: ph, extra});
          else frame(S, {a: [0, -D / 2 + t / 2], b: [0, D / 2 - t / 2], half, eave: top + .1, ridge: top + rise * .93, phase: ph, extra});
        } else if (r.frame !== false) {
          // A hipped roof stands on tie beams across, a king post, and a rafter from each corner and each side to the ridge.
          const cu = L / 2 - t / 2, cv = D / 2 - t / 2, eaveY = top + .1, apexY = top + rise * .9, Rr = Math.max(0, ridgeHalf - over - .3), tint = c => G.tint(c, .05), wood = '#9a7b55';
          const ends = along ? [[-Rr, 0], [Rr, 0]] : [[0, -Rr], [0, Rr]];
          for (const [su, sv] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
            const e0 = ends.find(([x, z]) => (along ? Math.sign(x || su) === su : Math.sign(z || sv) === sv)) ?? ends[0];
            k.beam('wood', pt(su * cu, eaveY, sv * cv), pt(e0[0], apexY, e0[1]), .3, tint(wood), ph, extra);
          }
          for (const sgn of [-1, 1]) {
            const end = along ? ends[sgn < 0 ? 0 : 1] : ends[sgn < 0 ? 0 : 1];
            k.beam('wood', pt(sgn * cu, eaveY, 0), pt(end[0], apexY, end[1]), .26, tint(wood), ph, extra);
            k.beam('wood', pt(0, eaveY, sgn * cv), pt(end[0], apexY, end[1]), .26, tint(wood), ph, extra);
          }
          k.beam('wood', pt(-cu, eaveY, 0), pt(cu, eaveY, 0), .4, tint(wood), ph, extra);
          k.beam('wood', pt(0, eaveY, -cv), pt(0, eaveY, cv), .4, tint(wood), ph, extra);
          k.beam('wood', pt(0, eaveY, 0), pt(0, apexY, 0), .34, tint(wood), ph, extra);
          if (Rr > .5) k.beam('wood', pt(ends[0][0], apexY, ends[0][1]), pt(ends[1][0], apexY, ends[1][1]), .3, tint(wood), ph, extra);
        }
        // Gable walls: the end walls carry on up to the ridge.
        if (kind === 'gable') {
          const ends = along ? ['u+', 'u-'] : ['v+', 'v-'];
          for (const name of ends) {
            const side = sides[name], w = Math.hypot(side.b[0] - side.a[0], side.b[1] - side.a[1]), c = w / 2;
            const a = [side.a[0] - side.out[0] * t / 2, side.a[1] - side.out[1] * t / 2], b = [side.b[0] - side.out[0] * t / 2, side.b[1] - side.out[1] * t / 2];
            const half = y => Math.max(0, c * (1 - (y - top) / rise));
            G.wall(a, b, top, top + rise, t, side.out, [], ph, extra, .8, {lo: y => c - half(y), hi: y => c + half(y)});
          }
        }
      }
    });
    // Dormers on the long faces, at the eave, and the chimneys on the ridge or the gable.
    for (const d of r.dormers ?? []) G.life(d.phase ? d : r, (ph, extra) => {
      const side = sides[d.side], len = Math.hypot(side.b[0] - side.a[0], side.b[1] - side.a[1]), dir = [(side.b[0] - side.a[0]) / len, (side.b[1] - side.a[1]) / len];
      for (const s of d.at ?? Array.from({length: d.count}, (_, i) => (i + .5) * len / d.count)) {
        const p = [side.a[0] + dir[0] * s, side.a[1] + dir[1] * s];
        dormer(S, {at: p, out: side.out, y: top, w: d.w ?? 2.4, h: d.h ?? 3.4, pediment: d.pediment ?? 'triangle', slope: rise / ((r.axis === 'v' ? L : D) / 2), stone, phase: ph, extra});
      }
    });
    for (const c of r.chimneys ?? []) G.life(c.phase ? c : r, (ph, extra) => chimney(S, {at: c.at, y: c.y ?? top + rise * .3, w: c.w ?? 1.6, d: c.d ?? 1.1, h: c.h ?? 5, rot: c.rot ?? 0, kind: c.kind, crown: c.crown, stone, phase: ph, extra}));
  }

  // A lantern standing on a roof or a tower: a lead (or slate) foot, a ring of columns, a dome and a gilded vane.
  function lanternon(k, e, P) {
    const S = begin(e, k, P);
    S.G.life(e, (ph, extra) => lantern(S, {...e, at: e.at ?? [0, 0], y: e.y ?? 0, phase: ph, extra}));
  }

  // The lantern tower over a crossing: a stone shaft in courses on a polygonal plan with its cornice and four corner turrets,
  // an open lantern of columns under a ringed entablature, a smaller one above it, a stone spire and a gilded finial.
  function lanternTower(k, e, P) {
    const S = begin(e, k, P), {G} = S, M = G.mesh;
    if (!S.mesh) throw new Error('lanternTower needs "masonry": "mesh" in the monument file.');
    const y0 = e.y0 ?? 0, stone = e.color ?? '#f6f2e6', c = [0, 0], tint = col => G.tint(col, .03), A = e.shaft ?? {}, B = e.lantern ?? {}, C = e.upper ?? {}, Sp = e.spire ?? {};
    G.life(e, (ph, extra) => {
      // The shaft.
      const rA = A.radius ?? 3.5, hA = A.height ?? 9.5, sides = A.sides ?? 8, ys = []; for (let y = y0; y < y0 + hA - .05; y += 1.5) ys.push(y); ys.push(y0 + hA);
      M.loft(c, ys, () => rA, ph, extra, {sides, turn: Math.PI / sides, course: .32, color: stone, step: 1.5});
      // Round-headed bays on the four faces, dark behind a stone surround.
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2, d = rA * Math.cos(Math.PI / sides) + .08, p = [Math.cos(a) * d, Math.sin(a) * d], dir = [-Math.sin(a), Math.cos(a)];
        G.box('glass', p, y0 + hA * .55, [1.5, 3.4, .1], dir, tint('#2f3a47'), ph, extra);
        G.box('stone', p.map((x, j) => x + (j ? Math.sin(a) : Math.cos(a)) * .08), y0 + hA * .55 + 1.95, [2.1, .35, .3], dir, tint(stone), ph, extra);
        for (const sgn of [-1, 1]) G.box('stone', p.map((x, j) => x + dir[j] * sgn * .95 + (j ? Math.sin(a) : Math.cos(a)) * .06), y0 + hA * .55, [.28, 3.7, .3], dir, tint(stone), ph, extra);
      }
      // The cornice, and the four corner turrets with their small cones.
      const Lr = S.layers(2), yc = y0 + hA;
      lathe(Lr, c, [[rA - .1, yc - .5], [rA + .35, yc - .5], [rA + .35, yc - .2], [rA + .75, yc - .1], [rA + .75, yc + .35], [rA + .5, yc + .45], [rA - .2, yc + .45]], {tol: .02});
      S.flush(Lr, 'stone', stone, ph, extra);
      const tR = A.turret ?? .95, tH = A.turretHeight ?? 4.6;
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + i * Math.PI / 2, tc = [Math.cos(a) * (rA + .2), Math.sin(a) * (rA + .2)], L2 = S.layers(2);
        lathe(L2, tc, [[tR, yc], [tR, yc + tH]], {tol: .02, mason: (s, d) => [s, yc + d, -.32]});
        lathe(L2, tc, [[tR + .15, yc + tH], [tR + .15, yc + tH + .25], [tR + .05, yc + tH + .25]], {tol: .02});
        S.flush(L2, 'stone', stone, ph, extra);
        const L3 = S.layers(2); lathe(L3, tc, [[tR + .2, yc + tH + .25], [tR * .5, yc + tH + 1.6], [.08, yc + tH + 2.9]], {tol: .02, smooth: true, mason: (s, d) => [s, d, .22]});
        S.flush(L3, 'slate', e.slate ?? '#a9b3bf', ph, extra);
      }
      // The open lantern: columns round a ring, an entablature, then the same smaller.
      const stage = (r0, ya, h, count, ringR) => {
        const L4 = S.layers(2);
        lathe(L4, c, [[r0 + .3, ya], [r0 + .3, ya + .25], [r0 + .55, ya + .25], [r0 + .55, ya + .5]], {tol: .02});
        S.flush(L4, 'stone', stone, ph, extra);
        for (let i = 0; i < count; i++) {
          const a = i / count * TAU, p = G.V(Math.cos(a) * r0, 0, Math.sin(a) * r0).toArray();
          k.turned('drum', 'stone', [p[0], ya + .5 + h / 2, p[2]], [ringR, h, ringR], 0, tint(stone), ph, ya, extra);
        }
        const yt = ya + .5 + h, L5 = S.layers(2);
        lathe(L5, c, [[r0 - .1, yt], [r0 + .45, yt], [r0 + .45, yt + .22], [r0 + .75, yt + .3], [r0 + .75, yt + .6], [r0 + .4, yt + .7], [r0 - .1, yt + .7]], {tol: .02});
        S.flush(L5, 'stone', stone, ph, extra);
        return yt + .7;
      };
      let y = yc + .45;
      y = stage(B.radius ?? 2.6, y, B.height ?? 4.6, B.columns ?? 8, B.column ?? .5);
      y = stage(C.radius ?? 1.7, y, C.height ?? 3.4, C.columns ?? 8, C.column ?? .34);
      // The spire, in scales of stone, and the finial.
      const sp = Sp.height ?? 9.5, L6 = S.layers(2);
      lathe(L6, c, [[(C.radius ?? 1.7) + .3, y], [.12, y + sp]], {tol: .02, mason: (s, d) => [s, d, -.3]});
      S.flush(L6, 'stone', stone, ph, extra);
      const top = y + sp, p = G.V(0, 0, 0).toArray();
      k.turned('ball', 'gilt', [p[0], top + .25, p[2]], [.6, .6, .6], 0, tint('#c9a94a'), ph, top, extra);
      for (const [h, w, dy] of [[1.8, .1, 1.2], [.1, .9, 1.5]]) k.box('gilt', [p[0], top + dy + .5, p[2]], [w, h, w], 0, tint('#c9a94a'), ph, top, extra);
    });
  }

  // A stair of two flights wound one above the other round an open newel (a double helix): the two ramps leave the floor a
  // half-turn apart, so that two people climbing do not meet, and meet the same landings. `levels` are the heights of the
  // floors; each storey is one turn of `steps` treads.
  function doubleHelixStair(k, e, P) {
    const S = begin(e, k, P), {G} = S, Ro = e.radius ?? 4.2, Ri = e.core ?? 1.7, steps = e.steps ?? 24, floors = e.levels, stone = e.color ?? '#e1d7bf', tint = col => G.tint(col, .03);
    G.life(e, (ph, extra) => {
      for (let h = 0; h < 2; h++) for (let f = 0; f < floors.length - 1; f++) {
        const ya = floors[f], yb = floors[f + 1], rise = (yb - ya) / steps;
        for (let i = 0; i < steps; i++) {
          const a = h * Math.PI + i / steps * TAU, y = ya + rise * (i + 1), rm = (Ro + Ri) / 2, dir = [Math.cos(a), Math.sin(a)];
          const arc = TAU * rm / steps * 1.05;
          G.box('stone', [dir[0] * rm, dir[1] * rm], y - .09, [Ro - Ri, .18, arc], dir, tint(stone), ph, extra);
          // The soffit under it, filling the flight.
          if (i % 2 === 0) G.box('stone', [dir[0] * rm, dir[1] * rm], y - .3 - rise, [Ro - Ri, .3, arc * 2.1], dir, tint(stone), ph, extra);
        }
      }
      // The open newel: slim columns between the flights, and a landing at each floor.
      const top = floors.at(-1);
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * TAU, p = G.V(Math.cos(a) * Ri * .88, 0, Math.sin(a) * Ri * .88).toArray();
        k.turned('drum', 'stone', [p[0], (floors[0] + top) / 2, p[2]], [.34, top - floors[0], .34], 0, tint(stone), ph, floors[0], extra);
      }
      for (const y of floors) {
        const L = S.layers(2);
        lathe(L, [0, 0], [[Ri * .55, y - .2], [Ro + .4, y - .2], [Ro + .4, y], [Ri * .55, y]], {tol: .02});
        S.flush(L, 'stone', stone, ph, extra);
      }
    });
  }

  return {drumTower, lodgingRange, lanternon, lanternTower, doubleHelixStair};
}
