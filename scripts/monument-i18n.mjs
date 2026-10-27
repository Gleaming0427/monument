#!/usr/bin/env node
// The words of a monument, in every language it is published in. The English stays in the monument file;
// each other language is a translation beside it, and the build will not publish a timeline with a slot left
// in the source language.
//
//   node scripts/monument-i18n.mjs skeletons <language>   write the English skeleton for what has no translation yet
//   node scripts/monument-i18n.mjs missing <language>      what still has no translation at all
//   node scripts/monument-i18n.mjs check [<language>]     every slot filled, every figure preserved
import {readFile, writeFile, readdir, mkdir, access} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {expand} from './lib/compact.mjs';
import {checkTranslation, mergeMonument, translationSkeleton} from './lib/i18n.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const exists = path => access(path).then(() => true, () => false);

// Every monument the site publishes, already expanded: a compact file is only ever the source, and the
// numbers a translation has to preserve are in the expanded one.
async function monuments() {
  const found = [];
  for (const id of (await readdir(join(root, 'examples')).catch(() => []))) {
    if (id.endsWith('.json')) found.push([id.slice(0, -5), join(root, 'examples', id)]);
  }
  for (const id of (await readdir(join(root, 'community')).catch(() => []))) {
    const dir = join(root, 'community', id);
    if (await exists(join(dir, 'monument.json'))) found.push([id, join(dir, 'monument.json')]);
  }
  return Promise.all(found.map(async ([id, path]) => [id, expand(await json(path), id)]));
}
// The site's languages are declared once, in the build; reading them from there keeps a single list.
const languages = async () => [.../const LANGUAGES = \[(.*?)\], SOURCE/s.exec(await readFile(join(root, 'scripts', 'build-site.mjs'), 'utf8'))[1].matchAll(/code: '(\w+)'/g)].map(match => match[1]);

// The line under a card of the collection is written once, in site/collection.json: it is the one piece of a
// monument's words that is not in the monument file, so a translation of a collection monument carries it too.
const blurbs = Object.fromEntries((await json(join(root, 'site', 'collection.json'))).map(({id, blurb}) => [id, blurb]));
const [command, language, only] = process.argv.slice(2), every = (await monuments()).filter(([id]) => !only || id === only), others = (await languages()).filter(code => code !== 'en');
if (command === 'skeletons') {
  const folder = join(root, 'i18n', 'monuments', language);
  await mkdir(folder, {recursive: true});
  for (const [id, monument] of every) {
    const file = join(folder, `${id}.json`);
    if (await exists(file)) { console.log(`${id}: déjà traduit`); continue; }
    await writeFile(file, `${JSON.stringify(translationSkeleton(monument, {blurb: blurbs[id]}), null, 2)}\n`);
    console.log(`${id}: squelette écrit (anglais à traduire)`);
  }
} else if (command === 'missing') {
  for (const [id] of every) if (!(await exists(join(root, 'i18n', 'monuments', language, `${id}.json`)))) console.log(id);
} else if (command === 'check') {
  let problems = 0;
  for (const code of language ? [language] : others) {
    for (const [id, monument] of every) {
      const file = join(root, 'i18n', 'monuments', code, `${id}.json`);
      if (!(await exists(file))) { console.log(`${code}/${id}: aucune traduction`); problems++; continue; }
      const translation = await json(file);
      const found = checkTranslation(monument, translation, code, {blurb: blurbs[id]});
      if (found.length) { console.log(`${code}/${id}:`); for (const problem of found.slice(0, 6)) console.log(`  ${problem}`); problems += found.length; }
      else {
        try { mergeMonument(monument, translation, code, id); console.log(`${code}/${id}: ${monument.phases.length} phases, tout est traduit`); }
        catch (error) { console.log(error.message); problems++; }
      }
    }
  }
  // Un English skeleton still answers every slot, so completeness alone cannot tell a translation from a
  // file nobody opened. A translation identical to the source, word for word, is exactly that.
  if (!problems) console.log('\nToutes les traductions sont complètes.');
  else process.exitCode = 1;
} else {
  console.error('Usage: node scripts/monument-i18n.mjs skeletons|missing|check [language]');
  process.exit(1);
}