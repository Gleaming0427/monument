#!/usr/bin/env node
// Holds the model's outline against each reference photo: node scripts/silhouette.mjs monuments/<id>.json [--ref <n>] [--write]
// Each photo is cut into building, sky and what says nothing, as the reference asks:
//   "silhouette": {"ground": 520, "ignore": [[[x, y], …], …], "trees": true, "holes": true}
// in pixels of the 960 × 600 frame compare.mjs captures: the line below which the ground and the crowd say nothing,
// polygons over what stands in front (a tree, a lamp post, a scaffold the model does not have), green taken for trees,
// and sky seen through a lattice. The photo comes from Commons, framed as compare.mjs lays it; where Commons cannot be
// reached, from the latest comparison pass that laid it over its capture. For each photo it writes the cut,
// <id>.evidence/silhouette/ref-<n>.png, and review-<n>.jpg to look at: sky tinted blue, what says nothing greyed,
// the model's outline in red, the model standing in the sky in magenta, the building it misses in yellow. It prints
// the share of building the photo and the model have in common; --write records it as silhouette.iou for every
// reference that has a "silhouette" (`{}` when the photo needs nothing ignored), which scripts/silhouette.test.mjs
// holds the model to from then on.
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {basename, dirname, join, resolve} from 'node:path';
import {startViewer, openBrowser} from './lib/browser.mjs';
import {expand} from './lib/compact.mjs';
import {PAGE, commonsPhoto, laidPhoto, referenceView} from './lib/silhouette.mjs';

const args = process.argv.slice(2), flag = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find(arg => arg.endsWith('.json'));
if (!file) { console.error('Usage: node scripts/silhouette.mjs monuments/<id>.json [--ref <n>] [--write]'); process.exit(1); }
const path = resolve(file), dir = dirname(path), text = await readFile(path, 'utf8'), raw = JSON.parse(text);
const id = basename(path) === 'monument.json' ? basename(dir) : basename(path, '.json'), d = expand(structuredClone(raw), id);
const evidence = join(dir, `${id}.evidence`), out = join(evidence, 'silhouette');
const refs = d.evidence?.references ?? [], only = flag('ref') === undefined ? null : Number(flag('ref'));
if (!refs.length) { console.error('evidence.references is empty: find and calibrate the reference photos first.'); process.exit(1); }
await mkdir(out, {recursive: true});

const viewer = await startViewer(dir, Number(flag('port') ?? 4197)), browser = await openBrowser({width: 960, height: 600});
let written = 0;
try {
  await browser.open(`${viewer.base}?t=99&clean#${id}`);
  await browser.run(PAGE);
  for (const [i, r] of refs.entries()) {
    if (only !== null && i !== only) continue;
    const {iou: recorded, ...how} = r.silhouette ?? {}, view = referenceView(d, r);
    // Commons first; a sandbox that cannot reach it falls back on the photo laid over a capture.
    const commons = commonsPhoto(r.url);
    let source = commons && await browser.run(`silhouette.photo({url: ${JSON.stringify(commons)}}).then(() => true, () => false)`) ? {url: commons} : null;
    if (!source) {
      const laid = await laidPhoto(evidence, i, r.url);
      if (!laid) { console.log(`ref ${i} · ${r.view ?? ''}: the photo can be neither downloaded nor recovered from a comparison pass; run compare.mjs where Commons answers`); continue; }
      source = {overlay: `/monuments/${id}.evidence/${laid.overlay}`, capture: `/monuments/${id}.evidence/${laid.capture}`};
    }
    const result = await browser.run(`(async () => {
      const photo = await silhouette.photo(${JSON.stringify(source)}), labels = silhouette.cut(photo, ${JSON.stringify(how)}), model = silhouette.outline(${JSON.stringify(view)});
      return {...silhouette.compare(labels, model), band: photo.band, png: silhouette.png(labels), review: silhouette.review(photo, labels, model)};
    })()`);
    // The mask is kept for a photo whose cut has been looked at; the review is drawn for every photo.
    if (r.silhouette) await writeFile(join(out, `ref-${i}.png`), Buffer.from(result.png, 'base64'));
    await writeFile(join(out, `review-${i}.jpg`), Buffer.from(result.review, 'base64'));
    const iou = Math.round(result.iou * 1000) / 1000;
    console.log(`ref ${i} · ${r.view ?? ''}: ${Math.round(iou * 100)}% of the building in common${recorded === undefined ? '' : ` (recorded ${Math.round(recorded * 100)}%)`}; model in the sky ${result.overSky.toFixed(1)}‰ of the frame, building missed ${result.missed.toFixed(1)}‰; photo over columns ${result.band.join('–')}${source.url ? '' : ' (recovered from a comparison pass)'}`);
    // Only a photo whose cut has been looked at is recorded: one that cannot be cut (a sunset through leaves) has no
    // "silhouette" and stays out of the test.
    if (args.includes('--write') && r.silhouette) { raw.evidence.references[i].silhouette = {...how, iou}; written++; }
  }
} finally { await browser.close(); viewer.stop(); }
// Written back into the file as it stands, like plan.mjs: a compact monument keeps its catalogue.
if (written) {
  const indent = /^\{\n( +)/.exec(text)?.[1].length ?? 1;
  await writeFile(path, JSON.stringify(raw, null, indent) + (text.endsWith('\n') ? '\n' : ''));
  console.log(`${written} reference(s) recorded in ${file}`);
}
console.log(`Look at ${join(out, 'review-<n>.jpg')}: draw "ignore" polygons over what stands in front, set "ground" under the base, and rerun.`);
