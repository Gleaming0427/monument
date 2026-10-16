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
const size = Math.max(128, Math.min(1024, Number(process.argv[2]) || 256));
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
  const head = Buffer.alloc(13); head.writeUInt32BE(size, 0); head.writeUInt32BE(size, 4); head[8] = 8; head[9] = channels === 1 ? 0 : 2;
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
