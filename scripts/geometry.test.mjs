#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';
import {loadEngine} from './lib/engine.mjs';

const engine = await loadEngine();

test('adaptive circular LOD respects its chord-error contract', () => {
  const radius = .5, errors = [8, 3, 1], segments = errors.map(maxChordErrorMm => engine.segmentsForChordError(radius, maxChordErrorMm, {min: 12, max: 128, multiple: 2}));
  assert.ok(segments[0] < segments[1] && segments[1] < segments[2], `expected increasing LOD, got ${segments}`);
  segments.forEach((count, index) => assert.ok(engine.chordError(radius, count) * 1000 <= errors[index], `${count} sides exceed ${errors[index]} mm`));
});

test('continuous profile sampling adds detail only where curvature needs it', () => {
  const profile = [[0, 1], [.18, 1.012], [.33, 1], [.7, .94], [1, .86]];
  const coarse = engine.sampleProfile(profile, {diameter: 1.9, maxChordErrorMm: 8, maxRows: 18});
  const precise = engine.sampleProfile(profile, {diameter: 1.9, maxChordErrorMm: 1, maxRows: 40});
  assert.ok(precise.length > coarse.length, `${precise.length} precise rows should exceed ${coarse.length} coarse rows`);
  assert.deepEqual(precise[0], [0, 1]); assert.deepEqual(precise.at(-1), [1, .86]);
});

test('profiled columns preserve flute count and profile continuity across drums', () => {
  const data = {
    phases: [{id: 'build'}],
    elements: [{type: 'profiledColumn', phase: 'build', center: [0, 0], height: 10, diameter: 1.9, order: 'doric', drums: 10,
      shaft: {flutes: 20, profile: [[0, 1], [.18, 1.012], [.33, 1], [.7, .94], [1, .86]]}, rendering: {maxChordErrorMm: 2}}],
  };
  const pieces = engine.buildPieces(data).pieces.filter(piece => piece.shape === 'profiledShaft');
  assert.equal(pieces.length, 10);
  for (let i = 1; i < pieces.length; i++) assert.ok(Math.abs(pieces[i - 1].geometry.profile.at(-1)[1] - pieces[i].geometry.profile[0][1]) < 1e-12);
  const factory = engine.SHAPES.profiledShaft, counts = [];
  for (const quality of ['basic', 'standard', 'cinematic']) {
    const {context} = engine.adaptiveContext(pieces[0], factory, quality), geometry = factory(context);
    assert.equal(geometry.userData.architecture.flutes, 20);
    assert.equal(context.radialSegments % 20, 0);
    assert.ok(engine.chordError(context.diameter / 2, context.radialSegments) * 1000 <= context.maxChordErrorMm);
    counts.push(geometry.attributes.position.count); geometry.dispose();
  }
  assert.ok(counts[0] < counts[1] && counts[1] < counts[2], `LOD vertex counts must increase: ${counts}`);
});

// A lathe's vertices lie around the axis first and along the profile second. Reading them the other way round
// still fills the whole buffer, so nothing throws and the columns simply shade wrong: this is the check that
// says the normal of a turned member is the one its own profile implies.
test('the normal of a turned member is the one its profile implies', () => {
  const geometry = engine.profiledGeometry({profile: [[0, 1], [1, 1]], diameter: 1.9, height: .95, radialSegments: 48});
  const position = geometry.attributes.position, normal = geometry.attributes.normal;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), z = position.getZ(i), radius = Math.hypot(x, z);
    if (radius < 1e-7) continue;                              // the two rings that close on the axis are the caps
    const outward = (normal.getX(i) * x + normal.getZ(i) * z) / radius;
    assert.ok(outward > 1 - 1e-6, `a plain cylinder is radial everywhere; vertex ${i} points ${outward} of it`);
  }
});

// The normal is read from the curve the whole member is cut from, never from one piece's own triangles: two
// drums of a column must answer identically at the station they share, or the shaft reads as stacked pieces.
test('drums cut from one curve agree at the joint they share', () => {
  const master = [[0, 1], [.18, 1.012], [.33, 1], [.7, .94], [1, .86]], drums = 10, segments = 60;
  const ratio = t => engine.profileAt(master, t), drum = i => {
    const from = i / drums, to = (i + 1) / drums;
    return engine.profiledGeometry({profile: [[0, ratio(from)], [.5, ratio((from + to) / 2)], [1, ratio(to)]],
      master, span: [from, to], radialSegments: segments, diameter: 1.9, height: 1});
  };
  const at = (geometry, ring, i) => {
    const rings = geometry.attributes.normal.count / (segments + 1), normal = geometry.attributes.normal, vertex = i * rings + ring;
    return [normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex)];
  };
  // The outermost ring of a closed drum is its cap, so the station two drums share is the one just inside it.
  for (let i = 0; i < drums - 1; i++) {
    const upper = drum(i), lower = drum(i + 1), rings = upper.attributes.normal.count / (segments + 1);
    for (let k = 0; k <= segments; k++) assert.deepEqual(at(upper, rings - 2, k), at(lower, 1, k), `drums ${i} and ${i + 1} disagree at vertex ${k}`);
  }
});

