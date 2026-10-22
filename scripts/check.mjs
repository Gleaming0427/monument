#!/usr/bin/env node
// Architectural validation: node scripts/check.mjs [file or folder ...]
// Compares what each monument was built as against the figures evidence.measurements cites, and prints the
// difference in the units it was measured in. A failure names the quantity, both numbers and the source, so
// the next edit can be made where the evidence says the model is wrong.
import {readdir, stat} from 'node:fs/promises';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadEngine} from './lib/engine.mjs';
import {readMonument} from './lib/compact.mjs';
import {audit} from './lib/architecture.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const pad = (value, width) => String(value).padEnd(width);
const number = value => (typeof value === 'number' ? (Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')) : String(value ?? '—'));

// The same file rule as validate.mjs: the collection is a folder of <id>.json, the gallery a folder of
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
let failures = 0, checked = 0, skipped = 0;

for (const file of (await Promise.all(targets.map(target => files(target)))).flat()) {
  const id = basename(file) === 'monument.json' ? basename(dirname(file)) : basename(file, '.json');
  const data = await readMonument(file);
  const declared = data.evidence?.measurements ?? [];
  if (!declared.length) { skipped++; console.log(`${id}: no evidence.measurements — nothing to check yet`); continue; }
  const engine = await loadEngine(data.bricks ? resolve(dirname(file), data.bricks) : undefined);
  const {pieces} = engine.buildPieces(data);
  const rows = audit(declared, pieces, id);
  const bad = rows.filter(row => !row.ok);
  checked += rows.length; failures += bad.length;
  console.log(`\n${id} · ${rows.length} sourced measurements`);
  for (const row of rows) {
    const expected = Array.isArray(row.expect) ? `${row.expect[0]}–${row.expect[1]}` : `${number(row.expect)}${row.tolerance ? ` ±${Math.round(row.tolerance * 100)}%` : ''}`;
    const mark = row.ok ? '✓' : '✗';
    const gap = row.ok ? '' : `  (${row.measured > (row.low + row.high) / 2 ? 'over' : 'under'} by ${Math.abs(((row.measured - (row.low + row.high) / 2) / ((row.low + row.high) / 2)) * 100).toFixed(0)}%)`;
    console.log(`  ${mark} ${pad(row.quantity, 28)} ${pad(`${number(row.measured)}${row.unit ? ` ${row.unit}` : ''}`, 24)} ${row.ok ? pad(`= ${expected}`, 22) : pad(`source ${expected}`, 22)}${gap}`);
  }
  for (const row of bad) console.log(`    → ${id}: ${row.quantity} is ${number(row.measured)} ${row.unit ?? ''}, the source says ${row.expect} (${row.source})`);
  // A ledger row that claims "matched" may name the measurements that back it. Those rows stop being a promise.
  const ledger = data.evidence?.detailReview?.items ?? [], backed = ledger.filter(item => Array.isArray(item.measurement) && item.measurement.length);
  const contradicted = backed.filter(item => item.result === 'matched' && item.measurement.some(quantity => bad.some(row => row.quantity === quantity)));
  for (const item of contradicted) console.log(`    → ${id}: the ledger row “${String(item.feature).slice(0, 48)}…” claims "matched" but ${item.measurement.filter(q => bad.some(r => r.quantity === q)).join(', ')} does not`);
  failures += contradicted.length;
  if (backed.length) console.log(`  ${backed.length} of ${ledger.length} ledger rows are backed by a measurement rather than an assertion`);
  else if (ledger.length) console.log(`  no ledger row names a measurement yet: all ${ledger.length} are still assertions`);
}

console.log(`\n${checked} measurements checked, ${failures} not matching their source, ${skipped} monuments without measurements.`);
if (failures) process.exitCode = 1;
