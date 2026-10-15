<h1 align="center">Monument</h1>

<p align="center"><b>A skill that builds any named building stone by stone, on its real plan, with every phase dated and sourced.</b><br>Runs in Claude Code, Codex, OpenCode and Antigravity.</p>

<p align="center">
  <a href="https://gleaming0427.github.io/monument/"><b>Website and live collection</b></a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#usage">Usage</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#community-gallery">Community gallery</a> ·
  <a href="#install">Install</a> ·
  <a href="#limits">Limits</a>
</p>

<p align="center"><img src=".github/assets/leaning-tower-of-pisa.gif" width="560" alt="The Leaning Tower of Pisa rising storey by storey, then leaning south as the years go by, and being pulled back by the engineers."></p>
<p align="center"><sub><code>examples/leaning-tower-of-pisa.json</code>: three campaigns from 1173 to 1372, then the lean that reaches 5.5° in 1990 and is brought back to 3.97° in 2001.</sub></p>

---

Name a building, and Claude researches its history, places it on its real plan, reads its architecture from photos and builds it as a live 3D scene you can turn and move through time. Thousands of small solid pieces drop into place, phase after dated phase; construction moments are pinned on the pieces they concern; every date and figure links to its source.

## Quick start

```sh
npx skills add Gleaming0427/monument
```

The CLI asks which agents to set up (Claude Code, Codex, OpenCode, Antigravity). Then, in any folder:

```text
/monument Himeji Castle, Himeji, Japan
```

In Codex, type `$monument`. No API keys and nothing to `npm install`: the viewer, Three.js and the fonts ship with the skill. It needs Node 20 or later.

## Usage

Name the building, its city and its country. Deciding how to build it is Claude's job.

```text
/monument Taj Mahal, Agra, India
/monument Notre-Dame de Paris, from 1163 to the 2024 reopening
/monument Mont-Saint-Michel, the abbey and the village
$monument Sagrada Família, Barcelona
```

Claude writes `monuments/<id>.json` in your folder, starts the local viewer and opens `http://127.0.0.1:4173/#<id>`. You can also start the viewer yourself:

```sh
node ~/.claude/skills/monument/scripts/serve.mjs monuments
```

## How it works

One rule sits at the top of [`SKILL.md`](SKILL.md): **the building is the evidence.**

1. **Size it**: a building, an ensemble or a whole site, with a time estimate. A whole site never starts without you.
2. **Identify it**: name, address, historic names, sources in the local language.
3. **Place it on the real plan**: footprints and heights from the land registry or OpenStreetMap ([references/real-plan.md](references/real-plan.md)).
4. **Read the architecture**: four photos or more and the list of features that make it recognisable ([references/fidelity.md](references/fidelity.md)).
5. **Write the timeline**: dated, sourced phases and construction moments ([references/format.md](references/format.md)).
6. **Build it from bricks**: generators that turn each element into small solid pieces ([references/bricks.md](references/bricks.md)). A new kind of architecture gets a new brick.
7. **Compare with the photos**: the finished model is captured from each photo's viewpoint (`scripts/capture.mjs`) and corrected, at least twice.
8. **Report honestly**: what is measured, documented and interpreted, and what still differs.

## The collection

The world's most recognised monuments, built one by one. Each animation is recorded from the live viewer with `scripts/record.mjs`.

| | | |
|---|---|---|
| <a href="https://gleaming0427.github.io/monument/view/#colosseum"><img src=".github/assets/colosseum.gif" alt="The Colosseum being built, then ruined"></a><br><b>Colosseum</b>, Rome | <a href="https://gleaming0427.github.io/monument/view/#leaning-tower-of-pisa"><img src=".github/assets/leaning-tower-of-pisa.gif" alt="The Leaning Tower of Pisa being built"></a><br><b>Leaning Tower of Pisa</b>, Italy | <a href="https://gleaming0427.github.io/monument/view/#eiffel-tower"><img src=".github/assets/eiffel-tower.gif" alt="The Eiffel Tower being built"></a><br><b>Eiffel Tower</b>, Paris |

Every one is live on the [website](https://gleaming0427.github.io/monument/collection/).

## Community gallery

Built a monument you like? In the same session, ask your agent:

```text
publish this monument to the community gallery
```

It asks for a title, an id and your GitHub name, shows what it will send, and opens a pull request that adds `community/<id>/`. Without a terminal, use the [Submit a monument](https://github.com/Gleaming0427/monument/issues/new?template=submit-monument.yml) form with a Gist. The site checks every file, rebuilds the monument and photographs it. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Install

Monument is a standard [Agent Skill](https://agentskills.io): this repository is the skill folder.

| | Command |
|---|---|
| skills CLI, for you | `npx skills add Gleaming0427/monument -g` (add `-a claude-code`, `-a codex`, `-a opencode` or `-a antigravity` to skip the question) |
| skills CLI, for one project | `npx skills add Gleaming0427/monument` |
| git, Claude Code | `git clone https://github.com/Gleaming0427/monument.git ~/.claude/skills/monument` |
| git, Codex | `git clone https://github.com/Gleaming0427/monument.git ~/.agents/skills/monument` |
| No git | [Download the ZIP](https://github.com/Gleaming0427/monument/archive/refs/heads/main.zip) and unzip it into your skills folder as `monument` |

## Repository

```
SKILL.md            the skill: what Claude does when you ask for a building
references/         monument file format, real-plan method, fidelity loop, bricks
kit/                the viewer: engine (builder.js), interface, Three.js and fonts, vendored
scripts/            serve, validate, capture, record (GIF and MP4), publish, build-site
examples/           the collection
community/          the community gallery, one folder per monument
site/               the website, deployed to GitHub Pages
```

`node scripts/validate.mjs` checks every monument and that every brick is documented.

## Limits

- **It is only as good as the record.** A documented history and good photos give a good model; a thin record gives a short timeline, labelled as such.
- **It is slow when it is good.** Count 30 to 90 minutes for one building, hours for an ensemble.
- **Shapes come from bricks.** A new kind of architecture needs a new brick; the first version is a draft.
- **It is a model, not a survey.** Footprints and heights are measured; facades, roofs and the split between periods are read from sources and photos.

## Credits

Made by [@Gleaming0427](https://x.com/Gleaming0427) with Claude Code.

The format of this skill, of its install and of its website follows [Anatomy](https://skills.wheresryan.sh/anatomy) by Ryan. Built with [Three.js](https://threejs.org) (MIT) and [Manrope](https://github.com/sharanda/manrope) (SIL Open Font License). Footprints and streets: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL) and IGN BD TOPO (Licence Ouverte). Each monument links to its own sources.

MIT licence.
