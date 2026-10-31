#!/usr/bin/env node
// A language is only done when the page reads as one language: every marker replaced, every key answered, and
// every link still landing on a file that exists. A missing translation has to stop the build — the one thing
// this must never do is quietly leave English in the middle of a French page.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile, readdir, stat, mkdtemp, rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join, dirname, resolve, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {expand} from './lib/compact.mjs';
import {checkTranslation, keys as i18nKeys, mergeMonument, render, translationSkeleton} from './lib/i18n.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = path => readFile(join(root, path), 'utf8');
const SOURCE_PAGES = ['site/index.html', 'site/collection/index.html', 'site/community/index.html'];
// The language of the site, read the same way the build reads it, so adding one is a line here and nowhere else.
const LANGUAGES = /const LANGUAGES = \[(.*?)\], SOURCE/s.exec(await read('scripts/build-site.mjs'))?.[1].match(/\{code: '(\w+)'/g).map(entry => /'(\w+)'/.exec(entry)[1]) ?? ['en', 'fr'];
const SOURCE = 'en';
const figuresOf = text => [...String(text).matchAll(/\d+/g)].map(match => match[0]);
const dictionaries = Object.fromEntries(await Promise.all(LANGUAGES.filter(code => code !== SOURCE).map(async code => [code, JSON.parse(await read(`i18n/site/${code}.json`))])));

// The keys the build and the application ask for without a marker: the text of a card, and the strings the
// viewer writes once it runs. Read from the code, so a new one cannot slip past a dictionary that never had it.
const literals = source => [...source.matchAll(/\b(?:t|say)\((?:dictionary, )?'([\w.]+)'/g)].map(match => match[1]);
const usedInCode = [...new Set([
  ...literals(await read('scripts/build-site.mjs')).filter(key => /^(card|gallery|viewer)\./.test(key)),
  ...literals(await read('kit/app.js')),
])];

test('every marker is well formed', async () => {
  for (const page of [...SOURCE_PAGES, 'kit/viewer.html']) {
    const {problems} = i18nKeys(await read(page));
    assert.deepEqual(problems, [], `${page}:`);
  }
});

test('every language answers every key, and answers nothing else', async () => {
  const used = new Set(usedInCode);
  for (const page of [...SOURCE_PAGES, 'kit/viewer.html']) for (const key of i18nKeys(await read(page)).keys) used.add(key);
  for (const [code, dictionary] of Object.entries(dictionaries)) {
    const missing = [...used].filter(key => !(key in dictionary));
    assert.deepEqual(missing, [], `${code}.json is missing: ${missing.join(', ')}`);
    const orphan = Object.keys(dictionary).filter(key => !used.has(key));
    assert.deepEqual(orphan, [], `${code}.json carries keys nothing asks for: ${orphan.join(', ')}`);
  }
  assert.ok(used.size > 100, `only ${used.size} keys found; the pages should carry far more than that`);
});

test('a missing key stops the build rather than leaving English behind', async () => {
  const html = await read('site/community/index.html');
  const dictionary = Object.fromEntries(i18nKeys(html).keys.map(key => [key, 'x']));
  delete dictionary['nav.community'];
  assert.throws(() => render(html, dictionary, 'fr'), /fr has no entry for nav\.community/);
});

test('a rendered page carries no marker and no broken tag', async () => {
  const code = LANGUAGES.find(language => language !== SOURCE), dictionary = dictionaries[code];
  for (const page of SOURCE_PAGES) {
    const out = render(await read(page), dictionary, code);
    assert.ok(!out.includes('data-i18n'), `${page}: a marker survived the render`);
    assert.match(out, new RegExp(`<html lang="${code}"`), `${page}: the language is not declared`);
    for (const tag of ['p', 'a', 'div', 'section', 'span']) {
      const open = (out.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? []).length, close = (out.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
      assert.equal(open, close, `${page}: ${open} <${tag}> against ${close} </${tag}>`);
    }
  }
});

// What a French reader takes for a page left in English: a line built from words that exist only in English. A
// marker forgotten on one heading or one example prompt leaves no trace in the build, so the rendered text is read.
const ENGLISH_ONLY = /\b(?:the|and|with|your|this|that|from|into|you|are|was|were|its|their|which|when|before|after)\b/gi;
const visibleText = html => {
  const attributes = [...html.matchAll(/\s(?:title|aria-label|alt|content)="([^"]*)"/g)].map(match => match[1]);
  const body = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, '\n');
  return [...body.split('\n'), ...attributes].map(line => line.replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
};
test('a translated page keeps no sentence in English', async () => {
  for (const [code, dictionary] of Object.entries(dictionaries)) {
    for (const page of SOURCE_PAGES) {
      const left = visibleText(render(await read(page), dictionary, code)).filter(line => new Set((line.match(ENGLISH_ONLY) ?? []).map(word => word.toLowerCase())).size >= 2);
      assert.deepEqual(left, [], `${code} ${page} still reads English: ${left.join(' | ')}`);
    }
  }
});

// The whole site, built and walked: a translated folder is one level deeper, so every relative link is a chance
// to point at nothing. This is the only check that would have caught it.
test('every built page links to something that exists', async () => {
  const out = await mkdtemp(join(tmpdir(), 'monument-i18n-'));
  try {
    execFileSync(process.execPath, [join(root, 'scripts', 'build-site.mjs'), '--out', out], {cwd: root, stdio: 'pipe'});
    const walk = async dir => {
      const found = [];
      for (const entry of await readdir(dir, {withFileTypes: true})) found.push(...(entry.isDirectory() ? await walk(join(dir, entry.name)) : [join(dir, entry.name)]));
      return found;
    };
    const pages = (await walk(out)).filter(file => file.endsWith('.html'));
    assert.equal(pages.length, 4 * LANGUAGES.length, `expected four pages in each of ${LANGUAGES.length} languages`);
    let checked = 0;
    for (const page of pages) {
      const html = await readFile(page, 'utf8'), declared = /<base href="([^"]+)"/.exec(html)?.[1];
      // A <base> is what the other relative references are measured against, not a reference itself.
      const base = resolve(dirname(page), declared ?? '.'), scannable = html.replace(/<base\b[^>]*>/, '');
      // A meta's content is a description as often as it is an address, so only the metas that name an image
      // are read as links; every other content= is prose.
      const urls = [...scannable.matchAll(/\s(?:href|src)="([^"]+)"/g)].map(match => match[1]);
      for (const meta of scannable.matchAll(/<meta\b[^>]*>/g)) {
        if (/\b(?:name|property)="(?:og:image|og:image:url|og:url|twitter:image)"/.test(meta[0])) urls.push(/\bcontent="([^"]+)"/.exec(meta[0])?.[1]);
      }
      for (const url of urls.filter(Boolean)) {
        if (/^(#|\/|https?:|mailto:|data:)/.test(url)) continue;
        const clean = url.split('#')[0].split('?')[0];
        if (!clean) continue;
        checked++;
        const target = resolve(base, clean);
        let found = true;
        try { const info = await stat(target); found = info.isFile() || info.isDirectory(); } catch { found = false; }
        assert.ok(found, `${relative(out, page)} points at ${url}, which is not in the build`);
      }
    }
    assert.ok(checked > 100, `only ${checked} relative links checked; the site should have far more`);
  } finally { await rm(out, {recursive: true, force: true}); }
});

test('each page declares its language and offers the others', async () => {
  const out = await mkdtemp(join(tmpdir(), 'monument-i18n-'));
  try {
    execFileSync(process.execPath, [join(root, 'scripts', 'build-site.mjs'), '--out', out], {cwd: root, stdio: 'pipe'});
    for (const source of SOURCE_PAGES) {
      const page = source.replace(/^site\//, '');            // the build lays them out without the source folder
      for (const code of LANGUAGES) {
        const built = await readFile(join(out, code === SOURCE ? '' : code, page), 'utf8');
        assert.match(built, new RegExp(`<html lang="${code}"`), `${code}/${page}: wrong lang`);
        const alternates = [...built.matchAll(/<link rel="alternate" hreflang="(\w+)" href="([^"]+)">/g)];
        assert.deepEqual(alternates.map(match => match[1]).sort(), [...LANGUAGES].sort(), `${code}/${page}: hreflang does not list every language`);
        for (const [, , href] of alternates) await stat(resolve(dirname(join(out, code === SOURCE ? '' : code, page)), href));
        const offered = [...built.matchAll(/<a class="lang"[^>]*href="([^"]+)"/g)].map(match => match[1]);
        assert.equal(offered.length, LANGUAGES.length, `${code}/${page}: the switcher offers ${offered.length} of ${LANGUAGES.length}`);
      }
    }
    // The viewer's shell is one application shared by every language: a translated one must point back at it
    // rather than carrying its own copy of the kit.
    for (const code of LANGUAGES) {
      const shell = await readFile(join(out, code === SOURCE ? '' : code, 'view', 'index.html'), 'utf8');
      const base = /<base href="([^"]+)"/.exec(shell)?.[1];
      assert.equal(base, code === SOURCE ? undefined : '../../view/', `${code}: the viewer shell needs a <base> onto the shared kit`);
      await stat(resolve(dirname(join(out, code === SOURCE ? '' : code, 'view', 'index.html')), base ?? '.', 'kit', 'app.js'));
      await stat(join(out, 'view', 'kit', 'i18n', `${code}.json`));
      // Every monument the site publishes, in this language too: the viewer asks for `<id>.<lang>.json`
      // before `<id>.json`, and a missing one silently drops the reader back into English.
      if (code !== SOURCE) {
        for (const monument of (await readdir(join(out, 'view', 'monuments'))).filter(name => name.endsWith('.json') && !name.endsWith(`.${code}.json`)))
          await stat(join(out, 'view', 'monuments', monument.replace(/\.json$/, `.${code}.json`)));
      }
    }
  } finally { await rm(out, {recursive: true, force: true}); }
});
// A translated viewer carries a <base> onto the shared kit, and every address that is not absolute is measured from
// it. Two of them are easy to get wrong, and both end the reader on the English site: the way home, and the
// address the viewer writes into the bar once a monument is open.
test('a translated viewer leads home to its own language and keeps its own address', async () => {
  const out = await mkdtemp(join(tmpdir(), 'monument-i18n-'));
  try {
    execFileSync(process.execPath, [join(root, 'scripts', 'build-site.mjs'), '--out', out], {cwd: root, stdio: 'pipe'});
    for (const code of LANGUAGES.filter(language => language !== SOURCE)) {
      const shell = await readFile(join(out, code, 'view', 'index.html'), 'utf8');
      const base = /<base href="([^"]+)"/.exec(shell)[1], brand = /<a href="([^"]+)" class="brand"/.exec(shell)[1];
      // On a project site (https://owner.github.io/project/), so that a link climbing one level too far leaves the project.
      const page = new URL(`${code}/view/`, 'https://owner.example/project/'), home = new URL(brand, new URL(base, page));
      assert.equal(home.pathname, `/project/${code}/`, `${code}: the brand of the viewer leads to ${home.href}`);
    }
  } finally { await rm(out, {recursive: true, force: true}); }
  const app = await read('kit/app.js'), calls = [...app.matchAll(/history\.(?:replaceState|pushState)\(([^;]*)\);/g)];
  assert.ok(calls.length > 0, 'the viewer writes its address through history');
  for (const [call, args] of calls) assert.match(args, /location\.pathname/, `${call} is measured from the <base>, not from the page`);
});

// A monument is written in every language the site publishes. The sentences around the evidence change; the
// evidence does not: a date, a measurement, a source URL and the order of the phases are the same whatever
// language reads them.
test('every monument is written in every language', async () => {
  const expanded = async (dir, id) => expand(await readFile(join(root, dir, id.endsWith('.json') ? id : 'monument.json'), 'utf8').then(JSON.parse), id);
  const found = [];
  for (const id of (await readdir(join(root, 'examples')).catch(() => [])).filter(name => name.endsWith('.json'))) found.push([id.slice(0, -5), () => expanded('examples', id)]);
  for (const id of (await readdir(join(root, 'community')).catch(() => []))) if (await read(`community/${id}/monument.json`).catch(() => null)) found.push([id, () => expanded(`community/${id}`, 'monument.json')]);
  assert.equal(found.length, 9, `expected nine monuments, found ${found.length}`);
  for (const code of LANGUAGES.filter(language => language !== SOURCE)) {
    for (const [id, load] of found) {
      const monument = await load(), file = join(root, 'i18n', 'monuments', code, `${id}.json`);
      if (!(await readFile(file, 'utf8').catch(() => null))) { assert.fail(`${code}/${id} has no translation`); return; }
      const translation = JSON.parse(await readFile(file, 'utf8'));
      const problems = checkTranslation(monument, translation, code);
      assert.deepEqual(problems.slice(0, 5), [], `${code}/${id}:`);
      // A skeleton still answers every slot: only a word-for-word copy of the source says nobody opened it.
      const untouched = JSON.stringify({...translation, _read: null}) === JSON.stringify({...translationSkeleton(monument), _read: null});
      assert.ok(!untouched, `${code}/${id} is still the English skeleton, word for word`);
      const merged = mergeMonument(monument, translation, code, id);
      assert.equal(merged.phases.length, monument.phases.length, `${code}/${id}: a phase was lost`);
      merged.phases.forEach((phase, i) => {
        // A date in numbers alone is the same in every language; one with words in it ("after 1930") is a phrase,
        // and what has to survive its translation is every figure.
        const said = monument.phases[i].when;
        if (/[A-Za-zÀ-ÿ]/.test(said)) assert.deepEqual(figuresOf(phase.when), figuresOf(said), `${code}/${id}: ${phase.id} lost a figure of its date`);
        else assert.equal(phase.when, said, `${code}/${id}: ${phase.id} lost its date`);
        assert.equal(phase.source, monument.phases[i].source, `${code}/${id}: ${phase.id} lost its source`);
        // The dates the pages disagree on keep their pages, and their figures through the words around them.
        const disputes = [[monument.phases[i].disputed, phase.disputed], ...(monument.phases[i].moments ?? []).map((moment, j) => [moment.disputed, phase.moments[j].disputed])];
        for (const [said, put] of disputes) (said ?? []).forEach((dispute, k) => dispute.claims.forEach((claim, c) => {
          const kept = put[k].claims[c];
          assert.equal(kept.source, claim.source, `${code}/${id}: ${phase.id} lost the page of a disputed date`);
          assert.deepEqual(figuresOf(kept.when), figuresOf(claim.when), `${code}/${id}: ${phase.id} changed a disputed date`);
          assert.ok(put[k].what && put[k].what !== dispute.what, `${code}/${id}: ${phase.id} left what a disputed date dates in English`);
        }));
      });
      assert.equal(merged.elements.length, monument.elements.length, `${code}/${id}: the geometry changed`);
    }
  }
});

test('what a disputed date dates is translated; its pages and its numbers are not', () => {
  const claims = [{when: '1650', source: 'https://a.example/'}, {when: '7 November 1660', source: 'https://b.example/'}];
  const monument = {name: 'X', phases: [{id: 'p', when: '1650–1700', title: 'T', text: 'Text.', source: 'https://a.example/', disputed: [{what: 'the first stay', claims}],
    moments: [{tag: 'Anecdote', title: 'M', text: 'Moment.', disputed: [{what: 'the last stay', claims}]}]}], elements: []};
  const skeleton = translationSkeleton(monument);
  assert.deepEqual(skeleton.phases.p.disputed, [{what: 'the first stay', claims: [{}, {when: '7 November 1660'}]}]);
  assert.deepEqual(skeleton.phases.p.moments[0].disputed, [{what: 'the last stay', claims: [{}, {when: '7 November 1660'}]}]);
  const translation = {name: 'X', phases: {p: {title: 'T', text: 'Texte.', disputed: [{what: 'le premier séjour', claims: [{}, {when: '7 novembre 1660'}]}],
    moments: [{tag: 'Anecdote', title: 'M', text: 'Moment.', disputed: [{what: 'le dernier séjour', claims: [{}, {when: '7 novembre 1660'}]}]}]}}};
  assert.deepEqual(checkTranslation(monument, translation, 'fr'), []);
  const merged = mergeMonument(monument, translation, 'fr', 'x');
  assert.deepEqual(merged.phases[0].disputed, [{what: 'le premier séjour', claims: [claims[0], {...claims[1], when: '7 novembre 1660'}]}]);
  assert.equal(merged.phases[0].moments[0].disputed[0].what, 'le dernier séjour');
  // A slot left out stops the merge, and a figure lost in a translated date is named.
  const missing = structuredClone(translation); delete missing.phases.p.moments[0].disputed;
  assert.throws(() => mergeMonument(monument, missing, 'fr', 'x'), /moments\[0\]\.disputed\[0\]\.what/);
  const changed = structuredClone(translation); changed.phases.p.disputed[0].claims[1].when = '8 novembre 1660';
  assert.match(checkTranslation(monument, changed, 'fr').join('\n'), /disputed\[0\]\.claims\[1\]\.when: figures/);
});
