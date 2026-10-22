#!/usr/bin/env node
// Checks a monument against its measured outline and draws the control plan.
//   node scripts/plan.mjs monuments/<id>.json
// Reads evidence.plan.outline (a JSON file: {"source", "url", "polygons": [[[x, z], …]], "lines": […]} in
// local metres, x east, z south, same origin as the model), writes <id>.evidence/plan.svg and prints the gap
// between the edges of the model seen from above and the edges of the outline, in metres.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname, join, basename, resolve} from 'node:path';
import {measurePlan} from './lib/plan.mjs';

const file = process.argv[2];
if (!file?.endsWith('.json')) { console.error('Usage: node scripts/plan.mjs monuments/<id>.json'); process.exit(1); }
const id = basename(file, '.json'), out = join(dirname(resolve(file)), `${id}.evidence`, 'plan.svg');
const {result, svg} = await measurePlan(resolve(file));
await mkdir(dirname(out), {recursive: true});
await writeFile(out, svg);
// The fit is recorded in evidence.plan.fit, shown by the viewer's evidence mode and checked by validate.mjs.
// The fit is written back into the file as it stands: a compact descriptor keeps its catalogue.
const text = await readFile(resolve(file), 'utf8'), d = JSON.parse(text), indent = /^\{\n( +)/.exec(text)?.[1].length ?? 1;
if (d.evidence?.plan) {
  d.evidence.plan.fit = {p90: result.p90, max: result.max, coverage: result.coverage, overflow: result.overflow};
  await writeFile(resolve(file), JSON.stringify(d, null, indent) + (text.endsWith('\n') ? '\n' : ''));
}
console.log(`${id}: gap to ${result.source}: p90 ${result.p90} m, max ${result.max} m, mean ${result.mean} m; the model covers ${Math.round(result.coverage * 100)}% of the outline and adds ${Math.round(result.overflow * 100)}% outside it`);
console.log(out);
