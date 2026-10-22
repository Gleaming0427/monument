#!/usr/bin/env node
// The contract of the compact catalogue: expansion is exact, merging is predictable, and a broken descriptor
// fails with a message the agent can act on without guessing.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {expand, merge, readMonument} from './lib/compact.mjs';
import {pack} from './catalogue.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const REFERENCE = ['parthenon', 'kinkaku-ji', 'cathedrale-de-coutances'];
const fails = (run, expected) => assert.throws(run, error => {
  assert.match(error.message, expected);
  return true;
});

test('merge keeps objects, replaces arrays and removes what is null', () => {
  assert.deepEqual(merge({a: 1, deep: {x: 1, y: 2}}, {deep: {y: 3}}), {a: 1, deep: {x: 1, y: 3}});
  assert.deepEqual(merge({list: [1, 2, 3]}, {list: [9]}), {list: [9]});
  assert.deepEqual(merge({a: 1, b: 2}, {b: null}), {a: 1});
});

test('an element names a prototype and overrides only what differs', () => {
  const data = {
    catalogue: {peristyle: {type: 'doricTemple', center: [0, 0], spec: {flutes: 20}, drums: 11}},
    elements: [{use: 'peristyle', phase: 'columns', spec: {flutes: 24}}],
  };
  assert.deepEqual(expand(data).elements[0], {type: 'doricTemple', center: [0, 0], spec: {flutes: 24}, drums: 11, phase: 'columns'});
});

test('a prototype may inherit another, and a plain name is enough', () => {
  const data = {catalogue: {base: {type: 'col', drums: 11}, west: {use: 'base', fronts: ['w']}}, elements: ['west', {use: 'base', drums: 12}]};
  const [west, plain] = expand(data).elements;
  assert.deepEqual(west, {type: 'col', drums: 11, fronts: ['w']});
  assert.deepEqual(plain, {type: 'col', drums: 12});
});

test('expansion never touches the file it was given', () => {
  const data = {catalogue: {a: {type: 'col', nested: {keep: 1}}}, elements: [{use: 'a', phase: 'p'}]};
  const before = JSON.stringify(data);
  expand(data);
  assert.equal(JSON.stringify(data), before);
});

test('a broken descriptor says what to fix', () => {
  fails(() => expand({catalogue: {a: {type: 'col'}}, elements: [{use: 'b'}]}), /elements\[0\] uses "b", which is not in the catalogue \(a\)/);
  fails(() => expand({catalogue: {a: {use: 'b'}, b: {use: 'a'}}, elements: ['a']}), /loops: a → b → a/);
  fails(() => expand({catalogue: {a: 'not an object'}, elements: ['a']}), /catalogue "a" must be a JSON object/);
  fails(() => expand({catalogue: {a: {type: 'col'}}, elements: [{use: ''}]}), /needs "use"/);
});

test('an element without "use" is a plain element and is left alone', () => {
  assert.deepEqual(expand({catalogue: {a: {type: 'col'}}, elements: [{type: 'apse', radius: 2}]}).elements[0], {type: 'apse', radius: 2});
});

test('packing a reference monument expands back to the very same monument', async () => {
  for (const id of REFERENCE) {
    // Whether the file on disk is compact or flat, the packer is measured on the flat monument.
    const flat = expand(await readMonument(`${root}/community/${id}/monument.json`), id), packed = pack(flat, {at: id});
    assert.deepEqual(expand(packed, id), flat, `${id}: packing changed the monument`);
    assert.ok(packed.elements.length === flat.elements.length, `${id}: packing changed the number of elements`);
  }
});

test('packing is worth doing and stays worth doing', async () => {
  let saved = 0, total = 0;
  for (const id of REFERENCE) {
    const flat = expand(await readMonument(`${root}/community/${id}/monument.json`), id);
    const size = value => Buffer.byteLength(`${JSON.stringify(value, null, 2)}\n`);
    saved += size(flat) - size(pack(flat, {at: id}));
    total += size(flat);
  }
  // The roadmap guessed −45 %. Whatever the real figure is, it is measured here and must not silently regress.
  const percent = (saved / total) * 100;
  console.log(`    catalogue: ${(saved / 1024).toFixed(1)}KB saved of ${(total / 1024).toFixed(1)}KB (−${percent.toFixed(1)}%)`);
  assert.ok(percent > 30, `the compact form only saves ${percent.toFixed(1)}% of the three reference files`);
});

test('packing an already packed file is refused rather than renaming prototypes', () => {
  const data = {
    catalogue: {col: {type: 'col', center: [0, 0]}},
    elements: [{use: 'col', phase: 'a'}, {use: 'col', phase: 'b'}],
  };
  fails(() => pack(data, {at: 'colonnade'}), /already uses a catalogue \(col\); expand it first/);
});