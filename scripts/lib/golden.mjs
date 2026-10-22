// Deterministic geometry snapshots for the small set of release-reference monuments. These are deliberately
// stricter than validate.mjs: a change to a generator must make the changed piece count, bounds or matrices
// visible in review instead of silently changing every monument that reuses the brick.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {loadEngine} from './engine.mjs';
import {expand} from './compact.mjs';

const round = (value, digits = 3) => +value.toFixed(digits);
const sorted = object => Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)));
const countBy = (items, key) => sorted(Object.fromEntries(Object.entries(Object.groupBy(items, key)).map(([name, list]) => [name, list.length])));

function transformedBounds(pieces) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const {matrix} of pieces) {
    const e = matrix.elements;
    for (const x of [-.5, .5]) for (const y of [-.5, .5]) for (const z of [-.5, .5]) {
      const point = [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]];
      point.forEach((value, axis) => { min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value); });
    }
  }
  return {min: min.map(value => round(value)), max: max.map(value => round(value))};
}

function digest(pieces) {
  const hash = createHash('sha256');
  for (const piece of pieces) {
    hash.update(`${piece.kind}|${piece.shape ?? 'box'}|${piece.phase}|${piece.until ?? ''}|${piece.element}|`);
    hash.update(piece.matrix.elements.map(value => round(value, 6)).join(','));
    hash.update('\n');
  }
  return hash.digest('hex').slice(0, 20);
}

export async function geometrySnapshot(file) {
  const path = resolve(file), folder = dirname(path), data = expand(JSON.parse(await readFile(path, 'utf8')), file);
  const engine = await loadEngine(data.bricks ? resolve(folder, data.bricks) : undefined);
  const started = performance.now(), {pieces, reliefs} = engine.buildPieces(data), buildMs = performance.now() - started;
  const shapes = countBy(pieces, piece => piece.shape ?? 'box');
  const unknownShapes = Object.keys(shapes).filter(shape => shape !== 'box' && !engine.SHAPES[shape]);
  const shapeGeometry = {};
  for (const shape of Object.keys(shapes).filter(shape => shape !== 'box')) {
    const geometry = engine.SHAPES[shape]();
    const curve = geometry.userData.adaptive;
    shapeGeometry[shape] = {type: geometry.type, vertices: geometry.attributes.position.count, ...(curve ? {curve: {...curve, chordErrorMm: round(engine.chordError(.5, curve.radialSegments) * 1000, 4)}} : {})};
    geometry.dispose();
  }
  const columnElements = data.elements.flatMap((element, index) => {
    if (element.type !== 'columns') return [];
    const own = pieces.filter(piece => piece.element === index), turned = own.filter(piece => piece.shape);
    return [{index, name: element.name ?? null, pieces: own.length, turned: turned.length, turnedShare: round(turned.length / Math.max(1, own.length), 4)}];
  });
  const fit = data.evidence?.plan?.fit;
  return {
    id: data.id,
    phases: data.phases.length,
    elements: data.elements.length,
    pieces: pieces.length,
    reliefs: reliefs.length,
    bounds: transformedBounds(pieces),
    shapes,
    shapeGeometry: sorted(shapeGeometry),
    columnElements,
    planFit: fit ? {p90: fit.p90, max: fit.max, coverage: fit.coverage, overflow: fit.overflow} : null,
    photoRms: (data.evidence?.references ?? []).map(reference => reference.calibration?.rms ?? null),
    digest: digest(pieces),
    unknownShapes,
    buildMs: round(buildMs, 1),
  };
}

export const stableSnapshot = ({buildMs, ...snapshot}) => snapshot;
