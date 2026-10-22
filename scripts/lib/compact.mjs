// Compact descriptors: a monument file may hoist the parts it repeats into a `catalogue` and let each element
// name the prototype it reuses. Expansion is exact — the expanded monument is the only thing the engine,
// the validator or the viewer ever sees, so compactness can never change the building.
//
//   "catalogue": {"peristyle": {"type": "doricTemple", "center": [0, 0], "spec": {…}}},
//   "elements": [{"use": "peristyle", "phase": "columns", "columns": 46}]
//
// Merge rules: plain objects merge key by key, arrays and scalars replace wholesale, `null` removes an
// inherited key. A prototype may itself start with `use`, which is how a family of variants stays readable.
import {readFile} from 'node:fs/promises';

const isPlain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const clone = value => (isPlain(value) ? merge({}, value) : value);

// base first, then the patch: an override keeps the prototype's position, so the expanded file still reads
// like the hand-written one it replaced.
export function merge(base, patch) {
  const out = isPlain(base) ? {...base} : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else if (isPlain(value) && isPlain(out[key])) out[key] = merge(out[key], value);
    else out[key] = clone(value);
  }
  return out;
}

// Resolve one name to a finished prototype, following inheritance and refusing a cycle with the chain that
// caused it: a loop is an authoring mistake the agent can fix from the message alone.
function prototype(name, catalogue, at, trail = []) {
  const key = typeof name === 'string' ? name : name?.use;
  if (typeof key !== 'string' || !key) throw new Error(`${at} needs "use": the name of a catalogue prototype`);
  if (!Object.hasOwn(catalogue, key)) {
    const known = Object.keys(catalogue);
    throw new Error(`${at} uses "${key}", which is not in the catalogue${known.length ? ` (${known.join(', ')})` : ' (the catalogue is empty)'}`);
  }
  if (trail.includes(key)) throw new Error(`${at} loops: ${[...trail, key].join(' → ')}`);
  const body = catalogue[key];
  if (!isPlain(body)) throw new Error(`${at}: catalogue "${key}" must be a JSON object`);
  const {use, ...own} = body;
  const base = use === undefined ? {} : prototype(use, catalogue, `${at} (catalogue "${key}")`, [...trail, key]);
  return merge(base, own);
}

export function expand(data, at = 'monument') {
  if (!isPlain(data)) throw new Error(`${at} must be a JSON object`);
  const {catalogue, elements, ...rest} = data;
  if (catalogue !== undefined && !isPlain(catalogue)) throw new Error(`${at}: "catalogue" must be a JSON object`);
  const book = catalogue ?? {};
  // Prototypes are resolved once: a family is a family, not a fresh copy per element.
  const cache = new Map();
  const resolved = name => {
    if (!cache.has(name)) cache.set(name, prototype(name, book, `${at}: catalogue "${name}"`));
    return cache.get(name);
  };
  if (elements !== undefined && !Array.isArray(elements)) throw new Error(`${at}: "elements" must be an array`);
  const list = (elements ?? []).map((entry, index) => {
    const where = `${at}: elements[${index}]`;
    if (typeof entry === 'string') return merge(resolved(entry), {});
    if (!isPlain(entry)) throw new Error(`${where} must be a string prototype name or a JSON object`);
    const {use, ...own} = entry;
    if (use === undefined) return own;
    let base;
    try { base = resolved(use); }
    catch {
      // Resolve once more against the element itself, so the message names the line to edit.
      prototype(use, book, where);
      throw new Error(`${where} could not use "${use}"`);
    }
    return merge(base, own);
  });
  return {...rest, elements: list};
}

// Read and expand in one step. Every script that opens a monument goes through here, so a compact file and a
// plain one are interchangeable everywhere else.
export async function readMonument(file) {
  return expand(JSON.parse(await readFile(file, 'utf8')), file);
}

// The compact source is what a modeller authors and what a reviewer reads; this is its honest size.
export const sourceBytes = file => readFile(file, 'utf8').then(text => Buffer.byteLength(text));
export const expandedBytes = data => Buffer.byteLength(`${JSON.stringify(data)}\n`);