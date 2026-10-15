#!/usr/bin/env node
// Creates a measured, immediately viewable starting monument from an OpenStreetMap footprint.
// It deliberately writes one present-day survey phase: research adds the real chronology afterwards.
import {access, mkdir, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  FAMILIES, createDraft, extractRing, parseOsmWays, resultFromWay, selectOsmWay, selectResult,
} from './lib/scaffold.mjs';
import {measurePlan} from './lib/plan.mjs';

const help = `Usage:
  node scripts/scaffold.mjs "Building, city, country" [options]

Options:
  --out <folder>       Output folder (default: monuments)
  --id <slug>          Override the generated id
  --family <name>      auto, ${FAMILIES.join(', ')}
  --height <metres>    Use a known height instead of map tags or a family estimate
  --floors <count>     Use a known storey count
  --input <json>       Read a saved Nominatim response instead of downloading it
  --force              Replace an existing generated JSON and evidence folder files
  --help               Show this help

The command stores the raw map response, a local-metre outline, the monument JSON and plan.svg.
It never invents a historical timeline: the result is a present-day geometry draft to research and refine.`;

function parseArgs(argv) {
  const options = {out: 'monuments', family: 'auto', force: false};
  const query = [];
  const takesValue = new Set(['--out', '--id', '--family', '--height', '--floors', '--input']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--force') options.force = true;
    else if (takesValue.has(arg)) {
      if (argv[i + 1] == null) throw new Error(`${arg} needs a value.`);
      options[arg.slice(2)] = argv[++i];
    } else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}.`);
    else query.push(arg);
  }
  options.query = query.join(' ').trim();
  if (options.height != null) options.height = positiveNumber(options.height, '--height');
  if (options.floors != null) options.floors = Math.round(positiveNumber(options.floors, '--floors'));
  return options;
}

function positiveNumber(value, option) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${option} must be a positive number.`);
  return parsed;
}

async function exists(path) {
  return access(path).then(() => true, () => false);
}

async function fetchText(url, label) {
  const response = await fetch(url, {
    headers: {'User-Agent': 'monument-skill/1.0 (+https://github.com/Gleaming0427/monument)', Accept: label === 'OpenStreetMap map data' ? 'application/xml' : 'application/json'},
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}.`);
  return response.text();
}

async function nominatim(query) {
  const params = new URLSearchParams({q: query, format: 'jsonv2', limit: '5', polygon_geojson: '1', addressdetails: '1', extratags: '1', namedetails: '1'});
  return JSON.parse(await fetchText(`https://nominatim.openstreetmap.org/search?${params}`, 'Nominatim'));
}

async function wikipediaMatch(query) {
  const genericPlaces = new Set(query.split(',').slice(1).map(part => part.trim().toLocaleLowerCase()).filter(Boolean));
  const distinctive = query.split(',')[0].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 3 && !genericPlaces.has(word));
  for (const language of ['fr', 'en']) {
    const searchParams = new URLSearchParams({action: 'query', list: 'search', srsearch: query, srlimit: '8', srprop: 'snippet', format: 'json', origin: '*'});
    const search = JSON.parse(await fetchText(`https://${language}.wikipedia.org/w/api.php?${searchParams}`, `${language}.wikipedia.org`)).query?.search ?? [];
    const ranked = search.map((candidate, index) => {
      const text = `${candidate.title} ${candidate.snippet ?? ''}`.replace(/<[^>]+>/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const score = distinctive.reduce((total, token) => total + (text.includes(token) ? 5 : 0), 0) - index * .1;
      return {...candidate, score};
    }).sort((a, b) => b.score - a.score);
    if (!ranked.length || ranked[0].score <= 0) continue;
    const pageParams = new URLSearchParams({action: 'query', pageids: ranked.map(candidate => candidate.pageid).join('|'), prop: 'coordinates|pageprops', format: 'json', origin: '*'});
    const pageData = JSON.parse(await fetchText(`https://${language}.wikipedia.org/w/api.php?${pageParams}`, `${language}.wikipedia.org`));
    const pages = new Map(Object.values(pageData.query?.pages ?? {}).map(page => [page.pageid, page]));
    const page = ranked.map(candidate => pages.get(candidate.pageid)).find(candidate => candidate?.coordinates?.[0] && !genericPlaces.has(candidate.title.toLocaleLowerCase()));
    if (!page) continue;
    const coordinate = page.coordinates[0];
    const parts = query.split(',').map(part => part.trim()).filter(Boolean);
    return {
      name: page.title, display_name: `${page.title} (${language}.wikipedia.org)`,
      lon: coordinate.lon, lat: coordinate.lat, category: 'historic', type: 'building',
      address: {city: parts[1], country: parts.at(-1)},
      extratags: {wikidata: page.pageprops?.wikibase_item, wikipedia: `${language}:${page.title}`},
      _resolvedBy: `${language}.wikipedia.org`, _requestedName: query,
    };
  }
  return null;
}

async function geocode(query) {
  const direct = await nominatim(query);
  if (direct.length) return {results: direct};
  const article = await wikipediaMatch(query);
  if (!article) return {results: []};
  const place = query.split(',').slice(1).join(',').trim();
  const alias = await nominatim([article.name, place].filter(Boolean).join(', '));
  const taggedAlias = alias.map(result => ({...result, _resolvedBy: article._resolvedBy, _requestedName: query}));
  return {results: [...taggedAlias, article]};
}

async function footprintFor(result, query) {
  const direct = extractRing(result.geojson);
  if (direct) return {result, ring: direct, rawType: 'json', raw: JSON.stringify(result, null, 2) + '\n'};
  const lon = Number(result.lon), lat = Number(result.lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) throw new Error('The selected map result has neither a polygon nor usable coordinates.');
  const radius = 160, dy = radius / 110540, dx = radius / (111320 * Math.cos(lat * Math.PI / 180));
  const bbox = [lon - dx, lat - dy, lon + dx, lat + dy].map(value => value.toFixed(7)).join(',');
  const raw = await fetchText(`https://api.openstreetmap.org/api/0.6/map?bbox=${bbox}`, 'OpenStreetMap map data');
  const way = selectOsmWay(parseOsmWays(raw), query, [lon, lat]);
  if (!way) throw new Error('OpenStreetMap returned a point, but no closed building outline was found within 160 m. Add a precise plan before modelling.');
  const resolved = resultFromWay(result, way), ring = extractRing(resolved.geojson);
  return {result: resolved, ring, rawType: 'xml', raw};
}

async function readInput(path, query) {
  const raw = await readFile(resolve(path), 'utf8');
  const parsed = JSON.parse(raw), results = Array.isArray(parsed) ? parsed : parsed.results ?? [parsed];
  return {result: selectResult(results, query), raw};
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return console.log(help);
  if (!options.query) throw new Error(`Give a building, city and country.\n\n${help}`);
  if (options.family !== 'auto' && !FAMILIES.includes(options.family)) throw new Error(`Unknown family "${options.family}". Choose ${FAMILIES.join(', ')} or auto.`);

  process.stdout.write(`Finding "${options.query}"…\n`);
  const located = options.input ? await readInput(options.input, options.query) : await geocode(options.query);
  const selected = options.input ? located.result : selectResult(located.results, options.query);
  const resolutionQuery = [options.query, selected.name].filter(Boolean).join(' ');
  const footprint = await footprintFor(selected, resolutionQuery);
  const draft = createDraft({query: options.query, result: footprint.result, ring: footprint.ring, requestedFamily: options.family, id: options.id, height: options.height, floors: options.floors});
  const out = resolve(options.out), jsonPath = join(out, `${draft.id}.json`), evidenceDir = join(out, `${draft.id}.evidence`);
  if (!options.force && await exists(jsonPath)) throw new Error(`${jsonPath} already exists. Use --force only if you want to replace the generated draft.`);

  await mkdir(evidenceDir, {recursive: true});
  const sourceName = `outline-source.${footprint.rawType}`;
  const outline = {
    source: `OpenStreetMap ${footprint.result.osm_type ?? 'feature'} ${footprint.result.osm_id ?? ''}`.trim(),
    url: draft.evidence.plan.url,
    attribution: '© OpenStreetMap contributors, ODbL',
    query: options.query,
    origin: draft._scaffold.origin,
    polygons: [draft.elements.find(element => Array.isArray(element.points))?.points ?? []],
  };
  delete draft._scaffold;
  await Promise.all([
    writeFile(jsonPath, JSON.stringify(draft, null, 2) + '\n'),
    writeFile(join(evidenceDir, sourceName), footprint.raw),
    writeFile(join(evidenceDir, 'outline.json'), JSON.stringify(outline, null, 2) + '\n'),
  ]);
  const {result, svg} = await measurePlan(jsonPath);
  await writeFile(join(evidenceDir, 'plan.svg'), svg);

  console.log(`${draft.name} → ${jsonPath}`);
  if (selected._resolvedBy) console.log(`Name resolved through ${selected._resolvedBy}${selected.name ? ` as "${selected.name}"` : ''}.`);
  console.log(`Family: ${draft.evidence.generated.family} (${draft.evidence.generated.familyReason})`);
  console.log(`Footprint: ${draft.facts[0].value}; height: ${draft.view.height} m; plan gap p90: ${result.p90} m`);
  const skill = fileURLToPath(new URL('..', import.meta.url));
  console.log(`Open it: node ${join(skill, 'scripts', 'serve.mjs')} ${out}`);
  console.log('Next: replace the generated estimates with sourced dimensions, phases, photos and distinctive details.');
}

main().catch(error => {
  console.error(`scaffold: ${error.message}`);
  process.exitCode = 1;
});
