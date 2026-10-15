# Community gallery

One folder per monument, added by pull request:

```
community/<id>/
  monument.json      the monument file (its "id" is the folder name)
  meta.json          title, author (GitHub name), model, prompt, date
  <id>.bricks.js     only if the monument brings its own bricks (reviewed by a maintainer)
```

Send one from your agent: “publish this monument to the community gallery”, or with
`node scripts/publish.mjs monuments/<id>.json --author <github name> --model "<model>" --prompt "<request>" --yes`.
See [CONTRIBUTING.md](../CONTRIBUTING.md).
