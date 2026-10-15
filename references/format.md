# The monument file

One building = one JSON file, `monuments/<id>.json` in the user's project (`examples/<id>.json` in this repository). The id is the file name: lowercase letters, digits and dashes. The viewer opens it at `http://127.0.0.1:4173/#<id>`.

```json
{
  "id": "golden-gate", "name": "Golden Gate Bridge", "place": "San Francisco · California · USA", "seed": 1937,
  "view": {"target": [0, 95, 0], "distance": 1500, "width": 2100, "radius": 1100, "height": 227,
           "start": {"target": [640, 40, 0], "distance": 420}, "water": true},
  "live": [{"label": "Height", "kind": "height", "unit": "m"}],
  "facts": [{"value": "1,280 m", "label": "main span"}],
  "modelNote": "What is measured, what is read from photos, what is simplified.",
  "evidence": {"identity": "…", "sources": ["https://…"], "references": [], "features": [], "geometry": "…", "uncertainties": ["…"]},
  "phases": [{
    "id": "foundations", "from": "1933-01-05", "to": "1933-11-07", "title": "The foundations", "text": "…", "source": "https://…",
    "moments": [{"at": 0.7, "tag": "Technique", "title": "A bathtub at sea", "text": "…", "anchor": [-640, 4, 0], "source": "https://…"}]
  }],
  "elements": [{"type": "suspension", "phase": "foundations", "…": "…"}]
}
```

## Phases

- In chronological order. As many as the evidence supports, no fixed number.
- A short site gets ISO `from` and `to`: the month runs during the phase. Otherwise `when`: the date or period only (`"1609"`, `"12th century"`, `"1993 · 2009–2015"`). It is shown in the timeline; commentary goes in `text`.
- `title`: a few words. `text`: two sentences at most. `source`: a page actually read.
- No night by default. `"mood": "night"` (and `"sparkle": true` for metal) only when night lighting is itself the subject and sourced, like the Eiffel Tower's illumination. Openings, inscriptions and restorations are shown by day.

## Moments

- `at`: position in the phase, 0 to 1. Playback slows down on each moment and the camera eases towards it.
- `tag`: one short word for the kind of moment (Technique, Figure, Anecdote, Controversy, Plan, Restoration…). Vary them within a file.
- `anchor`: the point, in metres, where the pin goes.
- `title` and `text`: one true, surprising detail, with its `source`.

## view

- `target`, `distance`: the final framing. `width`: horizontal extent to frame. `start`: a close shot at the beginning; the camera pulls back to the final framing.
- `radius`, `height`, `dots`, `drop`: scale of the ground pattern, of the drop animation and of the height readout.
- `direction`: the camera's starting direction.
- `water`: the ground becomes water.
- `light`: `"day"` for a higher, neutral daylight when whiteness is a feature (plaster, marble); the default is a low golden sun.
- `night`: colour of the metal's illumination, used only with a `"mood": "night"` phase.

## live and facts

- `live`: `height` (highest point reached; scaffolds and ridge ornaments are left out) or `count` (pieces carrying a `tag`).
- `facts`: three short sourced figures.

## evidence

Everything a reader needs to trust the model, and what `validate.mjs --strict` checks. Paths are relative to the monument file; supporting files live in `<id>.evidence/`.

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
- `plan.outline`: the measured outline as `{"source", "url", "polygons": [[[x, z], …]], "lines": [[[x, z], …]]}` (closed polygons, and open lines for rings split into several ways) in local metres (x east, z south, same origin as the model). `scripts/plan.mjs` measures the gap and draws `<id>.evidence/plan.svg`; `plan.tolerance` (at most 5 m) only for a building known from a published plan.
- `references`: at least four photos from at least three sides; `azimuth` is the direction of the photographer seen from the building, in degrees from north; `elevation` (negative looks up) and `distance` place the camera, `target` is the point it looks at, and `fov` (optional, degrees) matches a wide-angle lens: put the camera where the photographer stood rather than moving it back.
- `features`: what makes the building recognisable, each with the page that says so.
- `comparisons`: written by `scripts/compare.mjs` (captures) and by you (gaps, fixed, remaining).

`modelNote` is the one-line version shown in the page.

## context and labels (optional, static, visible from the start)

- `context.buildings`: `[{"points": [[x, z], …], "holes": [[[x, z], …]], "height": 18.4}]`, neighbours at their real height.
- `context.streets`: `[{"name": "Rue …", "width": 12, "points": [[x, z], …]}]`.
- `labels`: `[{"text": "Garden", "at": [x, y, z]}]`, names of streets, courtyards, gardens.

## bricks (optional)

`"bricks": "<id>.bricks.js"`: a module next to the file whose default export holds extra generators. See [bricks.md](bricks.md).
