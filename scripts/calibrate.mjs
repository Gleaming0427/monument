#!/usr/bin/env node
// Fits a reference photo's aim and lens to points recognised in it:
//   node scripts/calibrate.mjs monuments/<id>.json --ref <n> --photo <width>,<height> --points '[[x, y, z, px, py], …]' [--frame] [--eye <m>] [--upright] [--move] [--write]
// Each point is a place on the building (x east, y up, z south, in metres; with --frame, in the monument's own
// frame before "rotate") and where it appears in the photo (pixels in an image of the given size). The camera
// A point may also lie anywhere on a known line: {"ellipse": {"center": [x, z], "radii": [a, b], "rot": radians,
// "y": height, "arc": [from, to] degrees}, "at": [px, py]}, for a curved facade whose bays cannot be told
// apart (a cornice, the top of a wall); only the side of the line facing the camera counts. Or on a known
// edge, {"line": [[x, y, z], …], "at": [px, py]}: a polyline through the building's points (with --frame, in
// its own frame), for a curved edge seen at a height that cannot be read (a tower's leg behind trees). The camera
// stays where the reference puts it (the place Commons records) and its direction and field of view are
// fitted so the model's points land on the photo's; with --move (six points or more), its position is fitted
// too, since a phone's recorded position can be tens of metres off. With --write, the reference's azimuth, elevation, target and fov
// are updated and the fit is recorded as reference.calibration {points, rms}: the remaining gap, in percent of
// the photo's height, is how far the model's silhouette sits from the photo once the viewpoint is right.
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const args = process.argv.slice(2), flag = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find(arg => arg.endsWith('.json')), n = Number(flag('ref'));
const [W, H] = (flag('photo') ?? '').split(',').map(Number), points = JSON.parse(flag('points') ?? '[]');
if (!file || !(n >= 0) || !(W > 0 && H > 0) || points.length < 3) {
  console.error("Usage: node scripts/calibrate.mjs monuments/<id>.json --ref <n> --photo <width>,<height> --points '[[x, y, z, px, py], …]' (3 points or more) [--frame] [--write]");
  process.exit(1);
}
const path = resolve(file), text = await readFile(path, 'utf8'), d = JSON.parse(text), ref = d.evidence?.references?.[n];
if (!ref) { console.error(`No evidence.references[${n}].`); process.exit(1); }
const rad = Math.PI / 180, turn = (d.rotate ?? 0) * rad;
// The monument's frame to the scene, as the viewer turns it.
const world = ([x, y, z]) => args.includes('--frame') ? [x * Math.cos(turn) + z * Math.sin(turn), y, -x * Math.sin(turn) + z * Math.cos(turn)] : [x, y, z];
const target = ref.target ?? d.view.target, az = ref.azimuth * rad, el = ref.elevation * rad;
const C = [target[0] + Math.sin(az) * Math.cos(el) * ref.distance, target[1] + Math.sin(el) * ref.distance, target[2] - Math.cos(az) * Math.cos(el) * ref.distance];
// --eye <metres>: the camera's height above the ground, read in the photo itself: a horizontal line of the
// building that shows straight across a curved or receding facade lies at the photographer's eye level.
if (flag('eye') !== undefined) C[1] = Number(flag('eye'));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = a => { const l = Math.hypot(...a); return a.map(v => v / l); };
// Pinhole camera at C (moved by [dx, dy, dz] with --move) looking along bearing psi (0 = north) and pitch
// theta, vertical field of view phi; image coordinates in units of the photo's height from its centre.
// --upright: the photo's verticals are parallel (a shift lens, or perspective corrected afterwards, as most
// architecture photos on Commons are). The camera then looks level, and the second unknown is instead the
// shift: how far below the photo's middle the horizon lies, in photo heights.
const move = args.includes('--move'), upright = args.includes('--upright');
const project = ([psi, theta, phi, dx = 0, dy = 0, dz = 0], P) => {
  const C2 = [C[0] + dx, C[1] + dy, C[2] + dz], pitch = upright ? 0 : theta;
  const f = [Math.sin(psi) * Math.cos(pitch), Math.sin(pitch), -Math.cos(psi) * Math.cos(pitch)], r = unit(cross(f, [0, 1, 0])), u = cross(r, f);
  const q = [P[0] - C2[0], P[1] - C2[1], P[2] - C2[2]], depth = dot(q, f), F = .5 / Math.tan(phi / 2);
  return [F * dot(q, r) / depth, -F * dot(q, u) / depth + (upright ? theta : 0)];
};
const seen = points.map(p => Array.isArray(p) ? {P: world(p.slice(0, 3)), at: [(p[3] - W / 2) / H, (p[4] - H / 2) / H]} : {curve: p.ellipse ?? {line: p.line.map(world)}, at: [(p.at[0] - W / 2) / H, (p.at[1] - H / 2) / H]});
// Points along an ellipse (amphitheatre convention: angle 0 at the end of the first axis, turned by rot).
const along = ({center: [cx, cz], radii: [a, b], rot = 0, y, arc}) => {
  const out = [], co = Math.cos(rot), si = Math.sin(rot);
  for (let d = 0; d < 360; d += .25) {
    if (arc && !(arc[0] <= arc[1] ? d >= arc[0] && d <= arc[1] : d >= arc[0] || d <= arc[1])) continue;
    const t = d * rad, x = a * Math.cos(t), z = b * Math.sin(t), nx = b * Math.cos(t), nz = a * Math.sin(t);
    out.push({P: [cx + x * co + z * si, y, cz - x * si + z * co], n: [nx * co + nz * si, 0, -nx * si + nz * co]});
  }
  return out;
};
// Points along an edge, every 25 cm; an edge has no side, so all of it counts.
const edge = line => line.slice(1).flatMap((b, i) => {
  const a = line[i], k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / .25));
  return Array.from({length: k + (i === line.length - 2)}, (_, j) => ({P: a.map((v, m) => v + (b[m] - v) * j / k)}));
});
for (const s of seen) if (s.curve) s.samples = s.curve.line ? edge(s.curve.line) : along(s.curve);
// Image distance from a seen point to where the model puts it (the nearest visible point of a line).
const miss = (p, s) => {
  if (!s.curve) { const [a, b] = project(p, s.P); return (a - s.at[0]) ** 2 + (b - s.at[1]) ** 2; }
  const C2 = [C[0] + (p[3] ?? 0), C[1] + (p[4] ?? 0), C[2] + (p[5] ?? 0)];
  let best = Infinity;
  for (const {P, n} of s.samples) {
    if (n && n[0] * (C2[0] - P[0]) + n[2] * (C2[2] - P[2]) <= 0) continue;
    const [a, b] = project(p, P); best = Math.min(best, (a - s.at[0]) ** 2 + (b - s.at[1]) ** 2);
  }
  return best === Infinity ? 1 : best;
};
// Points on one facade cannot tell a long lens far away from a short one close by: the recorded position is
// kept as a prior. A move of 15% of the distance on the ground (20 m at least) or 3% in height (2 m at least)
// costs as much as a 1% gap at every point: a phone's position is rougher for a far shot.
const sg = Math.max(20, .15 * ref.distance), sh = Math.max(2, .03 * ref.distance);
const prior = p => move ? seen.length * 1e-4 * (((p[3] ?? 0) ** 2 + (p[5] ?? 0) ** 2) / sg ** 2 + (p[4] ?? 0) ** 2 / sh ** 2) : 0;
const cost = p => p[2] < 5 * rad || p[2] > 120 * rad ? 1e9 : prior(p) + seen.reduce((sum, s) => sum + miss(p, s), 0);
const gap = p => Math.sqrt(seen.reduce((sum, s) => sum + miss(p, s), 0) / seen.length) * 100;
// Nelder-Mead from the reference's current aim and lens.
const look = unit([target[0] - C[0], target[1] - C[1], target[2] - C[2]]);
if (move && seen.length < 6) { console.error('--move fits six unknowns: give at least six points.'); process.exit(1); }
const dims = move ? 6 : 3, steps = [4 * rad, upright ? .05 : 4 * rad, 6 * rad, 15, 4, 15];
const fit = start => {
  let simplex = [start];
  for (let i = 0; i < dims; i++) { const p = start.slice(); p[i] += steps[i]; simplex.push(p); }
  for (let it = 0; it < 20000; it++) {
    simplex.sort((a, b) => cost(a) - cost(b));
    const best = simplex[0], worst = simplex[dims], c = start.map((_, j) => simplex.slice(0, dims).reduce((s, p) => s + p[j], 0) / dims);
    const at = t => c.map((v, j) => v + t * (worst[j] - v)), r = at(-1);
    if (cost(r) < cost(best)) { const e = at(-2); simplex[dims] = cost(e) < cost(r) ? e : r; }
    else if (cost(r) < cost(simplex[dims - 1])) simplex[dims] = r;
    else { const k = at(.5); if (cost(k) < cost(worst)) simplex[dims] = k; else simplex = simplex.map(p => p.map((v, j) => best[j] + (v - best[j]) / 2)); }
    if (Math.abs(cost(simplex[dims]) - cost(simplex[0])) < 1e-15) break;
  }
  return simplex.sort((a, b) => cost(a) - cost(b))[0];
};
// Restarted once from its own result, which steadies Nelder-Mead in six dimensions.
const lens = (ref.fov ?? 38) * rad, pitch0 = Math.asin(look[1]);
let best = fit([Math.atan2(look[0], -look[2]), upright ? .5 / Math.tan(lens / 2) * Math.tan(pitch0) + (ref.shift ?? 0) : pitch0, lens, ...(move ? [0, 0, 0] : [])]);
best = fit(best);
const [psi, theta, phi, dx = 0, dy = 0, dz = 0] = best, rms = gap(best);
const simplex = [best];
const pitch = upright ? 0 : theta, f = [Math.sin(psi) * Math.cos(pitch), Math.sin(pitch), -Math.cos(psi) * Math.cos(pitch)], D = ref.distance, Cm = [C[0] + dx, C[1] + dy, C[2] + dz];
const T = Cm.map((v, j) => +(v + f[j] * D).toFixed(1)), back = [Cm[0] - T[0], Cm[1] - T[1], Cm[2] - T[2]];
if (move) console.log(`camera moved by ${Math.hypot(dx, dz).toFixed(1)} m on the ground and ${dy.toFixed(1)} m in height`);
const next = {azimuth: +((Math.atan2(back[0], -back[2]) / rad + 360) % 360).toFixed(1), elevation: +(Math.asin(back[1] / Math.hypot(...back)) / rad).toFixed(1), distance: +Math.hypot(...back).toFixed(1), target: T, fov: +(phi / rad).toFixed(1)};
console.log(`reference ${n}: ${ref.view ?? ref.url}`);
for (const [i, s] of seen.entries()) console.log(`  point ${i}: off by ${(Math.sqrt(miss(simplex[0], s)) * 100).toFixed(1)}% of the photo's height`);
console.log(`aim ${next.azimuth}°, ${next.elevation}°, fov ${next.fov}°${upright ? `, horizon ${(theta * 100).toFixed(1)}% of the photo's height below its middle` : ''} · rms ${rms.toFixed(1)}% of the photo's height`);
if (args.includes('--write')) {
  Object.assign(ref, next, {calibration: {points: seen.length, rms: +rms.toFixed(1)}});
  if (upright) ref.shift = +theta.toFixed(4); else delete ref.shift;
  const indent = /^\{\n( +)/.exec(text)?.[1].length ?? 1;
  await writeFile(path, JSON.stringify(d, null, indent) + (text.endsWith('\n') ? '\n' : ''));
  console.log('Written to the reference.');
}
