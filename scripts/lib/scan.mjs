// A captured scan held against the model: read the points, fit the scan onto the building, and say, element by
// element, how far the model stands from what was captured. The scan is the evidence for centimetres; the model
// keeps the history. Nothing here invents a surface: it reads points, aligns two frames and measures distances.
import {open, readFile} from 'node:fs/promises';
import {extname} from 'node:path';

// ——— Reading points ———————————————————————————————————————————————————————————————————————————————————————————
// PLY (ascii or binary little endian: what COLMAP, OpenMVS, Metashape and the splat trainers write), OBJ
// (vertices only), the antimatter15 `.splat` (32 bytes a gaussian) and plain `x y z` text. A `.spz` is
// compressed and is not read here: convert it to PLY first.
const PLY_TYPES = {char: ['getInt8', 1], int8: ['getInt8', 1], uchar: ['getUint8', 1], uint8: ['getUint8', 1], short: ['getInt16', 2], int16: ['getInt16', 2], ushort: ['getUint16', 2], uint16: ['getUint16', 2], int: ['getInt32', 4], int32: ['getInt32', 4], uint: ['getUint32', 4], uint32: ['getUint32', 4], float: ['getFloat32', 4], float32: ['getFloat32', 4], double: ['getFloat64', 8], float64: ['getFloat64', 8]};

function readPly(buffer) {
  const head = buffer.subarray(0, Math.min(buffer.length, 1 << 16)).toString('latin1'), end = head.indexOf('end_header');
  if (end < 0) throw new Error('not a PLY file: no end_header');
  const lines = head.slice(0, end).split(/\r?\n/), body = end + 'end_header'.length + (head[end + 10] === '\r' ? 2 : 1);
  const format = lines.find(line => line.startsWith('format '))?.split(/\s+/)[1];
  const elements = [];
  for (const line of lines) {
    const [word, a, b, c] = line.trim().split(/\s+/);
    if (word === 'element') elements.push({name: a, count: Number(b), props: []});
    else if (word === 'property') elements.at(-1)?.props.push(a === 'list' ? {list: true, name: c} : {type: a, name: b});
  }
  const vertex = elements[0];
  if (vertex?.name !== 'vertex') throw new Error('the PLY file must start with a vertex element');
  if (vertex.props.some(prop => prop.list)) throw new Error('a list property inside the vertex element is not supported');
  const names = vertex.props.map(prop => prop.name), at = ['x', 'y', 'z'].map(axis => names.indexOf(axis));
  if (at.some(index => index < 0)) throw new Error('the PLY vertex element has no x, y, z');
  const positions = new Float32Array(vertex.count * 3);
  if (format === 'ascii') {
    const rows = buffer.subarray(body).toString('latin1').split(/\r?\n/);
    for (let i = 0; i < vertex.count; i++) { const cells = rows[i].trim().split(/\s+/); for (let k = 0; k < 3; k++) positions[i * 3 + k] = Number(cells[at[k]]); }
  } else if (format === 'binary_little_endian') {
    const view = new DataView(buffer.buffer, buffer.byteOffset + body), offsets = []; let stride = 0;
    for (const prop of vertex.props) { const type = PLY_TYPES[prop.type]; if (!type) throw new Error(`PLY type "${prop.type}" is not supported`); offsets.push([type, stride]); stride += type[1]; }
    for (let i = 0; i < vertex.count; i++) for (let k = 0; k < 3; k++) { const [[getter], offset] = offsets[at[k]]; positions[i * 3 + k] = view[getter](i * stride + offset, true); }
  } else throw new Error(`PLY format "${format}" is not supported (ascii or binary_little_endian)`);
  return positions;
}

function readSplat(buffer) {
  if (buffer.length % 32) throw new Error('a .splat file is a whole number of 32-byte gaussians');
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.length), positions = new Float32Array(buffer.length / 32 * 3);
  for (let i = 0; i < positions.length / 3; i++) for (let k = 0; k < 3; k++) positions[i * 3 + k] = view.getFloat32(i * 32 + k * 4, true);
  return positions;
}

const readText = (text, vertices) => {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (vertices) { if (line.startsWith('v ')) out.push(...line.trim().split(/\s+/).slice(1, 4).map(Number)); continue; }
    const cells = line.trim().split(/[\s,;]+/).slice(0, 3).map(Number);
    if (cells.length === 3 && cells.every(Number.isFinite)) out.push(...cells);
  }
  return Float32Array.from(out);
};

export async function readPoints(file) {
  const kind = extname(file).toLowerCase();
  if (kind === '.spz') throw new Error('.spz is compressed: convert it to PLY (the Spark and SuperSplat tools do) before aligning');
  if (!['.ply', '.splat', '.obj', '.xyz', '.txt', '.csv'].includes(kind)) throw new Error(`unknown scan format "${kind}" (ply, splat, obj, xyz)`);
  const buffer = await readFile(file);
  if (kind === '.ply') return readPly(buffer);
  if (kind === '.splat') return readSplat(buffer);
  return readText(buffer.toString('utf8'), kind === '.obj');
}

// ——— Similarity transform (Horn 1987): the scale, rotation and translation that best map a onto b ——————————————
// 4 × 4 symmetric eigenproblem by Jacobi rotations: small, dependency-free, and exact enough for a fit in metres.
function jacobiEigen(matrix) {
  const n = matrix.length, a = matrix.map(row => [...row]), v = Array.from({length: n}, (_, i) => Array.from({length: n}, (_, j) => +(i === j)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] ** 2;
    if (off < 1e-24) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-30) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
      for (let k = 0; k < n; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
      for (let k = 0; k < n; k++) { const x = v[k][p], y = v[k][q]; v[k][p] = c * x - s * y; v[k][q] = s * x + c * y; }
    }
  }
  return {values: a.map((row, i) => row[i]), vectors: v};
}

// The result is {scale, R (row-major 3 × 3), t}: b ≈ scale · R · a + t. `rigid` keeps the scale at 1.
export function fitSimilarity(a, b, {rigid = false} = {}) {
  const n = a.length, mean = list => list.reduce((m, p) => [m[0] + p[0] / n, m[1] + p[1] / n, m[2] + p[2] / n], [0, 0, 0]), ma = mean(a), mb = mean(b);
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; let va = 0;
  for (let i = 0; i < n; i++) {
    const p = [a[i][0] - ma[0], a[i][1] - ma[1], a[i][2] - ma[2]], q = [b[i][0] - mb[0], b[i][1] - mb[1], b[i][2] - mb[2]];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r][c] += p[r] * q[c];
    va += p[0] ** 2 + p[1] ** 2 + p[2] ** 2;
  }
  const [[sxx, sxy, sxz], [syx, syy, syz], [szx, szy, szz]] = S;
  const {values, vectors} = jacobiEigen([[sxx + syy + szz, syz - szy, szx - sxz, sxy - syx], [syz - szy, sxx - syy - szz, sxy + syx, szx + sxz], [szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy], [sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz]]);
  const top = values.indexOf(Math.max(...values)), [w, x, y, z] = vectors.map(row => row[top]), norm = Math.hypot(w, x, y, z);
  const q0 = w / norm, q1 = x / norm, q2 = y / norm, q3 = z / norm;
  const R = [[q0 * q0 + q1 * q1 - q2 * q2 - q3 * q3, 2 * (q1 * q2 - q0 * q3), 2 * (q1 * q3 + q0 * q2)], [2 * (q1 * q2 + q0 * q3), q0 * q0 - q1 * q1 + q2 * q2 - q3 * q3, 2 * (q2 * q3 - q0 * q1)], [2 * (q1 * q3 - q0 * q2), 2 * (q2 * q3 + q0 * q1), q0 * q0 - q1 * q1 - q2 * q2 + q3 * q3]];
  let scale = 1;
  if (!rigid) { let num = 0; for (let i = 0; i < n; i++) { const p = [a[i][0] - ma[0], a[i][1] - ma[1], a[i][2] - ma[2]], q = [b[i][0] - mb[0], b[i][1] - mb[1], b[i][2] - mb[2]]; for (let r = 0; r < 3; r++) num += q[r] * (R[r][0] * p[0] + R[r][1] * p[1] + R[r][2] * p[2]); } scale = num / va; }
  const t = [0, 1, 2].map(r => mb[r] - scale * (R[r][0] * ma[0] + R[r][1] * ma[1] + R[r][2] * ma[2]));
  return {scale, R, t};
}

export const apply = ({scale, R, t}, p) => [0, 1, 2].map(r => scale * (R[r][0] * p[0] + R[r][1] * p[1] + R[r][2] * p[2]) + t[r]);
// The transform that applies `second` after `first`.
export const compose = (second, first) => ({scale: second.scale * first.scale, R: second.R.map(row => [0, 1, 2].map(c => row[0] * first.R[0][c] + row[1] * first.R[1][c] + row[2] * first.R[2][c])), t: apply(second, first.t)});
// Column-major 4 × 4 (three.js Matrix4.elements): the scale is folded into the rotation.
export const toMatrix = ({scale, R, t}) => [R[0][0] * scale, R[1][0] * scale, R[2][0] * scale, 0, R[0][1] * scale, R[1][1] * scale, R[2][1] * scale, 0, R[0][2] * scale, R[1][2] * scale, R[2][2] * scale, 0, t[0], t[1], t[2], 1];
export function fromMatrix(m) {
  const scale = Math.hypot(m[0], m[1], m[2]);
  return {scale, R: [[m[0] / scale, m[4] / scale, m[8] / scale], [m[1] / scale, m[5] / scale, m[9] / scale], [m[2] / scale, m[6] / scale, m[10] / scale]], t: [m[12], m[13], m[14]]};
}
// The rotation about the vertical axis the viewer applies to everything in the monument's own frame (`rotate`).
export const turnY = degrees => { const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return {scale: 1, R: [[c, 0, s], [0, 1, 0], [-s, 0, c]], t: [0, 0, 0]}; };

// ——— The model as triangles, and the nearest one to a point ——————————————————————————————————————————————————
const CUBE = (() => {
  const v = [[-.5, -.5, -.5], [.5, -.5, -.5], [.5, .5, -.5], [-.5, .5, -.5], [-.5, -.5, .5], [.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5]];
  return [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [3, 6, 2], [3, 7, 6], [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5]].map(face => face.map(i => v[i]));
})();

// What stands at the end of the film, as world-space triangles tagged with the element that laid them. A block is its
// plain box (the chamfer is a centimetre or two, below what a scan resolves); any other shape is its own geometry.
export function modelTriangles(engine, data, pieces, {elements} = {}) {
  const last = data.phases.length - 1, shapes = new Map(), triangles = [], owner = [];
  for (const piece of pieces) {
    if (piece.phase > last || (piece.until !== undefined && piece.until <= last) || piece.kind === 'glass') continue;
    if (elements && !elements.includes(piece.element)) continue;
    if (piece.mesh) {
      // A patch of real surface (kit/masonry.js): its own triangles, held in its bounding box's unit cube.
      const {position, index} = piece.mesh, m = piece.matrix.elements;
      const at = i => { const x = position[i * 3], y = position[i * 3 + 1], z = position[i * 3 + 2]; return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]; };
      for (let i = 0; i < index.length; i += 3) { triangles.push([at(index[i]), at(index[i + 1]), at(index[i + 2])]); owner.push(piece.element); }
      continue;
    }
    const shape = piece.shape ?? 'box';
    if (!shapes.has(shape)) {
      if (shape === 'box') shapes.set(shape, CUBE);
      else {
        const geometry = engine.SHAPES[shape](), position = geometry.attributes.position, index = geometry.index, list = [];
        const vertex = i => [position.getX(i), position.getY(i), position.getZ(i)];
        for (let i = 0; i < (index ? index.count : position.count); i += 3) list.push([0, 1, 2].map(k => vertex(index ? index.getX(i + k) : i + k)));
        geometry.dispose(); shapes.set(shape, list);
      }
    }
    const m = piece.matrix.elements;
    for (const triangle of shapes.get(shape)) {
      triangles.push(triangle.map(([x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]));
      owner.push(piece.element);
    }
  }
  return {triangles, owner};
}

// Closest point on a triangle to p (Ericson, Real-Time Collision Detection, 5.1.5), on flat coordinates: the squared
// distance is returned and the point is left in `hit`. A query touches thousands of triangles, so nothing is allocated.
const hit = [0, 0, 0];
function closestOnTriangle(px, py, pz, t, o) {
  const ax = t[o], ay = t[o + 1], az = t[o + 2], abx = t[o + 3] - ax, aby = t[o + 4] - ay, abz = t[o + 5] - az, acx = t[o + 6] - ax, acy = t[o + 7] - ay, acz = t[o + 8] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az, d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  const done = (x, y, z) => { hit[0] = x; hit[1] = y; hit[2] = z; return (x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2; };
  if (d1 <= 0 && d2 <= 0) return done(ax, ay, az);
  const bpx = px - t[o + 3], bpy = py - t[o + 4], bpz = pz - t[o + 5], d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return done(t[o + 3], t[o + 4], t[o + 5]);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return done(ax + abx * v, ay + aby * v, az + abz * v); }
  const cpx = px - t[o + 6], cpy = py - t[o + 7], cpz = pz - t[o + 8], d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return done(t[o + 6], t[o + 7], t[o + 8]);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return done(ax + acx * w, ay + acy * w, az + acz * w); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return done(t[o + 3] + (t[o + 6] - t[o + 3]) * w, t[o + 4] + (t[o + 7] - t[o + 4]) * w, t[o + 5] + (t[o + 8] - t[o + 5]) * w); }
  const denom = 1 / (va + vb + vc), v = vb * denom, w = vc * denom;
  return done(ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w);
}

// A uniform grid of triangles. A query visits the cells round the point shell by shell and stops as soon as the best
// triangle found is nearer than the shells not yet visited can hold, so the answer is the nearest triangle, exactly,
// within `reach` metres (or null): a scan that sits on the model costs a handful of triangles a point.
export function triangleGrid({triangles, owner}, {reach = 2, cell = .5} = {}) {
  const flat = new Float64Array(triangles.length * 9), buckets = new Map(), key = (i, j, k) => ((i + 32768) * 65536 + (j + 32768)) * 65536 + (k + 32768); // cells of half a metre: ±16 km, 48 bits, exact
  triangles.forEach((triangle, index) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < 3; v++) for (let axis = 0; axis < 3; axis++) { const x = triangle[v][axis]; flat[index * 9 + v * 3 + axis] = x; if (x < lo[axis]) lo[axis] = x; if (x > hi[axis]) hi[axis] = x; }
    for (let i = Math.floor(lo[0] / cell); i <= Math.floor(hi[0] / cell); i++) for (let j = Math.floor(lo[1] / cell); j <= Math.floor(hi[1] / cell); j++) for (let k = Math.floor(lo[2] / cell); k <= Math.floor(hi[2] / cell); k++) { const id = key(i, j, k); const list = buckets.get(id); if (list) list.push(index); else buckets.set(id, [index]); }
  });
  const cells = new Map([...buckets].map(([id, list]) => [id, Int32Array.from(list)]));
  return {
    reach, triangles: triangles.length,
    // {distance, point, normal, element} of the nearest triangle within `reach`, or null.
    nearest(p) {
      const i = Math.floor(p[0] / cell), j = Math.floor(p[1] / cell), k = Math.floor(p[2] / cell), rings = Math.ceil(reach / cell);
      if (Math.max(Math.abs(i), Math.abs(j), Math.abs(k)) + rings >= 32768) return null;
      let best = Infinity, at = -1, bx = 0, by = 0, bz = 0;
      for (let ring = 0; ring <= rings; ring++) {
        for (let di = -ring; di <= ring; di++) for (let dj = -ring; dj <= ring; dj++) {
          const edge = Math.abs(di) === ring || Math.abs(dj) === ring, step = edge ? 1 : 2 * ring || 1;
          for (let dk = -ring; dk <= ring; dk += step) {
            const list = cells.get(key(i + di, j + dj, k + dk));
            if (!list) continue;
            for (let n = 0; n < list.length; n++) { const d = closestOnTriangle(p[0], p[1], p[2], flat, list[n] * 9); if (d < best) { best = d; at = list[n]; bx = hit[0]; by = hit[1]; bz = hit[2]; } }
          }
        }
        if (at >= 0 && best <= (ring * cell) ** 2) break;
      }
      if (at < 0 || best > reach * reach) return null;
      const o = at * 9, ux = flat[o + 3] - flat[o], uy = flat[o + 4] - flat[o + 1], uz = flat[o + 5] - flat[o + 2], vx = flat[o + 6] - flat[o], vy = flat[o + 7] - flat[o + 1], vz = flat[o + 8] - flat[o + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, length = Math.hypot(nx, ny, nz) || 1;
      return {distance: Math.sqrt(best), point: [bx, by, bz], normal: [nx / length, ny / length, nz / length], element: owner[at]};
    },
  };
}

// ——— Aligning a scan to the model —————————————————————————————————————————————————————————————————————————————
const quantile = (sorted, q) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null;
const every = (count, limit) => { const step = Math.max(1, Math.ceil(count / limit)), out = []; for (let i = 0; i < count; i += step) out.push(i); return out; };

// Gauss elimination with partial pivoting on a small dense system; the matrix is symmetric and positive.
function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let pivot = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[pivot][c])) pivot = r;
    [M[c], M[pivot]] = [M[pivot], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / (M[c][c] || 1e-30); for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let sum = M[r][n]; for (let k = r + 1; k < n; k++) sum -= M[r][k] * x[k]; x[r] = sum / (M[r][r] || 1e-30); }
  return x;
}

// Trimmed point-to-plane iterative closest point from a first fit (the method CloudCompare and Open3D use): each
// round keeps the nearer `keep` of the points that have a model triangle within reach, and moves the scan so that
// they lie on the planes of their triangles, which lets a scan slide along a wall without being held by it. Points
// with no triangle in reach (trees, neighbours, scaffolding) never count. `rigid` keeps the scale; otherwise the scale
// is refitted too, which a scan that was not scaled by measurement needs.
export function refine(positions, grid, start, {rounds = 80, keep = .7, sample = 8000, rigid = false} = {}) {
  const picks = every(positions.length / 3, sample).map(i => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]);
  let T = start, last = Infinity;
  for (let round = 0; round < rounds; round++) {
    const pairs = [];
    for (const p of picks) { const moved = apply(T, p), hit = grid.nearest(moved); if (hit) pairs.push({p: moved, q: hit.point, n: hit.normal, d: hit.distance}); }
    if (pairs.length < 10) break;
    pairs.sort((u, v) => u.d - v.d);
    const kept = pairs.slice(0, Math.max(10, Math.floor(pairs.length * keep))), rms = Math.sqrt(kept.reduce((s, x) => s + x.d * x.d, 0) / kept.length);
    const c = kept.reduce((m, x) => [m[0] + x.p[0] / kept.length, m[1] + x.p[1] / kept.length, m[2] + x.p[2] / kept.length], [0, 0, 0]), dims = rigid ? 6 : 7;
    const A = Array.from({length: dims}, () => new Array(dims).fill(0)), b = new Array(dims).fill(0);
    for (const {p, q, n} of kept) {
      const u = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], row = [u[1] * n[2] - u[2] * n[1], u[2] * n[0] - u[0] * n[2], u[0] * n[1] - u[1] * n[0], n[0], n[1], n[2], u[0] * n[0] + u[1] * n[1] + u[2] * n[2]].slice(0, dims);
      const residual = n[0] * (p[0] - q[0]) + n[1] * (p[1] - q[1]) + n[2] * (p[2] - q[2]);
      for (let r = 0; r < dims; r++) { b[r] -= row[r] * residual; for (let k = 0; k < dims; k++) A[r][k] += row[r] * row[k]; }
    }
    for (let r = 0; r < dims; r++) A[r][r] += 1e-9;
    const x = solve(A, b), angle = Math.hypot(x[0], x[1], x[2]), axis = angle ? [x[0] / angle, x[1] / angle, x[2] / angle] : [0, 0, 1], co = Math.cos(angle), si = Math.sin(angle), [kx, ky, kz] = axis;
    const R = [[co + kx * kx * (1 - co), kx * ky * (1 - co) - kz * si, kx * kz * (1 - co) + ky * si], [ky * kx * (1 - co) + kz * si, co + ky * ky * (1 - co), ky * kz * (1 - co) - kx * si], [kz * kx * (1 - co) - ky * si, kz * ky * (1 - co) + kx * si, co + kz * kz * (1 - co)]];
    const scale = rigid ? 1 : 1 + x[6], move = [x[3], x[4], x[5]];
    const step = {scale, R, t: [0, 1, 2].map(r => c[r] + move[r] - scale * (R[r][0] * c[0] + R[r][1] * c[1] + R[r][2] * c[2]))};
    T = compose(step, T);
    if (Math.abs(last - rms) < 1e-6 && angle < 1e-6) break;
    last = rms;
  }
  return T;
}

// How far the model stands from the scan, overall and element by element, in metres.
export function residuals(positions, grid, T, {sample = 200000} = {}) {
  const all = [], byElement = new Map(); let seen = 0;
  for (const i of every(positions.length / 3, sample)) {
    seen++;
    const hit = grid.nearest(apply(T, [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]));
    if (!hit) continue;
    all.push(hit.distance);
    if (!byElement.has(hit.element)) byElement.set(hit.element, []);
    byElement.get(hit.element).push(hit.distance);
  }
  const stats = list => { const s = [...list].sort((u, v) => u - v); return {points: s.length, median: quantile(s, .5), p90: quantile(s, .9), p99: quantile(s, .99)}; };
  return {seen, covered: all.length / Math.max(1, seen), ...stats(all), elements: [...byElement].map(([element, list]) => ({element, ...stats(list)})).sort((u, v) => v.p90 - u.p90)};
}
