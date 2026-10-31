#!/usr/bin/env node
// The contract of chronology validation: every monument of the collection tells its story in order today,
// and a film that stops doing so — a card waiting on a spire that is not up, moments listed backwards, phases
// out of date order — fails with a message that names the phase, the moment and the numbers.
import assert from 'node:assert/strict';
import test from 'node:test';
import {dirname, join, resolve} from 'node:path';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {loadEngine} from './lib/engine.mjs';
import {readMonument} from './lib/compact.mjs';
import {audit, startYear} from './lib/chronology.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const FILES = {
  'notre-dame-de-paris': 'examples/notre-dame-de-paris.json',
  'eiffel-tower': 'examples/eiffel-tower.json',
  'colosseum': 'examples/colosseum.json',
  'cathedrale-de-coutances': 'community/cathedrale-de-coutances/monument.json',
  'kinkaku-ji': 'community/kinkaku-ji/monument.json',
  'parthenon': 'community/parthenon/monument.json',
  'leaning-tower-of-pisa': 'examples/leaning-tower-of-pisa.json',
};

async function run(id, mutate) {
  const file = resolve(root, FILES[id]), data = await readMonument(file);
  if (mutate) mutate(data);
  const engine = await loadEngine(data.bricks ? resolve(dirname(file), data.bricks) : undefined);
  return audit(data, engine.buildPieces(data).pieces, engine, id);
}
const moment = (data, phase, title) => data.phases.find(p => p.id === phase).moments.find(m => m.title === title);

for (const id of Object.keys(FILES)) test(`${id} tells its story in order`, async () => {
  const {problems} = await run(id);
  assert.deepEqual(problems, []);
});

test('a card pinned on a spire that is not up yet is refused, with the time it belongs at', async () => {
  const {problems} = await run('notre-dame-de-paris', data => { moment(data, 'renaissance', 'The golden cock').at = .2; });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /“The golden cock” shows at 0\.2 with the nearest standing piece \d+\.\d m from its pin/);
  assert.match(problems[0], /belongs there or later/);
});

test('an anchor that is not on the building at all is refused', async () => {
  const {problems} = await run('colosseum', data => { moment(data, 'buttresses', 'Holding the broken ends').anchor = [-87.5, 14, -34.2]; });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /“Holding the broken ends”.*the anchor is off the building/);
});

test('a card where something has just come down is right; the same card elsewhere is not', async () => {
  const {problems} = await run('notre-dame-de-paris');
  assert.equal(problems.filter(problem => /The spire falls/.test(problem)).length, 0);
  const moved = await run('notre-dame-de-paris', data => { moment(data, 'incendie', 'The spire falls').anchor = [90, 50, 60]; });
  assert.equal(moved.problems.filter(problem => /The spire falls/.test(problem)).length, 1, moved.problems.join('\n'));
});

test('moments listed out of order are refused: the viewer would never show the earlier one', async () => {
  const {problems} = await run('eiffel-tower', data => { const top = data.phases.find(p => p.id === 'sommet'); top.moments.reverse(); });
  assert.ok(problems.some(problem => /is listed after one at/.test(problem)), problems.join('\n'));
});

test('a phase that begins before the one that comes first in the film is refused', async () => {
  const {problems} = await run('cathedrale-de-coutances', data => { [data.phases[4].when, data.phases[5].when] = ['c. 1270–1315', 'after 1228']; });
  assert.ok(problems.some(problem => /begins before/.test(problem)), problems.join('\n'));
});

test('a piece taken down in the phase that raises it is refused', async () => {
  const {problems} = await run('colosseum', data => { data.elements.find(e => e.until).until = data.elements.find(e => e.until).phase; });
  assert.ok(problems.some(problem => /taken down in the phase that raises them/.test(problem)), problems.join('\n'));
});

test('years are read from the way each monument writes its dates', () => {
  const years = Object.entries({
    'c. 70–79': 70, '80': 80, '15 April 2019': 2019, 'June 1944': 1944, 'After 1349': 1349, '1807 · 1827': 1807,
    '12th century': 1150, '3rd–4th century': 250, '480 BC': -480, 'c. 490–480 BC': -490, '5th century BC': -450, 'early 18th c. – 1843': 1750,
  });
  for (const [when, year] of years) assert.equal(startYear({when}), year, when);
  assert.equal(startYear({from: '1887-01-26', to: '1887-06-30'}), 1887);
  assert.equal(startYear({when: 'Since forever'}), null);
});

test('a disputed date says what it dates and gives two pages and two dates, or it is refused', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'monument-disputed-')), id = 'chateau-de-chambord', data = JSON.parse(await readFile(resolve(root, `examples/${id}.json`), 'utf8'));
  const a = 'https://fr.wikipedia.org/wiki/Ch%C3%A2teau_de_Chambord', b = 'https://www.chambord.org/fr/histoire/le-chateau/au-fil-de-lhistoire/';
  const validate = async disputed => {
    // The copy travels without its evidence folder, so without the masks its photos' cuts point to.
    const copy = structuredClone(data); copy.phases[0].disputed = disputed; for (const r of copy.evidence.references) delete r.silhouette;
    await writeFile(join(dir, `${id}.json`), JSON.stringify(copy));
    return promisify(execFile)(process.execPath, [resolve(root, 'scripts/validate.mjs'), join(dir, `${id}.json`)]).then(out => out.stdout + out.stderr, error => error.stdout + error.stderr);
  };
  try {
    assert.match(await validate([{what: 'the first stone', claims: [{when: '1519', source: a}, {when: '1520', source: b}]}]), /All monuments are valid/);
    assert.match(await validate([{claims: [{when: '1519', source: a}, {when: '1520', source: b}]}]), /disputed\[0\] needs "what"/);
    assert.match(await validate([{what: 'the first stone', claims: [{when: '1519', source: a}]}]), /needs at least two "claims"/);
    assert.match(await validate([{what: 'the first stone', claims: [{when: '1519', source: a}, {when: '1520', source: a}]}]), /each claim comes from a different page/);
    assert.match(await validate([{what: 'the first stone', claims: [{when: '1519', source: a}, {when: '1519', source: b}]}]), /the pages do not disagree/);
    assert.match(await validate({what: 'the first stone'}), /"disputed" must be a list/);
  } finally { await rm(dir, {recursive: true, force: true}); }
});
