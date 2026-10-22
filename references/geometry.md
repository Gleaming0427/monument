# Adaptive architectural geometry

Monument keeps architectural definition separate from tessellation. A column profile, flute count and measured dimensions are evidence; vertex count is only a rendering decision.

## Curve tolerance

For a circular radius `r` rendered by `n` straight chords, the maximum radial error is:

`error = r × (1 − cos(π / n))`

`kit/geometry.js` solves this relation for the smallest acceptable segment count, rounds it to a symmetry-compatible multiple, and clamps it to the active quality level. Defaults are 8 mm for `basic`, 3 mm for `standard`, and 1 mm for `cinematic`. An explicit `maxChordErrorMm` can demand a tighter mesh. Fluted shafts also reserve 4, 6 or 8 samples per flute respectively, so an arris always falls on a vertex.

## Declarative columns

Use `profiledColumn` when sources give the shaft's proportions:

```json
{
  "type": "profiledColumn",
  "phase": "columns",
  "positions": [[-4, 0], [4, 0]],
  "height": 10.43,
  "diameter": 1.9,
  "order": "doric",
  "drums": 11,
  "shaft": {
    "flutes": 20,
    "profile": [[0, 1], [0.18, 1.006], [0.33, 1], [0.7, 0.91], [1, 0.78]]
  },
  "rendering": {"maxChordErrorMm": 2, "lod": "adaptive"},
  "provenance": "documented"
}
```

Profile stations are `[height fraction, diameter ratio]`, from 0 at the foot to 1 at the top. Ratios are relative to `diameter`. The engine samples the continuous spline only where its deviation from a straight chord exceeds the tolerance, then uses the same sampled curve for a monolith or splits it continuously across `drums`.

`maxChordErrorMm` controls mathematical mesh approximation, not historical certainty. Unknown measurements remain uncertainties even when the mesh itself is accurate to a millimetre.

## Instancing and LOD

Pieces are grouped by material, profile and required LOD. Equal profiles reuse one `InstancedMesh`; different vertex counts never duplicate the architectural description. Small distant members stay light, ordinary curves use roughly 30–72 radial segments, and close fluted work can reach 96 segments or the flute-compatible cap declared by its shape.

Run `node scripts/geometry.test.mjs` for the mathematical contract and `node scripts/golden.test.mjs` for monument-level regression. A reviewed change to either reference monument requires an intentional update of `scripts/fixtures/golden-models.json`.
