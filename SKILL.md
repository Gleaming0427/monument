---
name: monument
description: Builds a researched, measured, animated 3D reconstruction of how a named building was built and transformed (historic or contemporary, anywhere in the world), placed on its real plan, compared with photos, and opens it in a live viewer. Use for /monument <building, city, country>, for any request to see or explain how a building, castle, bridge, tower, cathedral, palace or monument was built, and to publish a monument to the community gallery.
---

# Monument

Name a building in one line, and you get it rising piece by piece: on its real plan, phase by dated phase, every date and figure sourced.

## The one idea that matters

**The building is the evidence.** Every phase is dated and cites a page you actually read. Every shape is measured or read from photos. Anything interpreted is said to be interpreted. A beautiful model of the wrong building, or of an invented history, is a failure.

`<skill>` below is the folder that holds this file. The page needs no install: the viewer, Three.js and the fonts ship in `<skill>/kit`. It needs Node 20 or later to serve it.

## Before anything: check your tools

The standard build needs web pages you can open and read, images you can inspect, and Node 20+. A local Chrome or Chromium makes the comparison sheet automatic; when it is unavailable, use the active browser to inspect and capture the same views. Never fall back to memory or search-result summaries.

## When someone asks for a building

`/monument <building, city, country>` in Claude Code, OpenCode or Antigravity, `$monument …` in Codex, or any request to see how a building was built.

### Standard build: detailed, focused, usually 8–15 minutes

Use this mode for one named structure. Spend the time on the building itself: its silhouette, exact storey and bay counts, roof profile, openings, structure, materials and at least six distinctive details. **Do not add neighbouring houses, streets or map labels unless the user asks for context or it is essential to understand the building.** Context is not part of the default result.

1. **Scope it.** Build the named structure only. For an ensemble or whole site, state the larger scope and propose the main structure first.
2. **Generate the measured skeleton first.** Run `node <skill>/scripts/scaffold.mjs "<building>, <city>, <country>" --out monuments`. It resolves the named feature, downloads only its OpenStreetMap outline, chooses a conservative architecture family, writes the JSON and plan evidence, and produces a detailed present-day shell with openings. Open this result immediately. If the resolver finds no closed outline, do not substitute a nearby building: use an address, cadastral plan or user-supplied outline ([references/scaffold.md](references/scaffold.md)).
3. **Reuse before researching.** Open the closest existing example and the brick table. Reuse its measured structure and generators when they fit; do not repeat solved geometry.
4. **Research in one batch.** Open at least two authoritative pages from different sites and three useful photos from at least two sides. Extract identity, dimensions, dated phases and the six or more features that make this building recognisable. A search result is not a source.
5. **Replace the skeleton's estimates.** Check height, storeys, roof and massing against the sources. Keep the downloaded outline, rerun `plan.mjs`, and remove the scaffold warnings only when their uncertainty is resolved. Do not collect the surrounding block unless context was requested ([references/real-plan.md](references/real-plan.md)).
6. **Model coarse to fine.** The footprint, orientation, openings and base mass already exist; spend the manual work on the true roof profile, structural system and signature details. Give every feature in `evidence.features` a visible counterpart. Write a new architecture brick only for the detail the existing bricks cannot express ([references/fidelity.md](references/fidelity.md), [references/bricks.md](references/bricks.md)).
7. **Write and open it.** Refine `monuments/<id>.json`, run the viewer, and play the complete timeline ([references/format.md](references/format.md)).
8. **One focused comparison.** Run `compare.mjs ... --pass 1 --quick`, inspect the three reference views, fix the visible gaps, rerun the same command to refresh the captures, and record `gaps`, `fixed` and `remaining`. The quick comparison skips redundant phase screenshots; play the timeline once instead.
9. **Validate.** Run `node <skill>/scripts/validate.mjs --standard monuments/<id>.json`, then report what is measured, documented and interpreted.

If the architecture needs a brand-new complex brick, say that the first build can take 20–35 minutes. Do not spend that time on decorative context.

### Publication build

Use this only when the user asks for maximum documentation or wants to publish. Add at least three pages from two sites, four photos from three sides, the complete plan evidence, phase captures and a second comparison pass. `node <skill>/scripts/validate.mjs --strict monuments/<id>.json` is the publication gate. A standard build is a valid local result; it is not publishable until strict validation passes.

## Rules

- **Never invent.** No dates, foundations, architects, anecdotes or earlier states to fill a timeline. Phases follow the evidence, with no fixed number. Where the history of the works is thin, show the attested states and label any schematic construction as such.
- **Explanation is not evidence.** A bottom-up animation does not prove the real order of works; say when a phase explains rather than documents.
- **Unknown building**: explain what you searched and ask for an address, a link, a plan or a photo. Offer a hypothetical model only under that name.
- **Keep what was reused.** Do not show a whole block demolished for a new storey: take the old roof off, raise the walls, put the new roof on.
- **Daylight.** No night scene unless night lighting is itself the subject, and sourced.
- **No look-alikes.** Never replace the requested building with a generic house, a variant of another monument, or its name on an existing model.
- **Details beat scenery.** Use the detail budget on the requested building. Neighbours, roads and labels are opt-in context, never a completion requirement.
- **The scaffold is a start, not evidence of history.** It automates mapped geometry for buildings that have a usable outline; it does not infer dates, architects, hidden structure or past states.
- **Do not claim** exhaustive historical coverage or an "exact" model.

## Publish to the community gallery

When the user asks to publish or share a monument ("publish this monument to the gallery"):

1. Ask for a title (default: the building's name), confirm the id, and ask for their GitHub name and the model that built it.
2. Show what will be sent: run `node <skill>/scripts/publish.mjs monuments/<id>.json --author <name> --model "<model>" --prompt "<their original request>"` without `--yes`, and show its output. It refuses a monument that fails `validate.mjs --strict`: a draft cannot be published.
3. On a clear yes, run it again with `--yes`. It forks `Gleaming0427/monument` with the GitHub CLI, adds `community/<id>/` (the file, its bricks and its `.evidence` folder) and opens the pull request. Give the user the link.

Without a terminal or the GitHub CLI, point them to the "Submit a monument" form on the repository, with the file in a Gist. The gallery rebuilds every monument from its file and photographs it; bricks that come with a monument are reviewed by a maintainer first.

## The collection

`<skill>/examples/` holds world-famous monuments built with the skill: `colosseum` (rings fitted to OpenStreetMap's 3D outline, built, then ruined), `leaning-tower-of-pisa` (three campaigns, with its lean over time) and `eiffel-tower`. Each passes `validate.mjs --strict`, with its sources, outline, control plan, reference photos and comparison passes in `examples/<id>.evidence/`. Open the closest one before you start: it shows the level of detail and evidence expected.

To share a construction as an animation, `node <skill>/scripts/record.mjs <id> --cam <azimuth>,<elevation>,<distance>,<x>,<y>,<z>` records it from the first piece to the last phase as a GIF and an MP4 (it needs Chrome and ffmpeg).
