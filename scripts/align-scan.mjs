#!/usr/bin/env node
// Aligns a captured scan (photogrammetry, laser, gaussian splats) onto a monument and says how far the model stands
// from it, element by element:
//   node scripts/align-scan.mjs <monument.json> <scan.ply|.splat|.obj|.xyz> --pairs '[[sx, sy, sz, mx, my, mz], …]'
//        [--rigid] [--no-icp] [--sample 8000] [--rounds 80] [--elements 13,14] [--write <file in the evidence folder>]
// Each pair is a place in the scan (its own units) and the same place on the model (metres, the monument's own frame,
// before "rotate"), three or more and not on one line: corners of the towers, the foot of a buttress, the apex of a
// gable. They only have to be right to a few decimetres: the point-to-plane refinement does the rest. `--rigid` keeps
// the scan's own scale, which is right for a scan scaled by measurement (control points, a measured length); without
// it the scale is fitted too, and printed so that you can judge it. `--write` records the transform in the monument as
// `scan` (the file, a matrix the viewer applies, and the fit), for the viewer's "captured" layer.
import {readFile, writeFile} from 'node:fs/promises';
import {basename, dirname, resolve} from 'node:path';
import {loadEngine} from './lib/engine.mjs';
import {readMonument} from './lib/compact.mjs';
import {readPoints, fitSimilarity, apply, compose, toMatrix, turnY, modelTriangles, triangleGrid, refine, residuals} from './lib/scan.mjs';

const args = process.argv.slice(2), flag = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const [monument, scanFile] = args.filter((arg, i) => !arg.startsWith('--') && !['--pairs', '--sample', '--rounds', '--elements', '--write'].includes(args[i - 1]));
if (!monument?.endsWith('.json') || !scanFile) {
  console.error("Usage: node scripts/align-scan.mjs <monument.json> <scan.ply|.splat|.obj|.xyz> --pairs '[[sx, sy, sz, mx, my, mz], …]' [--rigid] [--no-icp] [--sample 8000] [--rounds 80] [--elements 13,14] [--write <evidence file>]");
  process.exit(1);
}
const path = resolve(monument), data = await readMonument(path), rigid = args.includes('--rigid');
const pairs = JSON.parse(flag('pairs') ?? 'null') ?? (data.scan?.fit?.pairs ?? null);
if (!Array.isArray(pairs) || pairs.length < 3 || pairs.some(pair => pair.length !== 6 || !pair.every(Number.isFinite))) { console.error('--pairs needs three or more [sx, sy, sz, mx, my, mz]'); process.exit(1); }

const engine = await loadEngine(data.bricks ? resolve(dirname(path), data.bricks) : undefined), {pieces} = engine.buildPieces(data);
const elements = flag('elements')?.split(',').map(Number), mesh = modelTriangles(engine, data, pieces, {elements}), grid = triangleGrid(mesh, {reach: 2});
const positions = await readPoints(resolve(scanFile));
console.log(`${basename(path)}: ${mesh.triangles.length.toLocaleString('en')} triangles of what stands at the end${elements ? ` (elements ${elements.join(', ')})` : ''}; ${basename(scanFile)}: ${(positions.length / 3).toLocaleString('en')} points`);

// The model's side of each pair is in the monument's frame; the scene is that frame turned by `rotate`.
const turn = turnY(data.rotate ?? 0), scene = pairs.map(pair => apply(turn, pair.slice(3)));
let T = fitSimilarity(pairs.map(pair => pair.slice(0, 3)), scene, {rigid});
const pairError = pairs.map((pair, i) => Math.hypot(...apply(T, pair.slice(0, 3)).map((v, k) => v - scene[i][k])));
console.log(`pairs: scale ${T.scale.toPrecision(6)}, worst pair ${Math.max(...pairError).toFixed(3)} m`);
if (!args.includes('--no-icp')) T = refine(positions, grid, T, {sample: Number(flag('sample') ?? 8000), rounds: Number(flag('rounds') ?? 80), rigid});

const result = residuals(positions, grid, T);
const cm = value => value === null ? '—' : `${(value * 100).toFixed(1)} cm`;
console.log(`scale ${T.scale.toPrecision(6)}${rigid ? ' (kept)' : ' (fitted)'}; ${(result.covered * 100).toFixed(0)} % of the scan lies within 2 m of the model; median ${cm(result.median)}, 90 % within ${cm(result.p90)}, 99 % within ${cm(result.p99)}`);
console.log('\nelement                                          points  median     p90');
for (const {element, points, median, p90} of result.elements.slice(0, 12)) {
  const e = data.elements[element], label = `${element} ${e?.type ?? ''} ${e?.name ?? ''}`.trim().slice(0, 46);
  console.log(`${label.padEnd(46)} ${String(points).padStart(8)} ${cm(median).padStart(8)} ${cm(p90).padStart(8)}`);
}
console.log('\nThese are distances between the model and the scan, not between the model and the building: the scan is as good as its ground sampling distance and its control (references/capture.md).');

const write = flag('write');
if (write) {
  const world = compose(turnY(-(data.rotate ?? 0)), T), text = await readFile(path, 'utf8'), d = JSON.parse(text), indent = /^\{\n( +)/.exec(text)?.[1].length ?? 1;
  d.scan = {...d.scan, file: write, matrix: toMatrix(world).map(v => +v.toPrecision(10)), fit: {pairs, scale: +T.scale.toPrecision(8), points: result.points, median: +result.median.toFixed(4), p90: +result.p90.toFixed(4), covered: +result.covered.toFixed(3), rigid, elements: result.elements.filter(e => e.points >= 200).slice(0, 80).map(e => ({element: e.element, points: e.points, median: +e.median.toFixed(4), p90: +e.p90.toFixed(4)})), date: new Date().toISOString().slice(0, 10)}};
  await writeFile(path, JSON.stringify(d, null, indent) + (text.endsWith('\n') ? '\n' : ''));
  console.log(`recorded in ${basename(path)} as scan (${write})`);
}
