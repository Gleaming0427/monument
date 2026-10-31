#!/usr/bin/env node
// Every monument stays as close to its reference photos as it was when they were last looked at. Each photo cut by
// scripts/silhouette.mjs (building, sky, and what says nothing) is held against the model's outline from the photo's
// calibrated viewpoint, in the state the photo shows: the share of building they have in common may not fall more
// than two points below what the reference records. A change that moves, shrinks, grows or loses part of a monument
// as the photos show it fails here, with the photo named; one that brings the model closer is recorded by rerunning
// scripts/silhouette.mjs --write. Name monuments to hold only them: node scripts/silhouette.test.mjs osaka-castle
import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {access, readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startViewer, openBrowser} from './lib/browser.mjs';
import {expand} from './lib/compact.mjs';
import {PAGE, referenceView} from './lib/silhouette.mjs';

const TOLERANCE = .02, only = process.argv.slice(2).filter(arg => !arg.startsWith('-'));
const root = fileURLToPath(new URL('..', import.meta.url));
const files = [
  ...(await readdir(join(root, 'examples'))).filter(name => name.endsWith('.json')).map(name => [name.slice(0, -5), join(root, 'examples', name), join(root, 'examples')]),
  ...(await readdir(join(root, 'community'), {withFileTypes: true})).filter(entry => entry.isDirectory()).map(entry => [entry.name, join(root, 'community', entry.name, 'monument.json'), join(root, 'community', entry.name)]),
];
const monuments = [];
for (const [id, file, dir] of files) {
  const d = expand(JSON.parse(await readFile(file, 'utf8').catch(() => 'null')) ?? {phases: [], elements: []}, id);
  const refs = (d.evidence?.references ?? []).map((r, i) => ({r, i})).filter(({r}) => Number.isFinite(r.silhouette?.iou));
  if (refs.length && (!only.length || only.includes(id))) monuments.push({id, d, dir, refs});
}

if (!only.length) test('the collection has photos cut for the outline test', () => assert.ok(monuments.length >= 5, `only ${monuments.length} monuments have a cut photo`));

test('every recorded cut has its mask beside the monument', async () => {
  for (const {id, dir, refs} of monuments) for (const {i} of refs) await access(join(dir, `${id}.evidence`, 'silhouette', `ref-${i}.png`)).catch(() => assert.fail(`${id}: reference ${i} records a silhouette but ${id}.evidence/silhouette/ref-${i}.png is missing`));
});

const viewer = await startViewer(join(root, 'examples'), 4199), browser = await openBrowser({width: 960, height: 600});
after(async () => { await browser.close(); viewer.stop(); });
for (const {id, d, refs} of monuments) test(`${id} keeps the outline its photos show`, async () => {
  await browser.open(`${viewer.base}?t=99&clean#${id}`);
  await browser.run(PAGE);
  const drifted = [];
  for (const {r, i} of refs) {
    const iou = await browser.run(`(async () => silhouette.compare(await silhouette.labelsOf('/monuments/${id}.evidence/silhouette/ref-${i}.png'), silhouette.outline(${JSON.stringify(referenceView(d, r))})).iou)()`);
    if (iou < r.silhouette.iou - TOLERANCE) drifted.push(`reference ${i} (${r.view ?? r.url}): ${Math.round(iou * 1000) / 10}% of the building in common with the photo, where ${Math.round(r.silhouette.iou * 1000) / 10}% was recorded; look at node scripts/silhouette.mjs --ref ${i}`);
  }
  assert.deepEqual(drifted, [], `${id} has moved away from its photos`);
});
