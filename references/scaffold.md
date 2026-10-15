# Automatic scaffold

`scripts/scaffold.mjs` turns a building name into a measured, immediately viewable draft. It removes the repetitive first pass: finding the mapped object, converting longitude and latitude to local metres, orienting its bounding box, choosing a broad architecture family, writing the JSON and checking the model against the footprint.

```sh
node <skill>/scripts/scaffold.mjs "Palais consulaire de Toulouse, Toulouse, France" --out monuments
```

The command writes:

- `monuments/<id>.json`, with one present-day survey phase and base volumes;
- `monuments/<id>.evidence/outline-source.json` (or `.xml` when a point needed an OSM map lookup);
- `monuments/<id>.evidence/outline.json`, converted to local metres;
- `monuments/<id>.evidence/plan.svg`, proving that the generated shell sits on the outline.

It normally completes in one map lookup plus one local build. No browser automation, package install or model-generated geometry code is involved.

## Options

| Option | Use |
| --- | --- |
| `--family auto` | Select from map tags and the name. This is the default. |
| `--family <name>` | Override with `block`, `civic`, `religious`, `castle`, `tower`, `amphitheatre`, `japanese-keep`, `modern` or `bridge`. |
| `--height <m>` | Supply a known total height. It takes priority over the OSM `height` tag. |
| `--floors <n>` | Supply a known storey count. It takes priority over `building:levels`. |
| `--id <slug>` | Override the file id. |
| `--input <file.json>` | Rebuild deterministically from a saved Nominatim response without another geocoding request. |
| `--force` | Replace an existing generated draft. Without it, existing work is protected. |

## What the family changes

Every family keeps the measured polygon. The `footprintBuilding` brick then generates masonry courses, storey bands, framed openings with mullions, panelled doors, cornices, a parapet and a roof fitted to that polygon. The family changes conservative base massing and proportions: religious buildings narrow their openings, towers become taller and more vertical, amphitheatres get an arcaded ellipse, fortified buildings get a crenellated shell, and modern buildings get a flatter glazed rhythm.

These choices are working geometry. The JSON records the reason for the family, whether height and storeys came from map tags or defaults, and every unresolved estimate in `evidence.uncertainties`. Research must replace those estimates before standard validation.

## Resolution and safe failure

Nominatim results with a polygon are used directly. If the named object resolves only to a point, the script downloads a small 160 m OpenStreetMap box and scores closed building ways by name, building tags and distance. If it still cannot find a closed outline, it stops. It never draws a generic rectangle or silently uses a neighbouring house.

The generator deliberately creates one phase called `Current mapped state`. It does not invent a construction chronology. After generation, research the building, replace the working height and roof, split the real dated phases, add photographs and recognisable features, then run the normal comparison and `validate.mjs --standard` workflow.
