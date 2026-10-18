#!/usr/bin/env node
// Rebuilds Monument's small, dependency-free PBR library. The source limestone texture may be replaced;
// every other map is deterministic, tileable and generated with Node alone.
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {deflateSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'kit', 'assets', 'materials');
let size = Math.max(128, Math.min(1024, Number(process.argv[2]) || 256));
const clamp = value => Math.max(0, Math.min(255, Math.round(value)));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const hash = (x, y, seed) => {
  let n = Math.imul(x + seed * 1013, 374761393) ^ Math.imul(y - seed * 733, 668265263);
  n = Math.imul(n ^ n >>> 13, 1274126177); return ((n ^ n >>> 16) >>> 0) / 4294967295;
};
const noise = (x, y, period, seed) => {
  const gx = x / size * period, gy = y / size * period, ix = Math.floor(gx), iy = Math.floor(gy), fx = smooth(gx - ix), fy = smooth(gy - iy);
  const h = (dx, dy) => hash((ix + dx + period) % period, (iy + dy + period) % period, seed);
  return mix(mix(h(0, 0), h(1, 0), fx), mix(h(0, 1), h(1, 1), fx), fy);
};
const fbm = (x, y, seed) => {
  let value = 0, weight = .54, total = 0;
  for (const p of [4, 8, 16, 32, 64]) { value += noise(x, y, p, seed + p) * weight; total += weight; weight *= .52; }
  return value / total;
};

const crcTable = Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; return c >>> 0; });
const crc32 = buffer => { let c = 0xffffffff; for (const byte of buffer) c = crcTable[(c ^ byte) & 255] ^ c >>> 8; return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4); length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data]))); return Buffer.concat([length, name, data, crc]); };
const png = (pixels, channels = 3) => {
  const head = Buffer.alloc(13); head.writeUInt32BE(size, 0); head.writeUInt32BE(size, 4); head[8] = 8; head[9] = channels === 1 ? 0 : channels === 4 ? 6 : 2;
  const raw = Buffer.alloc((size * channels + 1) * size);
  for (let y = 0; y < size; y++) { const row = y * (size * channels + 1); raw[row] = 0; pixels.copy(raw, row + 1, y * size * channels, (y + 1) * size * channels); }
  return Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'binary'), chunk('IHDR', head), chunk('IDAT', deflateSync(raw, {level: 9})), chunk('IEND', Buffer.alloc(0))]);
};

const sourcePath = join(root, 'scripts', 'assets', 'limestone-paris-source.jpg');
let paris = null;
try {
  await readFile(sourcePath);
  const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', sourcePath, '-vf', `scale=${size}:${size}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], {maxBuffer: size * size * 4});
  if (!decoded.status && decoded.stdout.length === size * size * 3) paris = decoded.stdout;
} catch {}

function material(id, sample, strength = 2.2) {
  const albedo = Buffer.alloc(size * size * 3), height = new Float32Array(size * size), roughness = Buffer.alloc(size * size), ao = Buffer.alloc(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, value = sample(x, y, i), color = value.color;
    albedo[i * 3] = clamp(color[0]); albedo[i * 3 + 1] = clamp(color[1]); albedo[i * 3 + 2] = clamp(color[2]);
    height[i] = Math.max(0, Math.min(1, value.height)); roughness[i] = clamp(value.roughness * 255);
  }
  const normal = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, left = height[y * size + (x + size - 1) % size], right = height[y * size + (x + 1) % size], down = height[((y + 1) % size) * size + x], up = height[((y + size - 1) % size) * size + x];
    let nx = (left - right) * strength, ny = (up - down) * strength, nz = 1, length = Math.hypot(nx, ny, nz); nx /= length; ny /= length; nz /= length;
    normal[i * 3] = clamp((nx * .5 + .5) * 255); normal[i * 3 + 1] = clamp((ny * .5 + .5) * 255); normal[i * 3 + 2] = clamp((nz * .5 + .5) * 255);
    ao[i] = clamp(205 + height[i] * 50);
  }
  return mkdir(join(out, id), {recursive: true}).then(() => Promise.all([
    writeFile(join(out, id, 'albedo.png'), png(albedo)), writeFile(join(out, id, 'normal.png'), png(normal)),
    writeFile(join(out, id, 'roughness.png'), png(roughness, 1)), writeFile(join(out, id, 'ao.png'), png(ao, 1)),
  ]));
}

const stone = (base, seed, age = .2) => (x, y) => {
  const broad = fbm(x, y, seed), fine = noise(x, y, 64, seed + 9), pore = noise(x, y, 96, seed + 21) > .93 ? -35 : 0, v = (broad - .5) * 34 + (fine - .5) * 13 + pore * age;
  return {color: base.map(c => c + v), height: .34 + broad * .46 + fine * .16 + pore / 130, roughness: .72 + age * .15 + (fine - .5) * .08};
};

await Promise.all([
  material('limestone-paris', (x, y, i) => {
    const n = fbm(x, y, 17), p = paris ? [paris[i * 3], paris[i * 3 + 1], paris[i * 3 + 2]] : [198, 190, 173];
    const lum = (p[0] + p[1] + p[2]) / 765;
    return {color: p.map(c => c * .92 + 10), height: .18 + lum * .58 + n * .2, roughness: .76 + (1 - n) * .12};
  }, 3.4),
  material('limestone-weathered', stone([173, 156, 127], 41, .85), 3.2),
  material('marble-white', (x, y) => {
    const n = fbm(x, y, 63), cloud = noise(x, y, 8, 68);
    const vein = Math.pow(1 - Math.abs(Math.sin((x + y * .24) / size * Math.PI * 5.5 + n * 4.2)), 13);
    const hairline = Math.pow(1 - Math.abs(Math.sin((x * .42 - y) / size * Math.PI * 3.2 + cloud * 5)), 22);
    const v = (n - .5) * 10 + (cloud - .5) * 5 - vein * 20 - hairline * 7;
    return {color: [226 + v, 224 + v, 216 + v * .88], height: .48 + n * .1 - vein * .025, roughness: .58 + n * .09};
  }, 1.8),
  material('sandstone-warm', (x, y) => {
    const n = fbm(x, y, 72), fine = noise(x, y, 64, 76), bed = Math.sin((y / size * 9 + n * .7) * Math.PI) * .5 + .5;
    const v = (n - .5) * 24 + (fine - .5) * 12 + bed * 5;
    return {color: [194 + v, 166 + v * .86, 121 + v * .62], height: .34 + n * .4 + fine * .16 + bed * .04, roughness: .84 + fine * .1};
  }, 2.8),
  material('granite-grey', (x, y) => {
    const n = fbm(x, y, 79), grain = noise(x, y, 96, 83), black = grain > .91 ? -38 : 0, quartz = grain < .08 ? 32 : 0, v = (n - .5) * 20 + black + quartz;
    return {color: [143 + v * .93, 145 + v * .96, 146 + v], height: .4 + n * .28 + grain * .16 + (quartz - black) / 420, roughness: .7 + n * .14};
  }, 2.5),
  material('brick-roman', (x, y) => {
    const bw = size / 5, bh = size / 9, row = Math.floor(y / bh), xx = (x + (row % 2) * bw / 2) % bw, yy = y % bh, joint = Math.min(xx, bw - xx, yy, bh - yy), mortar = joint < size / 100, n = fbm(x, y, 88), cell = hash(Math.floor((x + (row % 2) * bw / 2) / bw), row, 91);
    const c = mortar ? 145 + n * 18 : 123 + cell * 40 + (n - .5) * 22;
    return {color: mortar ? [c, c - 5, c - 14] : [c + 28, c - 13, c - 29], height: mortar ? .18 : .52 + n * .2, roughness: mortar ? .94 : .84};
  }, 4.2),
  material('oak-aged', (x, y) => {
    const n = fbm(x, y, 112), grain = .5 + .5 * Math.sin((x / size * 18 + n * 2.4) * Math.PI), dark = Math.pow(grain, 8), v = (n - .5) * 25 - dark * 28;
    return {color: [112 + v, 76 + v * .72, 43 + v * .48], height: .35 + grain * .28 + n * .18, roughness: .76 + (1 - grain) * .14};
  }, 3),
  material('slate-aged', (x, y) => {
    const n = fbm(x, y, 131), strata = Math.sin((y / size * 24 + n * 3) * Math.PI) * .5 + .5, v = (n - .5) * 22 + strata * 9;
    return {color: [54 + v * .65, 61 + v * .8, 68 + v], height: .32 + n * .33 + strata * .16, roughness: .62 + n * .16};
  }, 2.8),
  material('terracotta-aged', (x, y) => {
    const n = fbm(x, y, 146), fleck = noise(x, y, 64, 155), v = (n - .5) * 30 + (fleck > .9 ? 24 : 0);
    return {color: [151 + v, 76 + v * .55, 48 + v * .4], height: .37 + n * .42, roughness: .78 + fleck * .12};
  }, 2.7),
  material('cobblestone', (x, y) => {
    const bw = size / 7, bh = size / 9, row = Math.floor(y / bh), xx = (x + (row % 2) * bw / 2) % bw, yy = y % bh, edge = Math.min(xx, bw - xx, yy, bh - yy), mortar = edge < size / 90, n = fbm(x, y, 174), cell = hash(Math.floor((x + (row % 2) * bw / 2) / bw), row, 181), c = 105 + cell * 45 + (n - .5) * 18;
    return {color: mortar ? [75, 72, 66] : [c, c - 2, c - 7], height: mortar ? .12 : .48 + Math.min(1, edge / (size / 55)) * .3, roughness: .86 + n * .08};
  }, 4.5),
  material('dry-grass', (x, y) => {
    const n = fbm(x, y, 203), blade = noise(x, y, 96, 211), green = Math.max(0, n - .46), v = (blade - .5) * 22;
    return {color: [126 + v - green * 45, 112 + v + green * 18, 68 + v * .55], height: .25 + n * .45 + blade * .2, roughness: .9};
  }, 3.4),
]);

console.log(`Generated ${11 * 4} PBR maps at ${size}×${size} in ${out}`);

// ——— Surfaces no photograph gives, at 512 px whatever the argument ———
size = 512;
// Gold leaf: squares of beaten leaf (kinpaku, 10.9 cm) laid in rows on lacquer, six to a tile of 0.654 m, each
// a little lighter or darker, their edges overlapping in thin seams, the leaf wrinkled where it was pressed.
await material('gold-leaf', (x, y) => {
  const cell = size / 6, cx = Math.floor(x / cell), cy = Math.floor(y / cell), u = x - cx * cell, v = y - cy * cell;
  const seam = Math.min(u, v) < 1.6 ? 1 : 0, tone = (hash(cx, cy, 401) - .5) * 16, wrinkle = (noise(x, y, 48, 409) - .5) * 10 + (noise(x, y, 160, 411) - .5) * 5;
  const c = [229, 187, 92].map((k, i) => k + tone * (i === 2 ? .5 : 1) + wrinkle - seam * 14);
  return {color: c, height: .5 + wrinkle / 60 + seam * .12, roughness: .26 + (noise(x, y, 32, 419) - .5) * .12 + seam * .18};
}, 1.4);
// Water: a tileable field of small ripples (only its normal map is used).
await material('water-ripple', (x, y) => {
  const t = (a, b, p, s) => Math.sin((x * a + y * b) / size * Math.PI * 2 * p + s);
  const h = .5 + .16 * t(1, .3, 3, .4) + .12 * t(-.4, 1, 5, 1.7) + .08 * t(.8, -.7, 9, 2.9) + .1 * (fbm(x, y, 431) - .5);
  return {color: [60, 90, 84], height: h, roughness: .05};
}, 5);

// ——— Cut-out atlases (RGBA) for foliage and grass cards ———
// Four quadrants each: small leaves of a clipped shrub, pine needles in tufts, maple leaves, and broad leaves
// (foliage.png); four tufts of grass blades (grass.png). Drawn leaf by leaf, later ones over earlier ones.
function atlas(id, quadrants) {
  size = 1024;
  const pixels = Buffer.alloc(size * size * 4), half = size / 2;
  const plot = (x, y, color) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4; pixels[i] = clamp(color[0]); pixels[i + 1] = clamp(color[1]); pixels[i + 2] = clamp(color[2]); pixels[i + 3] = 255;
  };
  // A leaf from (x, y) along angle a: length l, half-width w at its widest, a darker midrib.
  const leaf = (q, x, y, a, l, w, color, lobes = 0) => {
    const ox = (q % 2) * half, oy = Math.floor(q / 2) * half, ca = Math.cos(a), sa = Math.sin(a), r = Math.ceil(l + w);
    for (let py = -r; py <= r; py++) for (let px = -r; px <= r; px++) {
      const u = (px * ca + py * sa) / l, v = -px * sa + py * ca;
      if (u < 0 || u > 1) continue;
      let width = w * Math.sin(Math.PI * Math.min(1, u * 1.08)) ** .8;
      if (lobes) width *= .55 + .45 * Math.abs(Math.cos(Math.atan2(v, u * l) * lobes));
      if (Math.abs(v) > width) continue;
      const shade = 1 - Math.abs(v) / Math.max(1, width) * .22 - (Math.abs(v) < .9 ? .16 : 0);
      plot(ox + x + px, oy + y + py, color.map(c => c * shade));
    }
  };
  quadrants.forEach((draw, q) => draw((x, y, a, l, w, color, lobes) => leaf(q, x, y, a, l, w, color, lobes)));
  return mkdir(join(out, id), {recursive: true}).then(() => writeFile(join(out, id, 'albedo.png'), png(pixels, 4)));
}
const greens = (seed, base) => { let k = seed; return () => { k++; const t = hash(k, 7, seed); return base.map((c, i) => c * (.78 + t * .4) + (i === 1 ? t * 10 : 0)); }; };
await atlas('foliage', [
  // Clipped shrub (box, azalea): many small leaves in a dense, round clump with a ragged edge.
  leaf => { const g = greens(3, [62, 96, 44]); for (let i = 0; i < 1500; i++) { const a = hash(i, 1, 5) * Math.PI * 2, r = Math.sqrt(hash(i, 2, 5)) * 236; leaf(256 + Math.cos(a) * r, 256 + Math.sin(a) * r, hash(i, 3, 5) * Math.PI * 2, 13 + hash(i, 4, 5) * 9, 4 + hash(i, 6, 5) * 2.5, g()); } },
  // Pine needles in tufts along short twigs, dark blue-green.
  leaf => { const g = greens(11, [38, 66, 46]); for (let t = 0; t < 26; t++) { const a0 = hash(t, 1, 13) * Math.PI * 2, r0 = Math.sqrt(hash(t, 2, 13)) * 160, cx = 256 + Math.cos(a0) * r0, cy = 256 + Math.sin(a0) * r0; for (let i = 0; i < 46; i++) { const a = hash(t * 64 + i, 3, 13) * Math.PI * 2; leaf(cx, cy, a, 50 + hash(t * 64 + i, 4, 13) * 40, 1.4, g()); } } },
  // Maple: five-lobed leaves, loosely overlapping.
  leaf => { const g = greens(19, [74, 112, 46]); for (let i = 0; i < 160; i++) { const a = hash(i, 1, 21) * Math.PI * 2, r = Math.sqrt(hash(i, 2, 21)) * 215; leaf(256 + Math.cos(a) * r, 256 + Math.sin(a) * r, hash(i, 3, 21) * Math.PI * 2, 30 + hash(i, 4, 21) * 14, 16, g(), 2.5); } },
  // Broad leaves of a wild shrub.
  leaf => { const g = greens(29, [70, 104, 50]); for (let i = 0; i < 520; i++) { const a = hash(i, 1, 31) * Math.PI * 2, r = Math.sqrt(hash(i, 2, 31)) * 232; leaf(256 + Math.cos(a) * r, 256 + Math.sin(a) * r, hash(i, 3, 31) * Math.PI * 2, 22 + hash(i, 4, 31) * 16, 7 + hash(i, 6, 31) * 4, g()); } },
]);
await atlas('grass', [0, 1, 2, 3].map(q => leaf => {
  const g = greens(41 + q, q === 3 ? [116, 122, 70] : [74, 112, 52]);
  // Blades rise from the bottom edge, tapering and leaning; drawn as thin leaves pointing up.
  for (let i = 0; i < 220; i++) { const x = 40 + hash(i, 1, 43 + q) * 432, lean = (hash(i, 2, 43 + q) - .5) * .7; leaf(x, 506, -Math.PI / 2 + lean, 150 + hash(i, 3, 43 + q) * 320 * (q === 1 ? .6 : 1), 2.4 + hash(i, 4, 43 + q) * 2, g()); }
}));
console.log('Generated gold-leaf, water-ripple, and the foliage and grass atlases.');
