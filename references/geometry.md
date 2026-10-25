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

## Continuous masonry

`kit/masonry.js` builds what a heap of boxes cannot: walls whose openings are cut by their real outline, arches that are curves, mouldings, tracery and roofs. It works in the brick's own frame and hands the engine **patches**: a patch is a piece like any other (phase, order, birth, `until`) whose `matrix` is its bounding box, so everything that measures pieces (scaffolds, the chronology audit, the plan fit, the golden digest) keeps working, and whose triangles (`piece.mesh`: positions and normals in that box's unit cube, a `mason` attribute, indices) are baked by the viewer into one mesh per material. A patch grows like a block does: the shader scales it about its own centre (`aCenter`) and drops it into place.

- **Walls** (`wall`, `gable`): bands of about 0.9 m, cut into cells of about 2.6 m, each cell a patch: outer and inner faces, the top, the sides of every opening and its sill and soffit. An opening is sliced where its outline turns (a sample every few millimetres of chord error on an arch: 10, 5 or 2.5 mm for `basic`, `standard`, `cinematic`), so no step and no gap.
- **Sections** (`moulding.roll`, `fillet`, `hollow`, `keel`, `chamfer`, `stack`): a profile `[r, d]` swept (`sweep`) along any path with mitred corners, normals smooth on a roll and doubled at an arris.
- **Plates** (`plate`, `foil`): a slab pierced by lights (a foil is a circle of lobes meeting in cusps), triangulated across its holes, with the sides of every hole: tracery, balustrades.
- **Lofts** (`loft`): rings of a regular polygon at chosen heights: shafts, cones, spires (courses, or a pattern of scales).
- **Material**: stone patches draw their coursing from `aMason` (s along the wall, height, course height) in the fragment shader: beds that wander, heads that stagger, a joint 14 mm wide whose contrast fades with the pixel's size, a tone per block, and a slow weathering; slate draws its rows of overlapping slates; glass its leaded panes.

`node scripts/masonry.test.mjs` holds it: the skin of a wall with a pointed opening has the area of the wall less the opening, to 0.4 %, no triangle lies in the opening, every face is wound the way its normal points, and in a browser the wall is stone where it is wall and glass where it is not.

