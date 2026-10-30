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
the vertex shader on every vertex of its mesh, once per pass — the colour pass, and at `standard` and `cinematic`
the sun's shadow map and the occlusion's normal pass too. Two things made that larger than it had to be, and both
were fixed without changing the image:

- three.js builds `RoundedBoxGeometry` as a soup, three vertices per triangle: the chamfered box every block shares
  was **324 vertices** for its 108 triangles. Welded (`SHAPES.box`), it is **56**, with the same triangles and the
  same normals.
- A piece not laid yet is folded to a point by the shader, but its vertices were shaded in every pass all the same.
  Each mesh now holds its pieces in the order they are laid, and `setTime` draws only those laid by then.

Vertex shader invocations per pass, at each monument's own quality:

| | before | finished | averaged over the film |
|---|---|---|---|
| Colosseum | 15.3 M | 3.5 M (4.4×) | 3.2 M (4.8×) |
| Kinkaku-ji | 8.9 M | 1.5 M (5.7×) | 1.0 M (9.2×) |
| Parthenon | 8.0 M | 2.5 M (3.1×) | 1.9 M (4.2×) |
| Osaka Castle | 5.9 M | 1.0 M (5.7×) | 0.4 M (13.6×) |
| Notre-Dame de Paris | 5.0 M | 2.5 M (2.0×) | 1.8 M (2.7×) |
| Cathédrale de Coutances | 3.1 M | 2.3 M (1.3×) | 1.7 M (1.8×) |

The triangles are unchanged (the Colosseum is still 6.4 million a pass). A level of detail by distance, a plain
box for blocks a few pixels wide, would now save at most 56 − 24 vertices a box: it waits until a profile on a real
GPU says the vertex stage still limits the frame rather than the pixels (4× multisampling, triplanar maps,
occlusion).

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