#!/usr/bin/env node
// One pass of the photo comparison: node scripts/compare.mjs monuments/<id>.json --pass <n> [--quick]
// For every reference photo in evidence.references (azimuth, elevation, distance, target), photographs the
// finished model from the same viewpoint. Publication mode also captures every phase; --quick skips those.
// The pass is recorded in evidence.comparisons with its captures; the gaps seen between each photo and its
// capture, and what was fixed, are then written there by whoever looks at them.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname, join, basename, resolve, relative} from 'node:path';
import {startViewer, openBrowser} from './lib/browser.mjs';

const args = process.argv.slice(2), flag = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find(arg => arg.endsWith('.json')), pass = Number(flag('pass'));
if (!file || !(pass >= 1)) { console.error('Usage: node scripts/compare.mjs monuments/<id>.json --pass <n> [--quick]'); process.exit(1); }
const quick = args.includes('--quick');
const path = resolve(file), dir = dirname(path), id = basename(path, '.json'), text = await readFile(path, 'utf8'), d = JSON.parse(text);
const refs = d.evidence?.references ?? [];
if (refs.length < 1) { console.error('evidence.references is empty: find the reference photos first (see references/fidelity.md).'); process.exit(1); }
for (const [i, r] of refs.entries()) if (![r.azimuth, r.elevation, r.distance].every(Number.isFinite)) { console.error(`Reference ${i} needs a numeric azimuth, elevation and distance (and optionally a target [x, y, z]).`); process.exit(1); }

const folder = join(dir, `${id}.evidence`, 'compare', `pass-${pass}`);
await mkdir(folder, {recursive: true});
const viewer = await startViewer(dir, Number(flag('port') ?? 4196)), browser = await openBrowser({width: 960, height: 600});
const cam = r => [r.azimuth, r.elevation, r.distance, ...(r.target ?? d.view.target)].join(',');
const captures = [], phases = [];
try {
  for (const [i, r] of refs.entries()) {
    await browser.open(`${viewer.base}?t=99&cam=${cam(r)}${r.fov ? `&fov=${r.fov}` : ''}&clean#${id}`);
    const out = join(folder, `ref-${i}.jpg`);
    await writeFile(out, await browser.shot('jpeg'));
    captures.push(relative(dir, out));
    console.log(`ref ${i} · ${r.view ?? ''} ${r.azimuth}° · photo ${r.url}\n        model ${out}`);
  }
  if (!quick) {
    // Publication mode also records the end of every phase from the overall view.
    const v = d.view, along = v.direction ?? [.55, .32, .78], len = Math.hypot(...along);
    const overall = [Math.atan2(along[0], -along[2]) * 180 / Math.PI, Math.asin(along[1] / len) * 180 / Math.PI, v.distance, ...v.target].map(n => +n.toFixed(2)).join(',');
    await browser.open(`${viewer.base}?t=0.001&cam=${overall}&clean&caption#${id}`);
    for (let i = 0; i < d.phases.length; i++) {
      await browser.run(`monument.seek(${i + .97})`);
      await browser.settle();
      const out = join(folder, `phase-${i}.jpg`);
      await writeFile(out, await browser.shot('jpeg', 75));
      phases.push(relative(dir, out));
    }
    console.log(`phases ${folder}/phase-*.jpg`);
  }
} finally { await browser.close(); viewer.stop(); }

// A side-by-side sheet to look at: each reference photo next to the capture from its viewpoint, then the
// end of every phase. Served by serve.mjs under /monuments/<id>.evidence/compare/pass-<n>/.
const photo = url => { const m = /commons\.wikimedia\.org\/wiki\/(File:.+)$/.exec(url); return m ? `https://commons.wikimedia.org/wiki/Special:FilePath/${m[1].slice(5)}?width=900` : null; };
const esc = text => String(text).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
const rows = refs.map((r, i) => `<section><h2>ref ${i} · ${esc(r.view ?? '')} · ${r.azimuth}°, ${r.elevation}°</h2><div>${photo(r.url) ? `<img src="${esc(photo(r.url))}" alt="reference photo">` : `<a href="${esc(r.url)}">open the reference photo</a>`}<img src="ref-${i}.jpg" alt="model"></div></section>`).join('');
const strip = quick ? '' : `<h2>The end of every phase</h2><div class="strip">${d.phases.map((p, i) => `<figure><img src="phase-${i}.jpg" alt=""><figcaption>${esc(p.when ?? p.from ?? '')} · ${esc(p.title)}</figcaption></figure>`).join('')}</div>`;
await writeFile(join(folder, 'index.html'), `<!doctype html><meta charset="utf-8"><title>${esc(d.name)} · pass ${pass}</title><style>body{margin:0;padding:16px;background:#111;color:#ddd;font:13px system-ui}section div{display:grid;grid-template-columns:1fr 1fr;gap:8px}img{width:100%;height:46vh;object-fit:contain;background:#222}h2{font-size:14px;margin:18px 0 6px}.strip{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.strip img{height:auto}</style><h1>${esc(d.name)} · comparison pass ${pass}</h1><p>Left: the reference photo. Right: the model from the same viewpoint. Write what differs in evidence.comparisons.</p>${rows}${strip}`);

// Record the pass; keep what was already written about it.
const evidence = d.evidence, list = evidence.comparisons ??= [], entry = list.find(c => c.pass === pass) ?? (list.push({pass}), list.at(-1));
Object.assign(entry, {captures, phases, gaps: entry.gaps ?? [], fixed: entry.fixed ?? []});
list.sort((a, b) => a.pass - b.pass);
const indent = /^\{\n( +)/.exec(text)?.[1].length ?? 1;
await writeFile(path, JSON.stringify(d, null, indent) + (text.endsWith('\n') ? '\n' : ''));
console.log(`\nSide by side: http://127.0.0.1:4173/monuments/${id}.evidence/compare/pass-${pass}/index.html (with serve.mjs on ${relative(process.cwd(), dir) || '.'})`);
console.log(`\nPass ${pass} recorded in evidence.comparisons. Now open each photo next to its capture and write in that entry:\n  "gaps": what differs (silhouette, proportions, counts, roofs, openings, colours, ornaments)\n  "fixed": what you changed after looking${pass === 1 ? '' : '\n  "remaining": deliberate simplifications left (also in evidence.uncertainties)'}`);
