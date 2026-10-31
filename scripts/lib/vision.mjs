// Seeing the model as a picture, to hold its windows and doors to the codes of a facade. A frontal view is taken of each wall
// that carries openings, from its outward normal and level with its middle; the openings the monument's numbers declare are
// projected into that picture by the viewer itself (`monument.project`), and what the picture shows there is measured:
// whether the glass reads dark, whether it stands where the numbers put it. Nothing here needs a dependency: the PNG the
// browser returns is read with zlib, which Node has.
import {inflateSync} from 'node:zlib';

export const FRAME = [960, 600], DARK = 85;

// An 8-bit RGB or RGBA PNG, as the browser takes it, as a grid of luminance (0-255).
export function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let at = 8, width = 0, height = 0, depth = 0, type = 0; const parts = [];
  while (at < buffer.length) {
    const len = buffer.readUInt32BE(at), name = buffer.toString('latin1', at + 4, at + 8), body = buffer.subarray(at + 8, at + 8 + len);
    if (name === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; type = body[9]; }
    else if (name === 'IDAT') parts.push(body);
    else if (name === 'IEND') break;
    at += 12 + len;
  }
  if (depth !== 8 || ![2, 6].includes(type)) throw new Error(`a ${depth}-bit PNG of colour type ${type} is not read`);
  const bpp = type === 6 ? 4 : 3, stride = width * bpp, raw = inflateSync(Buffer.concat(parts)), out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), line = out.subarray(y * stride, (y + 1) * stride), prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev ? prev[i] : 0, c = prev && i >= bpp ? prev[i - bpp] : 0;
      line[i] = (row[i] + (filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : (() => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; })())) & 255;
    }
  }
  const lum = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) lum[i] = Math.round(.299 * out[i * bpp] + .587 * out[i * bpp + 1] + .114 * out[i * bpp + 2]);
  return {width, height, lum};
}

// How much of a rectangle (x0, y0, x1, y1, in pixels) reads dark, and where the dark sits in it.
export function darkness(img, [x0, y0, x1, y1], limit = DARK) {
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(img.width, Math.ceil(x1)); y1 = Math.min(img.height, Math.ceil(y1));
  let dark = 0, total = 0, sx = 0, sy = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { total++; if (img.lum[y * img.width + x] < limit) { dark++; sx += x; sy += y; } }
  return {share: total ? dark / total : 0, cx: dark ? sx / dark : NaN, cy: dark ? sy / dark : NaN, area: total};
}

const NORMAL = {'u+': [1, 0], 'u-': [-1, 0], 'v+': [0, 1], 'v-': [0, -1]};
const sideOf = (e, side) => ({length: side[0] === 'u' ? e.depth : e.length, normal: NORMAL[side]});
// The walls, their openings as the numbers declare them (renaissance.js lays them: `bays` between `from` and `to`, a window
// or none per storey, `skip` bays left out, `openings` for doors and arches), in the monument's frame.
export function wallOpenings(e) {
  const levels = e.levels ?? [6.5, 6.5, 6], y0 = e.y0 ?? 0, floors = levels.reduce((acc, h) => (acc.push((acc.at(-1) ?? y0) + h), acc), []), top = floors.at(-1);
  const walls = [];
  for (const [side, spec] of Object.entries(e.sides ?? {})) {
    if (spec === false) continue;
    const {length, normal} = sideOf(e, side), from = spec?.from ?? 0, to = spec?.to ?? length, bays = spec?.bays ?? Math.max(1, Math.round((to - from) / 5)), grid = spec?.windows ?? e.windows ?? [{w: 1.5, sill: 1.5, head: 4.7}];
    const windows = [], doors = [];
    levels.forEach((h, i) => {
      const g = grid[Math.min(i, grid.length - 1)], base = i === 0 ? y0 : floors[i - 1];
      if (g === false) return;
      for (let j = 0; j < bays; j++) {
        if ((spec?.skip ?? []).some(([lv, bay]) => lv === i && bay === j)) continue;
        windows.push({s: from + (j + .5) * (to - from) / bays, w: g.w, sill: base + g.sill, head: base + g.head, level: i});
      }
    });
    for (const o of spec?.openings ?? []) doors.push({s: o.s, w: o.w, sill: o.sill ?? 0, head: (o.spring ?? 4) + (o.kind === 'round' ? o.w / 2 : 0), dark: Boolean(o.door) || o.glass !== false});
    if (windows.length || doors.length) walls.push({side, length, normal, from, to, bays, windows, doors, y0, top});
  }
  return walls;
}

// Does anything stand between the camera and a point on the wall, as high as the point? A plan test against the other
// buildings' footprints, the towers' cornices counted in: a window that is hidden is not asked to show.
export function hiddenBy(elements, self, camera, point, y) {
  const [cx, cz] = camera, [px, pz] = point, dx = px - cx, dz = pz - cz, len = Math.hypot(dx, dz) || 1;
  for (let j = 0; j < elements.length; j++) {
    const o = elements[j]; if (j === self || !['lodgingRange', 'drumTower'].includes(o.type)) continue;
    const levels = o.levels ? o.levels.reduce((a, b) => a + b, 0) : o.height ?? 0, roof = Array.isArray(o.roofs) ? Math.max(0, ...o.roofs.map(r => r.rise ?? 0)) : o.roof?.rise ?? 0, topOf = (o.y0 ?? 0) + levels + roof + 1;
    if (topOf <= y) continue;
    for (let k = 0; k <= 80; k++) {
      const t = k / 80, x = cx + dx * t, z = cz + dz * t;
      if (t * len > len - .6) break;
      if (o.type === 'drumTower' ? Math.hypot(x - o.center[0], z - o.center[1]) < o.radius + 1 : Math.abs(x - o.center[0]) < o.length / 2 + .3 && Math.abs(z - o.center[1]) < o.depth / 2 + .3) return j;
    }
  }
  return null;
}
