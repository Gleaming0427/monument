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