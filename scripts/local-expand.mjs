#!/usr/bin/env node
// Local helper, not part of the build: the dev server (serve.mjs) serves monument files as they are, but a
// community monument may be written in the compact `catalogue`/`use` form that only the build expands. This
// expands a community folder into a folder serve.mjs can read directly, so the same file can be captured
// locally without running the whole site build.
//   node scripts/local-expand.mjs <community dir> <out dir> <id>...
import {mkdir, readFile, writeFile, cp, rm} from 'node:fs/promises';
import {join, resolve, basename} from 'node:path';
import {expand} from './lib/compact.mjs';

const [dir, out, ...ids] = process.argv.slice(2);
if (!dir || !out || !ids.length) { console.error('Usage: node scripts/local-expand.mjs <community dir> <out dir> <id>...'); process.exit(1); }
const target = resolve(out);
await rm(target, {recursive: true, force: true});
await mkdir(target, {recursive: true});
for (const id of ids) {
  const from = resolve(dir, id), data = await readFile(join(from, 'monument.json'), 'utf8').then(JSON.parse);
  await writeFile(join(target, `${id}.json`), JSON.stringify(expand(data, id)));
  await cp(join(from, `${id}.bricks.js`), join(target, `${id}.bricks.js`));
  const evidence = join(from, `${id}.evidence`);
  await cp(evidence, join(target, `${id}.evidence`), {recursive: true}).catch(() => {});
  console.log(`${id}.json  ←  ${basename(from)}/monument.json`);
}