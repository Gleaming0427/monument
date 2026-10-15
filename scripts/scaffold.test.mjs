#!/usr/bin/env node
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createDraft, extractRing, parseOsmWays, selectOsmWay, selectResult} from './lib/scaffold.mjs';
import {loadEngine} from './lib/engine.mjs';
import {measurePlan} from './lib/plan.mjs';

const palace = {
  osm_type: 'way', osm_id: 42, name: 'Palais consulaire de Toulouse',
  display_name: 'Palais consulaire de Toulouse, Toulouse, Haute-Garonne, France',
  category: 'building', type: 'civic', address: {city: 'Toulouse', country: 'France'},
  extratags: {'building:levels': '4', height: '21 m'},
  geojson: {type: 'Polygon', coordinates: [[
    [1.44000, 43.60000], [1.44042, 43.60004], [1.44046, 43.59972], [1.44008, 43.59968], [1.44000, 43.60000],
  ]]},
};
const decoy = {...palace, name: 'Maison voisine', display_name: 'Maison voisine, Toulouse', geojson: {type: 'Point', coordinates: [1.44, 43.6]}};
assert.equal(selectResult([decoy, palace], 'Palais consulaire de Toulouse').osm_id, 42);
const ring = extractRing(palace.geojson);
assert.equal(ring.length, 4);
const draft = createDraft({query: 'Palais consulaire de Toulouse, Toulouse, France', result: palace, ring});
assert.equal(draft.id, 'palais-consulaire-de-toulouse');
assert.equal(draft.evidence.generated.family, 'civic');
assert.equal(draft.view.height, 21);
assert.ok(draft.elements.some(element => element.type === 'footprintBuilding'));

const xml = `<?xml version="1.0"?><osm>
<node id="1" lat="43.6" lon="1.44"/><node id="2" lat="43.6" lon="1.4401"/><node id="3" lat="43.5999" lon="1.4401"/><node id="4" lat="43.5999" lon="1.44"/>
<way id="9"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="1"/><tag k="building" v="yes"/><tag k="name" v="Palais consulaire de Toulouse"/></way></osm>`;
const way = selectOsmWay(parseOsmWays(xml), 'Palais consulaire de Toulouse', [1.44005, 43.59995]);
assert.equal(way.id, '9');

const {buildPieces} = await loadEngine();
assert.ok(buildPieces(draft).pieces.length > 100, 'the generated draft should contain a detailed visible shell');

const folder = await mkdtemp(join(tmpdir(), 'monument-scaffold-test-'));
const evidence = join(folder, `${draft.id}.evidence`), file = join(folder, `${draft.id}.json`);
await mkdir(evidence);
await writeFile(file, JSON.stringify(draft));
await writeFile(join(evidence, 'outline.json'), JSON.stringify({source: 'test outline', polygons: [draft.elements.find(element => element.points).points]}));
const {result} = await measurePlan(file);
assert.ok(result.p90 <= 1.5, `generated shell should fit the downloaded outline (p90 ${result.p90} m)`);
assert.ok(result.coverage >= .8, `generated shell should cover the downloaded outline (${result.coverage})`);
console.log(`scaffold: family, OSM fallback, detailed shell and plan fit pass (p90 ${result.p90} m)`);
