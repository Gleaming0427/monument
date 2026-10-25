#!/usr/bin/env node
// The P3 gate: what does a monument actually cost, and is any of it worth moving off JavaScript?
//
// Run this before proposing a native or WebAssembly port, and run it again when the workload changes. It
// measures the three places the roadmap ever named — mass mesh generation, offline builds, geometric
// comparison — and prints them against the threshold a rewrite would have to beat to be worth its upkeep.
//
//   node scripts/profile.mjs [--quality standard|cinematic]
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readMonument} from './lib/compact.mjs';
import {loadEngine} from './lib/engine.mjs';

// A monorepo would need roughly this much mesh work before a second implementation of the geometry code —
// a toolchain, a build step, a WASM boundary and the memory transfer across it — could pay for itself.
const THRESHOLD_MS = 2000;
const qualityIndex = process.argv.indexOf('--quality');
const quality = qualityIndex < 0 ? 'standard' : process.argv[qualityIndex + 1];
const root = fileURLToPath(new URL('..', import.meta.url));
const MONUMENTS = ['community/parthenon', 'community/kinkaku-ji', 'community/cathedrale-de-coutances'];

// The grouping kit/builder.js does in the viewer: one geometry per material, shape and level of detail. The
// number of groups is the point — tens of thousands of instances already collapse into tens of meshes.
const groupsOf = (pieces, engine, qualityName) => {
  const groups = new Map();
  for (const piece of pieces) {
    if (piece.mesh) { const key = `${piece.kind}|patch`; if (!groups.has(key)) groups.set(key, {patch: true, count: 0, vertices: 0}); const g = groups.get(key); g.count++; g.vertices += piece.mesh.position.length / 3; continue; }
    const shape = piece.shape ?? 'box', factory = engine.SHAPES[shape];
    if (!factory) continue;
    const variant = factory.adaptive ? engine.adaptiveContext(piece, factory, qualityName) : {context: {}, key: 'fixed'};
    const key = `${piece.kind}|${shape}|${variant.key}`;
    if (!groups.has(key)) groups.set(key, {factory, context: variant.context, count: 0});
    groups.get(key).count++;
  }
  return groups;
};

const rows = [];
let buildTotal = 0, meshTotal = 0, vertices = 0;

for (const dir of MONUMENTS) {
  const file = resolve(root, dir, 'monument.json');
  const data = await readMonument(file);
  const engine = await loadEngine(resolve(dirname(file), data.bricks));

  const started = performance.now();
  const {pieces} = engine.buildPieces(data);
  const buildMs = performance.now() - started;
  const groups = groupsOf(pieces, engine, quality);

  const meshStarted = performance.now();
  let count = 0;
  for (const group of groups.values()) {
    if (group.patch) { count += group.vertices; continue; }
    const geometry = group.factory(group.context);
    count += geometry.attributes.position.count;
    geometry.dispose();
  }
  const meshMs = performance.now() - meshStarted;

  const instances = [...groups.values()].reduce((sum, group) => sum + group.count, 0);
  buildTotal += buildMs; meshTotal += meshMs; vertices += count;
  rows.push({id: data.id, pieces: pieces.length, instances, groups: groups.size, vertices: count, buildMs, meshMs});
}

const pad = (value, width) => String(value).padEnd(width);
const ms = value => `${value.toFixed(1)} ms`;
console.log(`Monument profile · node ${process.version} · quality ${quality}\n`);
console.log(`${pad('monument', 24)}${pad('pieces', 10)}${pad('meshes', 9)}${pad('vertices', 11)}build      meshes`);
for (const row of rows) {
  console.log(`${pad(row.id, 24)}${pad(row.pieces.toLocaleString(), 10)}${pad(row.groups, 9)}${pad(row.vertices.toLocaleString(), 11)}${pad(ms(row.buildMs), 10)}${ms(row.meshMs)}`);
}
console.log(`\n${pad('total', 24)}${pad(rows.reduce((s, r) => s + r.pieces, 0).toLocaleString(), 10)}${pad(rows.reduce((s, r) => s + r.groups, 0), 9)}${pad(vertices.toLocaleString(), 11)}${pad(ms(buildTotal), 10)}${ms(meshTotal)}`);

const ratio = meshTotal / THRESHOLD_MS;
console.log(`\nThe whole candidate surface is ${ms(meshTotal)} of mesh generation and ${ms(buildTotal)} of building.`);
console.log(`A native or WebAssembly port would have to beat ${ms(THRESHOLD_MS)} to earn its toolchain, its build`);
console.log(`step, its WASM boundary and the memory transfer across it. That is ${(1 / ratio).toFixed(0)}× more than there is to win.`);
console.log(ratio >= 1 ? '\nThe gate is met: a port is worth measuring.' : '\nThe gate is not met. Do not port; re-run this when the workload grows.');
if (ratio >= 1) process.exitCode = 1;