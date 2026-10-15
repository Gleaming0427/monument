#!/usr/bin/env node
// Checks monument files: node scripts/validate.mjs [file or folder ...]
// Without arguments: the collection (examples/) and the community gallery (community/*/monument.json).
// Every phase and moment must cite a source, every element must use a known brick, and every brick of
// the kit must be documented in references/bricks.md, or the next monument will not find it.
import {readFile, readdir, stat} from 'node:fs/promises';
import {join, resolve, dirname, basename} from 'node:path';
import {fileURLToPath} from 'node:url';

const skill = fileURLToPath(new URL('..', import.meta.url));
const bricksOf = source => new Set([...source.matchAll(/^\s{2}(\w+)\(k,\s*e,\s*P\)/gm)].map(m => m[1]));
const kit = bricksOf(await readFile(join(skill, 'kit', 'builder.js'), 'utf8'));
const table = await readFile(join(skill, 'references', 'bricks.md'), 'utf8');
let failures = 0;
const check = (ok, message) => { if (!ok) { console.error(`✗ ${message}`); failures++; } };
for (const brick of kit) check(table.includes(`| \`${brick}\` |`), `brick ${brick} is missing from references/bricks.md`);

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

const url = value => { try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; } };
const targets = process.argv.slice(2).length ? process.argv.slice(2).map(arg => resolve(arg)) : [join(skill, 'examples'), join(skill, 'community')];
const seen = new Map();
for (const file of (await Promise.all(targets.map(files))).flat()) {
  let d;
  try { d = JSON.parse(await readFile(file, 'utf8')); } catch (error) { check(false, `${file}: not valid JSON (${error.message})`); continue; }
  const id = basename(file) === 'monument.json' ? basename(dirname(file)) : basename(file, '.json'), at = `${id}:`;
  check(/^[a-z0-9-]+$/.test(id), `${at} id must be lowercase letters, digits and dashes`);
  check(d.id === id, `${at} "id" must be "${id}" (the file or folder name)`);
  check(!seen.has(id), `${at} same id as ${seen.get(id)}`); seen.set(id, file);
  for (const key of ['name', 'place', 'view', 'phases', 'elements']) check(d[key], `${at} missing "${key}"`);
  if (!d.phases || !d.elements) continue;
  let bricks = kit;
  for (const stat of d.live ?? []) check(typeof stat.label === 'string' && ['height', 'count'].includes(stat.kind), `${at} each "live" entry needs a text "label" and a kind "height" or "count"`);
  for (const fact of d.facts ?? []) check(typeof fact.value === 'string' && typeof fact.label === 'string', `${at} each "facts" entry needs a text "value" and "label"`);
  if (d.bricks) {
    if (!/^[a-z0-9-]+\.bricks\.js$/.test(d.bricks)) { check(false, `${at} "bricks" must be a plain file name like "${id}.bricks.js"`); continue; }
    const source = await readFile(join(dirname(file), d.bricks), 'utf8').catch(() => '');
    check(source, `${at} bricks module ${d.bricks} not found`);
    bricks = new Set([...kit, ...bricksOf(source)]);
  }
  const phases = new Set(d.phases.map(p => p.id));
  check(phases.size === d.phases.length, `${at} duplicate phase id`);
  for (const p of d.phases) {
    check(url(p.source), `${at} phase ${p.id} needs a source URL`);
    check(p.title && p.text, `${at} phase ${p.id} needs a title and a text`);
    check(p.when || (!isNaN(Date.parse(p.from)) && !isNaN(Date.parse(p.to))), `${at} phase ${p.id} needs "when" or ISO "from" and "to"`);
    check(!p.when || p.when.length <= 28, `${at} phase ${p.id}: "when" is a date or period only ("${p.when}")`);
    for (const m of p.moments ?? []) {
      check(m.at >= 0 && m.at <= 1, `${at} moment "${m.title}" must have 0 ≤ at ≤ 1`);
      check(m.anchor?.length === 3 && m.anchor.every(Number.isFinite), `${at} moment "${m.title}" needs an [x, y, z] anchor`);
      check(url(m.source), `${at} moment "${m.title}" needs a source URL`);
    }
  }
  const refs = obj => { for (const [key, value] of Object.entries(obj)) {
    if (['phase', 'until', 'restore'].includes(key) && typeof value === 'string') check(phases.has(value), `${at} unknown phase "${value}"`);
    if (key === 'phases' && value && typeof value === 'object') for (const phase of Object.values(value)) check(phases.has(phase), `${at} unknown phase "${phase}"`);
    if (value && typeof value === 'object') refs(value);
  } };
  for (const e of d.elements) { check(bricks.has(e.type), `${at} unknown brick "${e.type}"`); refs(e); }
  console.log(`${id}: ${d.phases.length} phases, ${d.elements.length} elements`);
}
if (failures) { console.error(`${failures} problem(s).`); process.exitCode = 1; } else console.log('All monuments are valid.');
