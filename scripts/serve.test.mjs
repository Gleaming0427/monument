#!/usr/bin/env node
// The local viewer serves monuments from three places — the reader's own folder, the collection and the
// gallery — and hands each one to the kit exactly as the published site does. That last part is the one that
// bites: a monument stored packed (its elements inheriting through `use`) reaches the scene with no type and
// stops with "Unknown brick", while a monument that is simply absent stops with "hasn't been built yet". Two
// different failures with the same symptom, and neither was caught, so they are checked here.
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {spawn} from 'node:child_process';
import {mkdtemp, rm, readFile, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const serve = join(root, 'scripts', 'serve.mjs');

let folder, server, base;
const get = async path => {
  const response = await fetch(base + path);
  return {status: response.status, body: await response.text()};
};
// A gallery monument is a folder holding a monument.json; a collection monument is examples/<id>.json.
const gallery = async () => {
  const found = [];
  for (const id of await readdir(join(root, 'community'))) {
    if (await readFile(join(root, 'community', id, 'monument.json'), 'utf8').catch(() => null)) found.push(id);
  }
  return found;
};
const collection = async () => (await readdir(join(root, 'examples'))).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5));

before(async () => {
  // An empty folder, so the checks read the collection and the gallery rather than anything of the reader's.
  folder = await mkdtemp(join(tmpdir(), 'monument-serve-'));
  server = spawn(process.execPath, [serve, folder, '--port', '4189'], {stdio: ['ignore', 'pipe', 'inherit']});
  // The viewer steps to the next port if the one it was given is taken, so the port to ask is the one it says
  // it is on, never the one it was asked for.
  const port = await new Promise((done, fail) => {
    let said = '';
    server.stdout.on('data', chunk => {
      said += chunk;
      const found = /Monument viewer: http:\/\/127\.0\.0\.1:(\d+)\//.exec(said);
      if (found) done(Number(found[1]));
    });
    server.on('exit', () => fail(new Error('The local viewer stopped before it was ready.\nIt said:\n' + said)));
  });
  base = 'http://127.0.0.1:' + port;
});

after(async () => {
  server?.kill();
  await rm(folder, {recursive: true, force: true});
});

test('every monument the skill publishes can be opened locally', async () => {
  const ids = [...await collection(), ...await gallery()];
  assert.ok(ids.length, 'the collection should not be empty');
  for (const id of ids) {
    const {status, body} = await get('/monuments/' + id + '.json');
    assert.equal(status, 200, id + ': the local viewer does not serve it at all');
    const monument = JSON.parse(body);
    assert.equal(monument.id, id, id + ': served under the wrong name');
    assert.ok(monument.elements?.length, id + ': served with no elements');
    // The whole point: what the kit receives must be a finished monument, not a packed one. A packed element
    // inherits its type through `use` and reaches the scene as undefined — "Unknown brick: undefined".
    const untyped = monument.elements.filter(element => !element.type);
    assert.deepEqual(untyped, [], id + ': ' + untyped.length + ' element(s) reached the kit without a type — the file was served packed');
  }
});

test('a monument that brings its own bricks can load them', async () => {
  let checked = 0;
  for (const id of await gallery()) {
    const raw = await readFile(join(root, 'community', id, 'monument.json'), 'utf8').catch(() => null);
    if (!raw) continue;
    const bricks = JSON.parse(raw).bricks;
    if (!bricks) continue;
    checked++;
    const {status, body} = await get('/monuments/' + bricks);
    assert.equal(status, 200, id + ': its bricks file (' + bricks + ') is not served');
    // A bricks file is served at /monuments/<id>.bricks.js, and everything it imports by a relative path is
    // resolved against that URL — so a relative import has to reach the kit at ../kit/, or it looks one
    // folder too high and the module never loads. A bricks file may import nothing relative at all.
    for (const [, specifier] of body.matchAll(/from '([^']+)'/g)) {
      if (!specifier.startsWith('.')) continue;
      assert.ok(specifier.startsWith('../kit/'), id + ': its bricks import ' + specifier + ', which does not resolve to the kit from /monuments/');
    }
  }
  assert.ok(checked, 'no gallery monument brings its own bricks; this check would pass for the wrong reason');
});

test('the evidence a monument was checked against is served', async () => {
  let checked = 0;
  for (const id of await gallery()) {
    const outline = join(root, 'community', id, id + '.evidence', 'outline.json');
    const read = await readFile(outline, 'utf8').catch(() => null);
    if (read === null) continue;
    checked++;
    const served = await get('/monuments/' + id + '.evidence/outline.json');
    assert.equal(served.status, 200, id + ': its measured outline is not served');
  }
  assert.ok(checked, 'no gallery monument carries a measured outline; this check would pass for the wrong reason');
});

test('the kit and the viewer are still served', async () => {
  assert.equal((await get('/kit/builder.js')).status, 200);
  assert.equal((await get('/kit/style.css')).status, 200);
  assert.equal((await get('/')).status, 200);
});

test('a request cannot read outside the roots it is given', async () => {
  const escapes = ['/monuments/..%2f..%2fpackage.json', '/monuments/%2e%2e%2f%2e%2e%2fpackage.json', '/kit/..%2f..%2fpackage.json'];
  for (const path of escapes) assert.equal((await get(path)).status, 404, path + ' should not be served');
});