# Faithful and beautiful

Someone who knows the building should recognise it at first glance, find its proportions and its telling details, and find the scene beautiful.

## References, before modelling

- For a standard build, use at least three useful photos from two sides (main front, a side, and the best view of the roof or structure), a measured footprint or plan, and official dimensions. Publication uses four photos from three sides. Look at them for real in the browser; note the azimuth and approximate height. Prefer freely licensed photos and link them in `evidence.references`.
- Write the **architectural reading**: at least eight features that make the building recognisable, each with its source. Cover the silhouette, then details that reward a close camera: joints, frames, fasteners, cornices, surface rhythm, carvings or roof edges. For Himeji Castle: white plaster, white tile joints, kara and chidori gables placed face by face, lattice windows in pairs, a fan-shaped stone base, ridge ornaments and their close construction. Every listed feature must be visibly modelled, at least simplified. Keep it in `evidence.features`.
- Read the worksite too. Find images or descriptions of materials arriving, temporary supports, lifting, joining and finishing. Use those sources for at least two `phase.scene` tableaux; do not dress every century as the same generic timber scaffold.

## Model this building

- Measures: footprint within 1–2 m, heights within 1 m, exact numbers of storeys, bays, towers and roofs.
- Shapes: the exact type of each roof, profiles (batter, curves, setbacks), shape and rhythm of the openings, telling ornaments.
- Materials and colours read from the photos, never generic tints.
- Round is round: columns, drums, piers with a round plan, turrets and finials are turned pieces (`k.turned`, `k.column` with the building's order), never square posts. A column has its base, its shaft (in drums or a monolith, with its entasis) and its capital.
- Sculpture is photographed, not invented: tympana, statues, friezes and carved roses that boxes cannot render are `relief` elements, free photos rectified onto the model with their depth (a portal's splay as a `recess`). Measure them on the same scale as the model (a known width in the photo), check them with `scripts/relief.mjs --check`, and credit each photo ([bricks.md](bricks.md)). A relief shows the carving as photographed: say so in `evidence.uncertainties` when it stands for earlier states too.
- Never transplant an element from another tradition: no European windows on a Japanese keep, no generic pitched roof on a dome.
- If the bricks cannot render these features, write a brick for this kind of architecture, as detailed as it needs to be.

## Detail ledger and close-view gate

The wide view tests the silhouette; it cannot prove a portal, a rose, a gallery, a carved capital or the rhythm of a facade. Before adding ornament, make a ledger in `evidence.detailReview`. New scaffolds create it with `status: "pending"`; a standard validation fails until it is complete.

```json
"detailReview": {
  "version": 1,
  "status": "complete",
  "items": [
    {
      "feature": "Three pointed west portals with recessed archivolts",
      "source": "https://…",
      "reference": 0,
      "element": 18,
      "method": "geometry",
      "model": "Three separately profiled portal recesses; centre bay is wider",
      "checked": true,
      "result": "matched"
    },
    {
      "feature": "Carved tympanum in the central portal",
      "source": "https://…",
      "reference": 3,
      "element": 19,
      "method": "relief",
      "model": "Rectified Commons detail photo in a pointed, recessed relief panel",
      "checked": true,
      "result": "named simplification"
    }
  ]
}
```

- `feature` must reproduce an entry in `evidence.features`; one ledger row per feature makes the claimed detail auditable rather than decorative prose.
- `reference` is the zero-based index of the photo that shows the feature. Choose a close or medium view when the wide view cannot resolve it. `element` is the index of the element that carries the feature. A `relief` row must point to a `relief` element.
- `method` is `geometry`, `relief`, or `material`. Geometry earns its place when the profile, count, depth or structural logic can be read; relief earns its place when an actual photographed carving must be seen rather than guessed. A material row documents a visible bond, joint, finish or colour rhythm, not a generic texture.
- `result` is `matched` only after the calibrated photo overlay and a close camera check agree. Use `named simplification` only when the reason is stated in the final comparison's `remaining` and in `evidence.uncertainties`; it is never a way to hide an unsourced approximation.

For a cathedral, palace, temple, ornate civic building or any facade whose identity is ornament, the ledger must cover the complete identity hierarchy:

1. overall silhouette, footprint and tower/roof heights;
2. bay and opening count, including the wider or narrower exceptional bays;
3. vertical stages, setbacks, buttresses, galleries, cornices and roof-edge rhythm;
4. the principal portal, window or rose geometry and its depth;
5. distinctive sculpture, tracery, capitals, mouldings, joints and material transitions visible at close range.

Never improve a poor photo match with invented micro-detail. Find a better detail reference, encode measured geometry, use a credited relief, or state the evidence gap. A close camera should reveal real construction information, not noise or repeated generic pieces.

## Compare, fix, repeat

1. Give each reference photo its viewpoint in `evidence.references`: `azimuth` (degrees from north, 180 = seen from the south), `elevation` (negative looks up from the foot of the building), `distance` and `target`, from the camera location Commons records for the photo (validation checks them against it), `fov` for the lens, and `phase` when the photo shows an earlier state (by default the model is photographed at the end of the last daylight phase).
2. Fit each viewpoint: pick three or more points you can recognise both on the building and in the photo (a tower's top corner, a rose's centre, the spire's tip, a portal's apex) and run `node scripts/calibrate.mjs monuments/<id>.json --ref <n> --photo <width>,<height> --points '[[x, y, z, px, py], …]' --frame --write` (`--move` with six points or more also refines the camera position, which a phone records roughly; `--eye <metres>` sets the camera's height when a horizontal line of the building runs straight across the photo, which puts the eye at that line's height; `--upright` when the photo's verticals are parallel, from a shift lens or a perspective correction as on many Commons photos: the camera then looks level, and the horizon's place is fitted and recorded as the reference's `shift`). On a curved or repetitive facade whose bays cannot be told apart, give lines instead of points: `{"ellipse": {"center", "radii", "rot", "y", "arc"}, "at": [px, py]}` is any point of a cornice, a rim or a storey line where the photo shows it; ten or twenty along three or four lines fit the view better than a few corners. A curved edge whose height cannot be read in the photo (a tower's leg running down behind trees) is a polyline: `{"line": [[x, y, z], …], "at": [px, py]}` is any point of that edge. Pick points that fix the width as well as the height (both sides of the building, not only its axis): a fit on heights alone can sit right in height and be wrong across. Read the pixels in the photo's own frame (its full width and height), not in a crop or a screenshot of it. When the photo cannot have been taken where Commons records it, say why in the reference's `positionReason`. It fits the aim and the lens so the model's points land on the photo's, and records the remaining gap in `reference.calibration`: how far the model sits from the photo once the viewpoint is right. The viewer's evidence mode lays the photo over the model from that viewpoint (`?photo=<n>`, with Fade).
3. For a standard build, run `node scripts/compare.mjs monuments/<id>.json --pass 1 --quick`. It photographs the finished model from every reference viewpoint and skips phase screenshots. Play the timeline once, fix the visible gaps, then rerun the same command to refresh the captures. Publication runs the command without `--quick` for two passes.
4. Open each photo and its capture, one after the other, and look at the photo laid over the model (`overlay-<n>.jpg` in the pass folder, or the evidence mode's Fade): a capture can look right next to its photo and still be too wide or too low. Write in that pass's `gaps` what differs: silhouette, proportions, number of elements, roof shapes, openings, colours, ornaments, and whether every phase reads. Then repeat this at the scale of each close ledger reference: test the signature feature's count, profile, depth and material rhythm, not merely its presence. A photo taken from the foot of a building flattens its upper roofs: match the viewpoint before judging proportions.
5. Hold the outline to the photos: `node scripts/silhouette.mjs monuments/<id>.json` cuts each photo into building, sky and what says nothing, and measures the share of building the photo and the model have in common from the photo's viewpoint. Look at each `<id>.evidence/silhouette/review-<n>.jpg`: sky tinted blue, what says nothing greyed, the model's outline in red, the model standing in the sky in magenta, building it misses in yellow. Then tell the cut, in the reference's `silhouette`, what to leave out, in pixels of the 960 × 600 frame (the grid is numbered): `ground`, the row under the building's base below which the ground, the water and the crowd say nothing; `ignore`, polygons over what stands in front (a tree, a bridge, a scaffold or a crane the model does not have); `trees: true` to leave out green; `holes: true` for sky seen through a lattice. Rerun until the grey covers only what should say nothing, and record with `--write`: from then on `scripts/silhouette.test.mjs` refuses a change that takes the model more than two points further from any of its photos. A photo that cannot be cut (a sunset through leaves) keeps no `silhouette`. Magenta and yellow are gaps to write in `gaps` like the others: a lantern too wide, chimneys the model lacks.
6. Hold the openings to their rule: `node scripts/openings.test.mjs` checks, for the bricks that carry their openings as numbers (`lodgingRange`, `drumTower`, the doors of a `doricTemple`'s walls), that a wall's windows stand in regular bays centred on it, that arches stand on window axes one to a bay, that dormers stand over window axes, that a door stands in the middle of its wall or on a bay's axis, that no window of a tower stands on a wall another building hides, and that no dormer stands through a chimney stack. Where a photograph gives an opening's place, the photograph decides and the opening is not left to the rule: put it in a brick that takes measured places (`openings`, `at`, `angles`), say so in `uncertainties`, and do not move it to make it regular.
7. Look at the walls, head on, and hold them to the codes a picture shows: `node scripts/vision.test.mjs` photographs each ground-based wall that carries openings from its outward normal (long walls in stretches of 40 m), projects the openings the numbers declare into the picture, and measures what the picture shows there. Three codes are held: (a) a window's glass reads dark, in each third of its height (at least 40% of the dimmest third under 85 of 255 in luminance: at Chambord, the dimmest third of 106 windows measures 0.48 to 1.0, that of windows with a panel laid over their foot or a block in front of them 0.0 to 0.27); (b) the window stands in the picture where the numbers put it, within 0.3 m, so that what is centred in the numbers is centred on the screen; (c) a door reads as an opening, dark over at least 60% of its leaf, in the middle of its wall or on a bay's axis. Windows another building stands in front of are not asked to show. `VISION_DIR=<folder>` keeps the picture of every wall, `VISION_REPORT=1` prints every measure: look at them, because a picture shows what no number does (a panel laid over a pane, a niche where a window should be). Symmetry and rhythm are held by the numbers in step 6; the loggias' round arches, the windows of each period and the doors a photograph shows but the model lacks need a photograph and are not a test.
8. Hold every photo relief to its photograph: `node scripts/relief.test.mjs` looks at each relief as the viewer lays it (a `relief` element, or a photo a brick lays on each detail that names it) head on along its own normal, on a black backdrop, the section view cutting away what stands more than 1.2 m in front of it (a porch, a colonnade, the far side of a nave), so that a relief buried in its own wall stays hidden by the stone, and takes that picture twice, with the reliefs and without them, without cast shadows (a cornice's shade would split the carving it falls on), the key light following the camera so that each picture depends on its view alone. Three codes are held: (a) the relief is seen: laying it changes the picture by more than 8 grey levels over at least 25% of its panel (over the 57 reliefs of the collection and the gallery, those that show measure 45 to 97%; the porch tympana of Coutances, buried 0.55 m in their towers' walls, measured 0%, and the Parthenon's corner metopes, behind a frieze standing 7 cm proud of the corner, 6 to 8%, before they were brought out); (b) what is seen is its photograph: the picture's luminance, read cell by cell over the panel, correlates with the photograph rectified through the relief's corners and cut to its shape and outline at 0.25 at least (0.36 to 0.96 for those that show; weathered, low-contrast photos read lowest, because the viewer lights the carving from its own light and shade; the hidden ones measured −0.16 to 0.30); (c) it lies on the building and faces out of it: on a band round the panel, a tenth of its smaller side out, at least half of the picture is the model, not the backdrop (63 to 100% for those laid right: an altar in a dark choir and the figures in a pediment's corners read lowest; a relief turned to face into the building, on an outer wall, sees the void round it). It also counts the panels a brick lays against the details that name them. Tried on purpose at Chambord, a photo laid on the face of a wing's wall passes (73% seen, 0.73 alike); the same photo laid 0.6 m inside the stone fails on (a) at 0%, turned to face into the wing it fails on (c) at 6%, and with its image missing it fails as not shown. `RELIEF_DIR=<folder>` keeps the picture of every relief, `RELIEF_REPORT=1` prints every measure. Whether the corners are the right ones on the photo is `relief.mjs --check`'s question: the test compares the panel with its own rectification.
9. Write what you changed in `fixed`. Standard mode finishes after the refreshed first pass when only deliberate, named simplifications remain. Publication adds a second pass. Write remaining simplifications in the last pass's `remaining` and in `evidence.uncertainties`.

## Beautiful

- Daylight, contrasted materials, a silhouette that reads in the final framing and during construction.
- No floating pieces, no flickering coplanar faces, no holes, no detail below a pixel at the usual framing that turns into noise.
- Each phase lays visible pieces, in an order that reads.
- Let a person establish scale. A close phase should reveal individual blocks, mullions, rivets or joints; the sourced worksite scene supplies figures, material stacks and temporary equipment without surrounding the monument with decorative scenery.
- Surprise comes from truth at small scale: the tool that solved a structural problem, the temporary support hidden in the finished silhouette, or the joint that only appears when the camera moves close. Put that fact in a pinned moment and its geometry at the anchor.
- Context stays quiet and true when explicitly requested; otherwise show the building alone.

## Report honestly

Say what is measured, documented and interpreted, and the gaps that remain with the photos. Never call a model "exact" or "perfect".

## Measuring the building against its sources

A golden snapshot proves a monument did not change. It cannot tell you the monument is right: if the model has
always been four columns short, the baseline has always been wrong and keeps it wrong.

`evidence.measurements` closes that gap. Each entry names a quantity, the figure a source gives for it, the
tolerance that figure deserves and the page it was read from:

```json
{"probe": "doric-peristyle", "quantity": "columnCount.total", "expect": 46,
 "source": "https://acropolisrestoration.ysma.gr/…", "note": "8 × 17 columns, 46 in all"}
```

`node scripts/check.mjs` builds the monument, runs the named probe and compares. A probe reads the pieces the
brick actually placed — never the spec that asked for them — so a model that quietly stops matching its evidence
is caught:

```
✗ spacing.flank            4.42       source says 4.296
    → parthenon: spacing.flank is 4.42 m centre to centre, the source says 4.296 (https://de.wikipedia.org/wiki/Parthenon)
```

Rules worth keeping:

- **Measure in the building's own frame.** A monument sits on its real plan, rotated; reading a bay off a world
  axis shortens it by the cosine of that rotation. The Parthenon is turned 12.9°, which is 2.5 % of every bay.
- **Read the bed, not the centre.** A leaning shaft's centre is not its axis; the foot is half the piece's own
  up-vector away.
- **A source that gives a range is written as one:** `"expect": [10, 12]` for drums laid in ten to twelve.
- **Give a tolerance the figure deserves.** Counts are exact; a stylobate rise measured between column axes
  stands inside the platform's full rise and cannot equal it.

A brick opts in by tagging what it builds — `part`, `member`, `faces`, `role` on its pieces. `kit/builder.js`
spreads them onto every piece, so a checker can find the members by name without guessing at geometry.

A `detailReview` row may then name the measurements behind it:

```json
{"feature": "A Doric peripteral temple of 8 by 17 columns, 46 in all…", "result": "matched",
 "measurement": ["columnCount.total", "columnCount.face.n", "columnCount.face.e"]}
```

Rows that name measurements stop being promises: `check.mjs` fails them if a measurement drifts. Rows that name
none are still assertions, and the report says how many of each there are.
