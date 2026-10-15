# Bricks

A brick is a generator in `kit/builder.js` (object `generators`) that turns one element of a monument file into many small solid pieces. Reuse a brick only when it renders the requested building faithfully; otherwise write a new one (below).

Units are metres. `x` points east, `z` points south, `y` up; the ground (or water) is at `y = 0`. `rot` turns an element around the vertical axis, in radians.

| Type | What it builds | Main parameters |
| --- | --- | --- |
| `facade` | A wall with openings, stone surrounds and balconies | `center`, `length`, `floors`, `floorHeight`, `bays`, `windowWidth`, `rot`, `y0`, `door`, `balconies`, `color`, `trim` |
| `wing` | A building block with four facades and a roof | `center`, `size` (width, length; length along local z), `floors`, `floorHeight`, `rot`, `y0`, `roof` (optional `until`), `sideBays` (bays on the long facades), facade parameters |
| `lawn` | A garden cut to a real outline, with a gravel border | `points`, `step`, `grass`, `gravel`, `border` |
| `fence` | A wrought-iron railing along a line | `points`, `height`, `color` |
| `wall` | A stone curtain wall | `points`, `closed`, `height`, `thickness`, `y0`, `crenel` |
| `tower` | A round tower | `at`, `radius`, `height`, `y0`, `crenel`, `roof` (cone), `tag` |
| `enceinte` | An oval enclosure with its towers | `center`, `radii`, `segments`, `skip` (openings, in degrees), `wall`, `towers` |
| `building` | A house, hall or church with a pitched roof | `center`, `size`, `height`, `rot`, `roof` |
| `village` | Houses packed in an oval | `center`, `radii`, `count`, `avoid`, `roof` |
| `cone` | A pointed roof | `center`, `radius`, `height` |
| `slab` | A solid foundation mass | `center`, `size`, `y0` |
| `scaffold` | A temporary timber scaffold | `at`, `height`, `until` (phase when it comes down) |
| `lattice` | A four-legged iron lattice tower | `profile`, `legWidth`, `bands`, `arch`, `decks`, `flag` |
| `suspension` | A suspension bridge | `span`, `side`, `tower`, `deck`, `width`, `portals`, `braces`, `phases` |
| `batteredBase` | A stone base with sloping walls | `center`, `size` (foot), `top` (top), `height`, `rot`, `curve` (> 1: fan-shaped profile, flared at the foot), `colors` |
| `timberFrame` | A timber frame of setback floors | `center`, `size`, `levels` (floor heights), `plans` (width, depth per level, in ken), `ken`, `y0`, `rot`, `pillars` (`offsets`, `height`, `width`: masts through every floor) |
| `tieredKeep` | A Japanese castle keep: plastered tiers, curved hip roofs with white tile joints, gables face by face | `center`, `rot`, `y0`, `ken`, `pitch`, `tile`, `joint`, `wall`, `tiers` (per tier: `plan` in ken, `height` eave to eave, `eave`, `brackets`, `bays`, `windowPitch`, `lattice`, `posts`, `gables` with `face` s/n/e/w, `kind` kara/chidori/irimoya, `width`, `height`, `at`, `slope`; top tier: `ridge`, `hip`) |
| `arcadedTower` | A round campanile of superposed arcades (Pisa type) | `center`, `radius`, `y0`, `color`, `shade`, `storeys` (per storey: `kind` blind/loggia/belfry, `height`, `phase`, `arches` or `columns`, `core`, belfry `radius`) |
| `amphitheatre` | An elliptical amphitheatre (Colosseum type) | `center`, `radii`, `rot`, `bays`, `part` (`facade`, `inner`, `cavea`, `arena`), `arc` (degrees kept, for a ruined side), facade `storeys` (`height`, `column`, `kind: attic`), `ring`, cavea `from`/`to` (`ring`, `height`), `rows`, `arena`, `podium`, `color`, `brick` |

## Change over time

Everything that happens to a building is tied to a phase:
- raise a building: a second element with a higher `y0`;
- ruin then restore: `"ruin": {"phase", "share", "restore"}`;
- take a whole element down: `until`; for `wing`, `roof.until` removes only the roof before a new storey goes on.
- lean a building as the ground gives way: `"lean": {"pivot": [x, y, z], "toward": [dx, 0, dz], "track": [[t, degrees], …]}` on an element; `t` is the timeline position in phases, and pins within `radius` lean with it. One leaning group per monument.

## Adding a brick

Write a generator `name(k, e, P)` modelled on the existing ones:
- `k.box`, `k.beam` or `k.oriented` for every piece, with its colour from `k.tint`;
- `P(e.phase)` for its phase;
- the `order` argument sets the laying order inside the phase: bottom to top by default, or out from the towers, as for the bridge.

Name it after the architecture (`ribbedVault`, `onionDome`, `setbackTower`), never after one building, and never branch on a building's id.

Where it goes:
- **In this repository** (`kit/builder.js`), add a row to the table above. `node scripts/validate.mjs` fails if a brick is missing from it.
- **In a user's project**, write `monuments/<id>.bricks.js` and set `"bricks": "<id>.bricks.js"` in the monument file. The module's default export is an object of generators. It may `import * as T from 'three'`, and `import {generators} from '../kit/builder.js'` to call core bricks such as `generators.facade`. The viewer loads it before building the scene, and `scripts/validate.mjs` reads its brick names. Bricks sent to the community gallery are reviewed before they join the kit.

Bricks still to write, as requests come: setback skyscrapers (Empire State Building), vaults, Gothic spires, flying buttresses, domes, minarets, rock and terrain (Mont-Saint-Michel), stepped pyramids. These are reasons to build, never reasons to refuse.
