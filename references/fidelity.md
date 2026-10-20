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
5. Write what you changed in `fixed`. Standard mode finishes after the refreshed first pass when only deliberate, named simplifications remain. Publication adds a second pass. Write remaining simplifications in the last pass's `remaining` and in `evidence.uncertainties`.

## Beautiful

- Daylight, contrasted materials, a silhouette that reads in the final framing and during construction.
- No floating pieces, no flickering coplanar faces, no holes, no detail below a pixel at the usual framing that turns into noise.
- Each phase lays visible pieces, in an order that reads.
- Let a person establish scale. A close phase should reveal individual blocks, mullions, rivets or joints; the sourced worksite scene supplies figures, material stacks and temporary equipment without surrounding the monument with decorative scenery.
- Surprise comes from truth at small scale: the tool that solved a structural problem, the temporary support hidden in the finished silhouette, or the joint that only appears when the camera moves close. Put that fact in a pinned moment and its geometry at the anchor.
- Context stays quiet and true when explicitly requested; otherwise show the building alone.

## Report honestly

Say what is measured, documented and interpreted, and the gaps that remain with the photos. Never call a model "exact" or "perfect".
