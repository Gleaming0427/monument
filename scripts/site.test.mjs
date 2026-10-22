#!/usr/bin/env node
// The site is three tabs of one page: Monument, Collection, Community. They are read as one document, so the
// content has to sit in the same column on all three — a tab that jumps sideways when you click it reads as
// three different sites. This checks the cause in the source; a browser check would only see the symptom.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const PAGES = [['Monument', 'index.html'], ['Collection', 'collection/index.html'], ['Community', 'community/index.html']];
const read = path => readFile(`${root}/site/${path}`, 'utf8');

test('every tab wraps its content in the same column', async () => {
  const widths = new Map();
  for (const [name, path] of PAGES) {
    const wrapper = /<main class="([^"]*)"/.exec(await read(path))?.[1];
    assert.ok(wrapper, `${name}: no <main class="…"> wrapper found in site/${path}`);
    widths.set(name, wrapper);
  }
  const distinct = new Set(widths.values());
  assert.equal(distinct.size, 1,
    `the tabs do not share one column: ${[...widths].map(([name, className]) => `${name}="${className}"`).join(', ')}`);
});

test('the width is declared once, so a tab cannot drift without changing it everywhere', async () => {
  const css = await read('site.css');
  const rules = [...css.matchAll(/^\.page\{([^}]*)\}/gm)].map(match => match[1]);
  assert.equal(rules.length, 1, `.page must be declared exactly once in site.css, found ${rules.length}`);
  assert.match(rules[0], /max-width:\d+px/, '.page must carry the shared max-width');
  // A second width modifier is exactly how the tabs drifted apart before.
  const modifiers = [...css.matchAll(/^\.([\w-]+)\{[^}]*max-width/gm)].map(match => match[1]);
  assert.deepEqual(modifiers.filter(name => name !== 'page'), [],
    `another class sets a max-width (${modifiers.join(', ')}); keep the content column on .page alone`);
});

test('the navigation is inside the column, so it moves with the content', async () => {
  for (const [name, path] of PAGES) {
    const html = await read(path);
    const main = html.indexOf('<main class='), nav = html.indexOf('<nav class="site"');
    assert.ok(main >= 0 && nav > main, `${name}: site/${path} must place the nav inside <main> to stay aligned`);
  }
});