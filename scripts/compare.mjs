#!/usr/bin/env node
// One pass of the photo comparison: node scripts/compare.mjs monuments/<id>.json --pass <n> [--quick] [--resume]
// For every reference photo in evidence.references (azimuth, elevation, distance, target), photographs the
// model from the same viewpoint, in the state the photo shows (its "phase", by default the last daylight
// one). Publication mode also captures every phase; --quick skips those.
// Each capture is also taken with the photo laid over it at half strength (overlay-<n>.jpg), when the photo
// can be loaded. The pass is recorded in evidence.comparisons with its captures; the gaps seen between each
// photo and its capture, and what was fixed, are then written there by whoever looks at them.
import {readFile, writeFile, mkdir, access} from 'node:fs/promises';
import {dirname, join, basename, resolve, relative} from 'node:path';
import {startViewer, openBrowser} from './lib/browser.mjs';
import {expand} from './lib/compact.mjs';

const args = process.argv.slice(2), flag = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find(arg => arg.endsWith('.json')), pass = Number(flag('pass'));
if (!file || !(pass >= 1)) { console.error('Usage: node scripts/compare.mjs monuments/<id>.json --pass <n> [--quick] [--resume]'); process.exit(1); }
const quick = args.includes('--quick');
const resume = args.includes('--resume');
const path = resolve(file), dir = dirname(path), id = basename(path, '.json'), text = await readFile(path, 'utf8'), d = expand(JSON.parse(text), file);
const refs = d.evidence?.references ?? [];
if (refs.length < 1) { console.error('evidence.references is empty: find the reference photos first (see references/fidelity.md).'); process.exit(1); }
for (const [i, r] of refs.entries()) if (![r.azimuth, r.elevation, r.distance].every(Number.isFinite)) { console.error(`Reference ${i} needs a numeric azimuth, elevation and distance (and optionally a target [x, y, z]).`); process.exit(1); }

const folder = join(dir, `${id}.evidence`, 'compare', `pass-${pass}`);
await mkdir(folder, {recursive: true});
const viewer = await startViewer(dir, Number(flag('port') ?? 4196)), browser = await openBrowser({width: 960, height: 600});
const cam = r => [r.azimuth, r.elevation, r.distance, ...(r.target ?? d.view.target)].join(',');
// A photo shows one state of the building: the end of its "phase", or by default the last daylight phase
// (a night-lighting finale is not what a daytime photo shows).
const daylight = d.phases.findLastIndex(p => p.mood !== 'night');
const state = r => { const i = r.phase ? d.phases.findIndex(p => p.id === r.phase) : daylight; return i < 0 ? 99 : i + .97; };
const captures = [], overlays = [], phases = [];
// A Commons photo at a given width (null for a photo hosted elsewhere).
const photo = (url, width = 900) => { const m = /commons\.wikimedia\.org\/wiki\/(File:.+)$/.exec(url); return m ? `https://commons.wikimedia.org/wiki/Special:FilePath/${m[1].slice(5)}?width=${width}` : null; };
try {
  for (const [i, r] of refs.entries()) {
    const out = join(folder, `ref-${i}.jpg`);
    const laid = join(folder, `overlay-${i}.jpg`);
    if (resume && await access(out).then(() => true, () => false)) {
      captures.push(relative(dir, out));
      if (await access(laid).then(() => true, () => false)) overlays.push(relative(dir, laid));
      console.log(`ref ${i} · reused ${out}`);
      continue;
    }
    await browser.open(`${viewer.base}?t=${state(r)}&cam=${cam(r)}${r.fov ? `&fov=${r.fov}` : ''}${r.shift ? `&shift=${r.shift}` : ''}&clean#${id}`);
    await writeFile(out, await browser.shot('jpeg'));
    captures.push(relative(dir, out));
    console.log(`ref ${i} · ${r.view ?? ''} ${r.azimuth}° · photo ${r.url}\n        model ${out}`);
    // The photo laid over the capture at half strength, framed as the evidence mode lays it (full height,
    // centred): a viewpoint, a lens or a proportion that is off shows as a double outline, which a side by
    // side view hides.
    const src = photo(r.url, 1200);
    if (src && await browser.run(`new Promise(done => {
      const img = Object.assign(new Image(), {id: 'compare-photo', onload: () => done(true), onerror: () => done(false)});
      img.style.cssText = 'position:fixed;top:0;left:50%;height:100%;transform:translateX(-50%);max-width:none;opacity:.5;z-index:99;pointer-events:none';
      img.src = ${JSON.stringify(src)}; document.body.append(img); setTimeout(() => done(false), 30000);
    })`)) {
      await browser.settle();
      await writeFile(laid, await browser.shot('jpeg'));
      overlays.push(relative(dir, laid));
    } else console.log('        (the photo could not be laid over the model)');
  }
  if (!quick) {
    // Publication mode also records the end of every phase from the overall view.
    const v = d.view, along = v.direction ?? [.55, .32, .78], len = Math.hypot(...along);
    const overall = [Math.atan2(along[0], -along[2]) * 180 / Math.PI, Math.asin(along[1] / len) * 180 / Math.PI, v.distance, ...v.target].map(n => +n.toFixed(2)).join(',');
    await browser.open(`${viewer.base}?t=0.001&cam=${overall}&clean&caption#${id}`);
    for (let i = 0; i < d.phases.length; i++) {
      const out = join(folder, `phase-${i}.jpg`);
      if (resume && await access(out).then(() => true, () => false)) {
        phases.push(relative(dir, out));
        continue;
      }
      await browser.run(`monument.seek(${i + .97})`);
      await browser.settle();
      await writeFile(out, await browser.shot('jpeg', 75));
      phases.push(relative(dir, out));
    }
    console.log(`phases ${folder}/phase-*.jpg`);
  }
} finally { await browser.close(); viewer.stop(); }

// A side-by-side sheet to look at: each reference photo next to the capture from its viewpoint, then the
// end of every phase. Served by serve.mjs under /monuments/<id>.evidence/compare/pass-<n>/.
const esc = text => String(text).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
const laid = i => overlays.includes(relative(dir, join(folder, `overlay-${i}.jpg`))) ? `<img src="overlay-${i}.jpg" alt="photo laid over the model">` : '<span></span>';
const rows = refs.map((r, i) => `<section><h2>ref ${i} · ${esc(r.view ?? '')} · ${r.azimuth}°, ${r.elevation}°</h2><div>${photo(r.url) ? `<img src="${esc(photo(r.url))}" alt="reference photo">` : `<a href="${esc(r.url)}">open the reference photo</a>`}<img src="ref-${i}.jpg" alt="model">${laid(i)}</div></section>`).join('');
const strip = quick ? '' : `<h2>The end of every phase</h2><div class="strip">${d.phases.map((p, i) => `<figure><img src="phase-${i}.jpg" alt=""><figcaption>${esc(p.when ?? p.from ?? '')} · ${esc(p.title)}</figcaption></figure>`).join('')}</div>`;
await writeFile(join(folder, 'index.html'), `<!doctype html><meta charset="utf-8"><title>${esc(d.name)} · pass ${pass}</title><style>body{margin:0;padding:16px;background:#111;color:#ddd;font:13px system-ui}section div{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}img{width:100%;height:46vh;object-fit:contain;background:#222}h2{font-size:14px;margin:18px 0 6px}.strip{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.strip img{height:auto}</style><h1>${esc(d.name)} · comparison pass ${pass}</h1><p>Left: the reference photo. Middle: the model from the same viewpoint. Right: the photo laid over the model at half strength. Write what differs in evidence.comparisons.</p>${rows}${strip}`);

// Record the pass; keep what was already written about it. The file is read again first: it may have been
// edited while the captures were being taken.
const now = await readFile(path, 'utf8'), current = JSON.parse(now);
const evidence = current.evidence ??= {}, list = evidence.comparisons ??= [], entry = list.find(c => c.pass === pass) ?? (list.push({pass}), list.at(-1));
Object.assign(entry, {captures, ...(overlays.length ? {overlays} : {}), phases, gaps: entry.gaps ?? [], fixed: entry.fixed ?? []});
list.sort((a, b) => a.pass - b.pass);
const indent = /^\{\n( +)/.exec(now)?.[1].length ?? 1;
await writeFile(path, JSON.stringify(current, null, indent) + (now.endsWith('\n') ? '\n' : ''));
console.log(`\nSide by side: http://127.0.0.1:4173/monuments/${id}.evidence/compare/pass-${pass}/index.html (with serve.mjs on ${relative(process.cwd(), dir) || '.'})`);
console.log(`\nPass ${pass} recorded in evidence.comparisons. Now look at each photo, its capture and the photo laid over it, and write in that entry:\n  "gaps": what differs (silhouette, proportions, counts, roofs, openings, colours, ornaments)\n  "fixed": what you changed after looking${pass === 1 ? '' : '\n  "remaining": deliberate simplifications left (also in evidence.uncertainties)'}`);
