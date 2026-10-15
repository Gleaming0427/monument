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

This skill needs four abilities. Check them first, and if one is missing, tell the user which one and stop; never fall back to modelling from memory or from a search engine's summaries:
- **open web pages** and read them (a fetch or browser tool), not only search;
- **look at images** (a browser, or reading image files), to see the reference photos and the captures;
- **run Node 20+**, for the viewer and the scripts;
- **a local Chrome or Chromium**, for `compare.mjs` and `plan.mjs` captures (set `CHROME=` if it is not found).

## When someone asks for a building

`/monument <building, city, country>` in Claude Code, OpenCode or Antigravity, `$monument …` in Codex, or any request to see how a building was built.

**Every step leaves evidence in the monument file, and `node <skill>/scripts/validate.mjs --strict monuments/<id>.json` checks all of it.** Until it passes, the monument is a draft: never present a draft as the result, never skip a step to save time. If the user asks for something quick, say that it will be a draft and which steps it skips.

| Step | What you do | Evidence `--strict` checks |
|---|---|---|
| 1. Size it | Say what you will build and how long it takes: *building* (one structure, 30–90 min), *ensemble* (wings, courtyard, neighbours, 2–4 h, announce it first), *site* (a whole castle or old town, 6 h+, never without the user: propose the main building first) | `evidence.size` |
| 2. Start from what exists | If `monuments/<id>.json` or `<skill>/examples/<id>.json` holds this building, copy it into `monuments/` and take it through every step again | — |
| 3. Read the sources | Identify the building (name, address, historic names). Open and read the pages: heritage inventories, the institution that occupies it, scholarly work, encyclopaedias, in the local language. A search result is not a source; only a page you opened is | `evidence.identity`; `evidence.sources` ≥ 3 pages from ≥ 2 sites, each `{"url", "read": "what this page says"}`; every phase and moment cites one of them; no mention of search results or snippets |
| 4. Place it on the real plan | Fetch the measured outline (land registry, BD TOPO, OpenStreetMap), convert it to local metres, save it as `monuments/<id>.evidence/outline.json`, fit the model to it, then `node <skill>/scripts/plan.mjs monuments/<id>.json` ([references/real-plan.md](references/real-plan.md)) | `evidence.plan` `{"source", "url", "outline"}`; the model within 3 m of the outline on 90% of its sides (measured by the script); `plan.svg` |
| 5. Read the architecture | Open at least four photos taken from at least three sides; note each one's viewpoint; list the features that make the building recognisable ([references/fidelity.md](references/fidelity.md)) | `evidence.references` ≥ 4, each `{"url", "view", "azimuth", "elevation", "distance", "target"}`, azimuths in ≥ 3 quadrants; `evidence.features` ≥ 5, each `{"text", "source"}` |
| 6. Write the file | `monuments/<id>.json`: phases, moments, elements, `view.light`, `modelNote`, uncertainties ([references/format.md](references/format.md)) | `view.light`; `modelNote` |
| 7. Bricks | Reuse the bricks that render this architecture faithfully; write new ones for the rest, named after the architecture ([references/bricks.md](references/bricks.md)) | every element uses a known brick |
| 8. Open it | `node <skill>/scripts/serve.mjs monuments` in the background; show `http://127.0.0.1:4173/#<id>`; play the timeline | — |
| 9. Compare, fix, compare again | `node <skill>/scripts/compare.mjs monuments/<id>.json --pass 1` photographs the model from every reference viewpoint and every phase. Look at each photo next to its capture, write the gaps, fix them, then `--pass 2`, and more passes until only deliberate simplifications remain | `evidence.comparisons` ≥ 2 passes, each with its captures and `gaps`; `fixed` after every pass but the last; `remaining` on the last, also in `uncertainties` |
| 10. Validate | `node <skill>/scripts/validate.mjs --strict monuments/<id>.json` | all of the above |
| 11. Report | What is measured, documented and interpreted, the remaining gaps, and an offer to publish | — |

## Rules

- **Never invent.** No dates, foundations, architects, anecdotes or earlier states to fill a timeline. Phases follow the evidence, with no fixed number. Where the history of the works is thin, show the attested states and label any schematic construction as such.
- **Explanation is not evidence.** A bottom-up animation does not prove the real order of works; say when a phase explains rather than documents.
- **Unknown building**: explain what you searched and ask for an address, a link, a plan or a photo. Offer a hypothetical model only under that name.
- **Keep what was reused.** Do not show a whole block demolished for a new storey: take the old roof off, raise the walls, put the new roof on.
- **Daylight.** No night scene unless night lighting is itself the subject, and sourced.
- **No look-alikes.** Never replace the requested building with a generic house, a variant of another monument, or its name on an existing model.
- **Do not claim** a universal geometry generator, exhaustive historical coverage, or an "exact" model.

## Publish to the community gallery

When the user asks to publish or share a monument ("publish this monument to the gallery"):

1. Ask for a title (default: the building's name), confirm the id, and ask for their GitHub name and the model that built it.
2. Show what will be sent: run `node <skill>/scripts/publish.mjs monuments/<id>.json --author <name> --model "<model>" --prompt "<their original request>"` without `--yes`, and show its output. It refuses a monument that fails `validate.mjs --strict`: a draft cannot be published.
3. On a clear yes, run it again with `--yes`. It forks `Gleaming0427/monument` with the GitHub CLI, adds `community/<id>/` (the file, its bricks and its `.evidence` folder) and opens the pull request. Give the user the link.

Without a terminal or the GitHub CLI, point them to the "Submit a monument" form on the repository, with the file in a Gist. The gallery rebuilds every monument from its file and photographs it; bricks that come with a monument are reviewed by a maintainer first.

## The collection

`<skill>/examples/` holds world-famous monuments built with the skill: `colosseum` (rings fitted to OpenStreetMap's 3D outline, built, then ruined), `leaning-tower-of-pisa` (three campaigns, with its lean over time) and `eiffel-tower`. Each passes `validate.mjs --strict`, with its sources, outline, control plan, reference photos and comparison passes in `examples/<id>.evidence/`. Open the closest one before you start: it shows the level of detail and evidence expected.

To share a construction as an animation, `node <skill>/scripts/record.mjs <id> --cam <azimuth>,<elevation>,<distance>,<x>,<y>,<z>` records it from the first piece to the last phase as a GIF and an MP4 (it needs Chrome and ffmpeg).
