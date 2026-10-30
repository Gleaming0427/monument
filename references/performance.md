# Performance, and the question of Rust

Monument is JavaScript on purpose. This page records the measurement behind that choice, so the question can be
reopened with numbers instead of opinions — and so nobody has to take a port on faith.

## Run the gate

```
node scripts/profile.mjs                      # what a viewer actually pays
node scripts/profile.mjs --quality cinematic  # the finest level of detail, the worst case
```

It builds the three reference monuments, counts what the viewer's instancing actually produces, and times the
two costs a port would have to take over.

## What was measured

Apple M2 Max, Node 24, cold process, three monuments: 109 327 pieces.

| | standard | cinematic |
|---|---|---|
| pieces placed | 109 327 | 109 327 |
| distinct meshes after instancing | 165 | 181 |
| vertices | 56 867 | 127 191 |
| `buildPieces` (matrices only) | 183 ms | 173 ms |
| **mesh generation** | **33 ms** | **52 ms** |

The single most important number is the third row. Thirty-seven thousand pieces of the Parthenon become **83
instanced meshes**. The "mass mesh generation" a port would accelerate is 8–24 ms for a temple that took the
Classical world two centuries: instancing has already collapsed the mass, and what remains is a few dozen lathed
solids.

`buildPieces` places matrices and no geometry at all — the meshes are built in the browser, in `createStage`,
which is exactly where a Rust port would have to cross the WASM boundary and copy buffers back.

## Continuous masonry

A monument with `"masonry": "mesh"` (Coutances, Notre-Dame) is no longer instanced: its walls, mouldings, tracery and roofs are real surfaces, about 25 000 patches baked into one mesh per material. At standard quality Coutances is 31 600 pieces, about 1.5 million vertices and 1.17 million triangles (it was 46 700 boxes before), built by `buildPieces` in about 2 s (Node 22, the development container); the viewer holds a vertex in 60 bytes (positions and joint coordinates in 32-bit floats, normals in 16 bits, colours and flags in 8), about 90 MB of vertex data. It is the work of `buildPieces` (JavaScript, one pass, once), not of mesh generation, which the gate above measures; the same gate still holds. `visualStyle.quality: "basic"` doubles the chord error of the curves (10 mm) and so cuts the vertices of the arches and mouldings, and a monument that needs less asks for no mesh masonry at all.

## What the GPU draws

The table above counts the vertices of the distinct meshes. The GPU pays for something else: every instance runs
the vertex shader on every vertex of its mesh, in every pass that draws the monument, and every pass costs its
pixels. What was larger than it had to be, and what was done:

- **The block.** three.js builds `RoundedBoxGeometry` as a soup, three vertices per triangle: the box every block
  shares was 324 vertices for 108 triangles. `SHAPES.box` is now a chamfered cube cut with the vertices a cube has,
  **24 for 44 triangles**: each vertex keeps its face's normal, so a chamfer's light still turns from one face to the
  other as it did on the rounded arris. Close up, the two cannot be told apart.
- **Pieces still to come.** A piece not laid yet is folded to a point by the shader, but its vertices were shaded
  all the same. Each mesh holds its pieces in the order they are laid, and `setTime` draws only those laid by then.
- **A third drawing of the monument.** The ambient occlusion drew the whole scene again to get its normals. It now
  reads the depth the colour pass leaves (`depthTexture` on the composer's target) and finds the normals in it, at
  half resolution, and only round the monument (`setSceneClipBox`, so that the paper floor far off does not grey
  itself). The occlusion of arcades, portals and galleries is as it was; the finest dark joints between blocks at a
  distance are softer.
- **Pixels nobody asked for.** The composer kept the pixel ratio it was made with, so `visualStyle.quality` never
  lowered it; it now follows the quality. The canvas no longer multisamples the one quad it receives.
- **Frames that change nothing.** The viewer draws only when the picture would differ from the one on screen (the
  camera, the size, the time, a setting, a worksite or a night's sparkle moving, something arriving): an idle viewer
  costs the GPU nothing.

Vertex shader invocations per pass, at each monument's own quality; there are two such passes now (colour and
shadow) where there were three:

| | before | finished | averaged over the film |
|---|---|---|---|
| Colosseum | 15.3 M | 2.1 M (7.3×) | 1.9 M (7.9×) |
| Kinkaku-ji | 8.9 M | 0.7 M (13×) | 0.4 M (21×) |
| Parthenon | 8.0 M | 1.9 M (4.2×) | 1.4 M (5.7×) |
| Osaka Castle | 5.9 M | 0.4 M (13×) | 0.2 M (32×) |
| Notre-Dame de Paris | 5.0 M | 2.2 M (2.3×) | 1.7 M (3.0×) |
| Cathédrale de Coutances | 3.1 M | 2.2 M (1.4×) | 1.6 M (1.9×) |

Time for one frame of the finished monument in the development container's software renderer (SwiftShader, 4
cores, 1440 × 900 pixels; not a GPU, so read the ratios): the Eiffel Tower went from 3.3 s to 1.7 s and the
Colosseum from 28.5 s to 16.8 s, the occlusion from 1.2 s to 0.5 s and from 3.1 s to 0.5 s. What remains is mostly
the colour pass itself: 4× multisampling, triplanar maps and the shading of the pieces hidden behind others.

Not done, and why: a level of detail by distance for the blocks would now save triangles only (a plain box has 24
vertices too); a depth pre-pass would stop the hidden pieces being shaded but draws the monument once more; frustum
culling needs the instances split by region, which multiplies the draw calls; a lower resolution while the camera
moves would also lower it in the film and its recordings. Each waits for a profile on a real GPU.

## The gate

A second implementation of the geometry code costs a toolchain, a build step, a WASM boundary, the memory
transfer across it, and a second thing to keep true when a profile changes. `scripts/profile.mjs` sets that
against a threshold of **2 s** of mesh generation, and exits non-zero when it is met:

> That is 60× more than there is to win. **The gate is not met. Do not port; re-run this when the workload
> grows.**

The threshold is deliberately high and deliberately written down. To reach it with today's geometry, a viewer
would have to open **hundreds of temples at once**. A monument is one building in one file; that is the shape of
the work, not an accident of the implementation.

## The three candidates the roadmap named

- **Mass mesh generation.** Measured above: 33 ms standard, 52 ms cinematic, for all three monuments. Not a
  problem, and the port would sit on the wrong side of the WASM boundary anyway.
- **Geometric comparison.** `scripts/compare.mjs` renders the model from each photograph's calibrated viewpoint
  and lays the photograph over it; it produces images and a list for a person to read. An automatic silhouette
  or detail comparison would be a new feature, and if it were built it would run over the same **165 meshes**,
  not over millions of triangles — the arithmetic above applies unchanged.
- **Offline work.** The whole offline pipeline already fits in CI: `validate --strict`, both test suites,
  `golden` and `build-site` together take a few seconds. `golden.test.mjs` builds and digests both reference
  monuments in about half a second.

## What is true, and what the numbers say

Rounding columns costs nothing in JavaScript, and the adaptive engine already spends **zero** time choosing a
tessellation: a closed form (`r × (1 − cos(π/n))`) resolves a whole level of detail without a loop, and
`kit/geometry.js` is a hundred lines. A port would be a port of a closed form.

What *did* cost was measured and fixed: the P1 engine replaced fixed 320-segment fluted drums with 120-segment
ones, a 2.7× cut in vertices, and the P2 catalogue cut the three monument files by 45 % — both in JavaScript,
both verified by the golden baselines staying byte-identical.

**If the numbers ever change, the gate says so.** Raise the workload, re-run `scripts/profile.mjs`, and port only
what it names.