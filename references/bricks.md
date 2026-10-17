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
| `footprintBuilding` | A detailed present-day shell fitted to any measured polygon, with automatic bays and a flat roof | `points`, `height`, `floors`, `floorHeight`, `thickness`, `door`, `windowRatio`, `color`, `trim`, `roof`, `crenel` |
| `village` | Houses packed in an oval | `center`, `radii`, `count`, `avoid`, `roof` |
| `cone` | A pointed roof | `center`, `radius`, `height` |
| `slab` | A solid foundation mass | `center`, `size`, `y0` |
| `scaffold` | A temporary timber scaffold | `at`, `height`, `until` (phase when it comes down) |
| `lattice` | A four-legged iron lattice tower | `profile` (outer corner half-width by height), `legWidth` (leg section by height), `merge`, `shaft`, `bands`, `arch` (`base`, `rise`, `span`, `depth`, `at`: vertical plane at that distance from the axis; omitted, the arch follows the sloping face), `decks` (`y`, `overhang` (balcony), `gallery` (railing height), `frieze` (depth of the edge girder below the floor), `names` (inscriptions per side, `letters` colour), `pavilions` (`height`, `depth`, `setback`, `gap`, `mullion`, `glass`, `roof`, `phase`)), `flag` |
| `suspension` | A suspension bridge | `span`, `side`, `tower`, `deck`, `width`, `portals`, `braces`, `phases` |
| `batteredBase` | A stone base with sloping walls | `center`, `size` (foot), `top` (top), `height`, `rot`, `curve` (> 1: fan-shaped profile, flared at the foot), `colors` |
| `timberFrame` | A timber frame of setback floors | `center`, `size`, `levels` (floor heights), `plans` (width, depth per level, in ken), `ken`, `y0`, `rot`, `pillars` (`offsets`, `height`, `width`: masts through every floor) |
| `tieredKeep` | A Japanese castle keep: plastered tiers, curved hip roofs with white tile joints, gables face by face | `center`, `rot`, `y0`, `ken`, `pitch`, `tile`, `joint`, `wall`, `tiers` (per tier: `plan` in ken, `height` eave to eave, `eave`, `brackets`, `bays`, `windowPitch`, `lattice`, `posts`, `gables` with `face` s/n/e/w, `kind` kara/chidori/irimoya, `width`, `height`, `at`, `slope`; top tier: `ridge`, `hip`) |
| `arcadedTower` | A round campanile of superposed arcades (Pisa type) | `center`, `radius`, `y0`, `color`, `shade`, `shadow` (galleries' back wall), `storeys` (per storey: `kind` blind/loggia/belfry, `height`, `phase`, `arches` or `columns`, `core`, belfry `radius`) |
| `amphitheatre` | An elliptical amphitheatre (Colosseum type), one ring per element | `center`, `rot`, `bays`, `part` (`facade`, `cavea`, `arena`), `arc` (degrees kept: 0 = east end of the major axis, 90 = south), facade `radii` and `storeys` (`height`, `column`, `kind: attic`), cavea `from`/`to` (`radii`, `height`), `rows`, `seats`, `walls`, `wallWidth`, `rings` (`radii`, `height`, `width`: corridor walls), arena `arena`, `podium`, `hypogeum`, `color`, `brick` |
| `buttress` | A sloping masonry buttress propping the end of a wall | `at`, `rot`, `height`, `length`, `width`, `course`, `color` |
| `basilica` | The body of a Gothic church, one run per element: central vessel with clerestory (twin lancets under an oculus) and steep lead roof, aisles under lean-to roofs, chapels between the buttresses (built later if `chapels.phase`), buttress piers with pinnacles, flying buttresses | `center`, `rot`, straight run `from`, `to`, `bays`, `sides`, or `apse` (`sides`, `start`, `end` degrees, a half cone roof), `vessel` (`half`, `eave`, `ridge`, `thick`, `windows`: `width`, `sill`, `spring`), `aisles` (`half`, `wall`, `top`, `windows`), `chapels` (`half`, `wall`, `phase`, `windows`, `gables`), `buttresses` (`half`, `width`, `top`, `step`, `pinnacle`, `ends`), `flyers` (`from`, `to`, `thick`, `drop`, `phase`), `roof` (`phase`, `until`, `rebuild`, `color`, `crest`), `ends` (plain end walls and gables: `at`, `until`), `color`, `lead`, `glass` |
| `twinTowerFront` | The harmonic west front of a Gothic church, facing -u: three portals with archivolts and doors, a gallery of kings, a rose between two tall windows, an open high gallery, two square towers with louvred openings, corner buttresses, balustrades and a stair turret | `center` (front line), `rot`, `width`, `depth`, `thick`, `levels` (`kings`, `rose`, `gallery`, `top`), `towerTop`, `bands` (phases by height), `portals` (`v`, `w`, `spring`), `kings` (`count`, `until`, `rebuild`), `rose` (`v`, `y`, `r`, `colors`), `windowWidth`, `towers` (`v`, `w`, `depth`, `turret`), `opening`, `buttresses`, `sideButtresses`, `sideWindows`, `gable` (the nave's gable behind) |
| `roseFront` | The end of a transept, or any gabled front, facing -u: portal under its gable, glazed gallery, great rose, gable with an oculus, two turrets with pinnacles | `center`, `rot`, `width`, `thick`, `eave`, `apex`, `rose` (`y`, `r`, `spokes`, `colors`), `gallery` (`count`, `sill`, `spring`), `portal` (`w`, `spring`), `oculus` (`r`, `y`), `turrets` (`width`, `top`, `pinnacle`) |
| `spire` | A Gothic crossing spire: lead collar, open lantern with a gable on every face, octagonal lead needle with crockets, cross and cock; statues standing down the four roofs | `center`, `base`, `top`, `radius`, `lantern`, `lead`, `timber`, `gold`, `statues` (`count`, `ridge`, `slope`, `step`, `color`, `phase`, `until`) |

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

Bricks still to write, as requests come: setback skyscrapers (Empire State Building), domes, minarets, rock and terrain (Mont-Saint-Michel), stepped pyramids. These are reasons to build, never reasons to refuse.
