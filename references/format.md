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

What a reader needs to trust the model: `identity` (name, address), `sources`, `references` (reference photos with their viewing azimuth), `features` (the architectural reading, each item sourced), `geometry` (what is measured and where it comes from) and `uncertainties` (what is estimated or simplified). `modelNote` is the one-line version shown in the page.

## context and labels (optional, static, visible from the start)

- `context.buildings`: `[{"points": [[x, z], …], "holes": [[[x, z], …]], "height": 18.4}]`, neighbours at their real height.
- `context.streets`: `[{"name": "Rue …", "width": 12, "points": [[x, z], …]}]`.
- `labels`: `[{"text": "Garden", "at": [x, y, z]}]`, names of streets, courtyards, gardens.

## bricks (optional)

`"bricks": "<id>.bricks.js"`: a module next to the file whose default export holds extra generators. See [bricks.md](bricks.md).
