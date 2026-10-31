// Holding the model against its reference photos by outline. A photo is cut once into what is building, what is
// sky and what says nothing either way (trees in front, the ground, people, the bands beside a narrow photo), and
// that cut is kept as a small PNG in <id>.evidence/silhouette/. The model's outline is then drawn from the photo's
// calibrated viewpoint and the two are measured against each other: the share of building they have in common.
//
// Everything that touches pixels runs in the browser the scripts already drive, which decodes and encodes images
// without a dependency: `PAGE` is evaluated in the viewer page once, and defines window.silhouette.
import {access, readFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';

// The frame of every comparison: the size compare.mjs captures at, the photo laid full height and centred.
export const FRAME = [960, 600];

// Where and when a reference photo was taken, as compare.mjs films it: the end of the photo's phase (by default the
// last daylight one, since a night finale is not what a daytime photo shows), its viewpoint, lens and lens shift.
export function referenceView(d, r) {
  const daylight = d.phases.findLastIndex(p => p.mood !== 'night'), i = r.phase ? d.phases.findIndex(p => p.id === r.phase) : daylight;
  return {t: i < 0 ? 99 : i + .97, cam: [r.azimuth, r.elevation, r.distance, ...(r.target ?? d.view.target)], fov: r.fov ?? 38, shift: r.shift ?? 0};
}

// A Commons photo at a given width (null for a photo hosted elsewhere).
export const commonsPhoto = (url, width = 1200) => { const m = /commons\.wikimedia\.org\/wiki\/(File:.+)$/.exec(url ?? ''); return m ? `https://commons.wikimedia.org/wiki/Special:FilePath/${m[1].slice(5)}?width=${width}` : null; };

// The latest comparison pass that laid this very photo over its capture: from the two, the photo can be recovered
// where Commons cannot be reached (the overlay is the photo at half strength over the capture).
export async function laidPhoto(evidence, i, url) {
  const name = decodeURIComponent(/File:(.+)$/.exec(url ?? '')?.[1] ?? '').replace(/ /g, '_');
  const passes = await readdir(join(evidence, 'compare')).catch(() => []);
  for (const pass of passes.filter(p => /^pass-\d+$/.test(p)).sort((a, b) => b.slice(5) - a.slice(5))) {
    const folder = join(evidence, 'compare', pass), sheet = await readFile(join(folder, 'index.html'), 'utf8').catch(() => '');
    const row = new RegExp(`<h2>ref ${i} · [\\s\\S]*?</section>`).exec(sheet)?.[0] ?? '';
    const shown = decodeURIComponent(row.replace(/&amp;/g, '&')).replace(/ /g, '_');
    const there = async file => access(join(folder, file)).then(() => true, () => false);
    if (name && shown.includes(name) && await there(`overlay-${i}.jpg`) && await there(`ref-${i}.jpg`)) return {pass, overlay: `compare/${pass}/overlay-${i}.jpg`, capture: `compare/${pass}/ref-${i}.jpg`};
  }
  return null;
}

export const PAGE = String.raw`window.silhouette = (() => {
  const [W, H] = ${JSON.stringify(FRAME)}, N = W * H;
  const load = src => new Promise((done, fail) => { const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => done(img); img.onerror = () => fail(new Error('cannot load ' + src)); img.src = src; });
  const canvas = () => { const c = Object.assign(document.createElement('canvas'), {width: W, height: H}); return [c, c.getContext('2d', {willReadFrequently: true})]; };
  const read = (img, x = 0, w = W) => { const [, g] = canvas(); g.drawImage(img, x, 0, w, H); return g.getImageData(0, 0, W, H).data; };

  // The model's outline from the view, at the frame's size: a pixel of the frame is the monument when the drawing
  // buffer's pixel at its centre is.
  function outline(view) {
    const {width, height, data} = monument.silhouette(view), out = new Uint8Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[y * W + x] = data[Math.floor((y + .5) * height / H) * width + Math.floor((x + .5) * width / W)];
    return out;
  }

  // The photo in the frame and the columns it covers: from Commons, laid as compare.mjs lays it; or recovered from a
  // comparison pass, as twice the overlay less the capture, over the columns the photo covers.
  async function photo(source) {
    if (source.url) {
      const img = await load(source.url), w = Math.round(H * img.naturalWidth / img.naturalHeight), x = Math.round((W - w) / 2);
      return {pixels: read(img, x, w), band: [Math.max(0, x), Math.min(W, x + w)]};
    }
    const o = read(await load(source.overlay)), c = read(await load(source.capture)), pixels = new Uint8ClampedArray(N * 4), seen = new Float64Array(W);
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < 3; k++) { pixels[i * 4 + k] = 2 * o[i * 4 + k] - c[i * 4 + k]; seen[i % W] += Math.abs(o[i * 4 + k] - c[i * 4 + k]) / 3; }
      pixels[i * 4 + 3] = 255;
    }
    // The photo is centred: its edges are the pair of columns, at the same distance from the middle, where the overlay
    // stops differing from the capture. A capture redrawn between the two shots differs a little everywhere; a photo
    // differs a lot. Without such an edge, the photo is as wide as the frame.
    const D = [...seen].map(sum => sum / H);
    let half = W / 2, best = 8;
    for (let h = 2; h < W / 2; h++) { const jump = (D[W / 2 - h] + D[W / 2 + h - 1] - D[W / 2 - h - 1] - D[W / 2 + h]) / 2; if (jump > best) { best = jump; half = h; } }
    return {pixels, band: [W / 2 - half, W / 2 + half]};
  }

  // The cut: 0 building, 1 sky, 2 says nothing. Sky is what can be reached from the top of the photo through sky-like
  // pixels (blue, or pale and grey) without crossing an edge; with holes, also sky-like pixels anywhere that have the
  // colour of the open sky near them, for a lattice the sky shows through. Below the ground line, inside an ignored
  // polygon, outside the photo and, with trees, leaves (green or yellow-green, saturated, greener than blue: not cream
  // stone, gilding or a green-grey roof): nothing.
  function cut({pixels: P, band}, {ground = H, ignore = [], trees = false, holes = false} = {}) {
    const lum = i => .299 * P[i * 4] + .587 * P[i * 4 + 1] + .114 * P[i * 4 + 2];
    const skyish = i => { const r = P[i * 4], g = P[i * 4 + 1], b = P[i * 4 + 2], l = lum(i), sat = Math.max(r, g, b) - Math.min(r, g, b); return (b >= r + 8 && l > 90) || (b >= r + 30 && b > 100) || (sat < 30 && l > 165); };
    const near = (i, j) => Math.max(Math.abs(P[i * 4] - P[j * 4]), Math.abs(P[i * 4 + 1] - P[j * 4 + 1]), Math.abs(P[i * 4 + 2] - P[j * 4 + 2])) <= 16;
    const [x0, x1] = band, sky = new Uint8Array(N), stack = [];
    for (let x = x0; x < x1; x++) if (skyish(x)) { sky[x] = 1; stack.push(x); }
    while (stack.length) {
      const i = stack.pop(), x = i % W, y = (i - x) / W;
      for (const j of [x > x0 ? i - 1 : -1, x < x1 - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) if (j >= 0 && !sky[j] && skyish(j) && near(i, j)) { sky[j] = 1; stack.push(j); }
    }
    if (holes) {
      // Sky seen through a lattice has the colour of the open sky beside it: the mean of the sky reached from the top
      // within 15 rows, or of all of it.
      const rows = Array.from({length: H}, () => [0, 0, 0, 0]), all = [0, 0, 0, 0];
      for (let i = 0; i < N; i++) if (sky[i]) { const row = rows[(i - i % W) / W]; for (let k = 0; k < 3; k++) { row[k] += P[i * 4 + k]; all[k] += P[i * 4 + k]; } row[3]++; all[3]++; }
      for (let y = 0; y < H; y++) {
        const near = [0, 0, 0, 0];
        for (let yy = Math.max(0, y - 15); yy < Math.min(H, y + 16); yy++) for (let k = 0; k < 4; k++) near[k] += rows[yy][k];
        const mean = near[3] > 20 ? near : all;
        if (!mean[3]) continue;
        for (let x = x0; x < x1; x++) {
          const i = y * W + x;
          if (!sky[i] && skyish(i) && [0, 1, 2].every(k => Math.abs(P[i * 4 + k] - mean[k] / mean[3]) <= 24)) sky[i] = 1;
        }
      }
    }
    // A 5 × 5 majority smooths the noise of a recovered photo: specks of sky in stone, and of stone in sky.
    const sum = new Int32Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) sum[(y + 1) * (W + 1) + x + 1] = sky[y * W + x] + sum[y * (W + 1) + x + 1] + sum[(y + 1) * (W + 1) + x] - sum[y * (W + 1) + x];
    const box = (x, y, r) => { const a = Math.max(0, x - r), b = Math.max(0, y - r), c = Math.min(W, x + r + 1), d = Math.min(H, y + r + 1); return [sum[d * (W + 1) + c] - sum[b * (W + 1) + c] - sum[d * (W + 1) + a] + sum[b * (W + 1) + a], (c - a) * (d - b)]; };
    const labels = new Uint8Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [s, n] = box(x, y, 2); labels[y * W + x] = s * 2 > n ? 1 : 0; }
    const inside = (x, y, poly) => { let hit = false; for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) { const [xa, ya] = poly[a], [xb, yb] = poly[b]; if ((ya > y) !== (yb > y) && x < (xb - xa) * (y - ya) / (yb - ya) + xa) hit = !hit; } return hit; };
    const green = new Uint8Array(N);
    if (trees) for (let i = 0; i < N; i++) { const r = P[i * 4], g = P[i * 4 + 1], b = P[i * 4 + 2]; if (g >= r - 6 && g > b + 25 && Math.max(r, g, b) - Math.min(r, g, b) > 40 && lum(i) < 220 && labels[i] === 0) green[i] = 1; }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let none = x < x0 || x >= x1 || y >= ground || ignore.some(poly => inside(x + .5, y + .5, poly));
      if (!none && trees) for (let dy = -3; dy <= 3 && !none; dy++) for (let dx = -3; dx <= 3 && !none; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && xx < W && yy >= 0 && yy < H && green[yy * W + xx]) none = true; }
      if (none) labels[i] = 2;
    }
    return labels;
  }

  // The share of building the photo and the model have in common, where the photo says something; and the two ways
  // they differ, in thousandths of the frame: model standing in the photo's sky, photo's building the model misses.
  function compare(labels, model) {
    let both = 0, either = 0, overSky = 0, missed = 0;
    for (let i = 0; i < N; i++) {
      if (labels[i] === 2) continue;
      const a = labels[i] === 0, b = model[i] === 1;
      if (a && b) both++; if (a || b) either++; if (b && !a) overSky++; if (a && !b) missed++;
    }
    return {iou: either ? both / either : 1, overSky: overSky / N * 1000, missed: missed / N * 1000};
  }

  // The cut as a PNG: black building, white sky, grey for what says nothing.
  function png(labels) {
    const [c, g] = canvas(), img = g.createImageData(W, H);
    for (let i = 0; i < N; i++) { const v = [0, 255, 128][labels[i]]; img.data.set([v, v, v, 255], i * 4); }
    g.putImageData(img, 0, 0); return c.toDataURL('image/png').split(',')[1];
  }
  async function labelsOf(src) {
    const p = read(await load(src)), labels = new Uint8Array(N);
    for (let i = 0; i < N; i++) labels[i] = p[i * 4] < 64 ? 0 : p[i * 4] > 192 ? 1 : 2;
    return labels;
  }

  // What to look at: the photo, its sky tinted blue and what says nothing greyed; where the model stands in the sky in
  // magenta, the building it misses in yellow, its outline in red; a grid every 50 px, numbered every 100.
  function review({pixels: P}, labels, model) {
    const [c, g] = canvas(), img = g.createImageData(W, H), mix = (i, rgb, a) => { for (let k = 0; k < 3; k++) img.data[i * 4 + k] = img.data[i * 4 + k] * (1 - a) + rgb[k] * a; };
    for (let i = 0; i < N; i++) {
      img.data.set([P[i * 4], P[i * 4 + 1], P[i * 4 + 2], 255], i * 4);
      if (labels[i] === 1) mix(i, [80, 140, 255], .25);
      if (labels[i] === 2) mix(i, [40, 40, 40], .6);
      else if (model[i] === 1 && labels[i] === 1) mix(i, [255, 0, 200], .55);
      else if (model[i] === 0 && labels[i] === 0) mix(i, [255, 220, 0], .45);
      const x = i % W, edge = x < W - 1 && model[i] !== model[i + 1] || i + W < N && model[i] !== model[i + W];
      if (edge) img.data.set([255, 0, 0, 255], i * 4);
    }
    g.putImageData(img, 0, 0);
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.font = 'bold 18px monospace'; g.fillStyle = '#fff';
    for (let x = 50; x < W; x += 50) { g.beginPath(); g.moveTo(x + .5, 0); g.lineTo(x + .5, H); g.stroke(); }
    for (let y = 50; y < H; y += 50) { g.beginPath(); g.moveTo(0, y + .5); g.lineTo(W, y + .5); g.stroke(); }
    g.lineWidth = 3; g.strokeStyle = '#000';
    for (let x = 100; x < W; x += 200) for (let y = 100; y < H; y += 200) { g.strokeText(x + ',' + y, x + 3, y - 4); g.fillText(x + ',' + y, x + 3, y - 4); }
    return c.toDataURL('image/jpeg', .85).split(',')[1];
  }

  return {outline, photo, cut, compare, png, labelsOf, review};
})(); true`;
