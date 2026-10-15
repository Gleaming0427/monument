---
name: monument
description: Builds a researched, measured, animated 3D reconstruction of how a named building was built and transformed (historic or contemporary, anywhere in the world), placed on its real plan, compared with photos, and opens it in a live viewer. Use for /monument <building, city, country>, for any request to see or explain how a building, castle, bridge, tower, cathedral, palace or monument was built, and to publish a monument to the community gallery.
---

# Monument

Name a building in one line, and you get it rising piece by piece: on its real plan, phase by dated phase, every date and figure sourced.

## The one idea that matters

**The building is the evidence.** Every phase is dated and cites a page you actually read. Every shape is measured or read from photos. Anything interpreted is said to be interpreted. A beautiful model of the wrong building, or of an invented history, is a failure.

`<skill>` below is the folder that holds this file. The page needs no install: the viewer, Three.js and the fonts ship in `<skill>/kit`. It needs Node 20 or later to serve it.

## When someone asks for a building

`/monument <building, city, country>` in Claude Code, OpenCode or Antigravity, `$monument …` in Codex, or any request to see how a building was built.

1. **Size it, out loud.** Say what you will build and roughly how long it takes:
   - *Building*: one structure (a tower, a bridge, a keep), 30–90 min. Build it without asking.
   - *Ensemble*: a building with its wings, courtyard and neighbours, 2–4 h. Announce it, then build it.
   - *Site*: a whole castle, abbey or old town, 6 h or more. Never start one without the user: propose the main building first and list what the full site would add.
2. **Start from what exists.** If `monuments/<id>.json` (in the user's project) or `<skill>/examples/<id>.json` already holds this building, treat it as a draft: copy it into `monuments/`, run it through the fidelity pass below and improve it. Never answer "pick one from the collection".
3. **Identify and document.** Resolve name, city, country, historic names and address; ask only if several buildings remain plausible. Search in the local language and with local names: national heritage inventories, city archives, the institution that occupies it, architects, museums, scholarly work. Write a short note of sources and uncertainties.
4. **Place it on the real plan**: footprints, heights and neighbours from the land registry or OpenStreetMap ([references/real-plan.md](references/real-plan.md)).
5. **Read the architecture from photos**: at least four reference photos from different sides, and the list of features that make the building recognisable ([references/fidelity.md](references/fidelity.md)).
6. **Write `monuments/<id>.json`** in the user's current folder ([references/format.md](references/format.md)): phases, moments, elements, evidence.
7. **Bricks.** Use the bricks that render this architecture faithfully; write new ones for what they cannot ([references/bricks.md](references/bricks.md)). Name them after the architecture, never after the building.
8. **Check**: `node <skill>/scripts/validate.mjs monuments`, and `node --check` on any bricks module.
9. **Open it**: run `node <skill>/scripts/serve.mjs monuments` in the background (port 4173, or the next free one) and show `http://127.0.0.1:4173/#<id>` in the browser if you have one; otherwise give the link. The page does not work opened as a file.
10. **Compare with the photos, fix, repeat**, at least twice: capture the model from each photo's viewpoint (`node <skill>/scripts/capture.mjs <id> --cam <azimuth>,<elevation>,<distance>,<x>,<y>,<z>`), list the gaps, fix them ([references/fidelity.md](references/fidelity.md)). Also play the timeline: each phase must read, the end must be the building as it stands.
11. **Report** what is measured, what is documented and what is interpreted, and the gaps that remain. Then offer to publish it to the community gallery.

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
2. Show what will be sent: run `node <skill>/scripts/publish.mjs monuments/<id>.json --author <name> --model "<model>" --prompt "<their original request>"` without `--yes`, and show its output.
3. On a clear yes, run it again with `--yes`. It forks `Gleaming0427/monument` with the GitHub CLI, adds `community/<id>/` and opens the pull request. Give the user the link.

Without a terminal or the GitHub CLI, point them to the "Submit a monument" form on the repository, with the file in a Gist. The gallery rebuilds every monument from its file and photographs it; bricks that come with a monument are reviewed by a maintainer first.

## The collection

`<skill>/examples/` holds the world's most recognised monuments built with the skill so far: `eiffel-tower` and `leaning-tower-of-pisa` (a campanile built in three campaigns, with its lean over time). Open the closest one before you start: it shows the level of detail and evidence expected.

To share a construction as an animation, `node <skill>/scripts/record.mjs <id> --cam <azimuth>,<elevation>,<distance>,<x>,<y>,<z>` records it from the first piece to the last phase as a GIF and an MP4 (it needs Chrome and ffmpeg).
