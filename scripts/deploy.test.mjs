#!/usr/bin/env node
// A deploy is one version. GitHub Pages lets a browser keep a file for ten minutes, so a visitor who came a few
// minutes before a deploy holds the old engine while the page, the monument file and its bricks are new. The site
// puts the deploy's stamp (?v=…) on every module URL so that the two are never mixed; a module that names another
// one without the stamp reaches the old copy from the cache: "The requested module '../kit/builder.js' does not
// provide an export named 'gothic'" on a phone, a scene that does not start, while every test at home passes
// because the dev server has no cache. This builds the site and reads the module graph the browser will walk.
import assert from 'node:assert/strict';
import test, {before, after} from 'node:test';
import {execFileSync} from 'node:child_process';
import {mkdtemp, readdir, readFile, rm, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url)), VERSION = 'feedc0de';
let folder, site;
// Relative specifiers of static imports, re-exports and dynamic imports, with their query if they carry one.
const imports = text => [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)(['"])(\.{1,2}\/[^'"]+\.js(?:\?[^'"]*)?)\1/g)].map(match => match[2]);
const modules = async dir => (await readdir(dir)).filter(name => name.endsWith('.js')).map(name => join(dir, name));
const exists = path => access(path).then(() => true, () => false);

before(async () => {
  folder = await mkdtemp(join(tmpdir(), 'monument-deploy-'));
  site = join(folder, '_site');
  execFileSync('node', [join(root, 'scripts', 'build-site.mjs'), '--out', site], {env: {...process.env, GITHUB_SHA: `${VERSION}0000000000000000000000000000`}, stdio: 'pipe'});
});
after(() => rm(folder, {recursive: true, force: true}));

test('the viewer page, every module of the kit and every bricks file name the other modules through the deploy\'s stamp', async () => {
  const page = await readFile(join(site, 'view', 'index.html'), 'utf8');
  assert.ok(page.includes(`kit/app.js?v=${VERSION}`) && page.includes(`kit/style.css?v=${VERSION}`), 'the viewer page loads its script and its style unstamped');
  let seen = 0;
  const files = [...await modules(join(site, 'view', 'kit')), ...(await modules(join(site, 'view', 'monuments'))).filter(file => file.endsWith('.bricks.js'))];
  assert.ok(files.length >= 7, `${files.length} modules read: the kit has five and three monuments bring bricks`);
  for (const file of files) {
    const dir = file.slice(0, file.lastIndexOf('/'));
    for (const specifier of imports(await readFile(file, 'utf8'))) {
      seen++;
      assert.ok(specifier.endsWith(`?v=${VERSION}`), `${file.slice(site.length)} imports ${specifier}, without the stamp: a browser that kept the old file for ten minutes will hand it to the new one`);
      assert.ok(await exists(join(dir, specifier.split('?')[0])), `${file.slice(site.length)} imports ${specifier}, which is not in the site`);
    }
  }
  assert.ok(seen >= 10, `${seen} imports read: the engine's own are seven and the bricks bring more`);
});

test('a bricks file reaches the engine at the very URL the viewer loaded it from: one engine, not two', async () => {
  const base = 'https://example.test/view/', viewer = new URL('./builder.js', `${base}kit/app.js?v=${VERSION}`);
  const app = imports(await readFile(join(site, 'view', 'kit', 'app.js'), 'utf8')).find(specifier => specifier.startsWith('./builder.js'));
  assert.ok(app, 'app.js does not import builder.js');
  const engine = new URL(app, `${base}kit/app.js?v=${VERSION}`).href;
  assert.equal(engine, `${viewer.href}?v=${VERSION}`);
  const bricks = (await readdir(join(site, 'view', 'monuments'))).filter(name => name.endsWith('.bricks.js'));
  let reached = 0;
  for (const name of bricks) for (const specifier of imports(await readFile(join(site, 'view', 'monuments', name), 'utf8')).filter(specifier => specifier.includes('/kit/builder.js'))) {
    reached++;
    assert.equal(new URL(specifier, `${base}monuments/${name}?v=${VERSION}`).href, engine, `${name} loads its own copy of the engine`);
  }
  assert.ok(reached >= 2, `${reached} bricks files import the engine: Coutances and the Parthenon do`);
});
