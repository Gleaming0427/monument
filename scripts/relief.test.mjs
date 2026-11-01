#!/usr/bin/env node
// Every photo relief, seen as a picture. A relief is a photograph rectified onto the model (scripts/relief.mjs prepares it);
// this holds what the viewer draws to what the photograph shows. Each relief, as laid (a `relief` element, or a photo a brick
// lays on each of its details, a dormer's front), is looked at head on along its own normal, the section view cutting away
// what stands more than SECTION metres in front of it (a porch, a colonnade, the far side of a nave: what may stand before a
// relief without hiding it), so that a relief buried in its own wall is still hidden by the stone. It is looked at twice: with
// the photo reliefs and without them. Then:
//   - the relief is seen: laying it changes the picture by more than CHANGE grey levels over MIN_SEEN of its panel at least
//     (over the 57 reliefs of the collection and the gallery: 44 to 98% for those that show, 0 to 8% for the six found buried
//     in stone or behind a member standing proud of the face, before they were brought out);
//   - what is seen is its photograph: the picture's luminance, read cell by cell over the panel, correlates with the photograph
//     rectified through the relief's corners and cut to its shape and outline (1 is the photo itself; 0.34 to 0.98 for those
//     that show, weathered low-contrast photos lowest; -0.16 to 0.30 for the buried ones);
//   - it lies on the building and faces out of it: on a band round the panel, the picture is the model, not the backdrop
//     (60 to 100% for those laid right; a relief turned to face into the building, on an outer wall, sees the void round it).
// A relief buried in its wall (stone in front of the photo), turned to face into the building, or whose image did not load,
// fails here. Whether its corners are the right ones on the photo is relief.mjs --check's question, not this test's.
// $RELIEF_DIR keeps the picture of every relief; $RELIEF_REPORT=1 prints every measure.
// Name monuments to hold only them: node scripts/relief.test.mjs chateau-de-chambord
import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {readdir, readFile, writeFile, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startViewer, openBrowser} from './lib/browser.mjs';
import {expand} from './lib/compact.mjs';
import {decodePng} from './lib/vision.mjs';

const root = fileURLToPath(new URL('..', import.meta.url)), only = process.argv.slice(2).filter(arg => !arg.startsWith('-'));
const FRAME = [512, 320], MIN_SEEN = .25, CHANGE = 8, MIN_LIKENESS = .25, MIN_ON = .5, SECTION = 1.2, FOV = 20, REPORT = process.env.RELIEF_REPORT === '1', DIR = process.env.RELIEF_DIR;
const sources = [
  ...(await readdir(join(root, 'examples'))).filter(name => name.endsWith('.json')).map(name => [name.slice(0, -5), join(root, 'examples'), `${name.slice(0, -5)}`]),
  ...(await readdir(join(root, 'community'), {withFileTypes: true})).filter(entry => entry.isDirectory()).map(entry => [entry.name, join(root, 'community', entry.name), 'monument']),
];
const monuments = [];
for (const [id, dir, stem] of sources) {
  const raw = JSON.parse(await readFile(join(dir, `${stem}.json`), 'utf8').catch(() => 'null') ?? 'null');
  if (!raw || (only.length && !only.includes(id))) continue;
  const d = expand(raw, id);
  if (d.elements.some(e => e.type === 'relief')) monuments.push({id, d});
}
// How many panels the bricks should lay for each relief without `at`: one a dormer that names it.
const expected = d => {
  const count = new Map();
  const walk = value => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    if (typeof value.relief === 'string') count.set(value.relief, (count.get(value.relief) ?? 0) + (value.at?.length ?? value.angles?.length ?? value.count ?? 1) * (value.rebuild ? 2 : 1));
    for (const [key, item] of Object.entries(value)) if (key !== 'relief') walk(item);
  };
  walk(d.elements.filter(e => e.type !== 'relief'));
  return count;
};

// In the page: the photograph of a relief sampled on a grid over its panel (u right, v up, both 0 to 1), smoothed to the size
// the panel takes on screen; for each sample inside the panel's shape and outline, the photo's luminance and the point of the
// panel in the scene, projected on the screen by the viewer itself.
const sampler = `async (r, grid, smooth) => {
  const image = new Image(); image.src = r.url;
  try { await Promise.race([image.decode(), new Promise((_, no) => setTimeout(() => no(new Error('no answer')), 20000))]); } catch { return null; }
  const canvas = document.createElement('canvas'), k = Math.min(1, smooth / Math.max(image.width, image.height));
  canvas.width = Math.max(1, Math.round(image.width * k)); canvas.height = Math.max(1, Math.round(image.height * k));
  const c = canvas.getContext('2d', {willReadFrequently: true}); c.imageSmoothingQuality = 'high'; c.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = c.getImageData(0, 0, canvas.width, canvas.height).data;
  // The unit square to the photo's quad (bottom left, bottom right, top right, top left), as the viewer maps it.
  const [tl, tr, br, bl] = r.corners, [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = [bl, br, tr, tl];
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3, dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, den = dx1 * dy2 - dx2 * dy1;
  const g = Math.abs(sx) + Math.abs(sy) < 1e-9 ? 0 : (sx * dy2 - dx2 * sy) / den, h = Math.abs(sx) + Math.abs(sy) < 1e-9 ? 0 : (dx1 * sy - sx * dy1) / den;
  const photo = (u, v) => { const z = g * u + h * v + 1; return [((x1 - x0 + g * x1) * u + (x3 - x0 + h * x3) * v + x0) / z, ((y1 - y0 + g * y1) * u + (y3 - y0 + h * y3) * v + y0) / z]; };
  const inPolygon = (pts, x, y) => { let c2 = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c2 = !c2; } return c2; };
  const [w, hh] = r.size, s = r.shape ?? {}, kind = s.kind ?? 'rect', spring = s.spring ?? 0;
  const inShape = (x, y) => {
    if (kind === 'circle') return (x / (w / 2)) ** 2 + ((y - hh / 2) / (hh / 2)) ** 2 <= 1;
    if (kind === 'rect' || y <= spring) return true;
    if (kind === 'round') return x * x + (y - spring) ** 2 <= w * w / 4;
    const a = s.rise || hh - spring, rr = (w * w / 4 + a * a) / w, d = Math.abs(x) + rr - w / 2; return d * d + (y - spring) ** 2 <= rr * rr;
  };
  const [nx, nz] = r.normal, n = Math.hypot(nx, nz), right = [nz / n, -nx / n], out = [];
  for (let j = 0; j < grid[1]; j++) for (let i = 0; i < grid[0]; i++) {
    const u = (i + .5) / grid[0], v = (j + .5) / grid[1], x = (u - .5) * w, y = v * hh;
    if (!inShape(x, y)) continue;
    const [px, py] = photo(u, v);
    if (px < 0 || py < 0 || px >= image.width || py >= image.height || (r.outline && !inPolygon(r.outline, px, py))) continue;
    const q = (Math.min(canvas.height - 1, Math.floor(py * k)) * canvas.width + Math.min(canvas.width - 1, Math.floor(px * k))) * 4;
    const X = r.middle[0] + right[0] * x, Z = r.middle[2] + right[1] * x, c3 = Math.cos(r.turn), s3 = Math.sin(r.turn);
    // monument.project takes a point of the monument's frame, before its \`rotate\`: the panel is in the scene's.
    const screen = monument.project([X * c3 - Z * s3, r.middle[1] - hh / 2 + y, X * s3 + Z * c3]);
    out.push([.299 * pixels[q] + .587 * pixels[q + 1] + .114 * pixels[q + 2], screen.x, screen.y, i, j]);
  }
  return out;
}`;

// The luminance of the picture round (x, y), over a box of `half` pixels each way.
const around = (img, x, y, half = 1) => {
  let sum = 0, n = 0;
  for (let j = Math.round(y) - half; j <= Math.round(y) + half; j++) for (let i = Math.round(x) - half; i <= Math.round(x) + half; i++) {
    if (i < 0 || j < 0 || i >= img.width || j >= img.height) continue;
    sum += img.lum[j * img.width + i]; n++;
  }
  return n ? sum / n : NaN;
};
// The photo and the picture are compared cell by cell, a cell being BLOCK × BLOCK samples of the grid: what is held is the
// carving's light and shade at the scale of its figures, not its grain, which the viewer's parallax and lighting move by a
// pixel or two.
const BLOCK = 3;
const cells = (samples, img) => {
  const by = new Map();
  for (const [lum, x, y, i, j] of samples) {
    const key = `${Math.floor(i / BLOCK)},${Math.floor(j / BLOCK)}`, cell = by.get(key) ?? [0, 0, 0];
    cell[0] += lum; cell[1] += around(img, x, y); cell[2]++; by.set(key, cell);
  }
  const kept = [...by.values()].filter(([, , n]) => n >= BLOCK * BLOCK / 2);
  return [kept.map(([a, , n]) => a / n), kept.map(([, b, n]) => b / n)];
};
const correlation = (a, b) => {
  const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < n; i++) { ab += (a[i] - ma) * (b[i] - mb); aa += (a[i] - ma) ** 2; bb += (b[i] - mb) ** 2; }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
};

const results = [], counts = [];
if (monuments.length) {
  const viewer = await startViewer(join(root, 'examples'), 4237), browser = await openBrowser({width: FRAME[0], height: FRAME[1]});
  after(async () => { await browser.close(); viewer.stop(); });
  for (const {id, d} of monuments) {
    await browser.open(`${viewer.base}?t=99&clean&section#${id}`);
    const laid = await browser.run('monument.reliefs'), duration = await browser.run('monument.duration');
    const want = expected(d);
    for (const [name, number] of want) counts.push({id, name, number, laid: laid.filter(r => d.elements[r.element]?.name === name).length});
    for (const [k, r] of laid.entries()) {
      const name = d.elements[r.element]?.name ?? `element ${r.element}`;
      // A relief whose photo did not load is not shown: there is nothing to look at.
      if (!r.shown) { results.push({id, k, element: r.element, name, shown: false, samples: 0, changed: 0, likeness: 0, grain: 0, on: 0}); continue; }
      // Seen when it stands: at the end, or half way through its life when it is taken down before the end.
      const t = r.death > duration ? duration : (r.birth + r.death) / 2, [nx, nz] = r.normal, n = Math.hypot(nx, nz), az = Math.atan2(nx, -nz) * 180 / Math.PI;
      const [w, h] = r.size, dist = Math.max(h / .6, w / (.6 * FRAME[0] / FRAME[1])) / (2 * Math.tan(FOV * Math.PI / 360));
      // The view's centre, which the section plane passes through, stands SECTION metres in front of the panel.
      const target = [r.middle[0] + nx / n * SECTION, r.middle[1], r.middle[2] + nz / n * SECTION];
      // One picture, on a black backdrop and without haze, so that the backdrop is known to the pixel.
      const picture = async reliefs => {
        await browser.run(`monument.photograph({t: ${t}, cam: [${az}, 0, ${dist}, ${target.join(', ')}], fov: ${FOV}, reliefs: ${reliefs}})`);
        await browser.settle(); await browser.sleep(150);
        return browser.shot('png');
      };
      const bare = decodePng(await picture(false)), shot = await picture(true), img = decodePng(shot);
      if (DIR) { await mkdir(DIR, {recursive: true}); await writeFile(join(DIR, `${id}-${k}.png`), shot); }
      const turn = (d.rotate ?? 0) * Math.PI / 180, toModel = ([X, y, Z]) => [X * Math.cos(turn) - Z * Math.sin(turn), y, X * Math.sin(turn) + Z * Math.cos(turn)];
      // About 2300 samples on a grid of square cells, whatever the panel's proportions: a long band is read as finely as a square.
      const grid = [Math.max(12, Math.round(Math.sqrt(2304 * w / h))), Math.max(12, Math.round(Math.sqrt(2304 * h / w)))];
      const samples = await browser.run(`(${sampler})(${JSON.stringify({...r, turn})}, ${JSON.stringify(grid)}, 160)`) ?? [];
      const seen = samples.filter(([, x, y]) => x >= 0 && y >= 0 && x < img.width && y < img.height);
      const likeness = correlation(...cells(seen, img)), grain = correlation(seen.map(s => s[0]), seen.map(([, x, y]) => around(img, x, y)));
      // Seen: the share of the panel where laying the relief changes the picture by more than CHANGE grey levels.
      const changed = seen.filter(([, x, y]) => Math.abs(around(img, x, y) - around(bare, x, y)) > CHANGE).length / Math.max(1, seen.length);
      if (process.env.RELIEF_DUMP && DIR) await writeFile(join(DIR, `${id}-${k}.json`), JSON.stringify(seen));
      // The ring runs round the panel's rectangle, a tenth of its smaller side out (20 cm at least); the backdrop is black.
      const right = [nz / n, -nx / n], m = Math.max(.2, .1 * Math.min(w, h)), W2 = w / 2 + m, top = h + m, length = 4 * W2 + 2 * (h + 2 * m);
      const points = Array.from({length: 96}, (_, i) => {
        let s = (i + .5) / 96 * length, x, y;
        if (s < 2 * W2) [x, y] = [-W2 + s, -m]; else if ((s -= 2 * W2) < h + 2 * m) [x, y] = [W2, -m + s]; else if ((s -= h + 2 * m) < 2 * W2) [x, y] = [W2 - s, top]; else [x, y] = [-W2, top - (s - 2 * W2)];
        return toModel([r.middle[0] + right[0] * x, r.middle[1] - h / 2 + y, r.middle[2] + right[1] * x]);
      });
      let on = 0, ring = 0;
      for (const p of await browser.run(`${JSON.stringify(points)}.map(p => monument.project(p))`)) {
        if (p.x < 0 || p.y < 0 || p.x >= img.width || p.y >= img.height) continue;
        ring++; if (around(img, p.x, p.y, 2) > 3) on++;
      }
      results.push({id, k, element: r.element, name, shown: samples.length > 0, samples: seen.length, changed, likeness, grain, on: ring ? on / ring : 0, px: Math.abs((samples.at(-1)?.[1] ?? 0) - (samples[0]?.[1] ?? 0))});
    }
  }
}
if (REPORT) for (const r of results) console.log(`${r.id} #${String(r.k).padStart(2)} ${r.name.padEnd(34)} ${r.shown ? 'shown' : 'NOT SHOWN'} seen over ${(r.changed * 100).toFixed(0).padStart(3)}% likeness ${r.likeness.toFixed(2)} (grain ${r.grain.toFixed(2)}) on the building ${(r.on * 100).toFixed(0)}% (${r.samples} samples)`);

for (const {id} of monuments) {
  const mine = results.filter(r => r.id === id);
  test(`${id}: every photo relief is seen, and shows its photograph, head on`, () => {
    assert.ok(mine.length > 0, `${id} has relief elements and the viewer laid none`);
    for (const r of mine) {
      assert.ok(r.shown, `${id}: relief "${r.name}" (#${r.k}) is not shown: its image did not load`);
      assert.ok(r.samples >= 50, `${id}: relief "${r.name}" (#${r.k}) is too small on screen to read (${r.samples} samples)`);
      assert.ok(r.changed >= MIN_SEEN, `${id}: relief "${r.name}" (#${r.k}) changes the picture over only ${Math.round(r.changed * 100)}% of its panel, under ${MIN_SEEN * 100}%: stone stands in front of it, or it lies behind its wall's face`);
      assert.ok(r.likeness >= MIN_LIKENESS, `${id}: relief "${r.name}" (#${r.k}) looks like its photograph at ${r.likeness.toFixed(2)}, under ${MIN_LIKENESS}: what is seen there is not its photo`);
    }
  });
  test(`${id}: every photo relief lies on the building and faces out of it`, () => {
    for (const r of mine.filter(r => r.shown)) assert.ok(r.on >= MIN_ON, `${id}: round relief "${r.name}" (#${r.k}) the picture is the model over ${Math.round(r.on * 100)}% of the ring, under ${MIN_ON * 100}%: it stands in the void, or faces into the building`);
  });
  test(`${id}: the bricks lay a photo on each detail that names one`, () => {
    for (const c of counts.filter(c => c.id === id)) assert.equal(c.laid, c.number, `${id}: "${c.name}" is named by ${c.number} details and laid ${c.laid} times`);
  });
}
test('the relief test looked at at least one monument', () => assert.ok(monuments.length > 0, 'no monument with photo reliefs was read'));
