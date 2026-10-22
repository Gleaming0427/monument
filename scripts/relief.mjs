#!/usr/bin/env node
// Photo reliefs: carved work too fine to build piece by piece (a tympanum, a gallery of statues, a frieze) is
// laid on the model as a photograph, rectified in the viewer. This script prepares and checks them.
//
//   node scripts/relief.mjs monuments/<id>.json --file "File:<name>.jpg" --name <slug> [--crop x0,y0,x1,y1] [--max 4096]
//     Reads the file's page on Wikimedia Commons, refuses it unless its licence is free (CC0, public domain,
//     CC BY, CC BY-SA, Licence Ouverte), downloads it, crops it (pixels of the original) and scales it down
//     to --max pixels, writes <id>.evidence/reliefs/<slug>.jpg and prints the `image` and `credit` to put in
//     the relief element. It also writes a working copy under a grid labelled in the image's own pixels, to
//     read the four corners of the carved panel from (its path is printed; it is not part of the monument).
//
//   node scripts/relief.mjs monuments/<id>.json --image <photo.jpg> --name <slug> --author "<who took it>" --license "<terms>" [--crop …] [--max …]
//     The same from a photo of your own (a survey, an orthophoto, a commissioned shot): fine for a model kept
//     by its owner; publishing it to the gallery still needs a free licence, which validate.mjs --strict checks.
//
//   node scripts/relief.mjs monuments/<id>.json --check <element index>
//     Rectifies the relief element's image through its four corners at the element's own proportions, draws
//     its outline (and its recess) in red, and writes the picture to a working folder: what the viewer will lay
//     on the model. Straight lines that should be straight (the panel's edges, the bands of a frieze) and the
//     carving sitting inside the red outline show whether the corners and the shape are right.
import {readFile, writeFile, mkdir, mkdtemp, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {dirname, join, resolve, basename} from 'node:path';
import {tmpdir} from 'node:os';
import {openBrowser} from './lib/browser.mjs';
import {expand} from './lib/compact.mjs';

const args = process.argv.slice(2), flag = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find(arg => arg.endsWith('.json'));
if (!file || !(flag('file') || flag('image') || flag('check'))) {
  console.error('Usage: node scripts/relief.mjs monuments/<id>.json --file "File:<name>.jpg" --name <slug> [--crop x0,y0,x1,y1] [--max 4096]\n       node scripts/relief.mjs monuments/<id>.json --image <photo.jpg> --name <slug> --author "<name>" --license "<terms>" [--crop …] [--max …]\n       node scripts/relief.mjs monuments/<id>.json --check <element index>');
  process.exit(1);
}
const path = resolve(file), id = basename(path, '.json'), folder = join(dirname(path), `${id}.evidence`, 'reliefs'), work = join(tmpdir(), 'monument-relief', id);
const UA = {'User-Agent': 'monument-skill/1.0 (https://github.com/Gleaming0427/monument)'};
// The panel's outline test, the same as the viewer's (kit/builder.js, insideOutline).
const insideSource = `(o, x, y) => {
  const {kind = 'rect', w, h, spring = 0, rise, cx = 0} = o; x -= cx;
  if (Math.abs(x) > w / 2 || y < 0 || y > h) return false;
  if (kind === 'circle') return (x / (w / 2)) ** 2 + ((y - h / 2) / (h / 2)) ** 2 <= 1;
  if (kind === 'rect' || y <= spring) return true;
  if (kind === 'round') return x * x + (y - spring) ** 2 <= w * w / 4;
  const a = rise || h - spring, r = (w * w / 4 + a * a) / w, d = Math.abs(x) + r - w / 2;
  return d * d + (y - spring) ** 2 <= r * r;
}`;
const FREE = /^(CC0|Public domain|PD|CC BY(-SA)? \d(\.\d)?( [A-Za-z-]+)?|CC-BY(-SA)?-\d(\.\d)?|Licence Ouverte|Etalab)/i;

// A page that draws images on a canvas in headless Chrome, served with the image from a temporary folder.
async function withCanvas(files, results, work) {
  const temp = await mkdtemp(join(tmpdir(), 'monument-relief-'));
  for (const [name, data] of Object.entries(files)) await writeFile(join(temp, name), data);
  // The page and the images share one origin, so the canvas can be read back.
  // The page posts its results back (large images do not fit in a DevTools reply).
  const server = createServer(async (req, res) => {
    const name = basename(decodeURIComponent(req.url.split('?')[0]));
    if (name === 'page') { res.setHeader('Content-Type', 'text/html'); return res.end('<!doctype html><title>relief</title>'); }
    if (req.method === 'POST') { const chunks = []; for await (const chunk of req) chunks.push(chunk); await writeFile(join(temp, `out-${name}`), Buffer.concat(chunks)); return res.end('ok'); }
    try { res.end(await readFile(join(temp, name))); } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const browser = await openBrowser({width: 800, height: 600});
  try {
    // Wait until the page has replaced about:blank, or the work would run in a context about to be destroyed.
    await browser.send('Page.navigate', {url: `http://127.0.0.1:${server.address().port}/page`});
    for (let i = 0; i < 100 && !(await browser.run(`location.pathname === '/page' && document.readyState === 'complete'`).catch(() => false)); i++) await browser.sleep(100);
    await work(browser, `http://127.0.0.1:${server.address().port}/`);
    const out = {};
    for (const name of Object.keys(results)) out[name] = await readFile(join(temp, `out-${name}`));
    return out;
  } finally { await browser.close(); server.close(); await rm(temp, {recursive: true, force: true}); }
}
// Runs page code; an exception in the page is raised here with its message.
const inPage = async (browser, code) => {
  const result = await browser.send('Runtime.evaluate', {expression: code, awaitPromise: true, returnByValue: true});
  if (result.exceptionDetails) throw new Error(`In the page: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
  return result.result.value;
};

// A photo from Commons (--file) or of one's own (--image): its pixels and its credit.
async function source() {
  if (flag('image')) {
    const author = flag('author'), licence = flag('license');
    if (!author || !licence) { console.error('--image needs --author (who took the photo) and --license (its terms, e.g. "CC BY 4.0" or "© Ville de …, all rights reserved").'); process.exit(1); }
    if (!FREE.test(licence)) console.warn(`Licence "${licence}" is not free: fine for a model its owner keeps, not for the public gallery.`);
    const original = await readFile(resolve(flag('image')));
    const size = await withCanvas({'original.jpg': original}, {size: 1}, async (browser, base) => inPage(browser, `(async () => { const image = new Image(); image.src = '${base}original.jpg'; await image.decode(); await fetch('${base}size', {method: 'POST', body: JSON.stringify([image.width, image.height])}); return true; })()`));
    const [width, height] = JSON.parse(size.size);
    return {original, width, height, credit: {file: flag('url') ?? basename(flag('image')), author, license: licence}};
  }
  const title = flag('file').startsWith('File:') ? flag('file') : `File:${flag('file')}`;
  const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url|size|extmetadata&iiextmetadatafilter=LicenseShortName|Artist|Credit|LicenseUrl`;
  const page = Object.values((await (await fetch(api, {headers: UA, signal: AbortSignal.timeout(30000)})).json()).query.pages)[0];
  if (!page?.imageinfo) { console.error(`Not on Commons: ${title}`); process.exit(1); }
  const info = page.imageinfo[0], meta = info.extmetadata ?? {}, licence = meta.LicenseShortName?.value ?? '', author = (meta.Artist?.value ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (!FREE.test(licence)) { console.error(`${title}: licence "${licence}" is not one a published model may reuse (CC0, public domain, CC BY, CC BY-SA, Licence Ouverte).`); process.exit(1); }
  console.log(`${title}: ${info.width}×${info.height}, ${licence}, ${author}`);
  const original = Buffer.from(await (await fetch(info.url, {headers: UA, signal: AbortSignal.timeout(300000)})).arrayBuffer());
  return {original, width: info.width, height: info.height, credit: {file: `https://commons.wikimedia.org/wiki/${title.replaceAll(' ', '_')}`, author, license: licence}};
}

if (flag('file') || flag('image')) {
  const slug = flag('name');
  if (!/^[a-z0-9-]+$/.test(slug ?? '')) { console.error('--name: a slug of lowercase letters, digits and hyphens.'); process.exit(1); }
  const {original, width, height, credit} = await source();
  const [x0, y0, x1, y1] = (flag('crop') ?? `0,0,${width},${height}`).split(',').map(Number), max = Number(flag('max') ?? 4096);
  const scale = Math.min(1, max / Math.max(x1 - x0, y1 - y0)), W = Math.round((x1 - x0) * scale), H = Math.round((y1 - y0) * scale);
  const {jpeg, grid} = await withCanvas({'original.jpg': original}, {jpeg: 1, grid: 1}, async (browser, base) => inPage(browser, `(async () => {
    const image = new Image(); image.src = '${base}original.jpg'; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = ${W}; canvas.height = ${H};
    const c = canvas.getContext('2d'); c.imageSmoothingQuality = 'high'; c.drawImage(image, ${x0}, ${y0}, ${x1 - x0}, ${y1 - y0}, 0, 0, ${W}, ${H});
    const blob = (canvas, type, quality) => new Promise(done => canvas.toBlob(done, type, quality));
    const save = async (name, data) => { const r = await fetch('${base}' + name, {method: 'POST', body: data}); if (!r.ok) throw new Error('could not save ' + name); };
    await save('jpeg', await blob(canvas, 'image/jpeg', .9));
    // The grid: a line every 100 pixels of the written image, labelled, over a copy at most 2000 pixels wide.
    const k = Math.min(1, 2000 / ${W}), g = document.createElement('canvas'); g.width = Math.round(${W} * k); g.height = Math.round(${H} * k);
    const d = g.getContext('2d'); d.drawImage(canvas, 0, 0, g.width, g.height); d.font = '12px sans-serif'; d.lineWidth = 1;
    const step = ${W} > 3000 ? 200 : 100;
    for (let x = 0; x < ${W}; x += step) { d.strokeStyle = x % (step * 5) ? 'rgba(255,40,40,.45)' : 'rgba(255,230,0,.9)'; d.beginPath(); d.moveTo(x * k + .5, 0); d.lineTo(x * k + .5, g.height); d.stroke(); d.fillStyle = '#ff0'; d.fillText(x, x * k + 2, 12); }
    for (let y = 0; y < ${H}; y += step) { d.strokeStyle = y % (step * 5) ? 'rgba(255,40,40,.45)' : 'rgba(255,230,0,.9)'; d.beginPath(); d.moveTo(0, y * k + .5); d.lineTo(g.width, y * k + .5); d.stroke(); d.fillStyle = '#ff0'; d.fillText(y, 2, y * k + 24); }
    await save('grid', await blob(g, 'image/png'));
    return true;
  })()`));
  await mkdir(folder, {recursive: true}); await mkdir(work, {recursive: true});
  await writeFile(join(folder, `${slug}.jpg`), jpeg);
  await writeFile(join(work, `${slug}.grid.png`), grid);
  console.log(`Wrote ${id}.evidence/reliefs/${slug}.jpg (${W}×${H}); the grid to read corners from: ${join(work, `${slug}.grid.png`)}`);
  console.log(JSON.stringify({image: `${id}.evidence/reliefs/${slug}.jpg`, credit: {...credit, ...(flag('crop') ? {crop: [x0, y0, x1, y1]} : {})}}, null, 1));
}

if (flag('check')) {
  const d = expand(JSON.parse(await readFile(path, 'utf8')), file), e = d.elements[Number(flag('check'))];
  if (e?.type !== 'relief') { console.error(`elements[${flag('check')}] is not a relief.`); process.exit(1); }
  const slug = `${basename(e.image).replace(/\.[a-z]+$/, '')}-${flag('check')}`, [w, h] = e.size, W = 1200, H = Math.round(W * h / w);
  const outline = {kind: 'rect', ...e.shape, w, h}, recess = e.recess ? {kind: outline.kind, w: e.recess.width, h, spring: e.recess.spring ?? outline.spring, rise: e.recess.rise, cx: e.recess.offset ?? 0} : null;
  const {png} = await withCanvas({'image.jpg': await readFile(join(dirname(path), e.image))}, {png: 1}, async (browser, base) => inPage(browser, `(async () => {
    const image = new Image(); image.src = '${base}image.jpg'; await image.decode();
    const src = document.createElement('canvas'); src.width = image.width; src.height = image.height; src.getContext('2d').drawImage(image, 0, 0);
    const from = src.getContext('2d').getImageData(0, 0, image.width, image.height).data;
    const out = document.createElement('canvas'); out.width = ${W}; out.height = ${H}; const c = out.getContext('2d'), pixels = c.createImageData(${W}, ${H});
    // Square to quad (top left, top right, bottom right, bottom left), as the viewer does it.
    const [[ax, ay], [bx, by], [cx, cy], [dx, dy]] = ${JSON.stringify(e.corners)};
    const sx = ax - bx + cx - dx, sy = ay - by + cy - dy, dx1 = bx - cx, dx2 = dx - cx, dy1 = by - cy, dy2 = dy - cy, den = dx1 * dy2 - dx2 * dy1;
    const g = (sx * dy2 - dx2 * sy) / den, hh = (dx1 * sy - sx * dy1) / den;
    const A = bx - ax + g * bx, B = dx - ax + hh * dx, D = by - ay + g * by, E = dy - ay + hh * dy;
    for (let j = 0; j < ${H}; j++) for (let i = 0; i < ${W}; i++) {
      const u = (i + .5) / ${W}, v = (j + .5) / ${H}, z = g * u + hh * v + 1, x = Math.floor((A * u + B * v + ax) / z), y = Math.floor((D * u + E * v + ay) / z), o = (j * ${W} + i) * 4;
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) { pixels.data[o + 3] = 255; continue; }
      const q = (y * image.width + x) * 4; pixels.data[o] = from[q]; pixels.data[o + 1] = from[q + 1]; pixels.data[o + 2] = from[q + 2]; pixels.data[o + 3] = 255;
    }
    // The outline (and the recess's inner outline) in red, as the viewer cuts and folds the panel.
    const inside = ${insideSource}, shapes = ${JSON.stringify([outline, recess].filter(Boolean))};
    for (const o of shapes) for (let j = 0; j < ${H}; j++) for (let i = 1; i < ${W}; i++) {
      const y = (1 - (j + .5) / ${H}) * ${h}, a = inside(o, (i - .5) / ${W} * ${w} - ${w} / 2, y), b = inside(o, (i + .5) / ${W} * ${w} - ${w} / 2, y), up = j > 0 && inside(o, (i + .5) / ${W} * ${w} - ${w} / 2, (1 - (j - .5) / ${H}) * ${h});
      if (a !== b || up !== b) for (const [di, dj] of [[0, 0], [1, 0], [0, 1]]) { const o2 = ((j + dj) * ${W} + i + di) * 4; if (o2 < pixels.data.length) { pixels.data[o2] = 255; pixels.data[o2 + 1] = 30; pixels.data[o2 + 2] = 30; } }
    }
    c.putImageData(pixels, 0, 0);
    const r = await fetch('${base}png', {method: 'POST', body: await new Promise(done => out.toBlob(done, 'image/png'))});
    return r.ok;
  })()`));
  await mkdir(work, {recursive: true}); await writeFile(join(work, `${slug}.check.png`), png);
  console.log(`The panel as the viewer lays it, ${w} × ${h} m: ${join(work, `${slug}.check.png`)}`);
}
