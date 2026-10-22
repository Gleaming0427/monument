#!/usr/bin/env node
// Compact catalogue: hoist what a monument file repeats, keep what it means.
//
//   node scripts/catalogue.mjs monuments/parthenon.json              print the expanded monument
//   node scripts/catalogue.mjs monuments/parthenon.json --pack       write a compact descriptor
//   node scripts/catalogue.mjs monuments/parthenon.json --stats      report the honest size difference
//
// Packing is a proposal, never a silent edit: it refuses to return anything that does not expand back to the
// exact monument it started from, so a compact file stays reviewable like any other change.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {expand} from './lib/compact.mjs';

const stable = value => JSON.stringify(value ?? null);
const pick = (object, keys) => Object.fromEntries(Object.entries(object).filter(([key]) => keys.includes(key)));
const omit = (object, keys) => Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));

// The keys every member of a group already agrees on.
function commonKeys(elements) {
  if (elements.length < 2) return [];
  const keys = [...new Set(elements.flatMap(element => Object.keys(element)))];
  return keys.filter(key => new Set(elements.map(element => stable(element[key]))).size === 1);
}

// A prototype is only worth its own line if it is short to write and says something. A variant is named after
// the keys that tell its members apart — `doricTemple#phase+until` reads; `doricTemple#7` does not.
function nameFor(base, keys, taken) {
  const telling = keys.filter(key => key !== 'type' && key !== 'use').sort();
  if (telling.length) {
    const name = `${base}#${telling.join('+').slice(0, 32)}`;
    if (!taken.has(name)) return name;
  }
  for (let i = 2; ; i++) if (!taken.has(`${base}#${i}`)) return `${base}#${i}`;
}

// `use` is the lineage the packer itself maintains: it is never hoisted, and a packed element's brick type
// lives in its prototype rather than beside it.
const effectiveType = (element, book) => {
  for (let guard = 0; guard < 64 && element?.use; guard++) {
    const parent = book[element.use];
    if (!parent) break;
    if (parent.type) return parent.type;
    element = parent;
  }
  return element?.type;
};

// Every set of one or two keys that at least two members repeat, scored by the bytes it actually removes.
// Members are clustered only inside one lineage: a variant always hangs off the prototype its members already
// use, so the catalogue stays a tree and no intermediate prototype is ever orphaned.
// Bytes a hoist really removes: every member stops carrying the key inline and gains a `use` reference, and
// the prototype itself has to be written once. A prototype that cannot pay for its own name is not one.
function hoistingGain(members, keys, nameLength) {
  const inline = keys.reduce((sum, key) => sum + key.length + stable(members[0][key]).length + 4, 0);
  return members.length * inline - (inline + 40 + nameLength) - members.length * (nameLength + 8);
}

function bestCluster(members, minSize, base) {
  let best = null;
  const lineages = new Map();
  for (const member of members) {
    const key = member.use ?? '';
    if (!lineages.has(key)) lineages.set(key, []);
    lineages.get(key).push(member);
  }
  for (const [use, cohort] of lineages) {
    const present = cohort.filter(member => Object.keys(member.own).length > 0);
    const keys = [...new Set(present.flatMap(member => Object.keys(member.own)))].filter(key => key !== 'use');
    const repeated = keys.filter(key => present.filter(member => stable(member.own[key]) !== stable(undefined)).length >= 2);
    const consider = candidateKeys => {
      const nameLength = base.length + 2 + candidateKeys.join('+').length;
      const sharing = new Map();
      for (const member of present) {
        const values = candidateKeys.map(key => stable(member.own[key]));
        if (values.some(value => value === stable(undefined))) continue;
        const signature = JSON.stringify(values);
        if (!sharing.has(signature)) sharing.set(signature, []);
        sharing.get(signature).push(member);
      }
      for (const group of sharing.values()) {
        // A variant must speak for a real part of the family. A pair that happens to match in three elements
        // out of thirty-six is noise, and a catalogue full of noise is worse than a long file.
        if (group.length < minSize) continue;
        const gain = hoistingGain(group.map(member => member.own), candidateKeys, nameLength);
        if (gain <= 0) continue;
        if (!best || gain > best.gain) best = {keys: candidateKeys, members: group, use, gain};
      }
    };
    for (const key of repeated) consider([key]);
    for (let i = 0; i < repeated.length; i++) for (let j = i + 1; j < repeated.length; j++) consider([repeated[i], repeated[j]]);
  }
  return best;
}

// One prototype per brick type for what the whole group shares, then one variant per block of elements that
// agree on more. Anything only one element says stays in that element, in the author's own words.
export function pack(data, {at = 'monument', verify = true, depth = 2} = {}) {
  const {catalogue = {}, elements = [], ...rest} = data;
  if (!Array.isArray(elements)) throw new Error(`${at}: "elements" must be an array`);
  // A file that already names its prototypes has been packed once. Packing it again could only rename the
  // prototypes a human chose, so the tool says so instead of rewriting names nobody asked it to touch.
  if (Object.keys(catalogue).length) throw new Error(`${at} already uses a catalogue (${Object.keys(catalogue).join(', ')}); expand it first to pack it again`);
  const book = {...catalogue}, taken = new Set(Object.keys(book)), result = new Array(elements.length);

  const groups = new Map();
  elements.forEach((element, index) => {
    const type = effectiveType(element, book);
    groups.set(type, [...(groups.get(type) ?? []), {index, element}]);
  });

  for (const [type, entries] of groups) {
    // Nothing to hoist for a single element: the element stays exactly as its author wrote it.
    if (entries.length < 2) {
      for (const entry of entries) result[entry.index] = entry.element;
      continue;
    }
    const shared = commonKeys(entries.map(entry => entry.element)).filter(key => key !== 'use');
    const parent = shared.length && hoistingGain(entries.map(entry => entry.element), shared, type.length) > 0
      ? (taken.add(type), book[type] = pick(entries[0].element, shared), type)
      : null;
    // Only a prototype that exists may take the shared keys out of its members.
    const hoisted = parent ? shared : [];
    // An element that already named a prototype keeps pointing at it: packing may add a variant below that
    // link, but it never re-parents a hand-authored `use`.
    const left = entries.map(entry => ({index: entry.index, own: omit(entry.element, hoisted), use: entry.element?.use ?? parent, level: entry.element?.use ? 0 : 1}));
    // Two members out of thirty-six sharing a value is chance, not a family. Require a real share of the
    // group, and stop descending once the catalogue is deep enough for a human to hold in mind.
    const minSize = Math.max(2, Math.ceil(entries.length * .25));
    for (let cluster; (cluster = bestCluster(left.filter(member => member.level < depth), minSize, type)); ) {
      const name = nameFor(type, cluster.keys, taken);
      taken.add(name);
      book[name] = {...cluster.use ? {use: cluster.use} : {}, ...pick(cluster.members[0].own, cluster.keys)};
      for (const member of cluster.members) {
        member.own = omit(member.own, cluster.keys);
        member.use = name;
        member.level++;
      }
    }
    for (const member of left) result[member.index] = member.use ? {use: member.use, ...member.own} : member.own;
  }

  const packed = {...rest, ...(Object.keys(book).length ? {catalogue: book} : {}), elements: result};
  if (verify) assert.deepEqual(expand(packed, at), expand(data, at), 'packing changed the monument');
  return packed;
}

export const prettyBytes = value => Buffer.byteLength(`${JSON.stringify(value, null, 2)}\n`);
// Four characters per token is the usual English rule of thumb for BPE tokenizers. It is an estimate and is
// labelled as one: the exact figure depends on the tokenizer reading the file, not on this script.
export const estimateTokens = bytes => Math.round(bytes / 4);

// The size report is the honest part of this tool: it is what decides whether the compact form is worth
// keeping, and it says where the bytes that remain are spent.
export function stats(data, {at = 'monument'} = {}) {
  const {elements = [], phases = [], evidence, catalogue = {}, ...head} = data;
  const section = (label, value) => ({label, bytes: prettyBytes(value)});
  // A file that is already compact is reported, not refused: its flat size is the number worth comparing with.
  const packed = Object.keys(catalogue).length ? data : pack(data, {at});
  const before = prettyBytes(expand(data, at)), after = prettyBytes(packed);
  return {
    packed, before, after,
    prototypes: Object.keys(packed.catalogue ?? {}).length,
    alreadyCompact: Object.keys(catalogue).length > 0,
    saved: before - after,
    percent: before ? ((before - after) / before) * 100 : 0,
    tokensBefore: estimateTokens(before),
    tokensAfter: estimateTokens(after),
    sections: [
      section('elements', packed.elements ?? []),
      section('catalogue', packed.catalogue ?? {}),
      section('phases', packed.phases ?? []),
      section('evidence', packed.evidence ?? {}),
      section('header', Object.fromEntries(Object.entries(packed).filter(([key]) => !['elements', 'catalogue', 'phases', 'evidence'].includes(key)))),
    ].sort((a, b) => b.bytes - a.bytes),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const file = process.argv[2];
  if (!file || file.startsWith('--')) {
    console.error('Usage: node scripts/catalogue.mjs <monument.json> [--pack] [--stats] [--out file]');
    process.exit(1);
  }
  const flag = name => process.argv.includes(`--${name}`);
  const outIndex = process.argv.indexOf('--out');
  const data = JSON.parse(await readFile(file, 'utf8'));

  if (flag('pack') || flag('stats')) {
    const report = stats(data, {at: file});
    const {packed, before, after, prototypes, percent, tokensBefore, tokensAfter, sections} = report;
    if (flag('pack')) {
      const target = outIndex < 0 ? file : process.argv[outIndex + 1];
      await writeFile(target, `${JSON.stringify(packed, null, 2)}\n`);
      console.log(`${target}: ${(before / 1024).toFixed(1)}KB → ${(after / 1024).toFixed(1)}KB (−${percent.toFixed(0)}%)`);
    }
    console.log(`  elements   ${(prettyBytes(data.elements) / 1024).toFixed(1)}KB → ${(prettyBytes(packed.elements) / 1024).toFixed(1)}KB`);
    console.log(`  catalogue  ${(prettyBytes(Object.values(packed.catalogue ?? {})) / 1024).toFixed(1)}KB in ${prototypes} prototypes`);
    console.log(`  file       ${(before / 1024).toFixed(1)}KB → ${(after / 1024).toFixed(1)}KB (−${percent.toFixed(0)}%)`);
    console.log(`  ~tokens    ${tokensBefore} → ${tokensAfter} (estimate, 4 characters per token)`);
    // Where the bytes that remain are spent. Prose and evidence are the modeller's own words: no format
    // removes them, and a report that hid them would be selling the compact form a saving it did not make.
    console.log('  remaining  ' + sections.map(section => `${section.label} ${(section.bytes / 1024).toFixed(1)}KB`).join(' · '));
  } else {
    console.log(JSON.stringify(expand(data, file), null, 2));
  }
}