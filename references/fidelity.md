# Faithful and beautiful

Someone who knows the building should recognise it at first glance, find its proportions and its telling details, and find the scene beautiful.

## References, before modelling

- At least four photos from different directions (main front, sides, a view from above if one exists), a measured footprint or a plan, the official dimensions. Look at them for real in the browser; write down for each one the azimuth it was taken from (direction of the photographer seen from the building, in degrees from north) and roughly how high. Prefer freely licensed photos (Wikimedia Commons) and link them in `evidence.references`.
- Write the **architectural reading**: the list of features that make the building recognisable, each with its source. For Himeji Castle: white plaster, white tile joints, kara and chidori gables placed face by face, lattice windows in pairs, a fan-shaped stone base, ridge ornaments. Every listed feature must be modelled, at least simplified. Keep it in `evidence.features`.

## Model this building

- Measures: footprint within 1–2 m, heights within 1 m, exact numbers of storeys, bays, towers and roofs.
- Shapes: the exact type of each roof, profiles (batter, curves, setbacks), shape and rhythm of the openings, telling ornaments.
- Materials and colours read from the photos, never generic tints. Choose `view.light` so the main material reads true (`"day"` for white plaster or marble).
- Never transplant an element from another tradition: no European windows on a Japanese keep, no generic pitched roof on a dome.
- If the bricks cannot render these features, write a brick for this kind of architecture, as detailed as it needs to be.

## Compare, fix, repeat

1. Give each reference photo its viewpoint in `evidence.references`: `azimuth` (degrees from north, 180 = seen from the south), `elevation` (negative looks up from the foot of the building), `distance` and `target`.
2. Run `node scripts/compare.mjs monuments/<id>.json --pass 1`. It photographs the finished model from every reference viewpoint, and the end of every phase, into `<id>.evidence/compare/pass-1/`, and records the pass in `evidence.comparisons`.
3. Open each photo and its capture, one after the other. Write in that pass's `gaps` what differs: silhouette, proportions, number of elements, roof shapes, openings, colours, ornaments, and whether every phase reads. A photo taken from the foot of a building flattens its upper roofs: match the viewpoint before judging proportions.
4. Fix the model, write what you changed in `fixed`, and run `--pass 2`. Repeat until only deliberate, named simplifications remain; write them in the last pass's `remaining` and in `evidence.uncertainties`.

## Beautiful

- Daylight, contrasted materials, a silhouette that reads in the final framing and during construction.
- No floating pieces, no flickering coplanar faces, no holes, no detail below a pixel at the usual framing that turns into noise.
- Each phase lays visible pieces, in an order that reads.
- Context stays quiet and true: real neighbours at real heights, or nothing.

## Report honestly

Say what is measured, documented and interpreted, and the gaps that remain with the photos. Never call a model "exact" or "perfect".
