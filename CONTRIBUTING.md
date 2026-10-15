# Contributing

## Add a monument to the community gallery

1. Build it with the skill: `/monument <building, city, country>`.
2. In the same session, ask: “publish this monument to the community gallery”. Your agent asks for a title, an id and your GitHub name, shows what it will send, then runs `scripts/publish.mjs`, which opens a pull request adding `community/<id>/`.
3. No terminal? Open the [Submit a monument](https://github.com/Gleaming0427/monument/issues/new?template=submit-monument.yml) form with a Gist holding your `monuments/<id>.json`.

What the checks do: `scripts/validate.mjs` reads your file (ids, phases, sources, bricks), then the site rebuilds your monument from it and photographs it at one size with the interface hidden.

The rules:
- **Sources.** Every phase and every moment links to a page that supports it. No invented dates, architects or anecdotes.
- **Real plan.** Say in `evidence.geometry` where the footprint and heights come from, and in `evidence.uncertainties` what is estimated.
- **Daylight.** No night scene unless night lighting is the subject, and sourced.
- **Data only, or reviewed code.** A monument file is data. If it brings its own bricks (`<id>.bricks.js`), a maintainer reads them before they go live; good bricks join the kit.
- **Licences.** Footprints from OpenStreetMap are © OpenStreetMap contributors (ODbL); say so in `evidence`. Do not paste copyrighted text into phases; summarise and link.

## Improve the skill or the kit

- New bricks go in `kit/builder.js`, named after the architecture, with a row in `references/bricks.md`. `node scripts/validate.mjs` fails if one is missing.
- Run `node scripts/validate.mjs` and `node scripts/build-site.mjs` before opening a pull request.
- Keep the viewer dependency-free: everything it loads ships in `kit/`.
