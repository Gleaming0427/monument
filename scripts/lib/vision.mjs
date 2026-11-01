// Every window, door and dormer, in every view (scripts/vision.test.mjs). The viewer lists the panes and leaves standing
// (monument.openings(): each carries the number of its opening) and casts rays through the picture (monument.pick); this
// module gathers the panes into openings, chooses the views of a monument, places the rays on an opening, and reads what
// they met. Everything is in the scene's frame, in metres; azimuths in degrees from north, the camera to the south at 180.

export const FRAME = [960, 600];
// An opening seen more than 66° off its normal is seen edge on: it is not judged from there.
export const GRAZING = Math.cos(66 * Math.PI / 180);
// Something standing more than 35 cm in front of the wall's face hides an opening; nearer, inside the opening, it covers it.
export const FRONT = .35;
// The longest stretch of wall a detail view holds.
export const STRETCH = 20;

const DEG = Math.PI / 180;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => mul(a, 1 / (len(a) || 1));
const round = (x, k = 10) => Math.round(x * k) / k;
const spread = (points, axis) => { let lo = Infinity, hi = -Infinity; for (const p of points) { const s = dot(p, axis); if (s < lo) lo = s; if (s > hi) hi = s; } return [lo, hi]; };

// A pane's normal, the way it spreads, and its corners. A box (its matrix: three columns scaled by its size, then its
// centre) is laid along its wall: its normal is the thinner of its two level sides (the depth of a pane, a leaf or a
// louvre board), or its thinnest side if it does not stand level. A patch of surface (its vertices) stands upright in a
// wall: its normal is the level direction it spreads least along.
function paneOf(p) {
  if (p.matrix) {
    const m = p.matrix, c = [m[12], m[13], m[14]], cols = [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]], sizes = cols.map(len);
    const level = [0, 1, 2].filter(i => Math.abs(cols[i][1]) < .3 * sizes[i]);
    const pool = level.length >= 2 ? level : [0, 1, 2], thin = pool.reduce((best, i) => sizes[i] < sizes[best] ? i : best, pool[0]);
    const corners = [];
    for (const i of [-.5, .5]) for (const j of [-.5, .5]) for (const k of [-.5, .5]) corners.push(add(c, add(mul(cols[0], i), add(mul(cols[1], j), mul(cols[2], k)))));
    return {n: unit(cols[thin]), area: sizes.reduce((area, s, i) => i === thin ? area : area * s, 1), corners};
  }
  const pts = p.points, mx = pts.reduce((s, q) => s + q[0], 0) / pts.length, mz = pts.reduce((s, q) => s + q[2], 0) / pts.length;
  let xx = 0, xz = 0, zz = 0;
  for (const q of pts) { const x = q[0] - mx, z = q[2] - mz; xx += x * x; xz += x * z; zz += z * z; }
  const along = .5 * Math.atan2(2 * xz, xx - zz), n = [-Math.sin(along), 0, Math.cos(along)];
  const [a0, a1] = spread(pts, [Math.cos(along), 0, Math.sin(along)]), [y0, y1] = spread(pts, [0, 1, 0]);
  return {n, area: Math.max(.01, (a1 - a0) * (y1 - y0)), corners: pts};
}

// The panes and leaves the viewer lists, gathered into openings: each with its centre, its normal n (level for an
// opening in a wall; its sign is not known, an opening shows from both sides of its wall), its width w along a (level)
// and its height h along b (up), in metres. An opening left open (an arch, a doorway: `open`) is the outline the kit
// sets at the back of its hole. `reveal`, where the kit gives it, is how far its glass (or the back of its hole) stands
// behind the face of its wall.
export function openingsOf(panes) {
  const groups = new Map();
  for (const p of panes) {
    const key = `${p.element}:${p.opening}`;
    if (!groups.has(key)) groups.set(key, {key, element: p.element, opening: p.opening, role: p.role, open: false, parts: []});
    const g = groups.get(key);
    g.parts.push(paneOf(p));
    if (p.open) g.open = true;
    if (p.reveal !== undefined && p.reveal !== null) g.reveal = Math.max(g.reveal ?? -Infinity, p.reveal);
  }
  const shape = ({parts, ...g}) => {
    const first = parts[0].n;
    let n = unit(parts.reduce((s, p) => add(s, mul(p.n, p.area * (dot(p.n, first) < 0 ? -1 : 1))), [0, 0, 0]));
    const level = Math.hypot(n[0], n[2]);
    if (level > .3) n = unit([n[0], 0, n[2]]);
    const a = level > .3 ? unit(cross([0, 1, 0], n)) : unit(cross(n, [1, 0, 0])), b = cross(n, a);
    const points = parts.flatMap(p => p.corners), [a0, a1] = spread(points, a), [b0, b1] = spread(points, b), [n0, n1] = spread(points, n);
    const centre = add(mul(a, (a0 + a1) / 2), add(mul(b, (b0 + b1) / 2), mul(n, (n0 + n1) / 2)));
    return {...g, parts, centre, n, a, b, w: a1 - a0, h: b1 - b0};
  };
  // One opening drawn in layers by several elements (a door's wooden core, and the gold leaf laid on it by a later
  // element) is one opening: openings of one role, parallel, of one size and within 15 cm of each other are merged, and
  // a ray that meets any of their layers meets the opening. Two doors 0.58 m apart are two doors.
  const shaped = [...groups.values()].map(shape), merged = [];
  for (const o of shaped) {
    const same = merged.find(m => m.role === o.role && Math.abs(dot(m.n, o.n)) > .98 && len(sub(m.centre, o.centre)) < .15 && Math.abs(m.w - o.w) < .3 && Math.abs(m.h - o.h) < .3);
    if (!same) { merged.push({...o, aliases: [o.key]}); continue; }
    Object.assign(same, shape({...same, parts: [...same.parts, ...o.parts]}), {aliases: [...same.aliases, o.key], open: same.open || o.open, reveal: Math.max(same.reveal ?? -Infinity, o.reveal ?? -Infinity)});
    if (same.reveal === -Infinity) delete same.reveal;
  }
  return merged.map(({parts, ...o}) => o);
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const compass = az => COMPASS[Math.round(((az % 360) + 360) % 360 / 45) % 8];
// From the target toward a camera at this azimuth, level.
const toward = az => [Math.sin(az * DEG), 0, -Math.cos(az * DEG)];
const azimuthOf = n => ((Math.atan2(n[0], -n[2]) / DEG) % 360 + 360) % 360;
// How far a camera of vertical field `fov` stands to hold `width` across and `height` up the frame.
const fit = (width, height, fov) => { const v = fov * DEG / 2, h = Math.atan(Math.tan(v) * FRAME[0] / FRAME[1]); return Math.max(width / 2 / Math.tan(h), height / 2 / Math.tan(v)); };

// The views the test takes of a monument, besides its reference photos: four elevations, square to the walls' axes (the
// front, the back and both profiles), the plan from above, four bird's-eye views on the diagonals, and a detail of every
// wall of every element, in stretches of STRETCH metres at most. Each is {name, t, cam: [azimuth, elevation, distance,
// x, y, z], fov, shift}, as monument.view takes it.
export function viewsOf(d, standing, t) {
  if (!standing.length) return [];
  // The walls' axes: their normals folded on a quarter turn and averaged, each weighed by its opening's area.
  let cx = 0, cz = 0;
  for (const o of standing) {
    if (Math.hypot(o.n[0], o.n[2]) < .5) continue;
    const q = 4 * Math.atan2(o.n[0], -o.n[2]);
    cx += Math.cos(q) * o.w * o.h; cz += Math.sin(q) * o.w * o.h;
  }
  const axis = Math.atan2(cz, cx) / 4 / DEG;
  const ends = standing.flatMap(o => [add(o.centre, mul(o.a, o.w / 2)), add(o.centre, mul(o.a, -o.w / 2))]);
  const y0 = Math.min(...standing.map(o => o.centre[1] - o.h / 2)), y1 = Math.max(d.view?.height ?? 0, ...standing.map(o => o.centre[1] + o.h / 2));
  // A camera at azimuth az and elevation el holding the given points (plan) and heights, with a margin of 4 m all round.
  const frame = (name, az, el, fov, points, lo, hi) => {
    const dir = toward(az), across = [-dir[2], 0, dir[0]], [a0, a1] = spread(points, across), [d0, d1] = spread(points, dir);
    const mid = add(mul(across, (a0 + a1) / 2), mul(dir, (d0 + d1) / 2)), c = Math.cos(el * DEG), s = Math.sin(el * DEG);
    const tall = el > 80 ? d1 - d0 : (hi - lo) * c + (d1 - d0) * s, deep = el > 80 ? hi - lo : (d1 - d0) * c;
    const distance = deep / 2 + fit(a1 - a0 + 8, tall + 8, fov);
    return {name, t, cam: [round(((az % 360) + 360) % 360), el, round(distance), round(mid[0]), round((lo + hi) / 2), round(mid[2])], fov, shift: 0};
  };
  const views = [];
  for (let k = 0; k < 4; k++) { const az = axis + 90 * k; views.push(frame(`elevation from the ${compass(az)}`, az, 8, 24, ends, y0, y1)); }
  views.push(frame('plan from above', axis, 88, 30, ends, y0, y1));
  for (let k = 0; k < 4; k++) { const az = axis + 45 + 90 * k; views.push(frame(`bird's-eye from the ${compass(az)}`, az, 35, 30, ends, y0, y1)); }

  // Details: each element's openings, by the way their wall faces, in twelve directions; along each, in stretches.
  const sides = outward(standing, d), byElement = new Map();
  for (const o of standing) { if (!byElement.has(o.element)) byElement.set(o.element, []); byElement.get(o.element).push(o); }
  for (const [element, list] of byElement) {
    const faces = new Map();
    for (const o of list) {
      if (Math.hypot(o.n[0], o.n[2]) < .5) continue;
      for (const sign of sides.get(o.key)) {
        const n = mul(o.n, sign), bin = Math.round(azimuthOf(n) / 30) % 12;
        if (!faces.has(bin)) faces.set(bin, []);
        faces.get(bin).push({o, n});
      }
    }
    const label = `${d.elements?.[element]?.type ?? 'element'} ${element}`;
    for (const group of faces.values()) {
      const az = azimuthOf(group.reduce((s, g) => add(s, g.n), [0, 0, 0])), dir = toward(az), across = [-dir[2], 0, dir[0]];
      group.sort((p, q) => dot(p.o.centre, across) - dot(q.o.centre, across));
      const stretches = [];
      for (let i = 0; i < group.length;) {
        const from = dot(group[i].o.centre, across); let j = i;
        while (j + 1 < group.length && dot(group[j + 1].o.centre, across) - from <= STRETCH) j++;
        stretches.push(group.slice(i, j + 1).map(g => g.o)); i = j + 1;
      }
      stretches.forEach((part, k) => {
        const points = part.flatMap(o => [add(o.centre, mul(o.a, o.w / 2)), add(o.centre, mul(o.a, -o.w / 2))]);
        const lo = Math.min(...part.map(o => o.centre[1] - o.h / 2)), hi = Math.max(...part.map(o => o.centre[1] + o.h / 2));
        const view = frame(`detail of ${label}, facing ${compass(az)} (${Math.round(az)}°)${stretches.length > 1 ? `, ${k + 1} of ${stretches.length}` : ''}`, az, 10, 45, points, lo, hi);
        view.cam[2] = Math.max(view.cam[2], 12);
        views.push(view);
      });
    }
  }
  return views;
}

// The way each opening's wall faces out, as signs of its normal. Away from its element's centre (its `center`, turned by
// the monument's `rotate`) when that stands 2.5 m or more behind it: a block's, a tower's, a choir's; a façade's centre
// lies in its wall, on its face, in front of the openings set back in it, and decides nothing. Then away from the middle
// of its element's openings, or of all the monument's openings (a transept front faces away from the crossing), when
// that stands more than 1.4 m off its plane; then away from its element's centre, at last; both ways when nothing does.
export function outward(standing, d) {
  const turn = (d?.rotate ?? 0) * DEG, c = Math.cos(turn), s = Math.sin(turn), middles = new Map(), out = new Map();
  const centreOf = i => { const p = d?.elements?.[i]?.center; return Array.isArray(p) && p.length === 2 ? [p[0] * c + p[1] * s, 0, -p[0] * s + p[1] * c] : null; };
  for (const o of standing) { const m = middles.get(o.element) ?? {sum: [0, 0, 0], count: 0}; m.sum = add(m.sum, o.centre); m.count++; middles.set(o.element, m); }
  const all = mul(standing.reduce((sum, o) => add(sum, o.centre), [0, 0, 0]), 1 / Math.max(1, standing.length)), level = v => [v[0], 0, v[2]];
  for (const o of standing) {
    const m = middles.get(o.element), at = centreOf(o.element), off = p => p ? dot(level(sub(o.centre, p)), o.n) : 0;
    const steps = [[off(at), 2.5], [off(mul(m.sum, 1 / m.count)), 1.4], [off(all), 1.4], [off(at), 1.4]];
    const side = steps.find(([x, least]) => Math.abs(x) >= least)?.[0] ?? 0;
    out.set(o.key, side ? [Math.sign(side)] : [1, -1]);
  }
  return out;
}

// A close-up of one opening, square to it and level with its middle, from the given side of its wall (1 or -1, along its
// normal), `distance` from its glass: the last look the test takes at an opening no view has seen.
export function closeUp(o, side, distance, t) {
  const n = mul(o.n, side), fov = Math.min(100, Math.max(20, 2 * Math.atan((Math.max(o.w, o.h) / 2 + .6) / distance) / DEG));
  return {name: `close-up of the ${o.role} ${o.key}`, t, cam: [round(azimuthOf(n)), 0, round(distance, 100), ...o.centre.map(x => round(x, 100))], fov: round(fov), shift: 0};
}

// A camera standing on an opening's wall, `face` metres out from its glass on the given side, looking straight out along
// its normal: the ray through the middle of its picture measures the room in front of the opening.
export function outlook(o, side, face, t) {
  const n = mul(o.n, side), from = add(o.centre, mul(n, face + .05)), far = 60;
  return {view: {name: `outlook of the ${o.role} ${o.key}`, t, cam: [round(azimuthOf(mul(n, -1)), 1000), 0, far - face - .05, ...add(o.centre, mul(n, far))], fov: 30, shift: 0}, from};
}

// Where the rays go for an opening seen from `eye`: three through its pane, a fifth of its width either side of its
// axis (where two leaves meet, or a mullion stands, the axis shows neither glass nor a gap fairly): at its middle's
// height on one side, and a third of its height above and below on the other; two on the wall either side of it, at its
// middle's height, 80 cm clear of it; and the two ends of its width, to measure it on the screen. Null when the opening
// is seen edge on.
export function sampleRays(o, eye) {
  const v = sub(eye, o.centre);
  if (Math.abs(dot(v, o.n)) < GRAZING * len(v)) return null;
  const up = mul(o.b, o.h / 3), off = mul(o.a, o.w / 5), side = mul(o.a, o.w / 2 + .8), half = mul(o.a, o.w / 2);
  return {points: [sub(o.centre, off), add(add(o.centre, off), up), sub(add(o.centre, off), up), add(o.centre, side), sub(o.centre, side)], pane: [0, 1, 2], wall: [3, 4], ends: [add(o.centre, half), sub(o.centre, half)]};
}

const what = h => h.kind === 'relief' ? `a relief of element ${h.element}` : `${h.role ? `the ${h.role} ${h.element}:${h.opening}` : `a ${h.kind} piece`} of element ${h.element}`;

// What the rays met, for one opening in one view (`hits` as monument.pick returns them, in the order of rays.points):
//   seen     a ray through its pane meets the opening itself (its glass, leaf, bars or frame), a relief laid in it (the
//            photograph of a portal or a rose), or passes between its boards (louvres) or through an open one (an arch,
//            a doorway) past the back of its hole, and none meets anything that should not be there;
//   hidden   the rays through its pane meet something standing in front of its wall's face (by more than FRONT);
//   covered  a ray through its pane meets something else inside its opening, between the wall's face and the glass (or
//            the back of an open one's hole: a wall built up in an arch), or passes where its glass should be and meets
//            what stands behind it;
//   unknown  the rays meet only the sides of its own hole: it is seen too obliquely to tell.
// The wall's face stands `reveal` in front of the glass, as the kit lays it; for an opening without it, the rays beside
// the opening find it where they meet bare wall within 3 m of the glass (1.5 m when none does). Something met near the
// edges of the opening, rather than across its middle, is the side of its own hole.
export function verdict(o, rays, hits, eye) {
  const n = dot(sub(eye, o.centre), o.n) > 0 ? o.n : mul(o.n, -1), depth = h => dot(sub(h.point, o.centre), n);
  // Its own pieces: those of its number (a number is the opening's, whichever element lays a layer of it: the gold leaf
  // a later element lays on a door), or of an opening merged with it.
  const own = h => h.opening !== undefined && (h.opening === o.opening || (o.aliases ?? [o.key]).includes(`${h.element}:${h.opening}`));
  // The face of the wall: where the kit says (`reveal`); else from the rays beside the opening.
  const beside = rays.wall.map(i => hits[i]).filter(h => h && h.opening === undefined && h.kind !== 'relief').map(depth).filter(f => f > -.15 && f < 3);
  const face = Math.max(.05, o.reveal ?? (beside.length ? Math.min(...beside) : 1.5));
  const looks = rays.pane.map(i => {
    const h = hits[i], open = o.open || o.role === 'louvres';
    // An opening left open is seen when a ray goes through its hole, past the back of it; louvres are boards with gaps
    // between them: a ray that passes between them sees the opening open.
    if (!h) return open ? {kind: 'seen'} : {kind: 'covered', why: 'the ray through its glass meets nothing: the glass is missing'};
    if (own(h)) return {kind: 'seen'};
    const off = depth(h), q = sub(h.point, o.centre);
    if (off < -.08) return open ? {kind: 'seen'} : {kind: 'covered', why: `the ray through its glass meets ${what(h)} ${(-off).toFixed(2)} m behind it: the glass is missing there`};
    if (off > face + FRONT + (h.kind === 'relief' ? .5 : 0)) return {kind: 'hidden', by: h.element, gap: off - face, face, side: n === o.n ? 1 : -1};
    // A relief is a photograph of a carving or an opening, laid in place: one standing in the opening is its picture.
    if (h.kind === 'relief') return {kind: 'seen'};
    if (Math.abs(dot(q, o.a)) > .3 * o.w || Math.abs(dot(q, o.b)) > .35 * o.h) return {kind: 'unknown'};
    return {kind: 'covered', why: `${what(h)} stands in its opening, ${off.toFixed(2)} m in front of its glass (the wall's face is ${face.toFixed(2)} m in front)`};
  });
  // Hidden, it says by what, and how far in front of its wall's face that stands, at the nearest.
  return looks.find(l => l.kind === 'covered') ?? looks.find(l => l.kind === 'seen') ?? looks.filter(l => l.kind === 'hidden').sort((p, q) => p.gap - q.gap)[0] ?? {kind: 'unknown'};
}
