#!/usr/bin/env node
// The contract of architectural validation: the Parthenon matches its sources today, and a model that stops
// matching them fails with a message that names the quantity, both numbers and the source it contradicts.
import assert from 'node:assert/strict';
import test from 'node:test';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadEngine} from './lib/engine.mjs';
import {readMonument} from './lib/compact.mjs';
import {audit, compare, measure, probeNames} from './lib/architecture.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const file = resolve(root, 'community/parthenon/monument.json');

async function build(mutate) {
  const data = await readMonument(file);
  if (mutate) mutate(data);
  const engine = await loadEngine(resolve(dirname(file), data.bricks));
  return {data, pieces: engine.buildPieces(data).pieces};
}

const templeSpec = (data, id = 0) => data.elements.filter(element => element.type === 'doricTemple')[id].spec;
const templeColumns = data => Object.assign(templeSpec(data).columns, templeSpec(data, 1).columns);

test('the reference temple matches every figure its sources give', async () => {
  const {data, pieces} = await build();
  const rows = audit(data.evidence.measurements, pieces, 'parthenon');
  assert.ok(rows.length >= 15, `expected a full set of sourced measurements, found ${rows.length}`);
  for (const row of rows) assert.ok(row.ok, `${row.quantity}: measured ${row.measured}, source says ${row.expect}`);
});

test('every measurement names the source it was read from', async () => {
  const {data, pieces} = await build();
  for (const row of audit(data.evidence.measurements, pieces, 'parthenon')) {
    assert.ok(/^https?:/.test(row.source), `${row.quantity} must cite an http source`);
  }
});

test('an unknown probe or an undeclared quantity is refused, not ignored', async () => {
  const {pieces} = await build();
  assert.throws(() => measure('no-such-probe', pieces, 'parthenon'), /no probe called "no-such-probe"/);
  const observed = measure('doric-peristyle', pieces, 'parthenon');
  assert.equal(compare({quantity: 'columnCount.nowhere', expect: 4}, observed).ok, false);
  assert.match(compare({quantity: 'columnCount.nowhere', expect: 4}, observed).reason, /no probe measured/);
});

test('a range accepts a model inside it and refuses one outside', () => {
  const observed = {d: {value: 11, unit: null}};
  assert.equal(compare({quantity: 'd', expect: [10, 12]}, observed).ok, true);
  assert.equal(compare({quantity: 'd', expect: [12, 14]}, observed).ok, false);
});

// Each of these is a monument quietly stopping matching its evidence: a bay one centimetre out, a shaft a
// centimetre thinner, a column gone, a drum count off. None of them throws; all of them must be caught.
const REGRESSIONS = [
  ['the interaxial bay drifts', data => { templeColumns(data).spacing = 4.4; }, 'spacing.flank'],
  ['the corner bay opens back up', data => { templeColumns(data).cornerSpacing = 4.296; }, 'spacing.flankCornerBay'],
  ['the shaft thins', data => { const columns = templeColumns(data); columns.diameter = 1.95; columns.corner = 1.95; }, 'column.diameter.flank'],
  ['the corner refinement is lost', data => { templeColumns(data).corner = templeColumns(data).diameter; }, 'column.diameter.corner'],
  ['the column stands a centimetre too short', data => { templeColumns(data).height = 10.33; }, 'column.height'],
  ['the stylobate is straightened', data => { templeSpec(data).curvature = [0, 0]; }, 'column.bedRise.flank'],
  ['the lean is straightened away', data => { templeColumns(data).lean = 0; }, 'column.lean'],
  ['the drums are re-laid in four', data => { templeColumns(data).drums = 4; }, 'column.drumCount'],
  ['a flank loses a column', data => {
    const columns = templeColumns(data);
    columns.flank = 16;
  }, 'columnCount.face.n'],
];

test('a model that stops matching its sources fails, and says how', async () => {
  assert.ok(probeNames().length, 'there must be at least one probe');
  for (const [what, mutate, quantity] of REGRESSIONS) {
    const {data, pieces} = await build(mutate);
    const rows = audit(data.evidence.measurements, pieces, 'parthenon');
    const failed = rows.filter(row => !row.ok);
    assert.ok(failed.length, `${what}: nothing failed, so the checker is not watching this`);
    assert.ok(failed.some(row => row.quantity === quantity),
      `${what}: expected ${quantity} to fail, got ${failed.map(row => `${row.quantity} (${row.measured} vs ${row.expect})`).join(', ')}`);
    for (const row of failed) assert.ok(/^https?:/.test(row.source), `${row.quantity} must name the source it contradicts`);
  }
});

test('the checker never mutates the monument it was given', async () => {
  const data = await readMonument(file), before = JSON.stringify(data);
  const {pieces} = await build();
  audit(data.evidence.measurements, pieces, 'parthenon');
  assert.equal(JSON.stringify(data), before);
});