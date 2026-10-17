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
const VISUAL_QUALITY = new Set(['basic', 'standard', 'cinematic']);
const MATERIAL_PRESETS = new Set(['gothic-limestone', 'roman-weathered', 'marble-italian', 'historic-masonry', 'industrial-iron']);
const ENVIRONMENT_PRESETS = new Set(['gothic-urban', 'mediterranean-lawn', 'roman-ruins', 'exposition-grounds', 'museum-neutral']);
const SURFACE_MATERIALS = new Set(['limestone-paris', 'limestone-weathered', 'marble-white', 'sandstone-warm', 'granite-grey', 'brick-roman', 'oak-aged', 'slate-aged', 'terracotta-aged']);
const DECOR_TYPES = new Set(['tree-oak', 'tree-cypress', 'tree-olive', 'stone-blocks', 'cart-medieval', 'amphora']);
// Links are opened, not trusted: a page cited must answer, a reference photo must exist on Wikimedia
// Commons and, when Commons records where it was taken, the declared viewpoint must match that place.
const UA = {'User-Agent': 'monument-skill/1.0 (+https://github.com/Gleaming0427/monument)'};
const opened = new Map();
const open = link => {
  if (!opened.has(link)) opened.set(link, (async () => {
    for (const method of ['HEAD', 'GET']) {
      try {
        const response = await fetch(link, {method, headers: UA, redirect: 'follow', signal: AbortSignal.timeout(20000)});
        response.body?.cancel();
        if (response.status < 400) return 'ok';
        if ([404, 410].includes(response.status)) return `answers ${response.status}`;
        if (method === 'GET') return [401, 403, 429, 503].includes(response.status) ? 'ok' : `answers ${response.status}`;
      } catch (error) { if (method === 'GET') return `cannot be opened (${error.cause?.code ?? error.name})`; }
    }
  })());
  return opened.get(link);
};
async function commons(titles) {
  const pages = new Map();
  for (let i = 0; i < titles.length; i += 40) {
    const query = new URLSearchParams({action: 'query', format: 'json', prop: 'coordinates|imageinfo', coprop: 'type', colimit: 'max', titles: titles.slice(i, i + 40).join('|')});
    const response = await fetch(`https://commons.wikimedia.org/w/api.php?${query}`, {headers: UA, signal: AbortSignal.timeout(30000)});
    const data = await response.json(), names = new Map((data.query.normalized ?? []).map(n => [n.to, n.from]));
    for (const page of Object.values(data.query.pages)) pages.set(names.get(page.title) ?? page.title, page);
  }
  return pages;
}
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
  if (d.visualStyle) {
    const style = d.visualStyle;
    check(VISUAL_QUALITY.has(style.quality), `${at} visualStyle.quality must be "basic", "standard" or "cinematic"`);
    check(MATERIAL_PRESETS.has(style.materialPreset), `${at} visualStyle.materialPreset is not in the bundled material library`);
    check(ENVIRONMENT_PRESETS.has(style.environmentPreset), `${at} visualStyle.environmentPreset is not in the bundled environment library`);
    for (const [surface, material] of Object.entries(style.surfaces ?? {})) check(SURFACE_MATERIALS.has(material), `${at} visualStyle.surfaces.${surface} uses unknown material "${material}"`);
    check(style.vegetation === undefined || typeof style.vegetation === 'boolean', `${at} visualStyle.vegetation must be true or false`);
    check((style.props ?? []).every(type => DECOR_TYPES.has(type)), `${at} visualStyle.props contains an unknown prop`);
    if (style.environment?.from) check(phases.has(style.environment.from), `${at} visualStyle.environment.from names unknown phase "${style.environment.from}"`);
    if (style.environment?.count !== undefined) check(Number.isInteger(style.environment.count) && style.environment.count >= 0 && style.environment.count <= 24, `${at} visualStyle.environment.count must be 0–24`);
    if (style.environment?.exclusion !== undefined) check(Number.isFinite(style.environment.exclusion) && style.environment.exclusion >= .25 && style.environment.exclusion <= 1, `${at} visualStyle.environment.exclusion must be 0.25–1`);
    check(Array.isArray(style.decor ?? []), `${at} visualStyle.decor must be an array`);
    for (const [i, item] of (style.decor ?? []).entries()) {
      check(DECOR_TYPES.has(item?.type), `${at} visualStyle.decor ${i} has unknown type`);
      check(item?.at?.length === 2 && item.at.every(Number.isFinite), `${at} visualStyle.decor ${i} needs at: [x, z]`);
      if (item?.from) check(phases.has(item.from), `${at} visualStyle.decor ${i} from names unknown phase "${item.from}"`);
      if (item?.until) check(phases.has(item.until), `${at} visualStyle.decor ${i} until names unknown phase "${item.until}"`);
    }
  }
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
      if (p.scene.scaffold) {
        const scaffold = p.scene.scaffold;
        check(typeof scaffold === 'object' && ['facade', 'ring', 'tower'].includes(scaffold.kind), `${at} phase ${p.id}: scene.scaffold needs kind "facade", "ring" or "tower"`);
        check(scaffold.offset === undefined || scaffold.offset?.length === 2 && scaffold.offset.every(Number.isFinite), `${at} phase ${p.id}: scene.scaffold.offset must be [x, z]`);
        check(scaffold.height === undefined || Number.isFinite(scaffold.height) && scaffold.height > 0, `${at} phase ${p.id}: scene.scaffold.height must be positive`);
        if (scaffold.kind === 'ring') check(Number.isFinite(scaffold.radius) && scaffold.radius > 0, `${at} phase ${p.id}: a ring scaffold needs a positive radius`);
        if (['facade', 'tower'].includes(scaffold.kind)) check(Number.isFinite(scaffold.width) && scaffold.width > 0, `${at} phase ${p.id}: a ${scaffold.kind} scaffold needs a positive width`);
      }
      if (p.scene.hoist) {
        const hoist = p.scene.hoist;
        check(typeof hoist === 'object' && ['gin-pole', 'treadwheel', 'steam-crane'].includes(hoist.kind), `${at} phase ${p.id}: scene.hoist needs kind "gin-pole", "treadwheel" or "steam-crane"`);
        check(hoist.offset === undefined || hoist.offset?.length === 2 && hoist.offset.every(Number.isFinite), `${at} phase ${p.id}: scene.hoist.offset must be [x, z]`);
        check(hoist.from === undefined || Number.isFinite(hoist.from), `${at} phase ${p.id}: scene.hoist.from must be a height`);
        check(hoist.to === undefined || Number.isFinite(hoist.to), `${at} phase ${p.id}: scene.hoist.to must be a height`);
        check(hoist.start === undefined || Number.isFinite(hoist.start) && hoist.start >= 0 && hoist.start <= 1, `${at} phase ${p.id}: scene.hoist.start must be 0–1`);
        check(hoist.end === undefined || Number.isFinite(hoist.end) && hoist.end >= 0 && hoist.end <= 1, `${at} phase ${p.id}: scene.hoist.end must be 0–1`);
      }
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
  check(['standard', 'cinematic'].includes(d.visualStyle?.quality), `${at} a standard build needs visualStyle quality "standard" or "cinematic"`);
  // Step 3: pages actually read, and every phase and moment backed by one of them.
  const sources = Array.isArray(ev.sources) ? ev.sources : [];
  const sourceMinimum = strict ? 3 : 2;
  check(sources.length >= sourceMinimum && sources.every(s => s && url(s.url) && typeof s.read === 'string' && s.read.length >= 20), `${at} evidence.sources needs at least ${sourceMinimum} pages read, each {"url", "read": "what this page says"}`);
  check(new Set(sources.map(s => { try { return new URL(s.url).hostname; } catch { return ''; } })).size >= 2, `${at} evidence.sources must come from at least 2 different sites`);
  const read = new Set(sources.map(s => s?.url));
  for (const link of [...read].filter(url)) { const state = await open(link); check(state === 'ok', `${at} source ${link} ${state}`); }
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
      // A tolerance above 3 m (at most 5 m) must be argued in evidence.plan.toleranceReason.
      const {result} = await measurePlan(file), tolerance = result.tolerance;
      check(result.p90 <= tolerance, `${at} the model's edges are ${result.p90} m off the measured outline (90% of the edges; max ${result.max} m); fit them within ${tolerance} m, the red marks in plan.svg show where`);
      check(result.coverage >= .85, `${at} the model covers only ${Math.round(result.coverage * 100)}% of the measured outline (85% needed)`);
      check(result.overflow <= .2, `${at} the model spreads ${Math.round(result.overflow * 100)}% beyond the measured outline (20% at most): check its scale and orientation`);
      check(!(plan.tolerance > 3) || (typeof plan.toleranceReason === 'string' && plan.toleranceReason.length >= 30), `${at} evidence.plan.tolerance is above 3 m: say why in evidence.plan.toleranceReason`);
      check(plan.fit && Math.abs(plan.fit.p90 - result.p90) < .06 && Math.abs(plan.fit.max - result.max) < .06, `${at} evidence.plan.fit is missing or out of date (measured now: p90 ${result.p90} m, max ${result.max} m): run node scripts/plan.mjs`);
    } catch (error) { check(false, `${at} cannot measure the plan: ${error.message}`); }
    check(await exists(join(dir, `${id}.evidence`, 'plan.svg')), `${at} ${id}.evidence/plan.svg is missing: run node scripts/plan.mjs`);
  }
  // Every element says where it comes from: measured, documented or interpreted (shown in the evidence mode).
  for (const [i, element] of d.elements.entries()) {
    check(['measured', 'documented', 'interpreted'].includes(element.provenance), `${at} element ${i} (${element.type}) needs "provenance": "measured", "documented" or "interpreted"`);
    if (element.provenance === 'interpreted') check(typeof element.note === 'string' && element.note.length >= 20, `${at} element ${i} is interpreted: say how in its "note"`);
  }
  // Step 5: reference photos from several sides, and the features that make the building recognisable.
  const photos = Array.isArray(ev.references) ? ev.references : [];
  const photoMinimum = strict ? 4 : 3, sideMinimum = strict ? 3 : 2;
  check(photos.length >= photoMinimum, `${at} evidence.references needs at least ${photoMinimum} reference photos`);
  for (const [i, r] of photos.entries()) check(url(r?.url) && typeof r.view === 'string' && [r.azimuth, r.elevation, r.distance].every(Number.isFinite), `${at} reference ${i} needs "url", "view", "azimuth", "elevation" and "distance"`);
  for (const [i, r] of photos.entries()) check(r?.phase === undefined || d.phases.some(p => p.id === r.phase), `${at} reference ${i}: "phase" names unknown phase "${r?.phase}"`);
  const sides = new Set(photos.filter(r => Number.isFinite(r?.azimuth)).map(r => Math.floor((((r.azimuth % 360) + 360) % 360) / 90)));
  check(sides.size >= sideMinimum, `${at} the reference photos must be taken from at least ${sideMinimum} sides (azimuths in different quadrants)`);
  // Every reference photo exists, and its viewpoint is where Commons says it was taken.
  try {
    const title = r => { const m = /commons\.wikimedia\.org\/wiki\/(File:[^?#]+)/.exec(r?.url ?? ''); return m ? decodeURIComponent(m[1]).replaceAll('_', ' ') : null; };
    const pages = await commons(photos.map(title).filter(Boolean));
    const origin = await readFile(join(dir, ev.plan?.outline ?? ''), 'utf8').then(text => JSON.parse(text).origin, () => null);
    for (const [i, r] of photos.entries()) {
      const name = title(r);
      if (!name) { const state = await open(r.url); check(state === 'ok', `${at} reference ${i}: ${r.url} ${state}`); continue; }
      const page = pages.get(name);
      check(page && !('missing' in page) && !('invalid' in page), `${at} reference ${i}: ${name} does not exist on Wikimedia Commons`);
      const camera = page?.coordinates?.find(c => c.type === 'camera') ?? page?.coordinates?.[0];
      if (camera && origin?.length === 2 && Number.isFinite(r.azimuth)) {
        const x = (camera.lon - origin[1]) * 111320 * Math.cos(origin[0] * Math.PI / 180), z = -(camera.lat - origin[0]) * 110540;
        const azimuth = (Math.atan2(x, -z) * 180 / Math.PI + 360) % 360, off = Math.abs(((r.azimuth - azimuth) % 360 + 540) % 360 - 180), far = Math.hypot(x, z);
        check(off <= 30 || far < 20, `${at} reference ${i}: Commons records the camera at azimuth ${Math.round(azimuth)}°, ${Math.round(far)} m away; the reference says ${r.azimuth}°`);
        const ground = r.distance * Math.cos((r.elevation ?? 0) * Math.PI / 180);
        check(far < 20 || (ground > far / 2.5 && ground < far * 2.5), `${at} reference ${i}: Commons records the camera ${Math.round(far)} m away; the reference puts it ${Math.round(ground)} m away (put the camera where the photographer stood, and use fov for the lens)`);
      }
    }
  } catch (error) { check(false, `${at} cannot verify the reference photos on Wikimedia Commons: ${error.message}`); }
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
    // The last pass shows the current timeline: one capture per phase. Earlier passes keep the phases of their day.
    if (strict) check(Array.isArray(c.phases) && c.phases.length >= (c === passes.at(-1) ? d.phases.length : 1), `${at} pass ${c.pass}: publication needs one capture per phase (run compare.mjs without --quick)`);
  }
  for (const c of strict ? passes.slice(0, -1) : passes.slice(0, 1)) check(Array.isArray(c.fixed) && c.fixed.length > 0, `${at} pass ${c.pass}: write in "fixed" what was changed after it`);
  const last = passes.at(-1);
  if (last) check(Array.isArray(last.remaining), `${at} the last pass needs "remaining": the simplifications left, or []`);
  if (last?.remaining?.length) check((ev.uncertainties ?? []).length > 0, `${at} the remaining gaps must also be in evidence.uncertainties`);
  check(['day', 'golden'].includes(d.view?.light), `${at} view.light must be chosen, "day" or "golden" (references/fidelity.md)`);
  check(typeof d.modelNote === 'string' && d.modelNote.length > 20, `${at} modelNote must say what is measured and what is interpreted`);
}
