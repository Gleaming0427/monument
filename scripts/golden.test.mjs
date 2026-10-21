#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {geometrySnapshot, stableSnapshot} from './lib/golden.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const baselines = JSON.parse(await readFile(new URL('./fixtures/golden-models.json', import.meta.url), 'utf8'));

for (const [name, expected] of Object.entries(baselines.models)) test(`golden geometry: ${name}`, async () => {
  const snapshot = await geometrySnapshot(`${root}/${expected.file}`);
  assert.deepEqual(snapshot.unknownShapes, [], 'every emitted shape must have a registered geometry');
  for (const [shape, geometry] of Object.entries(snapshot.shapeGeometry)) assert.notEqual(geometry.type, 'BoxGeometry', `${shape} must not resolve to a box`);
  for (const column of snapshot.columnElements) {
    assert.ok(column.turned > 0, `column element ${column.index} must contain turned pieces`);
    assert.ok(column.turnedShare >= .75, `column element ${column.index} is only ${Math.round(column.turnedShare * 100)}% turned geometry`);
  }
  if (snapshot.id === 'parthenon') {
    assert.ok(snapshot.shapes.parthenonFlutedDrum >= 1000, 'the Parthenon must keep its individually fluted shaft drums');
    assert.ok(snapshot.shapeGeometry.parthenonFlutedDrum.vertices >= 1000, 'the fluted shaft profile must keep a smooth circular envelope');
  }
  assert.deepEqual(stableSnapshot(snapshot), expected.snapshot,
    `generated geometry changed (built in ${snapshot.buildMs} ms); inspect the model, then update the reviewed baseline intentionally`);
});
