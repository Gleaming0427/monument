#!/usr/bin/env node
// The contract of scan alignment. A captured scan is only evidence for centimetres if the fit is exact where it can be
// and honest where it cannot: the transform is recovered from a few approximate pairs, noise and outliers (trees,
// scaffolding, neighbours) do not move it, and the residuals say how far each element stands from what was captured.
import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadEngine} from './lib/engine.mjs';
import {readMonument} from './lib/compact.mjs';
import {readPoints, fitSimilarity, apply, compose, toMatrix, fromMatrix, turnY, modelTriangles, triangleGrid, refine, residuals} from './lib/scan.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

// A small deterministic generator, so a failure can be replayed.
const rng = seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const gauss = random => Math.sqrt(-2 * Math.log(random() + 1e-12)) * Math.cos(2 * Math.PI * random());
const rotation = (yaw, pitch, roll) => {
  const [cy, sy, cp, sp, cr, sr] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch), Math.cos(roll), Math.sin(roll)];
  const Y = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]], X = [[1, 0, 0], [0, cp, -sp], [0, sp, cp]], Z = [[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]];
  const mul = (a, b) => a.map(row => [0, 1, 2].map(c => row[0] * b[0][c] + row[1] * b[1][c] + row[2] * b[2][c]));
  return mul(Y, mul(X, Z));
};

test('a similarity transform is recovered exactly from exact pairs', () => {
  const random = rng(7), T = {scale: 1.73, R: rotation(.9, -.2, .35), t: [12, -4, 30]};
  const a = Array.from({length: 40}, () => [random() * 50, random() * 20, random() * 50]), b = a.map(p => apply(T, p));
  const fit = fitSimilarity(a, b);
  assert.ok(Math.abs(fit.scale - T.scale) < 1e-9, `scale ${fit.scale}`);
  for (const p of a) assert.ok(Math.hypot(...apply(fit, p).map((v, i) => v - apply(T, p)[i])) < 1e-8);
  const rigid = fitSimilarity(a, a.map(p => apply({...T, scale: 1}, p)), {rigid: true});
  assert.equal(rigid.scale, 1);
});

test('the matrix handed to the viewer applies the same transform, and the turn of the monument composes with it', () => {
  const T = {scale: .42, R: rotation(-.7, .1, .05), t: [3, 1, -9]}, back = fromMatrix(toMatrix(T)), p = [4, 5, 6];
  assert.ok(Math.hypot(...apply(back, p).map((v, i) => v - apply(T, p)[i])) < 1e-12);
  // scene = turn(rotate) · monument frame: undoing the turn and applying it again changes nothing.
  const turn = turnY(-14.5), undo = turnY(14.5), same = compose(turn, compose(undo, T));
  assert.ok(Math.hypot(...apply(same, p).map((v, i) => v - apply(T, p)[i])) < 1e-12);
});

test('every format a capture tool writes is read, and the ones that cannot be are refused with the way out', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'monument-scan-'));
  try {
    const points = [[1, 2, 3], [4.5, -5, 6], [-7, 8, 9.25]];
    await writeFile(join(dir, 'a.ply'), `ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nend_header\n${points.map(p => `${p.join(' ')} 200`).join('\n')}\n`);
    const header = 'ply\nformat binary_little_endian 1.0\nelement vertex 3\nproperty float nx\nproperty double x\nproperty float y\nproperty float z\nproperty uchar red\nend_header\n';
    const body = Buffer.alloc(3 * 21); points.forEach((p, i) => { body.writeFloatLE(0, i * 21); body.writeDoubleLE(p[0], i * 21 + 4); body.writeFloatLE(p[1], i * 21 + 12); body.writeFloatLE(p[2], i * 21 + 16); body[i * 21 + 20] = 9; });
    await writeFile(join(dir, 'b.ply'), Buffer.concat([Buffer.from(header), body]));
    const splat = Buffer.alloc(3 * 32); points.forEach((p, i) => p.forEach((v, k) => splat.writeFloatLE(v, i * 32 + k * 4)));
    await writeFile(join(dir, 'c.splat'), splat);
    await writeFile(join(dir, 'd.obj'), `# mesh\n${points.map(p => `v ${p.join(' ')}`).join('\n')}\nf 1 2 3\n`);
    await writeFile(join(dir, 'e.xyz'), points.map(p => p.join(' ')).join('\n'));
    for (const name of ['a.ply', 'b.ply', 'c.splat', 'd.obj', 'e.xyz']) assert.deepEqual([...await readPoints(join(dir, name))], points.flat(), name);
    await assert.rejects(readPoints(join(dir, 'x.spz')), /compressed: convert it to PLY/);
    await assert.rejects(readPoints(join(dir, 'x.las')), /unknown scan format/);
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('a noisy scan with outliers, hand-picked pairs a few decimetres out, lands on the model within 2 cm (median)', async () => {
  // Coutances: asymmetric, 1.6 million triangles, and the building the skill is held against.
  const file = resolve(root, 'community/cathedrale-de-coutances/monument.json'), data = await readMonument(file);
  const engine = await loadEngine(resolve(dirname(file), data.bricks)), {pieces} = engine.buildPieces(data);
  const mesh = modelTriangles(engine, data, pieces), grid = triangleGrid(mesh, {reach: 2});
  assert.ok(mesh.triangles.length > 1e6, `only ${mesh.triangles.length} triangles`);

  // The "scan": points on the model's surface, 2 cm of noise, 8 % foreign points, in an arbitrary frame and scale.
  const random = rng(11), area = t => { const u = [0, 1, 2].map(i => t[1][i] - t[0][i]), v = [0, 1, 2].map(i => t[2][i] - t[0][i]); return .5 * Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]); };
  const cumulative = []; let total = 0; for (const t of mesh.triangles) cumulative.push(total += area(t));
  const pick = () => { const r = random() * total; let lo = 0, hi = cumulative.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (cumulative[mid] < r) lo = mid + 1; else hi = mid; } return mesh.triangles[lo]; };
  const toScan = {scale: 2.4, R: rotation(2.2, .15, -.1), t: [-80, 15, 220]}, N = 30000, scan = new Float32Array(N * 3);
  const box = [[-70, 70], [0, 80], [-40, 40]];
  for (let i = 0; i < N; i++) {
    let p;
    if (random() < .08) p = box.map(([lo, hi]) => lo + random() * (hi - lo));
    else { let [u, v] = [random(), random()]; if (u + v > 1) { u = 1 - u; v = 1 - v; } const t = pick(); p = [0, 1, 2].map(k => t[0][k] + u * (t[1][k] - t[0][k]) + v * (t[2][k] - t[0][k]) + gauss(random) * .02); }
    scan.set(apply(toScan, p), i * 3);
  }
  // Four pairs the way a person picks them: the scan's point, and the model's, a few decimetres wrong.
  const sources = [0, 1, 2, 3].map(i => mesh.triangles[(i * 150001 + 7) % mesh.triangles.length][0]);
  const pairs = sources.map(m => ({scan: apply(toScan, m), model: m.map(v => v + (random() - .5) * .6)}));
  const first = fitSimilarity(pairs.map(p => p.scan), pairs.map(p => p.model));
  const fit = refine(scan, grid, first, {sample: 6000, rounds: 60});

  assert.ok(Math.abs(fit.scale * toScan.scale - 1) < .001, `scale off by ${(Math.abs(fit.scale * toScan.scale - 1) * 100).toFixed(3)} %`);
  const result = residuals(scan, grid, fit, {sample: 30000});
  assert.ok(result.covered > .85 && result.covered < .97, `covered ${result.covered} (8 % of the points are foreign)`);
  assert.ok(result.median < .02, `median residual ${result.median.toFixed(3)} m`);
  assert.ok(result.p90 < .08, `p90 residual ${result.p90.toFixed(3)} m`);
  assert.ok(result.elements.length > 0 && result.elements.every(e => Number.isInteger(e.element)));
});

test('an element that stands where the scan does not shows in the residuals, and the others do not', () => {
  // Two blocks of 4 m, 20 m apart, two elements. The scan has the first where the model has it and the second 30 cm out.
  const cube = (cx, owner) => { const v = [[-2, -2, -2], [2, -2, -2], [2, 2, -2], [-2, 2, -2], [-2, -2, 2], [2, -2, 2], [2, 2, 2], [-2, 2, 2]].map(([x, y, z]) => [x + cx, y + 2, z]); return [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [3, 6, 2], [3, 7, 6], [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5]].map(f => ({triangle: f.map(i => v[i]), owner})); };
  const all = [...cube(0, 5), ...cube(20, 9)], mesh = {triangles: all.map(t => t.triangle), owner: all.map(t => t.owner)}, grid = triangleGrid(mesh, {reach: 2});
  const random = rng(5), scan = new Float32Array(20000 * 3);
  for (let i = 0; i < 20000; i++) {
    const [index] = [Math.floor(random() * all.length)], t = all[index].triangle; let [u, v] = [random(), random()]; if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const p = [0, 1, 2].map(k => t[0][k] + u * (t[1][k] - t[0][k]) + v * (t[2][k] - t[0][k]));
    // Pushed 30 cm along the face's own normal, away from the block, for the second element.
    if (all[index].owner === 9) { const n = [0, 1, 2].map(k => p[k] - [20, 2, 0][k]), big = n.indexOf(n.map(Math.abs).reduce((m, x) => Math.max(m, x), 0)); p[big] += Math.sign(n[big]) * .3; }
    scan.set(p, i * 3);
  }
  const identity = {scale: 1, R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [0, 0, 0]}, result = residuals(scan, grid, identity), by = Object.fromEntries(result.elements.map(e => [e.element, e]));
  assert.ok(by[5].p90 < 1e-3, `the block that fits has p90 ${by[5].p90}`);
  assert.ok(Math.abs(by[9].median - .3) < .02, `the block 30 cm out has median ${by[9].median}`);
  assert.equal(result.elements[0].element, 9, 'the worst element comes first');
  assert.equal(result.covered, 1);
});

test('validate.mjs accepts a placed scan, refuses a misplaced one, and asks the gallery for a credit and a fit', async () => {
  const run = promisify(execFile), dir = await mkdtemp(join(tmpdir(), 'monument-scan-validate-')), id = 'leaning-tower-of-pisa';
  try {
    const data = JSON.parse(await readFile(resolve(root, `examples/${id}.json`), 'utf8'));
    await mkdir(join(dir, `${id}.evidence`, 'scan'), {recursive: true});
    await writeFile(join(dir, `${id}.evidence`, 'scan', 'capture.splat'), Buffer.alloc(32 * 10));
    const validate = async scan => { await writeFile(join(dir, `${id}.json`), JSON.stringify({...data, scan})); return run(process.execPath, [resolve(root, 'scripts/validate.mjs'), ...(scan?.strict ? ['--strict'] : []), join(dir, `${id}.json`)]).then(out => out.stdout + out.stderr, error => error.stdout + error.stderr); };
    const good = {file: `${id}.evidence/scan/capture.splat`, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]};
    assert.match(await validate(good), /All monuments are valid/);
    assert.match(await validate({...good, file: 'elsewhere/capture.ply'}), /"file" must be a \.splat, \.ply/);
    assert.match(await validate({...good, file: `${id}.evidence/scan/missing.ply`}), /missing\.ply not found/);
    assert.match(await validate({...good, matrix: new Array(16).fill(0)}), /"matrix" is singular/);
    assert.match(await validate({...good, matrix: [1, 2, 3]}), /"matrix" needs 16 numbers/);
    assert.match(await validate({...good, strict: true}), /a published scan needs "credit"/);
  } finally { await rm(dir, {recursive: true, force: true}); }
});
