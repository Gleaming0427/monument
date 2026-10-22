#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {geometrySnapshot, stableSnapshot} from './lib/golden.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const baselineUrl = new URL('./fixtures/golden-models.json', import.meta.url);
const baselines = JSON.parse(await readFile(baselineUrl, 'utf8'));

// Golden changes are deliberately opt-in: the normal test only reports the reviewed diff. When a modeller has
// inspected that diff and the rendered buildings, this mode records the exact stable snapshots in one pass.
if (process.env.UPDATE_GOLDENS === '1') {
  for (const expected of Object.values(baselines.models)) expected.snapshot = stableSnapshot(await geometrySnapshot(`${root}/${expected.file}`));
  await writeFile(baselineUrl, `${JSON.stringify(baselines, null, 2)}\n`);
}

for (const [name, expected] of Object.entries(baselines.models)) test(`golden geometry: ${name}`, async () => {
  const snapshot = await geometrySnapshot(`${root}/${expected.file}`);
  assert.deepEqual(snapshot.unknownShapes, [], 'every emitted shape must have a registered geometry');
  for (const [shape, geometry] of Object.entries(snapshot.shapeGeometry)) assert.notEqual(geometry.type, 'BoxGeometry', `${shape} must not resolve to a box`);
  for (const column of snapshot.columnElements) {
    assert.ok(column.turned > 0, `column element ${column.index} must contain turned pieces`);
    assert.ok(column.turnedShare >= .75, `column element ${column.index} is only ${Math.round(column.turnedShare * 100)}% turned geometry`);
  }
  if (snapshot.id === 'parthenon') {
    assert.ok(snapshot.shapes.parthenonFlutedDrum >= 46, 'the Parthenon must keep a fluted shaft for every peristyle column');
    const flute = snapshot.shapeGeometry.parthenonFlutedDrum.curve;
    assert.equal(flute.flutes, 20, 'the Doric shaft must keep its twenty measured flutes');
    assert.ok(flute.radialSegments >= 120 && flute.radialSegments % 20 === 0, 'each flute must keep at least six samples at standard LOD');
    assert.ok(flute.chordErrorMm <= flute.maxChordErrorMm, 'the fluted shaft must respect its chord-error tolerance');
  }
  assert.deepEqual(stableSnapshot(snapshot), expected.snapshot,
    `generated geometry changed (built in ${snapshot.buildMs} ms); inspect the model, then update the reviewed baseline intentionally`);
});
