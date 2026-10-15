#!/usr/bin/env node
// Checks a monument against its measured outline and draws the control plan.
//   node scripts/plan.mjs monuments/<id>.json
// Reads evidence.plan.outline (a JSON file: {"source", "url", "polygons": [[[x, z], …]]} in local metres,
// x east, z south, same origin as the model), writes <id>.evidence/plan.svg and prints the gap in metres.
import {writeFile, mkdir} from 'node:fs/promises';
import {dirname, join, basename, resolve} from 'node:path';
import {measurePlan} from './lib/plan.mjs';

const file = process.argv[2];
if (!file?.endsWith('.json')) { console.error('Usage: node scripts/plan.mjs monuments/<id>.json'); process.exit(1); }
const id = basename(file, '.json'), out = join(dirname(resolve(file)), `${id}.evidence`, 'plan.svg');
const {result, svg} = await measurePlan(resolve(file));
await mkdir(dirname(out), {recursive: true});
await writeFile(out, svg);
console.log(`${id}: gap to ${result.source}: p90 ${result.p90} m, max ${result.max} m, mean ${result.mean} m, coverage ${Math.round(result.coverage * 100)}% of the outline`);
console.log(out);
