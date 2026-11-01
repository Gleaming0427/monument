# Drafts

Monuments that are not in the collection yet, because something the publication gate asks for is missing. Each is laid
out as a monuments folder: `<id>.json`, the bricks it brings (`<id>.bricks.js`) and its evidence (`<id>.evidence/`), its
French text (`<id>.fr.json`) and its gallery card (`<id>.meta.json`). They are not checked by CI, not built into the
site and not in the tests. To see one:

```sh
node scripts/serve.mjs drafts
```

then open `http://127.0.0.1:4173/#<id>`.

## taj-mahal

The Taj Mahal, Agra: the white marble tomb, its plinth and its four minarets, in five phases from the works begun in
1632 to the restorations of the 2020s, with new Mughal bricks (`mughalPlinth`, `mughalTomb`, `onionDome`, `chhatri`,
`minaret`, `finial`).

- Measured: the plan, on OpenStreetMap's 3D building parts (the plinth's outline within 1.5 m at the 90th percentile;
  the tomb's chamfered square, the dome's width, the chhatris and the minarets' axes).
- Documented: the heights and widths published by Koch and Barraud (the tomb 56.9 m wide and 67.97 m high, a minaret
  5.65 m across and 43.02 m high) and by Wikipedia (the plinth, the pishtaqs, the dome, its drum and its finial), the
  dates, and the worksites as the pages read describe them, their disagreements shown.
- Interpreted: the proportions of the façades (the pishtaqs' and iwans' widths, the arches, the balconies, the
  parapet), the chhatris' domes, the minarets' balconies and taper. They are named in `evidence.uncertainties`.

What it lacks to pass `node scripts/validate.mjs --strict`: the reference photographs. Wikimedia Commons refused every
download from the session that made it (HTTP 429, too many requests), so no photo was fitted, compared or cut into a
silhouette. To publish it:

1. choose four or more Commons photos with a recorded camera location, from three sides at least, and add them to
   `evidence.references`;
2. fit them with `scripts/calibrate.mjs`, compare with `scripts/compare.mjs` (two passes) and record each outline with
   `scripts/silhouette.mjs --write`; correct the façades where the photos disagree, and the uncertainties with them;
3. publish it with `node scripts/publish.mjs drafts/taj-mahal.json …` (or move it to `community/taj-mahal/`), move
   `taj-mahal.fr.json` to `i18n/monuments/fr/taj-mahal.json`, and raise the count of monuments that
   `scripts/i18n.test.mjs` holds (nine today).
