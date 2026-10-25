#!/usr/bin/env node
// Chronology validation: node scripts/chronology.mjs [file or folder ...]
// Builds every monument and holds the film to its own story: the phases follow each other in time, the
// moments are listed in the order the film reaches them, a card is never pinned on a spire that is not up yet,
// and a piece is never laid with nothing under it. A failure names the phase, the moment and the numbers, so the
// next edit can be made where the film is wrong. See scripts/lib/chronology.mjs for what each check means.
import {readdir, stat} from 'node:fs/promises';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadEngine} from './lib/engine.mjs';
import {readMonument} from './lib/compact.mjs';
import {audit} from './lib/chronology.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

// The same file rule as check.mjs: the collection is a folder of <id>.json, the gallery a folder of
// <id>/monument.json.
async function files(target) {
  const info = await stat(target).catch(() => null);
  if (!info) return [];
  if (info.isFile()) return [target];
  const out = [];
  for (const name of await readdir(target)) {
    const path = join(target, name);
    if ((await stat(path)).isDirectory()) out.push(...(await files(path)).filter(file => basename(file) === 'monument.json'));
    else if (name.endsWith('.json') && name !== 'meta.json' && name !== 'index.json') out.push(path);
  }
  return out;
}

const paths = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const targets = paths.length ? paths.map(arg => resolve(arg)) : [join(root, 'examples'), join(root, 'community')];
let failures = 0, checked = 0;

for (const file of (await Promise.all(targets.map(target => files(target)))).flat()) {
  const id = basename(file) === 'monument.json' ? basename(dirname(file)) : basename(file, '.json');
  const data = await readMonument(file);
  const engine = await loadEngine(data.bricks ? resolve(dirname(file), data.bricks) : undefined);
  const {pieces} = engine.buildPieces(data);
  const {problems, notes} = audit(data, pieces, engine, id);
  checked++; failures += problems.length;
  const moments = data.phases.reduce((n, phase) => n + (phase.moments?.length ?? 0), 0);
  console.log(`${problems.length ? '✗' : '✓'} ${id}: ${data.phases.length} phases, ${moments} moments, ${pieces.length} pieces${problems.length ? '' : ', in order'}`);
  for (const note of notes) console.log(`    · ${note}`);
  for (const problem of problems) console.log(`    → ${problem}`);
}

console.log(`\n${checked} monuments checked, ${failures} problem${failures === 1 ? '' : 's'} in their chronology.`);
if (failures) process.exitCode = 1;
