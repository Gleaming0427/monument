#!/usr/bin/env node
// Checks monument files: node scripts/validate.mjs [--standard|--strict] [file or folder ...]
// Without paths: the collection (examples/) and the community gallery (community/*/monument.json).
// Every phase and moment must cite a source, every element must use a known brick, and every brick of
// the kit must be documented in references/bricks.md, or the next monument will not find it.
// --standard checks the focused local workflow: measured outline, two sources, three reference views,
// recognisable close details, a photo-to-element detail ledger, sourced worksite scenes and one comparison
// pass. --strict adds the wider source/photo set, phase captures and a second comparison pass.
import {readFile, readdir, stat} from 'node:fs/promises';
import {join, resolve, dirname, basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {measurePlan} from './lib/plan.mjs';
import {expand} from './lib/compact.mjs';

const skill = fileURLToPath(new URL('..', import.meta.url));
// A brick is a generator `name(k, e, P)`: a method of `generators` in kit/builder.js, or a function of a kit module (kit/renaissance.js, kit/japanese.js).
const bricksOf = source => new Set([...source.matchAll(/^\s{2}(?:function\s+)?(\w+)\(k,\s*e,\s*P\)/gm)].map(m => m[1]));
const kit = new Set([...bricksOf(await readFile(join(skill, 'kit', 'builder.js'), 'utf8')), ...bricksOf(await readFile(join(skill, 'kit', 'renaissance.js'), 'utf8')), ...bricksOf(await readFile(join(skill, 'kit', 'japanese.js'), 'utf8'))]);
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
const MATERIAL_PRESETS = new Set(['gothic-limestone', 'roman-weathered', 'marble-italian', 'historic-masonry', 'industrial-iron', 'japanese-timber', 'vernacular-timber']);
const SURFACE_MATERIALS = new Set(['limestone-paris', 'limestone-weathered', 'marble-white', 'sandstone-warm', 'granite-grey', 'brick-roman', 'oak-aged', 'slate-aged', 'terracotta-aged',
  'hinoki', 'cedar', 'wood-weathered', 'wood-rough', 'wood-old',
  'plaster-white', 'plaster-rough', 'shingle-wood', 'shingle-mossy', 'thatch', 'tile-clay', 'stone-japanese', 'rock-mossy', 'bark-pine', 'bark-cedar', 'gold-leaf']);
// Links are opened, not trusted: a page cited must answer, a reference photo must exist on Wikimedia
// Commons and, when Commons records where it was taken, the declared viewpoint must match that place.
const UA = {'User-Agent': 'monument-skill/1.0 (+https://github.com/Gleaming0427/monument)'};
const opened = new Map();
const archived = async (link, reason) => {
  const copy = await fetch(`https://web.archive.org/web/2/${link}`, {method: 'HEAD', headers: UA, redirect: 'manual', signal: AbortSignal.timeout(20000)}).then(r => r.headers.get('location')).catch(() => null);
  if (/\/web\/\d{14}\//.test(copy ?? '')) { console.warn(`! ${link} ${reason}; the Internet Archive's copy is used: ${copy}`); return 'ok'; }
  return null;
};
const open = link => {
  if (!opened.has(link)) opened.set(link, (async () => {
    for (const method of ['HEAD', 'GET']) {
      try {
        const response = await fetch(link, {method, headers: UA, redirect: 'follow', signal: AbortSignal.timeout(20000)});
        response.body?.cancel();
        if (response.status < 400) return 'ok';
        if ([404, 410].includes(response.status)) return `answers ${response.status}`;
        if (method === 'GET') {
          if ([401, 403, 429].includes(response.status)) return 'ok';
          if (response.status >= 500) return await archived(link, `answers ${response.status}`) ?? `answers ${response.status} and has no archived copy`;
          return `answers ${response.status}`;
        }
      } catch (error) {
        if (method !== 'GET') continue;
        // A site that does not answer at all (an outage, a block) is not a page that is gone: the page counts
        // if the Internet Archive holds a copy of it, which is said; otherwise it cannot be verified.
        if (await archived(link, `does not answer (${error.cause?.code ?? error.name})`)) return 'ok';
        return `cannot be opened (${error.cause?.code ?? error.name}) and has no archived copy`;
      }
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
// Photo reliefs: the image's size in pixels, read from its header (JPEG or PNG).
async function imageSize(path) {
  const data = await readFile(path).catch(() => null);
  if (!data) return null;
  if (data.readUInt32BE(0) === 0x89504e47) return [data.readUInt32BE(16), data.readUInt32BE(20)];
  for (let i = 2; i < data.length - 9;) {
    if (data[i] !== 0xff) return null;
    const marker = data[i + 1], length = data.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [data.readUInt16BE(i + 7), data.readUInt16BE(i + 5)];
    i += 2 + length;
  }
  return null;
}
// Licences a published model may reuse a photo under (and must credit it): see scripts/relief.mjs.
const FREE = /^(CC0|Public domain|PD|CC BY(-SA)? \d(\.\d)?( [A-Za-z-]+)?|CC-BY(-SA)?-\d(\.\d)?|Licence Ouverte|Etalab)/i;
async function relief(e, i, file, id, at, strict) {
  const where = `${at} relief ${i}`;
  check(new RegExp(`^${id}\\.evidence/reliefs/[a-z0-9-]+\\.(jpg|jpeg|png)$`).test(e.image ?? ''), `${where}: "image" must be a file in ${id}.evidence/reliefs/ (scripts/relief.mjs puts it there)`);
  const size = typeof e.image === 'string' ? await imageSize(join(dirname(file), e.image)) : null;
  check(size, `${where}: image ${e.image} not found or not a JPEG/PNG`);
  check(Array.isArray(e.corners) && e.corners.length === 4 && e.corners.every(c => c?.length === 2 && c.every(Number.isFinite) && (!size || c[0] >= 0 && c[1] >= 0 && c[0] <= size[0] && c[1] <= size[1])), `${where}: "corners" needs four [x, y] points inside the image (top left, top right, bottom right, bottom left)`);
  check(e.size?.length === 2 && e.size.every(v => Number.isFinite(v) && v > 0), `${where}: "size" needs [width, height] in metres`);
  check(e.at?.length === 3 && e.at.every(Number.isFinite), `${where}: "at" needs [u, y, v], the panel's centre`);
  check(e.facing === undefined || e.facing?.length === 2 && e.facing.every(Number.isFinite) && Math.hypot(...e.facing) > 0, `${where}: "facing" must be an outward [u, v] direction`);
  check(e.shape === undefined || ['rect', 'round', 'pointed', 'circle'].includes(e.shape.kind) && (e.shape.spring === undefined || e.shape.spring >= 0 && e.shape.spring < e.size?.[1]) && (e.shape.rise === undefined || e.shape.rise > 0 && e.shape.rise <= e.size?.[1] - (e.shape.spring ?? 0) + .01), `${where}: "shape" must be {"kind": "rect" | "round" | "pointed" | "circle", "spring": metres above the foot, "rise": the arch's height above it}`);
  const recess = e.recess;
  check(recess === undefined || Number.isFinite(recess.depth) && recess.depth > 0 && Number.isFinite(recess.width) && recess.width > 0 && recess.width < e.size?.[0] && (recess.offset === undefined || Math.abs(recess.offset) + recess.width / 2 <= e.size?.[0] / 2), `${where}: "recess" needs a "depth" and an inner "width" that fits inside the panel (with its "offset")`);
  const credit = e.credit ?? {};
  // A photo of one's own may stand in a model its owner keeps; the public gallery needs a free licence.
  check(typeof credit.file === 'string' && credit.file && typeof credit.author === 'string' && credit.author.length > 1 && typeof credit.license === 'string' && credit.license, `${where}: "credit" needs the photo's "file" (its page, or its file name), its "author" and its "license"`);
  if (strict) check(url(credit.file) && FREE.test(credit.license ?? ''), `${where}: a published model needs a photo with a public page and a free licence (CC0, public domain, CC BY, CC BY-SA, Licence Ouverte); "${credit.license}" is not one`);
}
// A scan (the captured layer of the viewer, see references/capture.md): a file in the evidence folder of a size the web
// can carry, the 4 × 4 matrix that places it in the monument's frame, and, for the gallery, a credit and the fit that
// says how far the model stands from it.
const SCAN_FILE_LIMIT = 50e6;
async function scanLayer(d, file, id, at, strict) {
  const scan = d.scan, where = `${at} scan`;
  if (scan === undefined) return;
  const path = typeof scan.file === 'string' ? scan.file : '';
  check(new RegExp(`^${id}\\.evidence/scan/[A-Za-z0-9._-]+\\.(splat|ply|spz|ksplat|sog)$`).test(path), `${where}: "file" must be a .splat, .ply, .spz, .ksplat or .sog in ${id}.evidence/scan/`);
  const size = path ? await stat(join(dirname(file), path)).then(info => info.size, () => null) : null;
  check(size !== null, `${where}: ${path || 'file'} not found`);
  if (size !== null) check(size <= SCAN_FILE_LIMIT, `${where}: ${path} is ${(size / 1e6).toFixed(0)} MB; a monument's scan stays under ${SCAN_FILE_LIMIT / 1e6} MB (decimate it, or convert it to .spz)`);
  check(Array.isArray(scan.matrix) && scan.matrix.length === 16 && scan.matrix.every(Number.isFinite), `${where}: "matrix" needs 16 numbers (column-major 4 × 4: scripts/align-scan.mjs --write records it)`);
  if (Array.isArray(scan.matrix) && scan.matrix.length === 16) {
    const m = scan.matrix, det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
    check(Math.abs(det) > 1e-12, `${where}: "matrix" is singular`);
  }
  if (strict) {
    const credit = scan.credit ?? {};
    check(typeof credit.author === 'string' && credit.author.length > 1 && typeof credit.license === 'string' && FREE.test(credit.license) && url(credit.source ?? ''), `${where}: a published scan needs "credit" {author, license, source}: who captured it, under a free licence, with a public page`);
    check(Number.isFinite(scan.fit?.median) && Number.isFinite(scan.fit?.p90) && scan.fit?.covered > 0, `${where}: a published scan needs the "fit" scripts/align-scan.mjs records (median, p90 and covered): it is how far the model stands from the scan`);
  }
}

// The credit of every relief matches what Wikimedia Commons records for its file.
async function reliefCredits(d, at) {
  const list = d.elements.filter(e => e.type === 'relief' && /commons\.wikimedia\.org\/wiki\/File:/.test(e.credit?.file ?? ''));
  if (!list.length) return;
  const titles = list.map(e => decodeURIComponent(/wiki\/(File:[^?#]+)/.exec(e.credit.file)[1]).replaceAll('_', ' '));
  const query = new URLSearchParams({action: 'query', format: 'json', prop: 'imageinfo', iiprop: 'extmetadata', iiextmetadatafilter: 'LicenseShortName', titles: [...new Set(titles)].join('|')});
  try {
    const data = await (await fetch(`https://commons.wikimedia.org/w/api.php?${query}`, {headers: UA, signal: AbortSignal.timeout(30000)})).json(), names = new Map((data.query.normalized ?? []).map(n => [n.to, n.from]));
    const licences = new Map(Object.values(data.query.pages).map(page => [names.get(page.title) ?? page.title, 'missing' in page ? null : page.imageinfo?.[0]?.extmetadata?.LicenseShortName?.value]));
    list.forEach((e, i) => {
      const licence = licences.get(titles[i]);
      check(licence !== null && licence !== undefined, `${at} relief photo ${titles[i]} does not exist on Wikimedia Commons`);
      if (licence) check(licence === e.credit.license, `${at} relief photo ${titles[i]}: Commons gives its licence as "${licence}", the credit says "${e.credit.license}"`);
    });
  } catch (error) { check(false, `${at} cannot verify the relief photos on Wikimedia Commons: ${error.message}`); }
}
const seen = new Map();
for (const file of (await Promise.all(targets.map(files))).flat()) {
  let d, text, raw;
  const id = basename(file) === 'monument.json' ? basename(dirname(file)) : basename(file, '.json'), at = `${id}:`;
  try { text = await readFile(file, 'utf8'); raw = JSON.parse(text); d = expand(raw, at); } catch (error) {
    check(false, `${file}: not a valid monument (${error.message})`); continue;
  }
  // The catalogue is authored by hand, so it gets its own readable checks on top of the expansion above.
  const book = raw.catalogue ?? {};
  for (const [name, prototype] of Object.entries(book)) {
    check(prototype && typeof prototype === 'object' && !Array.isArray(prototype), `${at} catalogue "${name}" must be a JSON object`);
    if (!prototype || typeof prototype !== 'object') continue;
    check(prototype.use !== undefined || prototype.type, `${at} catalogue "${name}" needs a "type", or a "use" to inherit one from`);
    check(Object.keys(prototype).length > 1, `${at} catalogue "${name}" repeats nothing: write the values inline instead`);
  }
  const used = new Set();
  const walk = value => { if (typeof value?.use === 'string') used.add(value.use); };
  for (const prototype of Object.values(book)) walk(prototype);
  for (const element of raw.elements ?? []) walk(element);
  for (const name of Object.keys(book)) check(used.has(name), `${at} catalogue "${name}" is never used`);
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
  // The viewer shows the monument alone in the studio: its grounds, water and setting are not drawn.
  check(d.water === undefined, `${at} "water" was removed: the viewer shows the monument alone in the studio`);
  for (const key of ['light', 'water', 'dots']) check(d.view?.[key] === undefined, `${at} view.${key} was removed: the studio has one light and no ground`);
  check(phases.size === d.phases.length, `${at} duplicate phase id`);
  if (d.visualStyle) {
    const style = d.visualStyle;
    check(VISUAL_QUALITY.has(style.quality), `${at} visualStyle.quality must be "basic", "standard" or "cinematic"`);
    check(MATERIAL_PRESETS.has(style.materialPreset), `${at} visualStyle.materialPreset is not in the bundled material library`);
    for (const [surface, material] of Object.entries(style.surfaces ?? {})) check(SURFACE_MATERIALS.has(material), `${at} visualStyle.surfaces.${surface} uses unknown material "${material}"`);
    for (const key of ['environmentPreset', 'environment', 'vegetation', 'decor', 'props', 'presentation', 'diorama']) check(style[key] === undefined, `${at} visualStyle.${key} was removed: the viewer only shows the studio (references/visual-style.md)`);
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
      check(m.look === undefined || Array.isArray(m.look) && m.look.length >= 1 && m.look.length <= 2 && m.look.every(Number.isFinite), `${at} moment "${m.title}": look must be [azimuth, elevation] in degrees`);
      check(m.inside === undefined || typeof m.inside === 'boolean', `${at} moment "${m.title}": inside must be true or false`);
      check(url(m.source), `${at} moment "${m.title}" needs a source URL`);
    }
  }
  const refs = obj => { for (const [key, value] of Object.entries(obj)) {
    if (['phase', 'until', 'restore', 'rebuild'].includes(key) && typeof value === 'string') check(phases.has(value), `${at} unknown phase "${value}"`);
    if (key === 'phases' && value && typeof value === 'object') for (const phase of Object.values(value)) check(phases.has(phase), `${at} unknown phase "${phase}"`);
    if (value && typeof value === 'object') refs(value);
  } };
  for (const [elementIndex, e] of d.elements.entries()) {
    check(bricks.has(e.type), `${at} unknown brick "${e.type}"`); refs(e);
    if (e.type === 'profiledColumn') {
      const label = `${at} element ${elementIndex} profiledColumn`, profile = e.shaft?.profile ?? e.profile, flutes = e.shaft?.flutes ?? e.flutes ?? 0, tolerance = e.rendering?.maxChordErrorMm;
      check(Number.isFinite(e.height) && e.height > 0 && Number.isFinite(e.diameter) && e.diameter > 0, `${label} needs positive height and diameter`);
      check(Array.isArray(profile) && profile.length >= 2 && profile.every(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)), `${label} needs at least two finite [height fraction, diameter ratio] stations`);
      if (Array.isArray(profile) && profile.length >= 2) {
        check(profile[0][0] === 0 && profile.at(-1)[0] === 1, `${label} profile must start at 0 and end at 1`);
        check(profile.every((point, i) => point[1] > 0 && (!i || point[0] > profile[i - 1][0])), `${label} profile heights must increase and diameter ratios must be positive`);
      }
      check(Number.isInteger(flutes) && flutes >= 0 && flutes <= 64, `${label} flutes must be an integer from 0 to 64`);
      check(tolerance === undefined || Number.isFinite(tolerance) && tolerance >= .25 && tolerance <= 20, `${label} maxChordErrorMm must be between 0.25 and 20`);
      check(e.rendering?.lod === undefined || e.rendering.lod === 'adaptive', `${label} rendering.lod must be "adaptive"`);
    }
  }
  for (const [i, e] of d.elements.entries()) if (e.type === 'relief') await relief(e, i, file, id, at, strict);
  await scanLayer(d, file, id, at, strict);
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
  await reliefCredits(d, at);
  // Step 5: reference photos from several sides, and the features that make the building recognisable.
  const photos = Array.isArray(ev.references) ? ev.references : [];
  const photoMinimum = strict ? 4 : 3, sideMinimum = strict ? 3 : 2;
  check(photos.length >= photoMinimum, `${at} evidence.references needs at least ${photoMinimum} reference photos`);
  for (const [i, r] of photos.entries()) check(url(r?.url) && typeof r.view === 'string' && [r.azimuth, r.elevation, r.distance].every(Number.isFinite), `${at} reference ${i} needs "url", "view", "azimuth", "elevation" and "distance"`);
  for (const [i, r] of photos.entries()) check(r?.phase === undefined || d.phases.some(p => p.id === r.phase), `${at} reference ${i}: "phase" names unknown phase "${r?.phase}"`);
  // Publication: every viewpoint is fitted on the photo (calibrate.mjs), and a gap above 3% of the photo's
  // height is named in evidence.uncertainties.
  if (strict) for (const [i, r] of photos.entries()) {
    const fit = r?.calibration, side = String(r?.view ?? '').split(/[,(]/)[0].trim().toLowerCase();
    check(fit && fit.points >= 3 && Number.isFinite(fit.rms), `${at} reference ${i}: fit its viewpoint on the photo with scripts/calibrate.mjs --write (publication needs every reference fitted)`);
    if (fit?.rms > 5) check(false, `${at} reference ${i}: the model is ${fit.rms}% of the photo's height off once the viewpoint is fitted (5% at most): fix the model or the points`);
    else if (fit?.rms > 3) check((ev.uncertainties ?? []).some(u => side && u.toLowerCase().includes(side)), `${at} reference ${i}: ${fit.rms}% off once fitted; say in evidence.uncertainties what still differs seen from the ${side || 'photo'}`);
  }
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
        // Where the reference puts the camera (its target, then back along the view) against where Commons
        // records it: a phone's position is rough, so a quarter of the distance (25 m at least) is allowed;
        // beyond that, "positionReason" must say why the photo cannot have been taken there.
        const far = Math.hypot(x, z), target = r.target ?? d.view.target, az = r.azimuth * Math.PI / 180, el = (r.elevation ?? 0) * Math.PI / 180;
        const cx = target[0] + Math.sin(az) * Math.cos(el) * r.distance, cz = target[2] - Math.cos(az) * Math.cos(el) * r.distance, gap = Math.hypot(cx - x, cz - z), allowed = Math.max(25, far / 4);
        check(gap <= allowed || (typeof r.positionReason === 'string' && r.positionReason.length >= 40), `${at} reference ${i}: Commons records the camera at [${Math.round(x)}, ${Math.round(z)}], ${Math.round(far)} m from the centre; the reference puts it ${Math.round(gap)} m from there (${Math.round(allowed)} m allowed). Start from Commons' position and fit the view (calibrate.mjs --move), or say in "positionReason" why the photo cannot have been taken there`);
      }
    }
  } catch (error) { check(false, `${at} cannot verify the reference photos on Wikimedia Commons: ${error.message}`); }
  const features = Array.isArray(ev.features) ? ev.features : [];
  const passes = Array.isArray(ev.comparisons) ? ev.comparisons : [];
  check(features.length >= 8 && features.every(f => f && typeof f.text === 'string' && url(f.source)), `${at} evidence.features needs at least 8 recognisable features, including close details, each {"text", "source"}`);
  // New scaffolded builds carry a detail ledger. It makes every claimed feature traceable to both a
  // reference photograph and a specific model element, so a plausible generic facade cannot pass as detail.
  const review = ev.detailReview;
  if (review !== undefined) {
    check(review && review.version === 1, `${at} evidence.detailReview needs version 1`);
    check(review?.status === 'complete', `${at} evidence.detailReview is ${review?.status ?? 'missing'}: inspect the close details before validation`);
    const items = Array.isArray(review?.items) ? review.items : [];
    check(items.length >= features.length, `${at} evidence.detailReview needs one photo-to-element row for every evidence.features entry`);
    const mapped = new Set();
    for (const [i, item] of items.entries()) {
      const featureIndex = features.findIndex(feature => feature?.text === item?.feature && feature?.source === item?.source);
      check(featureIndex >= 0, `${at} detailReview item ${i}: feature and source must exactly match an evidence.features entry`);
      if (featureIndex >= 0) mapped.add(featureIndex);
      check(Number.isInteger(item?.reference) && item.reference >= 0 && item.reference < photos.length, `${at} detailReview item ${i}: reference must index a reference photo that shows the feature`);
      check(Number.isInteger(item?.element) && item.element >= 0 && item.element < d.elements.length, `${at} detailReview item ${i}: element must index the modelled feature`);
      check(['geometry', 'relief', 'material'].includes(item?.method), `${at} detailReview item ${i}: method must be geometry, relief, or material`);
      if (item?.method === 'relief' && Number.isInteger(item?.element)) check(d.elements[item.element]?.type === 'relief', `${at} detailReview item ${i}: a relief method must point to a relief element`);
      check(typeof item?.model === 'string' && item.model.length >= 18, `${at} detailReview item ${i}: describe the specific geometry, relief, or material modelled`);
      check(item?.checked === true, `${at} detailReview item ${i}: mark checked only after close-view comparison`);
      check(['matched', 'named simplification'].includes(item?.result), `${at} detailReview item ${i}: result must be matched or named simplification`);
      if (item?.result === 'named simplification') {
        const needle = String(item?.feature ?? '').toLowerCase();
        const named = [...ev.uncertainties ?? [], ...passes.flatMap(pass => pass.remaining ?? [])].some(value => String(value).toLowerCase().includes(needle));
        check(named, `${at} detailReview item ${i}: name its simplification in the final remaining gaps and evidence.uncertainties`);
      }
    }
    check(mapped.size >= features.length, `${at} evidence.detailReview must cover every evidence.features entry exactly enough to audit it`);
  }
  // Standard: one focused final-view pass. Publication: two passes and phase captures.
  const passMinimum = strict ? 2 : 1;
  check(passes.length >= passMinimum, `${at} evidence.comparisons needs at least ${passMinimum} pass${passMinimum > 1 ? 'es' : ''}`);
  for (const c of passes) {
    check(Array.isArray(c.captures) && c.captures.length >= photos.length, `${at} pass ${c.pass}: one capture per reference photo (run compare.mjs again)`);
    for (const capture of [...c.captures ?? [], ...c.overlays ?? []]) check(await exists(join(dir, capture)), `${at} pass ${c.pass}: capture ${capture} not found`);
    // An overlay is the capture with the photograph laid over it at half strength, so it carries the photograph's
    // detail: a real one is at least a tenth heavier than the bare capture (the lightest in the collection, 1.10).
    // One within 2 % of it is the capture alone, with the browser's broken-image icon where the photo was meant
    // to be: the photograph never loaded, and the file claims a check nobody made.
    for (const overlay of c.overlays ?? []) {
      const capture = (c.captures ?? []).find(name => basename(name).replace(/^ref-/, '') === basename(overlay).replace(/^overlay-/, ''));
      if (!capture || !(await exists(join(dir, overlay))) || !(await exists(join(dir, capture)))) continue;
      const [laid, bare] = [(await stat(join(dir, overlay))).size, (await stat(join(dir, capture))).size];
      check(laid > bare * 1.02, `${at} pass ${c.pass}: ${overlay} is the capture without a photograph (${laid} bytes against ${bare}): load the photo and run compare.mjs again, or take the overlay out of the pass`);
    }
    check(Array.isArray(c.gaps) && c.gaps.length > 0 && c.gaps.every(g => typeof g === 'string' && g.length > 10), `${at} pass ${c.pass}: write in "gaps" what differs between each photo and its capture`);
    // The last pass shows the current timeline: one capture per phase. Earlier passes keep the phases of their day.
    if (strict) check(Array.isArray(c.phases) && c.phases.length >= (c === passes.at(-1) ? d.phases.length : 1), `${at} pass ${c.pass}: publication needs one capture per phase (run compare.mjs without --quick)`);
  }
  for (const c of strict ? passes.slice(0, -1) : passes.slice(0, 1)) check(Array.isArray(c.fixed) && c.fixed.length > 0, `${at} pass ${c.pass}: write in "fixed" what was changed after it`);
  const last = passes.at(-1);
  if (last) check(Array.isArray(last.remaining), `${at} the last pass needs "remaining": the simplifications left, or []`);
  if (last?.remaining?.length) check((ev.uncertainties ?? []).length > 0, `${at} the remaining gaps must also be in evidence.uncertainties`);
  check(typeof d.modelNote === 'string' && d.modelNote.length > 20, `${at} modelNote must say what is measured and what is interpreted`);
}
