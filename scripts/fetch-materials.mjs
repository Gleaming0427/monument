#!/usr/bin/env node
// Fetches the photo-scanned surfaces of the library from Poly Haven (CC0) and stores them, resized, in
// kit/assets/materials/<id>/: albedo and normal at 1024 px, roughness and ambient occlusion at 512 px, as
// JPEG. Their real size (Poly Haven's dimensions) sets the world scale, so that a plank or a pebble keeps its
// size on any monument. Run again to refresh; kit/assets/materials/sources.json records where each comes from.
//   node scripts/fetch-materials.mjs [id ...]
import {mkdir, mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'kit', 'assets', 'materials');
const UA = {'User-Agent': 'monument-skill/1.0 (+https://github.com/Gleaming0427/monument)'};
// Library id → Poly Haven asset, with the roughness and normal strength the engine starts from.
export const SURFACES = {
  'hinoki': {source: 'hinoki_planks', roughness: .78, normalScale: .55},
  'cedar': {source: 'japanese_cedar_planks', roughness: .8, normalScale: .6},
  'wood-weathered': {source: 'weathered_planks', roughness: .88, normalScale: .8},
  'wood-rough': {source: 'rough_wood', roughness: .9, normalScale: .9},
  'wood-old': {source: 'old_planks_02', roughness: .86, normalScale: .7},
  'plaster-white': {source: 'plastered_wall', roughness: .9, normalScale: .35},
  'plaster-rough': {source: 'white_rough_plaster', roughness: .92, normalScale: .6},
  'shingle-wood': {source: 'roof_slates_02', roughness: .86, normalScale: .9},
  'shingle-mossy': {source: 'roof_07', roughness: .9, normalScale: .9},
  'thatch': {source: 'thatch_roof_angled', roughness: .95, normalScale: 1},
  'tile-clay': {source: 'clay_roof_tiles', roughness: .8, normalScale: .9},
  'stone-japanese': {source: 'japanese_stone_wall', roughness: .88, normalScale: .9},
  'rock-mossy': {source: 'mossy_rock', roughness: .9, normalScale: .9},
  'bark-pine': {source: 'pine_bark', roughness: .95, normalScale: 1},
  'bark-cedar': {source: 'japanese_cedar_bark', roughness: .95, normalScale: 1},
};
const MAPS = [['albedo', 'Diffuse', 1024], ['normal', 'nor_gl', 1024], ['roughness', 'Rough', 512], ['ao', 'AO', 512]];

const json = async url => { const response = await fetch(url, {headers: UA, signal: AbortSignal.timeout(30000)}); if (!response.ok) throw new Error(`${url} answers ${response.status}`); return response.json(); };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const wanted = process.argv.slice(2), ids = wanted.length ? wanted : Object.keys(SURFACES);
  const sourcesFile = join(out, 'sources.json'), sources = JSON.parse(await readFile(sourcesFile, 'utf8').catch(() => '{}'));
  // Downloads land in a scratch folder of their own; only the resized maps are kept.
  const scratch = await mkdtemp(join(tmpdir(), 'monument-materials-'));
  try {
    for (const id of ids) {
      const spec = SURFACES[id];
      if (!spec) { console.error(`Unknown surface ${id}`); continue; }
      const [info, files] = await Promise.all([json(`https://api.polyhaven.com/info/${spec.source}`), json(`https://api.polyhaven.com/files/${spec.source}`)]);
      await mkdir(join(out, id), {recursive: true});
      const kept = [];
      for (const [name, key, size] of MAPS) {
        const file = files[key]?.['1k']?.jpg ?? files[key]?.['1k']?.png;
        if (!file) continue;
        const raw = join(scratch, `${id}-${name}${file.url.slice(file.url.lastIndexOf('.'))}`);
        const response = await fetch(file.url, {headers: UA, signal: AbortSignal.timeout(120000)});
        if (!response.ok) throw new Error(`${file.url} answers ${response.status}`);
        await writeFile(raw, Buffer.from(await response.arrayBuffer()));
        const grey = name === 'roughness' || name === 'ao';
        execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', raw, '-vf', `scale=${size}:${size}:flags=lanczos${grey ? ',format=gray' : ''}`, '-q:v', name === 'normal' ? '5' : '4', join(out, id, `${name}.jpg`)]);
        kept.push(name);
      }
      const [w, h] = info.dimensions ?? [2000, 2000];
      sources[id] = {source: `https://polyhaven.com/a/${spec.source}`, authors: Object.keys(info.authors ?? {}), license: 'CC0', tile: [+(w / 1000).toFixed(2), +(h / 1000).toFixed(2)], maps: kept, roughness: spec.roughness, normalScale: spec.normalScale};
      console.log(`${id} ← ${spec.source} (${sources[id].tile.join(' × ')} m, ${kept.join(', ')})`);
    }
  } finally { await rm(scratch, {recursive: true, force: true}); }
  await writeFile(sourcesFile, JSON.stringify(sources, null, 1) + '\n');
}
