#!/usr/bin/env node
// Checks monument files: node scripts/validate.mjs [--standard|--strict] [file or folder ...]
// Without paths: the collection (examples/) and the community gallery (community/*/monument.json).
// Every phase and moment must cite a source, every element must use a known brick, and every brick of
// the kit must be documented in references/bricks.md, or the next monument will not find it.
// --standard checks the focused local workflow: measured outline, two sources, three reference views,
// recognisable close details, sourced worksite scenes and one comparison pass. --strict adds the wider
// source/photo set, phase captures and a second comparison pass.
import {readFile, readdir, stat} from 'node:fs/promises';
import {join, resolve, dirname, basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {measurePlan} from './lib/plan.mjs';

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
const strict = process.argv.includes('--strict'), standard = strict || process.argv.includes('--standard');
const paths = process.argv.slice(2).filter(arg => !['--strict', '--standard'].includes(arg));
const targets = paths.length ? paths.map(arg => resolve(arg)) : [join(skill, 'examples'), join(skill, 'community')];
const exists = path => stat(path).then(() => true, () => false);
// Words that betray facts taken from a search engine's summary instead of a page that was read.
const HEARSAY = /search[- ](result|snippet)|\bsnippets?\b|search engine|summari[sz]ing (the )?(search|results)/i;
const seen = new Map();
for (const file of (await Promise.all(targets.map(files))).flat()) {
  let d, text;
  try { text = await readFile(file, 'utf8'); d = JSON.parse(text); } catch (error) { check(false, `${file}: not valid JSON (${error.message})`); continue; }
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
    if (p.scene) {
      check(['masonry', 'timber', 'metal', 'earth', 'restoration', 'mixed'].includes(p.scene.craft), `${at} phase ${p.id}: scene.craft must name the work shown`);
      check(p.scene.at?.length === 2 && p.scene.at.every(Number.isFinite), `${at} phase ${p.id}: scene.at needs an [x, z] worksite centre`);
      check(p.scene.focus?.length === 3 && p.scene.focus.every(Number.isFinite), `${at} phase ${p.id}: scene.focus needs a camera [x, y, z] point`);
      check(url(p.scene.source), `${at} phase ${p.id}: the worksite scene needs its own source URL`);
      check(p.scene.distance === undefined || Number.isFinite(p.scene.distance) && p.scene.distance > 0, `${at} phase ${p.id}: scene.distance must be a positive camera distance`);
      check(p.scene.workers === undefined || Number.isInteger(p.scene.workers) && p.scene.workers >= 0 && p.scene.workers <= 18, `${at} phase ${p.id}: scene.workers must be 0–18`);
      check(p.scene.dust === undefined || Number.isFinite(p.scene.dust) && p.scene.dust >= 0 && p.scene.dust <= 1, `${at} phase ${p.id}: scene.dust must be 0–1`);
    }
    for (const m of p.moments ?? []) {
      check(m.at >= 0 && m.at <= 1, `${at} moment "${m.title}" must have 0 ≤ at ≤ 1`);
      check(m.anchor?.length === 3 && m.anchor.every(Number.isFinite), `${at} moment "${m.title}" needs an [x, y, z] anchor`);
      check(m.distance === undefined || Number.isFinite(m.distance) && m.distance > 0, `${at} moment "${m.title}": distance must be a positive camera distance`);
      check(url(m.source), `${at} moment "${m.title}" needs a source URL`);
    }
  }
  const refs = obj => { for (const [key, value] of Object.entries(obj)) {
    if (['phase', 'until', 'restore'].includes(key) && typeof value === 'string') check(phases.has(value), `${at} unknown phase "${value}"`);
    if (key === 'phases' && value && typeof value === 'object') for (const phase of Object.values(value)) check(phases.has(phase), `${at} unknown phase "${phase}"`);
    if (value && typeof value === 'object') refs(value);
  } };
  for (const e of d.elements) { check(bricks.has(e.type), `${at} unknown brick "${e.type}"`); refs(e); }
  if (standard) await evidence(d, text, file, id, at, strict);
  console.log(`${id}: ${d.phases.length} phases, ${d.elements.length} elements${standard ? `, ${strict ? 'publication' : 'standard'} evidence checked` : ''}`);
}
if (failures) { console.error(`${failures} problem(s).${strict ? ' Until they are fixed, the monument cannot be published.' : ''}`); process.exitCode = 1; }
else console.log(strict ? 'All monuments pass the publication evidence gate.' : standard ? 'All monuments pass the standard evidence gate.' : 'All monuments are valid.');

// The evidence of every step of SKILL.md, read from the file and the files next to it.
async function evidence(d, text, file, id, at, strict) {
  const ev = d.evidence ?? {}, dir = dirname(file);
  check(!HEARSAY.test(text), `${at} mentions search results or snippets: every fact must come from a page that was opened and read`);
  check(['building', 'ensemble', 'site'].includes(ev.size), `${at} evidence.size must be "building", "ensemble" or "site" (step 1, size it)`);
  check(typeof ev.identity === 'string' && ev.identity.length > 10, `${at} evidence.identity must name the building and its address (step 3)`);
  // Step 3: pages actually read, and every phase and moment backed by one of them.
  const sources = Array.isArray(ev.sources) ? ev.sources : [];
  const sourceMinimum = strict ? 3 : 2;
  check(sources.length >= sourceMinimum && sources.every(s => s && url(s.url) && typeof s.read === 'string' && s.read.length >= 20), `${at} evidence.sources needs at least ${sourceMinimum} pages read, each {"url", "read": "what this page says"}`);
  check(new Set(sources.map(s => { try { return new URL(s.url).hostname; } catch { return ''; } })).size >= 2, `${at} evidence.sources must come from at least 2 different sites`);
  const read = new Set(sources.map(s => s?.url));
  const scenes = d.phases.filter(phase => phase.scene);
  check(scenes.length >= Math.min(2, d.phases.length), `${at} show a sourced human-scale worksite in at least ${Math.min(2, d.phases.length)} phases with phase.scene`);
  for (const p of d.phases) {
    check(read.has(p.source), `${at} phase ${p.id}: its source is not one of the pages in evidence.sources`);
    if (p.scene) check(read.has(p.scene.source), `${at} phase ${p.id}: its scene source is not one of the pages in evidence.sources`);
    for (const m of p.moments ?? []) check(read.has(m.source), `${at} moment "${m.title}": its source is not one of the pages in evidence.sources`);
  }
  // Step 4: the measured outline, and the model sitting on it.
  const plan = ev.plan ?? {};
  check(plan.source && url(plan.url) && typeof plan.outline === 'string', `${at} evidence.plan needs "source", "url" and "outline" (the measured outline file, step 4)`);
  if (typeof plan.outline === 'string') {
    try {
      const {result} = await measurePlan(file), tolerance = Math.min(10, plan.tolerance ?? 3);
      check(result.p90 !== null && result.p90 <= tolerance, `${at} the model is ${result.p90} m off its measured outline (90% of sectors; max ${result.max} m); fit it within ${tolerance} m`);
      check(result.coverage >= .5, `${at} the model covers only ${Math.round(result.coverage * 100)}% of the measured outline`);
    } catch (error) { check(false, `${at} cannot measure the plan: ${error.message}`); }
    check(await exists(join(dir, `${id}.evidence`, 'plan.svg')), `${at} ${id}.evidence/plan.svg is missing: run node scripts/plan.mjs`);
  }
  // Step 5: reference photos from several sides, and the features that make the building recognisable.
  const photos = Array.isArray(ev.references) ? ev.references : [];
  const photoMinimum = strict ? 4 : 3, sideMinimum = strict ? 3 : 2;
  check(photos.length >= photoMinimum, `${at} evidence.references needs at least ${photoMinimum} reference photos`);
  for (const [i, r] of photos.entries()) check(url(r?.url) && typeof r.view === 'string' && [r.azimuth, r.elevation, r.distance].every(Number.isFinite), `${at} reference ${i} needs "url", "view", "azimuth", "elevation" and "distance"`);
  const sides = new Set(photos.filter(r => Number.isFinite(r?.azimuth)).map(r => Math.floor((((r.azimuth % 360) + 360) % 360) / 90)));
  check(sides.size >= sideMinimum, `${at} the reference photos must be taken from at least ${sideMinimum} sides (azimuths in different quadrants)`);
  const features = Array.isArray(ev.features) ? ev.features : [];
  check(features.length >= 8 && features.every(f => f && typeof f.text === 'string' && url(f.source)), `${at} evidence.features needs at least 8 recognisable features, including close details, each {"text", "source"}`);
  // Standard: one focused final-view pass. Publication: two passes and phase captures.
  const passes = Array.isArray(ev.comparisons) ? ev.comparisons : [];
  const passMinimum = strict ? 2 : 1;
  check(passes.length >= passMinimum, `${at} evidence.comparisons needs at least ${passMinimum} pass${passMinimum > 1 ? 'es' : ''}`);
  for (const c of passes) {
    check(Array.isArray(c.captures) && c.captures.length >= photos.length, `${at} pass ${c.pass}: one capture per reference photo (run compare.mjs again)`);
    for (const capture of c.captures ?? []) check(await exists(join(dir, capture)), `${at} pass ${c.pass}: capture ${capture} not found`);
    check(Array.isArray(c.gaps) && c.gaps.length > 0 && c.gaps.every(g => typeof g === 'string' && g.length > 10), `${at} pass ${c.pass}: write in "gaps" what differs between each photo and its capture`);
    if (strict) check(Array.isArray(c.phases) && c.phases.length >= d.phases.length, `${at} pass ${c.pass}: publication needs one capture per phase (run compare.mjs without --quick)`);
  }
  for (const c of strict ? passes.slice(0, -1) : passes.slice(0, 1)) check(Array.isArray(c.fixed) && c.fixed.length > 0, `${at} pass ${c.pass}: write in "fixed" what was changed after it`);
  const last = passes.at(-1);
  if (last) check(Array.isArray(last.remaining), `${at} the last pass needs "remaining": the simplifications left, or []`);
  if (last?.remaining?.length) check((ev.uncertainties ?? []).length > 0, `${at} the remaining gaps must also be in evidence.uncertainties`);
  check(['day', 'golden'].includes(d.view?.light), `${at} view.light must be chosen, "day" or "golden" (references/fidelity.md)`);
  check(typeof d.modelNote === 'string' && d.modelNote.length > 20, `${at} modelNote must say what is measured and what is interpreted`);
}
