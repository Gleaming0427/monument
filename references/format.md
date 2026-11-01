# The monument file

One building = one JSON file, `monuments/<id>.json` in the user's project (`examples/<id>.json` in this repository). The id is the file name: lowercase letters, digits and dashes. The viewer opens it at `http://127.0.0.1:4173/#<id>`.

```json
{
  "id": "golden-gate", "name": "Golden Gate Bridge", "place": "San Francisco · California · USA", "seed": 1937,
  "view": {"target": [0, 95, 0], "distance": 1500, "width": 2100, "radius": 1100, "height": 227,
           "start": {"target": [640, 40, 0], "distance": 420}},
  "visualStyle": {"quality": "standard", "materialPreset": "historic-masonry"},
  "live": [{"label": "Height", "kind": "height", "unit": "m"}],
  "facts": [{"value": "1,280 m", "label": "main span"}],
  "modelNote": "What is measured, what is read from photos, what is simplified.",
  "evidence": {"identity": "…", "sources": ["https://…"], "references": [], "features": [], "geometry": "…", "uncertainties": ["…"]},
  "phases": [{
    "id": "foundations", "from": "1933-01-05", "to": "1933-11-07", "title": "The foundations", "text": "…", "source": "https://…",
    "scene": {"craft": "earth", "at": [-640, 0], "focus": [-640, 6, 0], "distance": 65, "radius": 35, "height": 12, "workers": 8, "materials": true, "scaffold": {"kind": "facade", "width": 28, "height": 10}, "hoist": {"kind": "gin-pole", "from": 0, "to": 4}, "dust": 0.35, "source": "https://…"},
    "moments": [{"at": 0.7, "tag": "Technique", "title": "A bathtub at sea", "text": "…", "anchor": [-640, 4, 0], "source": "https://…"}]
  }],
  "elements": [{"type": "suspension", "phase": "foundations", "…": "…"}]
}
```

## The catalogue: writing less without saying less

A temple is thirty-six elements of the same brick, and they differ by a phase, a range of columns, a handful of replacement drums. Writing the shared 1.4 kB `spec` thirty-six times is how a monument file becomes unreadable and expensive. Hoist it into a `catalogue` and let each element name the prototype it reuses:

```json
{
  "catalogue": {
    "doricTemple": {"type": "doricTemple", "center": [0, 0], "spec": {"…": "…"}},
    "doricTemple#phase+provenance": {"use": "doricTemple", "phase": "temple", "provenance": "measured"}
  },
  "elements": [
    {"use": "doricTemple#phase+provenance", "parts": ["columns"], "columns": "n1-n3 s1-s5 e1-e8 w1-w8"},
    "doricTemple"
  ]
}
```

- `"use": "name"` names a prototype; a bare string is the same thing. Any other key overrides it.
- Plain objects merge key by key, **arrays and scalars replace wholesale**, and `null` removes an inherited key.
- A prototype may itself start with `"use"`, so a family stays a readable chain instead of a pile of near-copies.
- Everything else in the file — phases, evidence, `note` — is never touched. A prototype that only repeats a value nobody else repeats is not a prototype, and `validate.mjs` says so.

Expansion is **exact**: the engine, the validator and the viewer only ever see the expanded monument, so the golden baselines of the Parthenon and Coutances stay byte-identical whatever the file says. That is the guarantee that makes the compact form safe to review like any other edit.

To convert a file that grew verbose, and to see what it would cost:

```
node scripts/catalogue.mjs monuments/<id>.json --stats    # report the real saving
node scripts/catalogue.mjs monuments/<id>.json --pack     # rewrite it, round-trip verified
```

`--pack` refuses to write anything that does not expand back to the exact monument it started from, and refuses a file that already uses a catalogue rather than renaming prototypes somebody chose. `node scripts/catalogue.test.mjs` checks the merge rules, the error messages, the exactness of all three reference monuments, and that the saving does not quietly regress.

Measured on the three community monuments: 114 753 → 62 130 estimated tokens, −45.9 %. The gain is entirely in `elements`; the phases and the evidence are the modeller's own prose and no format removes them. The Parthenon gives up 57 % of its file; Coutances, whose fifty-nine elements are all different work, only 8 %. Quote the number a benchmark measured, not the one a plan hoped for.

## Provenance of the elements

Every element says where it comes from, so the viewer's evidence mode can colour each piece and readers can tell a measurement from a guess:

- `"provenance": "measured"`: placed on the measured plan and sized from published dimensions;
- `"documented"`: read in the sources and the reference photos, without a measurement;
- `"interpreted"`: not documented, a reasoned reconstruction; it then needs a `"note"` saying what was interpreted and why.

## Photo reliefs

A `relief` element lays a photograph of carving on the model (see [bricks.md](bricks.md)). Its `image` lives in `<id>.evidence/reliefs/` next to the file and travels with it; its `credit` names the photo's page, author and licence, which validation checks against Wikimedia Commons, and the viewer's evidence mode lists. Its `provenance` is `documented` (the carving is photographed), and its `note` says what it shows. A relief has a phase like any element, `until` to take it down and `rebuild` to set it back.

## The scan

A monument may carry a capture of the building, shown by the viewer's **Captured** button (or `?scan`) in place of the model:

```json
"scan": {"file": "<id>.evidence/scan/capture.spz", "matrix": [16 numbers],
         "credit": {"author": "…", "license": "CC BY 4.0", "source": "https://…"},
         "fit": {"scale": 1, "points": 2000000, "median": 0.013, "p90": 0.04, "covered": 0.93, "rigid": true, "elements": [], "date": "2026-10-25"}}
```

- `file`: a `.splat`, `.ply`, `.spz`, `.ksplat` or `.sog` under `<id>.evidence/scan/`, 50 MB at most. Drawn by [Spark](https://sparkjs.dev), vendored in `kit/vendor/spark` and loaded only for a monument that has a scan.
- `matrix`: the 4 × 4 (column-major) that places the scan in the monument's own frame, `rotate` then turning it with everything else. `scripts/align-scan.mjs --write` computes it from three or more pairs of points and refines it.
- `fit`: how far the model stands from the scan, in metres: the median and 90th percentile of the distance of the scan's points to the model's surface, the share of the scan within 2 m of the model, and the same for each element with 200 points or more. It is the model's error where the scan is good; see [capture.md](capture.md).
- `credit`: needed for the gallery (`validate.mjs --strict`): who captured it, under a free licence, with a public page.

## Orientation

Model a building in the frame that suits it (its axis along x, say), then set `"rotate"` (degrees, counter-clockwise seen from above) to turn it onto its real orientation. `rotate` turns the elements, the moment `anchor`s and the worksite scenes; `view` and the reference viewpoints stay geographic (x east, z south), like the measured outline.

## Masonry

`"masonry": "mesh"` (default `"blocks"`) tells the Gothic bricks to build walls, gables, arches, roofs, balustrades, pinnacles, buttresses and the tracery of their windows as real surfaces instead of heaps of boxes. A wall is one continuous skin, cut by the true outline of its openings (sampled to a chord error that follows `visualStyle.quality`: 10 mm basic, 5 mm standard, 2.5 mm cinematic, so a pointed arch is a curve, not a staircase), with its reveals, sills and soffits; the joints are drawn by the material at the size of the courses in the photographs (about 0.32 m), staggered and fading out where a pixel is wider than a joint; each block has its own tone. Mouldings are sections swept along the outline (archivolts of rolls and hollows, string courses, copings); a window of three lights or more gets a plate of tracery with foiled lights (a lattice of quatrefoils in its head), a pane of leaded glass behind it, and a rose a plate of petals between spokes. Each piece is still laid in its phase from the bottom up, and a piece is a patch of that surface (a cell about 2.6 m × 0.9 m of wall, a 1.2 m run of moulding), so the chronology, the scaffolds and the evidence colours work as they do for blocks. See [geometry.md](geometry.md#continuous-masonry).

A window takes `lights` (2, 3 or 4; by default two up to 3.3 m wide, then three, then four from 5 m), `foils` (lobes of its foiled lights, 4 by default), `orders` (mouldings round it), `panes` (the height of a pane of leaded glass, in metres), `shafts: false` (no colonnettes up its jambs), `oculus: false`, and `twin: true` asks for the mullions and the tracery at all; an element takes `jointCourse` (the height of its courses, 0.32 m by default); a run of chevet level, `vault.end: false` and `vault.trim: [first, last]` draw its vault back from the end that another wall closes.

## Phases

- In chronological order. As many as the evidence supports, no fixed number.
- A short site gets ISO `from` and `to`: the month runs during the phase. Otherwise `when`: the date or period only (`"1609"`, `"12th century"`, `"1993 · 2009–2015"`). It is shown in the timeline; commentary goes in `text`.
- `title`: a few words. `text`: two sentences at most. `source`: a page actually read.
- No night by default. `"mood": "night"` (and `"sparkle": true` for metal) only when night lighting is itself the subject and sourced, like the Eiffel Tower's illumination. Openings, inscriptions and restorations are shown by day.

### Human-scale worksite scene

At least two construction phases in a standard build carry `scene`, unless the whole documented history has only one phase. The viewer places animated workers, material stacks, dust or sparks and optional temporary structures around the building, then brings the camera closer to `focus`.

- `craft`: `masonry`, `timber`, `metal`, `earth`, `restoration` or `mixed`; this chooses the restrained material and particle language.
- `at`: `[x, z]` centre of the activity. `focus`: `[x, y, z]` point the camera should feel close to. `distance` sets the human-scale camera distance in metres; frame at least one worker and the detail being built. `radius` controls the spread and `height` the work reached.
- `workers`: 0–18. Figures communicate human scale; do not use them to assert an unsupported workforce count. `figures`: `"traditional"` (shirt, trousers, hat) or `"modern"` (helmet and vest); by default modern where the scaffold is of steel. `clothes`: the palette they are dressed in.
- `materials`, `scaffold`, `hoist`: include only what the scene's source supports. Temporary structures grow during the phase, so describe their geometry instead of using `true`.
  - `scaffold`: fitted to the work. It follows the outer face of the pieces laid during the phase at a constant gap, rises lift by lift as the masonry beside it reaches each lift's foot, and comes down when the phase ends. `kind`: `facade` (over `width` metres of wall centred on the scene, around the monument's centre), `ring` (around the scene's centre: an apse, a round tower; `arc` and `start` in degrees, `radius` for its reach) or `tower` (all round the scene's centre: a pier, a tower, a spire; `width` for its reach). `base` (metres): where it stands, for a scaffold set on a roof or on a lower storey; `height`: the highest piece it serves above `base`; `rise: "first"`: put up before the work, for a restoration or a spire built inside its cage; `material`: `timber` (poles, putlogs into the wall, plank decks, braces, ladders, before the industrial age) or `steel` (tubes on two rows of standards, transoms, boards, toe boards and guard rails); `levelHeight` (2 m), `gap` from the wall (0.45 m), `depth` of the decks, `zone` (3 m: how deep the outer face is).
  - `hoist.kind`: `gin-pole`, `treadwheel` or `steam-crane`. Without `offset`, it stands just outside the scaffold with its boom over the wall. Use `height`, `offset: [x, z]`, and `from`/`to` for the base height followed during the phase. `start` and `end` (0–1) limit the moving interval.
  - Match both to the geometry, period and phase: never place a straight facade scaffold against a round tower, or repeat a modern crane in an earlier phase. If the exact arrangement is unknown, state the reconstruction in `evidence.uncertainties`.
- `dust`: 0–1. For `metal`, these points read as brief sparks; otherwise as fine construction dust.
- `source`: a page in `evidence.sources` that supports the craft, tool or temporary structure. Put uncertain staging in `evidence.uncertainties`.

## Moments

- `at`: position in the phase, 0 to 1. Playback slows down on each moment and the camera eases towards it. List a phase's moments in increasing `at`: the viewer shows the last listed moment whose time has passed. Pieces are laid from the bottom up between 0.03 and 0.89 of a phase, so a moment about the top of a tower or a spire belongs late; `node scripts/chronology.mjs` tells you when the pin has nothing standing at it.
- `tag`: one short word for the kind of moment (Technique, Figure, Anecdote, Controversy, Plan, Restoration…). Vary them within a file.
- `anchor`: the point, in metres, where the pin goes. `distance` optionally moves the camera much closer for a tool, joint or ornament; keep enough context to understand what is being built.
- `title` and `text`: one true, surprising detail, with its `source`.
- `inside: true` and `look` [azimuth, elevation] (degrees, as a reference viewpoint's): a moment inside the building. While it shows, the camera swings round to look from that side and the section view opens on the camera's side of the view's centre, unless the reader has set the section view or moved the camera themselves. The cut passes a little in front of the anchor (the camera eases most of the way to it), so put the anchor just in front of the object, on the camera's side.
- Use at least one close construction moment: a joint, tool, temporary support or material operation. Its anchor should be where the viewer can see the corresponding geometry while reading it.

## Dates the sources disagree on

When the pages read give different dates for something the film shows, the film does not settle it quietly. The phase or the moment that states that date takes `disputed`, and the viewer shows each page's date on its card, hatches the phase's bar on the timeline and halves the moment's diamond:

```json
"disputed": [{"what": "Louis XIV's first stay", "claims": [
  {"when": "1650", "source": "https://fr.wikipedia.org/wiki/Ch%C3%A2teau_de_Chambord"},
  {"when": "1660", "source": "https://www.chambord.org/fr/histoire/le-chateau/les-personnages-marquants/"}]}]
```

The card reads: *Sources disagree on Louis XIV's first stay: 1650 (fr.wikipedia.org) or 1660 (chambord.org)*, each site linked to its page.

- `what`: what the dates are the date of, in a few words that follow "Sources disagree on".
- `claims`: one per page, at least two, and at least two different dates; two pages that give the same date are two claims, and the card puts them together. `when` is written like a phase's `when`; `source` is one of the pages in `evidence.sources`.
- The film still has to place the work: the phase's own `when` (or `from` and `to`) follows one claim, or only what the claims agree on (Osaka Castle's walls are "From 1620" because the pages end the works in 1628 or 1629). Where the text can step round the disputed date, let it: Chambord's card gives the number of Louis XIV's stays and the last, on which the pages agree. Say in `evidence.uncertainties` which date the film follows and why.
- Only for dates the film shows or a card states. A disagreement about something the film does not use stays in `evidence.uncertainties`.
- `what`, and a `when` with words in it ("7 November 1931"), are translated with the rest of the card (`scripts/monument-i18n.mjs`); dates in numbers and the pages are not.

`validate.mjs` refuses a dispute without `what`, with fewer than two claims, with two claims from one page or with a single date, and, from the standard build on, a claim whose page is not in `evidence.sources`.

## view

- `target`, `distance`: the final framing. `width`: horizontal extent to frame. `start`: a close shot at the beginning; the camera pulls back to the final framing.
- `radius`, `height`, `drop`: scale of the studio floor and its shadows, of the drop animation and of the height readout.
- `direction`: the camera's starting direction.
- `night`: colour of the metal's illumination, used only with a `"mood": "night"` phase.

## visualStyle

Standard builds use the bundled semi-realistic PBR library. Set `quality` and `materialPreset`, and `surfaces` where the building needs it. The viewer shows the monument alone in the studio: no sky, ground, vegetation, water or surroundings. The complete catalog and schema are in [visual-style.md](visual-style.md).

## live and facts

- `live`: `height` (highest point reached; scaffolds and ridge ornaments are left out) or `count` (pieces carrying a `tag`).
- `facts`: three short sourced figures.

## evidence

Everything a reader needs to trust the model. `validate.mjs --standard` checks the focused local result; `--strict` adds the publication requirements. Paths are relative to the monument file; supporting files live in `<id>.evidence/`.

```json
"evidence": {
  "size": "building",
  "identity": "Torre di Pisa, Piazza del Duomo, Pisa, Italy (OSM relation 12982355)",
  "sources": [{"url": "https://…", "read": "What this page says that the model uses"}],
  "plan": {"source": "OpenStreetMap relation 12982355", "url": "https://www.openstreetmap.org/relation/12982355", "outline": "<id>.evidence/outline.json"},
  "references": [{"url": "https://commons.wikimedia.org/wiki/File:…", "view": "east", "azimuth": 80, "elevation": 3, "distance": 95, "target": [0, 28, 0]}],
  "features": [{"text": "Six galleries of 30 columns each", "source": "https://…"}],
  "geometry": "What is measured, and from where",
  "comparisons": [
    {"pass": 1, "captures": ["<id>.evidence/compare/pass-1/ref-0.jpg"], "phases": ["…"], "gaps": ["…"], "fixed": ["…"]},
    {"pass": 2, "captures": ["…"], "gaps": ["…"], "remaining": ["…"]}
  ],
  "uncertainties": ["What is estimated or simplified"]
}
```

- `size`: building, ensemble or site (step 1).
- `sources`: pages that were opened and read, with what each says. Every phase and moment `source` must be one of them. Search results are not sources.
- `plan.outline`: the measured outline as `{"source", "url", "origin": [lat, lon], "polygons": [[[x, z], …]], "lines": [[[x, z], …]]}` (closed polygons, and open lines for rings split into several ways) in local metres around `origin` (x east, z south, same origin as the model). `scripts/plan.mjs` fills both the outline and the model seen from above to their outer envelope (gaps under 3 m closed, as an aerial trace would) and measures the distance between their edges both ways; it draws `<id>.evidence/plan.svg` with the edges further apart than the tolerance in red. It records the result in `plan.fit` (`p90`, `max`, `coverage`, `overflow`), which the viewer shows and validation checks against a fresh measurement. The tolerance is 3 m at the 90th percentile; `plan.tolerance` may raise it to 5 m at most, with the reason in `plan.toleranceReason`. The model must also cover 85% of the outline and add no more than 20% outside it.
- `references`: standard mode uses at least three photos from two sides; publication uses four from three sides. `azimuth` is the direction of the photographer seen from the building, in degrees from north; `elevation` (negative looks up) and `distance` place the camera, `target` is the point it looks at, and `fov` (optional, degrees) matches a wide-angle lens: put the camera where the photographer stood rather than moving it back. `phase` (optional) names the state the photo shows, for an old photo or a state since changed; by default the model is captured at the end of the last daylight phase. `calibration` (`points`, `rms`) is written by `scripts/calibrate.mjs`: the viewpoint fitted on points recognised in the photo, and the remaining gap in percent of the photo's height. `silhouette` (`ground`, `ignore`, `trees`, `holes`, and the `iou` that `scripts/silhouette.mjs --write` records) says how the photo is cut for the outline test, which holds the model to it ([fidelity.md](fidelity.md#compare-fix-repeat)); its mask is `<id>.evidence/silhouette/ref-<n>.png`.
- `features`: what makes the building recognisable, each with the page that says so.
- `comparisons`: written by `scripts/compare.mjs` (captures, overlays of each photo on its capture, phase captures) and by you (gaps, fixed, remaining).

`modelNote` is the one-line version shown in the page.

## context and labels (optional, hidden by default)

- `context.buildings`: `[{"points": [[x, z], …], "holes": [[[x, z], …]], "height": 18.4}]`, neighbours at their real height.
- `context.streets`: `[{"name": "Rue …", "width": 12, "points": [[x, z], …]}]`.
- `labels`: `[{"text": "Garden", "at": [x, y, z]}]`, names of streets, courtyards, gardens.

Do not generate these for a standard building unless the user asks for the surroundings. The viewer reveals them with `?context`, or permanently when `view.context` is `true`. Keep label anchors on the ground (`y` near `0`) and use them only when a name adds information the geometry cannot show.

## bricks (optional)

`"bricks": "<id>.bricks.js"`: a module next to the file whose default export holds extra generators. See [bricks.md](bricks.md).
