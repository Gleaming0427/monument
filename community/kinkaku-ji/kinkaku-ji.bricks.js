import * as T from 'three';

// ——— Japanese storeyed pavilion (rōkaku) ———
// A timber pavilion of superposed storeys on a stone platform: through-posts, plastered or plank walls with
// their fittings bay by bay (shitomi lattice shutters, plank doors, maira sliding doors, lattice windows,
// bell-shaped katōmado, panelled sankarado), verandas on cantilevered brackets with their railings (wayō
// rails on struts, or zen rails with finialled corner posts), bracketed eaves with base and flying rafters,
// and shingled roofs (kokera) concave in section with their eaves lifting at the corners: a skirt round the
// storey above, or a pyramid (hōgyō) crowned by a stepped pedestal and a finial bird; a gabled annex.
//
// One element is one life of the pavilion. `parts` picks what it lays, by role: base (the stone platform),
// timber (bare wood), plaster, core (the timber under the leaf: black lacquer, or bare wood once the leaf has
// gone), skin (the gold leaf), lacquer (lacquered floors), roof (the shingles), frame (the roof frame, wagoya
// purlins on struts and hanegi cantilevers, with the common rafters under every slope), finial (pedestal and
// bird), annex, rods (metal rods at the roof corners); `skip` leaves out the pieces tagged so ("skeleton": the
// posts and beams that stand after a fire), `only` keeps only those. `finish` gives each role its colour.
// Every piece carries the role it was laid for (`piece.role`). A roof never stands without its frame: the frame is
// raised before the shingles and kept under them, wherever the surface dips (scripts/roof.test.mjs holds it).
// Gilded timber is a core and a leaf laid over it, so that the leaf can wear away, burn or be laid again
// without the timber. Frame: u east, v south (the front faces +v), y up from the water; plans in `unit`
// metres (one shaku, 0.303 m, by default).
const ROLES = ['base', 'timber', 'plaster', 'core', 'skin', 'lacquer', 'roof', 'frame', 'finial', 'annex', 'rods'];
const FINISH = {base: '#9b968c', timber: '#4b3729', plaster: '#ecebe4', core: '#1e1b19', skin: '#e2bd5f', lacquer: '#1b1918',
  roof: '#4a4038', frame: '#94724f', finial: '#e2bd5f', pedestal: '#23211f', annex: '#4b3729', bracket: '#2a2522', ceiling: '#3d2f26'};
const KIND = {base: 'stone', timber: 'wood', plaster: 'plaster', core: 'wood', skin: 'gilt', lacquer: 'lead', roof: 'shingle', frame: 'wood', finial: 'gilt', annex: 'wood'};
// Faces: outward normal n, tangent t (west to east, or north to south), as [u, v].
const FACES = {s: {n: [0, 1], t: [1, 0]}, n: {n: [0, -1], t: [1, 0]}, e: {n: [1, 0], t: [0, 1]}, w: {n: [-1, 0], t: [0, 1]}};
const cumulate = (bays, unit) => { const out = [0]; for (const b of bays) out.push(out.at(-1) + b * unit); const half = out.at(-1) / 2; return out.map(x => +(x - half).toFixed(4)); };

function storeyedPavilion(k, e, P) {
  const [cx, cz] = e.center ?? [0, 0], rot = e.rot ?? 0, co = Math.cos(rot), si = Math.sin(rot), ph = P(e.phase), unit = e.unit ?? .30303;
  const want = new Set(e.parts ?? ROLES), skip = new Set(e.skip ?? []), only = e.only, F = {...FINISH, ...e.finish}, L = e.levels;
  const V = (u, y, v) => new T.Vector3(cx + u * co + v * si, y, cz - u * si + v * co);
  const on = (role, tag) => want.has(role) && !(tag && skip.has(tag)) && (!only || tag === only);
  const kindOf = role => KIND[role] ?? 'wood';
  // Wood counts towards the height read out, like masonry: these are the building's own pieces. Each piece also
  // carries the role it was laid for (`frame`, `roof`, `annex`…), so that what stands under a roof can be told
  // from the roof, and held to it (scripts/roof.test.mjs).
  const extra = {structural: true}, tagged = {}, ex = role => tagged[role] ??= {...extra, role};
  // An axis-aligned box: centre [u, y, v], size [along u, height, along v].
  const put = (role, [u, y, v], [a, h, b], o = {}) => {
    if (!on(role, o.tag) || a <= 0 || h <= 0 || b <= 0) return;
    const p = V(u, y, v), c = k.tint(o.color ?? F[o.paint ?? role], o.jitter ?? .05);
    const kind = o.kind ?? kindOf(role);
    if (o.shape) k.turned(o.shape, kind, [p.x, p.y, p.z], [a, h, b], rot + (o.yaw ?? 0), c, ph, o.order ?? y - h / 2, ex(o.as ?? role));
    else k.box(kind, [p.x, p.y, p.z], [a, h, b], rot + (o.yaw ?? 0), c, ph, o.order ?? y - h / 2, ex(o.as ?? role));
  };
  const beam = (role, a, b, t, o = {}) => { if (on(role, o.tag)) k.beam(kindOf(role), V(...a), V(...b), t, k.tint(o.color ?? F[o.paint ?? role], .05), ph, o.order === undefined ? ex(o.as ?? role) : {...ex(o.as ?? role), order: o.order}); };
  const rod = (role, a, b, d, o = {}) => {
    if (!on(role, o.tag)) return;
    const A = V(...a), B = V(...b), len = A.distanceTo(B);
    if (len > .01) k.lying('drum', kindOf(role), A.clone().add(B).multiplyScalar(.5), B.clone().sub(A), [d, len], k.tint(o.color ?? F[role], .04), ph, Math.min(A.y, B.y), ex(role));
  };
  // Gilded timber: the core, then the leaf wrapped round it (posts, rails, brackets) or laid on its outer face
  // only (`face`: the outward [u, v], for walls lacquered inside).
  const gilt = (c, s, o = {}) => {
    put('core', c, s, o);
    if (!o.face) return put('skin', c, s.map(x => x + .026), {...o, color: undefined, order: (o.order ?? c[1] - s[1] / 2) + .001});
    const [nu, nv] = o.face, d = nu ? s[0] : s[2];
    put('skin', [c[0] + nu * (d / 2 + .013), c[1], c[2] + nv * (d / 2 + .013)], nu ? [.018, s[1], s[2]] : [s[0], s[1], .018], {...o, color: undefined});
  };
  const giltBeam = (a, b, t, o = {}) => { beam('core', a, b, t, o); beam('skin', a, b, t + .026, o); };
  // On face f at `line` metres from the centre: s along the face, y up, off outwards; size [along, high, deep].
  const at = (f, line, s, y, off = 0) => [f.t[0] * s + f.n[0] * (line + off), y, f.t[1] * s + f.n[1] * (line + off)];
  const dims = (f, [l, h, d]) => f.t[0] ? [l, h, d] : [d, h, l];
  const slab = (role, f, line, s, y, off, size, o = {}) => put(role, at(f, line, s, y, off), dims(f, size), o);
  const giltSlab = (f, line, s, y, off, size, o = {}) => gilt(at(f, line, s, y, off), dims(f, size), o.wrap ? o : {...o, face: f.n});

  const U = cumulate(e.grid.u, unit), W = cumulate(e.grid.v, unit), post = e.post ?? .24;
  const halfU = U.at(-1), halfV = W.at(-1);

  // ——— The stone platform, its revetment and footings ———
  const base = e.base ?? {};
  if (on('base')) {
    const top = L.platform, [bu, bv] = base.half ?? [halfU + 1.6, halfV + 1.6];
    // Dressed blocks round the edge, rough boulders set along the water, flat stones over the fill.
    for (const f of ['s', 'n', 'e', 'w']) {
      const F2 = FACES[f], len = F2.t[0] ? bu : bv, line = F2.t[0] ? bv : bu;
      for (let s = -len; s < len - .05;) {
        const l = Math.min(.9 + k.rand() * .7, len - s);
        slab('base', F2, line, s + l / 2, top / 2, -.3, [l - .03, top, .6], {color: base.block ?? '#b3a68f', jitter: .1});
        if (base.boulders?.includes(f) && k.rand() < .35) {
          const r = .3 + k.rand() * .4, p = at(F2, line, s + l / 2, r * .4, .25 + k.rand() * .3);
          put('base', p, [r * (1 + k.rand() * .6), r * (.8 + k.rand() * .5), r * (.8 + k.rand() * .4)], {color: base.rock ?? '#5f5c56', jitter: .18, yaw: k.rand() * 3});
        }
        s += l;
      }
    }
    for (let u = -bu + .6; u < bu; u += 1.2) for (let v = -bv + .6; v < bv; v += 1.2) put('base', [u, top - .1, v], [1.18, .2, 1.18], {color: base.fill ?? '#a39d91', jitter: .06, order: -1});
    // The plastered plinth (kamebara) the floor frame stands on.
    if (base.plinth) for (const f of ['s', 'n', 'e', 'w']) {
      const F2 = FACES[f], len = F2.t[0] ? halfU : halfV, line = F2.t[0] ? halfV : halfU;
      slab('base', F2, line, 0, top + base.plinth / 2, base.plinthAt ?? 0, [2 * (len + (base.plinthAt ?? 0)) + .3, base.plinth, .3], {color: '#d8d4cb', jitter: .02});
    }
  }

  // ——— Storey 1: posts, deck, walls and fittings ———
  const S1 = e.storey1, F1 = L.floor1, H1 = L.head1, deckW = S1.deck ?? .95;
  const perimeter = (u0, u1, v0, v1) => { const out = []; for (const u of U) for (const v of W) if (u >= u0 - .01 && u <= u1 + .01 && v >= v0 - .01 && v <= v1 + .01 && (Math.abs(u - u0) < .01 || Math.abs(u - u1) < .01 || Math.abs(v - v0) < .01 || Math.abs(v - v1) < .01)) out.push([u, v]); return out; };
  const nodes1 = [...perimeter(U[0], U.at(-1), W[0], W.at(-1)), ...U.slice(1, -1).map(u => [u, W[S1.inner ?? W.length - 2]])];
  // Through-posts: one post from the floor to the second storey's head, in two lengths of finish.
  for (const [u, v] of nodes1) put('timber', [u, (F1 + H1) / 2, v], [post, H1 - F1, post], {tag: 'skeleton'});
  // Footings and deck: joists on short posts, boards across the deck, the edge beam.
  if (on('timber')) {
    const du = halfU + deckW, dv = halfV + deckW;
    for (let u = -du; u <= du + .01; u += 1.82) for (let v = -dv; v <= dv + .01; v += 1.82) {
      put('base', [u, L.platform + .06, v], [.36, .12, .36], {color: '#8f8a80'});
      put('timber', [u, (L.platform + F1 - .12) / 2, v], [.16, F1 - .12 - L.platform, .16], {order: L.platform});
    }
    for (const f of ['s', 'n', 'e', 'w']) {
      const F2 = FACES[f], len = (F2.t[0] ? halfU : halfV) + deckW, line = F2.t[0] ? halfV : halfU;
      slab('timber', F2, line, 0, F1 - .16, deckW, [2 * len, .2, .14]);
      for (let s = -len + .12; s < len; s += .24) slab('timber', F2, line, s, F1 - .04, deckW / 2 - .05, [.22, .07, deckW + .1], {order: F1});
    }
    // The floor inside, boards along u.
    for (let v = -halfV; v < halfV; v += .3) put('timber', [0, F1 - .04, v + .15], [2 * halfU, .07, .29], {order: F1, color: F.ceiling});
  }
  // Railings on the deck (wayō: posts, top rail, middle rail, sill rail) and the steps.
  const rail = (role, f, line, s0, s1, y, h, o = {}) => {
    if (s1 - s0 < .3) return;
    const make = o.gilded ? (c, s) => gilt(c, s, {wrap: true}) : (c, s) => put(role, c, s);
    const mk = (s, yy, size) => make(at(f, line, s, yy, 0), dims(f, size));
    mk((s0 + s1) / 2, y + .05, [s1 - s0, .1, .12]);
    mk((s0 + s1) / 2, y + h * .55, [s1 - s0, .08, .07]);
    const n = Math.max(1, Math.round((s1 - s0) / (o.step ?? .9)));
    for (let i = 0; i <= n; i++) mk(s0 + (s1 - s0) * i / n, y + h / 2, [.1, h, .1]);
    if (o.zen) for (const s of [s0, s1]) { mk(s, y + h + .07, [.13, .14, .13]); put(o.gilded ? 'skin' : role, at(f, line, s, y + h + .2, 0), [.12, .14, .12], {shape: 'cone'}); }
    const top = at(f, line, s0, y + h, 0), end = at(f, line, s1, y + h, 0);
    if (o.gilded) { rod('core', top, end, .085); rod('skin', top, end, .11); } else rod(role, top, end, .085);
    if (!o.zen) for (let i = 0; i < n; i++) mk(s0 + (s1 - s0) * (i + .5) / n, y + h * .78, [.07, h * .42, .07]);
  };
  for (const f of S1.railing ?? []) {
    const F2 = FACES[f], len = (F2.t[0] ? halfU : halfV) + deckW, line = (F2.t[0] ? halfV : halfU) + deckW - .08;
    const gap = S1.gaps?.[f];
    if (gap) { rail('timber', F2, line, -len, gap[0], F1, .62); rail('timber', F2, line, gap[1], len, F1, .62); }
    else rail('timber', F2, line, -len, len, F1, .62);
  }
  for (const [f, s0, s1] of S1.steps ?? []) {
    const F2 = FACES[f], line = (F2.t[0] ? halfV : halfU) + deckW;
    for (let i = 0; i < 3; i++) slab('timber', F2, line, (s0 + s1) / 2, F1 - (i + 1) * (F1 - L.platform) / 3.4, .2 + i * .28, [s1 - s0, .08, .3]);
  }

  // Fittings in one bay of a wall line, from s0 to s1 (post centres) between floor y0 and head y1.
  function bay(storey, kind, f, line, s0, s1, y0, y1) {
    const g = storey > 1, w = s1 - s0 - post, mid = (s0 + s1) / 2, h = y1 - y0;
    // Heights of the fittings, from the storey's description: the lintel (nageshi) below the head, the waist
    // wall under the lattice windows, the shutters' lower panel, the head of panelled doors, the window.
    const S = [e.storey1, e.storey2, e.storey3][storey - 1] ?? {}, lint = S.lintel ?? .72, waist = S.waist ?? .9;
    const wood = (s, y, off, size, o = {}) => g ? giltSlab(f, line, s, y, off, size, {...o, wrap: storey === 3 || o.wrap}) : slab(o.role ?? 'timber', f, line, s, y, off, size, o);
    const bar = (s, y, off, size) => g ? giltSlab(f, line, s, y, off, size, {wrap: true}) : slab('timber', f, line, s, y, off, size, {color: '#2d261f'});
    const lattice = (sA, sB, yA, yB, off, step = .16, o = {}) => {
      bar((sA + sB) / 2, yA + .03, off, [sB - sA, .06, .06]); bar((sA + sB) / 2, yB - .03, off, [sB - sA, .06, .06]);
      for (let s = sA + step; s < sB - .02; s += step) bar(s, (yA + yB) / 2, off, [.035, yB - yA, .04]);
      if (!o.vertical) for (let y = yA + step; y < yB - .02; y += step) bar((sA + sB) / 2, y, off, [sB - sA, .035, .04]);
      // Behind the lattice: paper (shōji), or the dark of the room.
      slab(storey === 3 ? 'plaster' : g ? 'lacquer' : 'timber', f, line, (sA + sB) / 2, (yA + yB) / 2, off - .07, [sB - sA, yB - yA, .02], {color: o.paper ?? (storey === 3 ? '#d9d2bf' : g ? '#2a231d' : '#231c17')});
    };
    // Sill (jifuku), lintel (uchinori nageshi) and head beam (kashiranuki) run through every closed bay.
    if (kind !== 'open') {
      wood(mid, y0 + .07, .02, [w + .02, .14, .2]);
      if (kind !== 'shitomi' && storey !== 3) wood(mid, y1 - lint, .05, [w + .04, .16, .14]);
    }
    if (kind === 'wall') {
      // Plaster in three panels between the members; the waist rail shows outside on the back wall only.
      const waistRail = y0 + (S.waistRail ?? .85), lintel = y1 - lint;
      put('plaster', at(f, line, mid, (y0 + .14 + lintel - .08) / 2, 0), dims(f, [w, lintel - .08 - y0 - .14, .14]));
      put('plaster', at(f, line, mid, (lintel + .08 + y1 - .25) / 2, 0), dims(f, [w, y1 - .25 - lintel - .08, .14]));
      slab('timber', f, line, mid, waistRail, f === FACES.n ? .06 : -.06, [w + .02, .12, .05]);
      // Inside, the room is dark: its walls lined with boards.
      slab('timber', f, line, mid, (y0 + y1) / 2, -.1, [w, y1 - y0 - .3, .03], {color: '#3a2d23'});
    } else if (kind === 'plank' || kind === 'renji' || kind === 'katomado') {
      // Vertical planks, cut round the window: a bell-shaped katōmado (an ogee head on straight jambs), or the
      // vertical bars of a renji window under the lintel.
      const K = S.window ?? {}, win = kind === 'katomado' ? {w: Math.min(K.w ?? .86, w * .6), sill: y0 + (K.sill ?? .55), spring: y1 - (K.spring ?? 1.05), rise: K.rise ?? .42} : kind === 'renji' ? {w: w * .8, sill: y1 - lint - .75, spring: y1 - lint - .1, rise: 0} : null;
      const head = s => { if (!win) return -1; const q = Math.abs(s - mid) / (win.w / 2); if (q > 1) return -1; return win.spring + win.rise * (q < .55 ? Math.cos(q / .55 * Math.PI / 2) ** .7 : 0) + (q > .55 ? win.rise * .18 * Math.sin((q - .55) / .45 * Math.PI) : 0); };
      for (let s = s0 + post / 2; s < s1 - post / 2 - .02; s += .3) {
        const sw = Math.min(.3, s1 - post / 2 - s), sc = s + sw / 2, top = head(sc);
        const spans = top < 0 ? [[y0 + .14, y1 - .25]] : [[y0 + .14, win.sill], [top + .05, y1 - .25]];
        for (const [a, b] of spans) if (b - a > .03) wood(sc, (a + b) / 2, 0, [sw - .006, b - a, .06]);
      }
      if (win) {
        lattice(mid - win.w / 2, mid + win.w / 2, win.sill, win.spring + (kind === 'katomado' ? .2 : 0), -.02, kind === 'renji' ? .11 : .14, {vertical: kind === 'renji'});
        // The frame: jambs, and the ogee head in short lengths.
        for (const side of [-1, 1]) wood(mid + side * win.w / 2, (win.sill + win.spring) / 2, .04, [.07, win.spring - win.sill, .1], {wrap: true});
        if (kind === 'katomado') for (let i = 0; i < 10; i++) { const s = mid - win.w / 2 + (i + .5) * win.w / 10; wood(s, head(s) + .02, .04, [win.w / 10 + .02, .07, .1], {wrap: true}); }
        else wood(mid, win.spring, .04, [win.w, .07, .1], {wrap: true});
        wood(mid, win.sill - .03, .05, [win.w + .14, .07, .12], {wrap: true});
      }
    } else if (kind === 'door' || kind === 'door2') {
      // Two leaves of boards (itado, itatobira) in a frame.
      const top = y1 - lint;
      for (const side of [-1, 1]) {
        const c = mid + side * w / 4;
        if (g) wood(c, (y0 + .14 + top) / 2, -.02, [w / 2 - .02, top - y0 - .14, .07]);
        else for (let s = -w / 4 + .06; s < w / 4; s += .2) slab('timber', f, line, c + s + .04, (y0 + .14 + top) / 2, -.02, [.19, top - y0 - .14, .07], {color: '#5a4230'});
        for (const y of [y0 + .5, top - .4]) wood(c, y, .03, [w / 2 - .08, .08, .03]);
      }
      if (g) wood(mid, (top + y1 - .25) / 2, 0, [w, y1 - .25 - top, .06]);
      else put('plaster', at(f, line, mid, (top + .08 + y1 - .25) / 2, 0), dims(f, [w, y1 - .25 - top - .08, .14]));
    } else if (kind === 'shitomi') {
      // Shitomi: a fixed lower lattice panel; the upper one hooked up under the eaves of the veranda.
      lattice(s0 + post / 2, s1 - post / 2, y0 + .14, y0 + (S.shitomi ?? 1.05), 0, .13);
      const yu = y1 - .42;
      if (on('timber')) for (let d = .12; d < 1.0; d += .13) slab('timber', f, line, mid, yu, d, [w, .035, .035], {color: '#2d261f'});
      for (let s = s0 + post / 2 + .13; s < s1 - post / 2; s += .13) slab('timber', f, line, s, yu, .52, [.035, .035, 1.0], {color: '#2d261f'});
      slab('timber', f, line, mid, yu + .03, .52, [w, .02, 1.0], {color: '#3a312a'});
      put('plaster', at(f, line, mid, y1 - .14, 0), dims(f, [w, .22, .14]));
      slab('timber', f, line, mid, y1 - .3, .04, [w + .02, .12, .16]);
    } else if (kind === 'lattice') {
      // A lattice window over a waist wall (koshikabe).
      wood(mid, (y0 + .14 + y0 + waist) / 2, 0, [w, waist - .14, .06]);
      lattice(s0 + post / 2, s1 - post / 2, y0 + waist, y1 - lint - .08, 0, .12);
      wood(mid, (y1 - lint + .08 + y1 - .25) / 2, 0, [w, lint - .33, .06]);
    } else if (kind === 'maira') {
      // Maira-do: two sliding panels with close horizontal slats.
      for (const side of [-1, 1]) {
        const c = mid + side * w / 4, top = y1 - lint - .08;
        wood(c, (y0 + .14 + top) / 2, -.02, [w / 2, top - y0 - .14, .05]);
        for (let y = y0 + .3; y < top - .05; y += .14) wood(c, y, .03, [w / 2 - .04, .025, .02], {wrap: true});
        for (const s of [-w / 4 + .04, w / 4 - .04]) wood(c + s, (y0 + .14 + top) / 2, .03, [.06, top - y0 - .14, .04], {wrap: true});
      }
      wood(mid, (y1 - lint + .08 + y1 - .25) / 2, 0, [w, lint - .33, .06]);
    } else if (kind === 'sankarado') {
      // Sankarado: panelled doors, latticed above and boarded below, in stiles and rails.
      for (const side of [-1, 1]) {
        const c = mid + side * w / 4, top = y1 - (S.doorTop ?? .45), ww = w / 2 - .02;
        wood(c, (y0 + .14 + top) / 2, -.03, [ww, top - y0 - .14, .05]);
        for (const s of [-ww / 2 + .04, ww / 2 - .04]) wood(c + s, (y0 + .14 + top) / 2, .02, [.07, top - y0 - .14, .05], {wrap: true});
        const split = y0 + (top - y0) * .45;
        for (const y of [y0 + .2, split - .04, split + .04, top - .05]) wood(c, y, .02, [ww, .07, .05], {wrap: true});
        lattice(c - ww / 2 + .08, c + ww / 2 - .08, split + .08, top - .09, .01, .12);
      }
      const dtop = y1 - (S.doorTop ?? .45);
      if (y1 - .25 - dtop > .03) wood(mid, (dtop + y1 - .25) / 2, 0, [w, y1 - .25 - dtop, .06]);
    }
  }
  // Walls with their fittings, one line of bays at a time: a face, the line it stands on (post index across) and
  // the posts it runs between.
  function walls(storey, list, grid, y0, y1) {
    const [GU, GV] = grid;
    for (const line of list) {
      const f = FACES[line.side], across = f.t[0] ? GV : GU, along = f.t[0] ? GU : GV;
      const dist = across[line.line] * (f.n[0] + f.n[1]);
      line.bays.forEach((kind, i) => bay(storey, kind, f, dist, along[line.span[0] + i], along[line.span[0] + i + 1], y0, y1));
    }
  }
  walls(1, S1.walls, [U, W], F1, H1);
  // Head beams (kashiranuki) all round, and the ceiling of the first storey.
  for (const f of ['s', 'n', 'e', 'w']) {
    const F2 = FACES[f], len = F2.t[0] ? halfU : halfV, line = F2.t[0] ? halfV : halfU;
    slab('timber', F2, line, 0, H1 - .12, 0, [2 * len + .3, .24, .2], {tag: 'skeleton'});
  }
  slab('timber', FACES.s, W[S1.inner ?? W.length - 2], 0, H1 - .12, 0, [2 * halfU, .24, .2], {tag: 'skeleton'});
  put('timber', [0, H1 - .3, 0], [2 * halfU - .2, .05, 2 * halfV - .2], {color: F.ceiling});

  // ——— Between the storeys: the bracket band (koshigumi) carrying the second-storey veranda ———
  const S2 = e.storey2, F2y = L.floor2, H2 = L.head2, bal2 = S2.balcony ?? .9;
  for (const f of ['s', 'n', 'e', 'w']) {
    const Fa = FACES[f], len = Fa.t[0] ? halfU : halfV, line = Fa.t[0] ? halfV : halfU;
    put('plaster', at(Fa, line, 0, (H1 + F2y - .22) / 2, 0), dims(Fa, [2 * len, F2y - .22 - H1, .16]));
    const n = Math.round(2 * len / .91);
    for (let i = 0; i <= n; i++) {
      const s = -len + 2 * len * i / n;
      const gap = F2y - .1 - H1;
      slab('timber', Fa, line, s, H1 + gap * .2, .1, [.24, gap * .4, .3], {color: F.bracket});
      slab('timber', Fa, line, s, H1 + gap * .52, bal2 / 2, [.14, gap * .26, bal2 + .1], {color: F.bracket, tag: 'skeleton'});
      for (const d of [.25, bal2 - .05]) slab('timber', Fa, line, s, H1 + gap * .8, d, [.16, gap * .3, .16], {color: d > .3 ? F.plaster : F.bracket});
    }
    slab('timber', Fa, line, 0, F2y - .16, bal2 - .05, [2 * (len + bal2), .12, .14], {color: F.bracket, tag: 'skeleton'});
    // The veranda floor, lacquered, and its gilded edge.
    for (let s = -len - bal2 + .15; s < len + bal2; s += .3) slab('lacquer', Fa, line, s, F2y - .05, bal2 / 2, [.29, .1, bal2 + .1], {order: F2y});
    giltSlab(Fa, line, 0, F2y - .12, bal2 + .02, [2 * (len + bal2) + .06, .16, .06], {order: F2y});
    rail('core', Fa, line + bal2 - .1, -len - bal2 + .1, len + bal2 - .1, F2y, S2.rail ?? .78, {gilded: true, step: .91});
  }
  put('lacquer', [0, F2y - .05, 0], [2 * halfU, .1, 2 * halfV], {order: F2y});

  // ——— Storey 2 ———
  const nodes2 = [...perimeter(U[0], U.at(-1), W[0], W.at(-1)), ...(S2.posts ?? []).map(([i, j]) => [U[i], W[j]])];
  for (const [u, v] of nodes2) gilt([u, (F2y + H2) / 2, v], [post, H2 - F2y, post], {tag: 'skeleton', order: F2y});
  walls(2, S2.walls, [U, W], F2y, H2);
  for (const f of ['s', 'n', 'e', 'w']) {
    const Fa = FACES[f], len = Fa.t[0] ? halfU : halfV, line = Fa.t[0] ? halfV : halfU;
    giltSlab(Fa, line, 0, H2 - .12, .02, [2 * len + .3, .24, .2], {wrap: true, tag: 'skeleton'});
  }
  put('core', [0, H2 - .3, 0], [2 * halfU - .2, .05, 2 * halfV - .2], {color: F.ceiling});

  // ——— Eaves and roofs ———
  // A roof over a rectangle of walls (half sizes aw, bw, head at yh): bracket sets on the head beam, base and
  // flying rafters out to the gilded fascia, the thick shingled eave (nokizuke), and the shingled surface from
  // the eave rectangle (ao, bo) at height ye up to the rectangle (ai, bi) at ye + rise: concave in section,
  // its eaves lifting towards the corners. Returns the surface's height.
  function roof(r, aw, bw, yh) {
    const {ao, bo, ai, bi, ye, rise, flat = .45, power = 2.2, lift = .4} = r;
    const prof = t => rise * (flat * t + (1 - flat) * t ** power);
    const side = f => FACES[f].t[0] ? {o: bo, i: bi, lo: ao, li: ai, w: bw, lw: aw} : {o: ao, i: ai, lo: bo, li: bi, w: aw, lw: bw};
    const half = (g, t) => g.lo + (g.li - g.lo) * t;
    const up = (g, s, t) => lift * Math.min(1, Math.abs(s) / g.lo) ** 4 * (1 - t) ** 2;
    const point = (f, t, s) => { const g = side(f); return at(FACES[f], 0, s, ye + prof(t) + up(g, s, t), g.o + (g.i - g.o) * t); };
    const surf = (f, t, s) => V(...point(f, t, s));
    const lay = (role, p, du, ds, size, o = {}) => {
      if (!on(role, o.tag)) return;
      const x = du.clone().normalize(), n = new T.Vector3().crossVectors(ds, du).normalize();
      if (n.y < 0) n.negate();
      k.oriented(kindOf(role), p, x, n, new T.Vector3().crossVectors(x, n).normalize(), size, k.tint(o.color ?? F[role], .06), ph, o.order ?? p.y, ex(role));
    };
    // Where the shingles lie: the height of their underside at plan point [u, v], or null where there is no roof (beyond the eaves,
    // or inside the rectangle the next storey stands on). The surface of a hip roof at a point is that of the face the point is
    // nearer the eave of, which is the one with the smaller t.
    const under = (u, v) => {
      const te = (ao - Math.abs(u)) / (ao - ai), ts = (bo - Math.abs(v)) / (bo - bi), t = Math.min(te, ts);
      if (!(t >= 0 && t <= 1)) return null;
      const g = side(te <= ts ? 'e' : 's');
      return ye + prof(t) + up(g, te <= ts ? v : u, t) - .01;
    };
    const eaveDrop = .22, fascia = .12, out = r.bracket ?? .85;
    for (const f of ['s', 'n', 'e', 'w']) {
      const Fa = FACES[f], g = side(f), run = g.o - g.i, rows = Math.max(4, Math.ceil(run / .3));
      // Shingles in staggered courses, eave to top, the courses trimmed at the hips.
      for (let rI = 0; rI < rows; rI++) {
        const t0 = rI / rows, t1 = (rI + 1) / rows, tm = (t0 + t1) / 2, h = half(g, tm), cw = .56, shift = (rI % 2) * cw / 2;
        for (let s = -h - shift; s < h; s += cw) {
          const a = Math.max(-h, s), b = Math.min(h, s + cw);
          if (b - a < .05) continue;
          const sc = (a + b) / 2, p = surf(f, tm, sc), du = surf(f, tm, b).sub(surf(f, tm, a)), ds = surf(f, t1, sc).sub(surf(f, t0, sc));
          lay('roof', p.add(new T.Vector3(0, .04, 0)), du, ds, [du.length() + .02, .09, ds.length() * 1.18], {order: ye + rI * .01});
        }
      }
      // Hip ridge cap.
      for (const sg of [-1, 1]) for (let i = 0; i < 6; i++) {
        const tA = i / 6, tB = (i + 1) / 6;
        beam('roof', point(f, tA, sg * half(g, tA)).map((x, j) => j === 1 ? x + .12 : x), point(f, tB, sg * half(g, tB)).map((x, j) => j === 1 ? x + .12 : x), .2, {color: F.roof});
      }
      // The thick eave (nokizuke) and the gilded fascia (kayaoi) under it.
      const n = Math.ceil(2 * g.lo / .5);
      for (let i = 0; i < n; i++) {
        const sA = -g.lo + 2 * g.lo * i / n, sB = -g.lo + 2 * g.lo * (i + 1) / n;
        const A = point(f, 0, sA), B = point(f, 0, sB);
        beam('roof', [A[0], A[1] - eaveDrop / 2 + .05, A[2]], [B[0], B[1] - eaveDrop / 2 + .05, B[2]], eaveDrop + .02, {color: F.roof});
        const a2 = at(Fa, 0, sA, A[1] - eaveDrop - fascia / 2 + .05, g.o - .06), b2 = at(Fa, 0, sB, B[1] - eaveDrop - fascia / 2 + .05, g.o - .06);
        giltBeam(a2, b2, fascia);
      }
      // Rafters: base rafters from the wall to the second fascia (kioi), flying rafters out to the eave; beyond
      // the wall's corner they start on the hip rafter (sumiki).
      const yw = yh + .55, yf = ye - eaveDrop - fascia + .02, mid2 = g.w + (g.o - g.w) * .62;
      const yAt = (d, s) => yw + (yf - yw) * (d - g.w) / (g.o - g.w) + up(g, s, 0) * Math.max(0, (d - g.w) / (g.o - g.w)) ** 2;
      for (let s = -g.lo + .16; s < g.lo; s += .34) {
        const q = Math.max(0, (Math.abs(s) - g.lw) / (g.lo - g.lw)), d0 = g.w + (g.o - g.w) * q;
        if (d0 > g.o - .3) continue;
        const A = at(Fa, 0, s, yAt(d0, s) - .04, d0), M = at(Fa, 0, s, yAt(Math.max(d0, mid2), s) - .04, Math.max(d0, mid2)), B = at(Fa, 0, s, yAt(g.o - .1, s) - .04, g.o - .1);
        if (mid2 > d0 + .1) giltBeam(A, M, .1);
        giltBeam(at(Fa, 0, s, yAt(Math.max(d0, mid2 - .5), s) + .07, Math.max(d0, mid2 - .5)), [B[0], B[1] + .07, B[2]], .09);
      }
      // The gilded soffit boards over the rafters, and the second fascia.
      for (let s = -g.lo; s < g.lo - .01; s += .9) {
        const sB = Math.min(g.lo, s + .9), sc = (s + sB) / 2, q = Math.max(0, (Math.abs(sc) - g.lw) / (g.lo - g.lw)), d0 = g.w + (g.o - g.w) * q;
        if (d0 > g.o - .3) continue;
        const A = at(Fa, 0, sc, yAt(d0, sc) + .14, d0), B = at(Fa, 0, sc, yAt(g.o - .05, sc) + .14, g.o - .05);
        if (on('skin') || on('core')) { const len = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]); const pA = V(...A), pB = V(...B), dir = pB.clone().sub(pA); const acr = V(...at(Fa, 0, sB, 0, 0)).sub(V(...at(Fa, 0, s, 0, 0))); lay('core', pA.clone().add(pB).multiplyScalar(.5), acr, dir, [sB - s, .04, len]); lay('skin', pA.clone().add(pB).multiplyScalar(.5).add(new T.Vector3(0, -.03, 0)), acr, dir, [sB - s, .015, len]); }
      }
      giltBeam(at(Fa, 0, -g.lw - (g.lo - g.lw) * .62, yAt(mid2, -g.lw) - .02, mid2), at(Fa, 0, g.lw + (g.lo - g.lw) * .62, yAt(mid2, g.lw) - .02, mid2), .1);
      // Bracket sets (demitsudo) on the posts and between them, carrying the eave purlin (gangyō).
      const along = Fa.t[0] ? r.postsU : r.postsV, sets = [];
      along.forEach((s, i) => { sets.push(s); if (i < along.length - 1 && r.between) sets.push((s + along[i + 1]) / 2); });
      for (const s of sets) {
        gilt(at(Fa, g.w, s, yh + .1, 0), dims(Fa, [.3, .2, .3]), {order: yh});
        gilt(at(Fa, g.w, s, yh + .27, .05), dims(Fa, [.85, .14, .16]), {order: yh});
        gilt(at(Fa, g.w, s, yh + .27, out / 2), dims(Fa, [.16, .14, out + .3]), {order: yh});
        for (const d of [-.32, 0, .32]) gilt(at(Fa, g.w, s + d, yh + .4, .05), dims(Fa, [.16, .12, .16]), {order: yh});
        gilt(at(Fa, g.w, s, yh + .4, out), dims(Fa, [.17, .12, .17]), {order: yh});
      }
      const pa = at(Fa, 0, -g.lw - .9, yh + .53, g.w + out), pb = at(Fa, 0, g.lw + .9, yh + .53, g.w + out);
      rod('core', pa, pb, .16); rod('skin', pa, pb, .19);
      // The wall between the head beam and the soffit, closing the eave.
      giltSlab(Fa, g.w, 0, yh + .4, -.02, [2 * g.lw + .3, .55, .08], {wrap: true});
    }
    // Hip rafters (sumiki), gilded, from the wall corners out to the eave corners.
    for (const [su, sv] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const A = [su * aw, yh + .55, sv * bw], B = [su * (ao - .1), ye - eaveDrop - .05 + lift, sv * (bo - .1)], n = 8;
      const line = Array.from({length: n + 1}, (_, i) => {
        const f = i / n, point = [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f], cap = under(point[0], point[2]);
        return cap === null ? point : [point[0], Math.min(point[1], cap - .13), point[2]];
      });
      for (let i = 1; i <= n; i++) giltBeam(line[i - 1], line[i], .16);
    }
    // Wind bells (fūtaku) hung under the ends of the hip rafters (`bells`).
    if (r.bells) for (const [su, sv] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const u = su * (ao - .45), v = sv * (bo - .45), y = ye - eaveDrop - .15 + lift * .85;
      beam('core', [u, y, v], [u, y - .22, v], .025, {color: '#4b4232'});
      put('core', [u, y - .38, v], [.2, .3, .2], {shape: 'bell', kind: 'metal', color: '#5e5136'});
    }
    return {prof, top: ye + rise, under, side, point};
  }
  const R2 = e.roof2, R3 = e.roof3, S3 = e.storey3, U3 = cumulate(S3.grid, unit), F3 = L.floor3, H3 = L.head3;
  const skirt = roof({...R2, postsU: U, postsV: W}, halfU, halfV, H2);
  // The frame of a roof, kept under its shingles. A roof has no business without one, and the frame has none rising into the
  // roof: the skirt is low at its walls and high where it meets the next storey, so a strut or a purlin is as high as the roof
  // lets it be where it stands (`under`), not as high as the roof's top. It is raised before the first shingle (`order`, a
  // rank at a time: the ties that the struts stand on, the struts, the purlins and hips, then what runs down to the eaves).
  const held = (roofed, ye, keep = .05) => {
    const order = rank => ye - .06 + rank * .01, lower = (u, y, v, t) => { const cap = roofed.under(u, v); return cap === null ? y : Math.min(y, cap - keep - t / 2); };
    return {
      // A post at plan point [u, v] from y0 up to y1, or as high as the roof allows.
      post(u, y0, y1, v, t, rank = 1) { const top = lower(u, y1, v, t); if (top - y0 > .08) beam('frame', [u, y0, v], [u, top, v], t, {order: order(rank)}); },
      // The common rafters (taruki): on each of the four faces, a line of them every `step` metres from the eave to the top of the slope,
      // each lying under the shingles at the depth of its own thickness, in lengths of about 90 cm (the surface dips less than 1 cm under such
      // a chord), and ending where the hip begins.
      rafters(t, step = .6, rank = 4) {
        for (const f of ['s', 'n', 'e', 'w']) {
          const Fa = FACES[f], g = roofed.side(f);
          for (let sIn = -g.lo + step / 2; sIn < g.lo; sIn += step) {
            const plan = [];
            for (let i = 0, n = Math.max(2, Math.ceil((g.o - g.i) / .9)); i <= n; i++) {
              const q = .05 + .92 * i / n;
              if (Math.abs(sIn) > g.lo + (g.li - g.lo) * q - .12) break;
              const [u, , v] = roofed.point(f, q, sIn), cap = roofed.under(u, v);
              if (cap !== null) plan.push([u, cap - keep - t / 2, v]);
            }
            for (let i = 1; i < plan.length; i++) beam('frame', plan[i - 1], plan[i], t, {order: order(rank)});
          }
        }
      },
      // A member from a to b, cut into lengths of at most 45 cm that each follow the surface down where it dips below the line.
      run(a, b, t, rank = 2) {
        const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / .45));
        let before = null;
        for (let i = 0; i <= n; i++) {
          const f = i / n, u = a[0] + (b[0] - a[0]) * f, v = a[2] + (b[2] - a[2]) * f, point = [u, lower(u, a[1] + (b[1] - a[1]) * f, v, t), v];
          if (before) beam('frame', before, point, t, {order: order(rank)});
          before = point;
        }
      },
    };
  };
  // The frame under the skirt: tie beams across, struts and purlins under the surface, hanegi cantilevers.
  if (on('frame')) {
    const fr = held(skirt, R2.ye), top = R2.ye + R2.rise - .3;
    for (const u of U) { fr.run([u, H2 + .15, -halfV], [u, H2 + .15, halfV], .26, 0); for (const v of [-halfV + 1, 0, halfV - 1]) fr.post(u, H2 + .28, top, v, .14, 1); }
    for (const v of [-halfV + 1, 0, halfV - 1]) fr.run([-halfU, top, v], [halfU, top, v], .18, 2);
    for (const f of ['s', 'n', 'e', 'w']) {
      const Fa = FACES[f], len = Fa.t[0] ? halfU : halfV, line = Fa.t[0] ? halfV : halfU, o = Fa.t[0] ? R2.bo : R2.ao;
      for (let s = -len + .5; s < len; s += 1.8) fr.run(at(Fa, line, s, R2.ye + R2.rise - .45, -2.2), at(Fa, line, s, R2.ye - .1, o - line - .6), .18, 3);
    }
    fr.rafters(.1);
  }

  // ——— Storey 3: its base on the skirt, veranda, walls ———
  const h3 = U3.at(-1), bal3 = S3.balcony ?? .92, base3 = R2.ye + R2.rise - .25;
  for (const f of ['s', 'n', 'e', 'w']) {
    const Fa = FACES[f];
    giltSlab(Fa, h3 + .2, 0, (base3 + F3 - .15) / 2, 0, [2 * h3 + .55, F3 - .15 - base3, .14], {wrap: true, order: base3});
    for (const s of [...U3, ...U3.slice(0, -1).map((x, i) => (x + U3[i + 1]) / 2)]) gilt(at(Fa, h3, s, F3 - .22, bal3 / 2 + .1), dims(Fa, [.13, .14, bal3 + .2]), {order: base3});
    for (let s = -h3 - bal3 + .15; s < h3 + bal3; s += .3) slab('lacquer', Fa, h3, s, F3 - .05, bal3 / 2, [.29, .1, bal3 + .1], {order: F3});
    giltSlab(Fa, h3, 0, F3 - .12, bal3 + .02, [2 * (h3 + bal3) + .06, .16, .06], {order: F3});
    rail('core', Fa, h3 + bal3 - .1, -h3 - bal3 + .1, h3 + bal3 - .1, F3, S3.rail ?? .72, {gilded: true, zen: true, step: .65});
  }
  put('lacquer', [0, F3 - .05, 0], [2 * h3, .1, 2 * h3], {order: F3});
  for (const u of U3) for (const v of U3) if (Math.abs(u) > h3 - .01 || Math.abs(v) > h3 - .01) gilt([u, (F3 + H3) / 2, v], [post, H3 - F3, post], {order: F3});
  walls(3, ['s', 'n', 'e', 'w'].map(side => ({side, line: FACES[side].n[0] + FACES[side].n[1] > 0 ? U3.length - 1 : 0, span: [0, U3.length - 1], bays: S3.bays})), [U3, U3], F3, H3);
  for (const f of ['s', 'n', 'e', 'w']) giltSlab(FACES[f], h3, 0, H3 - .12, .02, [2 * h3 + .3, .24, .2], {wrap: true});
  gilt([0, H3 - .3, 0], [2 * h3 - .2, .05, 2 * h3 - .2], {wrap: true});
  // The plaque under the south eave.
  if (S3.plaque) { put('core', at(FACES.s, h3, S3.plaque[0], H3 + .02, .45), [.55, .8, .06], {color: '#1c1a19'}); put('skin', at(FACES.s, h3, S3.plaque[0], H3 + .02, .49), [.6, .86, .02], {color: undefined}); }
  const pyramid = roof({...R3, ai: R3.top, bi: R3.top, postsU: U3, postsV: U3, between: true}, h3, h3, H3);
  if (on('frame')) {
    const fr = held(pyramid, R3.ye);
    fr.post(0, H3, R3.ye + R3.rise - .2, 0, .26, 1);
    for (const [su, sv] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) fr.run([su * h3, H3 + .4, sv * h3], [su * .4, R3.ye + R3.rise - .3, sv * .4], .2, 2);
    for (const y of [.3, .65]) for (const f of ['s', 'n', 'e', 'w']) { const d = h3 * (1 - y) + .5; fr.run(at(FACES[f], d, -d, R3.ye + R3.rise * y - .25, 0), at(FACES[f], d, d, R3.ye + R3.rise * y - .25, 0), .14, 3); }
    fr.rafters(.1);
  }

  // ——— Finial: the stepped pedestal (roban) and the bird ———
  const Fi = e.finial, y0f = R3.ye + R3.rise;
  if (Fi) {
    // `only`: "pedestal" or "bird", for a bird taken down or renewed on its pedestal.
    if (Fi.only !== 'bird') {
      put('finial', [0, y0f + .15, 0], [Fi.pedestal * 2, .34, Fi.pedestal * 2], {color: F.pedestal, order: y0f});
      put('finial', [0, y0f + .4, 0], [Fi.pedestal * 1.62, .16, Fi.pedestal * 1.62], {order: y0f + .3});
      put('finial', [0, y0f + .53, 0], [Fi.pedestal * 1.25, .12, Fi.pedestal * 1.25], {order: y0f + .45});
      put('finial', [0, y0f + .64, 0], [.32, .1, .32], {shape: 'flare', order: y0f + .6});
    }
    if (Fi.bird !== false && Fi.only !== 'pedestal') {
      // A phoenix facing south (+v), standing: legs, a full breast, the neck rising to a crested head, the wings
      // raised in two fans of feathers, and the tail's long feathers sweeping back and curling up.
      const b = Fi.bird ?? 1, y = y0f + .7, O = {order: y + .1}, P2 = (u, h, v) => [u * b, y + h * b, v * b];
      for (const s of [-.07, .07]) beam('finial', P2(s, 0, .02), P2(s * .7, .3, .06), .045 * b, O);
      put('finial', P2(0, .42, .04), [.26 * b, .3 * b, .42 * b], {shape: 'ball', ...O});
      put('finial', P2(0, .5, .16), [.2 * b, .26 * b, .2 * b], {shape: 'ball', ...O});
      beam('finial', P2(0, .55, .2), P2(0, .78, .26), .1 * b, O);
      beam('finial', P2(0, .78, .26), P2(0, .86, .3), .08 * b, O);
      put('finial', P2(0, .9, .32), [.12 * b, .13 * b, .17 * b], {shape: 'ball', ...O});
      beam('finial', P2(0, .9, .4), P2(0, .87, .47), .035 * b, O);
      for (const [dv, h] of [[.28, 1.02], [.25, 1.05], [.21, 1.03]]) beam('finial', P2(0, .95, .3), P2(0, h, dv), .025 * b, O);
      for (const s of [-1, 1]) for (let i = 0; i < 5; i++) {
        const a = (i / 4) * .9, len = .42 - i * .04;
        beam('finial', P2(s * .1, .55, .02), P2(s * (.14 + Math.sin(a) * len * .5), .6 + Math.cos(a) * len, -.04 - Math.sin(a) * len * .7), .05 * b, O);
      }
      for (let i = 0; i < 7; i++) {
        const q = (i - 3) / 3, mid = P2(q * .12, .5 + (1 - Math.abs(q)) * .12, -.5), end = P2(q * .3, .62 + (1 - Math.abs(q)) * .3, -.92 + Math.abs(q) * .12);
        beam('finial', P2(0, .4, -.16), mid, .045 * b, O); beam('finial', mid, end, .04 * b, O);
      }
    }
  }

  // ——— Rods (`rods`): straight metal rods carried out from roof corners (`items`: roof 2 or 3, the corner
  // [su, sv], the direction [du, dv], length and rise), and a conductor (`down` [u, v]) from the eave of the
  // main roof to a post in the ground. ———
  if (e.rods && on('rods')) {
    const metal = k.tint(F.rods ?? F.skin, .03);
    for (const it of e.rods.items ?? []) {
      const r = it.roof === 2 ? R2 : R3, [su, sv] = it.corner, [du, dv] = it.dir, len = it.length ?? 3.6;
      const a = [su * (r.ao - .7), r.ye - .15, sv * (r.bo - .7)], b = [a[0] + du * len, a[1] + (it.rise ?? .4), a[2] + dv * len];
      k.beam('metal', V(...a), V(...b), .08, metal, ph, ex('rods'));
      k.beam('metal', V(...b), V(b[0] + du * .12, b[1] - .3, b[2] + dv * .12), .1, metal, ph, ex('rods'));
    }
    if (e.rods.down) {
      const [u, v] = e.rods.down;
      k.beam('metal', V(u, 2.3, v), V(u, R2.ye - .2, v), .03, k.tint('#2c2a28', .02), ph, ex('rods'));
      k.box('wood', V(u, 1.15, v).toArray(), [.16, 2.3, .16], rot, k.tint('#3b2d22', .03), ph, 0, ex('rods'));
    }
  }

  // ——— The annex (Sōsei): a one-bay open pavilion with a gabled roof over the water ———
  const A = e.annex;
  if (A && on('annex')) {
    const [u0, u1] = A.u, [v0, v1] = A.v, fl = A.floor;
    for (const u of [u0, u1]) for (const v of [v0, v1]) {
      put('annex', [u, .12, v], [.4, .24, .4], {color: '#8b867c', kind: 'stone'});
      put('annex', [u, (.24 + A.eave) / 2, v], [.18, A.eave - .24, .18]);
    }
    // The floor runs on to the veranda of the first storey (`join`), over a boarded apron.
    const join = A.join ?? u1;
    for (let u = u0 - .3; u < join; u += .24) put('annex', [u + .12, fl - .04, (v0 + v1) / 2], [.22, .07, v1 - v0 + .6], {order: fl});
    for (const v of [v0 - .3, v1 + .3]) put('annex', [(u0 + join) / 2 - .15, fl - .25, v], [join - u0 + .3, .38, .1]);
    put('annex', [u0 - .3, fl - .25, (v0 + v1) / 2], [.1, .38, v1 - v0 + .6]);
    // Low rails on three sides, beams at the eaves.
    rail('annex', FACES.w, -u0 + .3, v0 - .3, v1 + .3, fl, .55);
    rail('annex', FACES.n, -v0 + .3, u0 - .3, u1 - .2, fl, .55);
    rail('annex', FACES.s, v1 + .3, u0 - .3, u1 - .2, fl, .55);
    for (const v of [v0, v1]) put('annex', [(u0 + u1) / 2, A.eave + .1, v], [u1 - u0 + .3, .2, .16], {order: A.eave - .03});
    for (const u of [u0, u1]) put('annex', [u, A.eave + .1, (v0 + v1) / 2], [.16, .2, v1 - v0 + .3], {order: A.eave - .03});
    // Gabled roof, ridge along u, shingled; the gable to the west with its bargeboards.
    const vm = (v0 + v1) / 2, hv = (v1 - v0) / 2 + A.overhang, ue = A.east ?? u1 + .6, uw = u0 - A.overhang;
    for (const sv of [-1, 1]) {
      const rows = 6;
      for (let i = 0; i < rows; i++) {
        const t0 = i / rows, t1 = (i + 1) / rows, tm = (t0 + t1) / 2, y = A.eave - .05 + (A.ridge - A.eave + .05) * tm, v = vm + sv * hv * (1 - tm);
        const p = V(( ue + uw) / 2, y + .05, v), du = V(ue, 0, 0).sub(V(uw, 0, 0)), ds = V(0, (A.ridge - A.eave) / rows, -sv * hv / rows).sub(V(0, 0, 0));
        const x = du.clone().normalize(), nrm = new T.Vector3().crossVectors(ds, du).normalize(); if (nrm.y < 0) nrm.negate();
        if (on('annex')) k.oriented('shingle', p, x, nrm, new T.Vector3().crossVectors(x, nrm).normalize(), [ue - uw + .05, .1, ds.length() * 1.2], k.tint(F.roof, .06), ph, A.eave + i * .01, ex('annex'));
      }
      beam('annex', [uw - .05, A.eave - .1, vm + sv * hv], [uw - .05, A.ridge + .08, vm], .14, {color: '#3e2d22'});
      put('annex', [(ue + uw) / 2, A.eave - .12, vm + sv * hv], [ue - uw, .18, .1], {color: '#3e2d22'});
    }
    // The frame the shingles lie on, under them: common rafters from the eave beams to the ridge, a purlin half way up each slope and
    // the ridge purlin (munagi). The shingles' underside at distance d from the ridge line is `lineAt(d)`; the members keep under it
    // and are raised before the first row.
    const lineAt = d => A.eave - .05 + (A.ridge - A.eave + .05) * (1 - d / hv) - .01, first = A.eave - .02, feet = hv - .15;
    for (const sv of [-1, 1]) {
      for (let u = uw + .2; u < ue - .05; u += .5) beam('annex', [u, lineAt(feet) - .02 - .065, vm + sv * feet], [u, lineAt(.05) - .02 - .065, vm + sv * .05], .1, {as: 'frame', paint: 'frame', order: first});
      beam('annex', [uw + .1, lineAt(hv / 2) - .02 - .075, vm + sv * hv / 2], [ue - .1, lineAt(hv / 2) - .02 - .075, vm + sv * hv / 2], .12, {as: 'frame', paint: 'frame', order: first + .005});
    }
    beam('annex', [uw + .1, lineAt(0) - .02 - .085, vm], [ue - .1, lineAt(0) - .02 - .085, vm], .16, {as: 'frame', paint: 'frame', order: first + .005});
    beam('annex', [uw, A.ridge + .1, vm], [ue, A.ridge + .1, vm], .2, {color: F.roof});
    // The pendant board (gegyo) under the gable's apex.
    put('annex', [uw - .08, A.ridge - .3, vm], [.05, .42, .5], {color: '#3e2d22'});
    for (let i = 0; i < 6; i++) { const y = A.eave + (A.ridge - A.eave) * (i + .5) / 6; put('annex', [u0 - .05, y, vm], [.06, (A.ridge - A.eave) / 6, 2 * hv * (1 - (i + .5) / 6) * .8], {color: '#5a4332'}); }
  }
}

export default {
  pavilion(k, e, P) { storeyedPavilion(k, e, P); },
};
