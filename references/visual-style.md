# Visual style library

Monument ships one small semi-realistic historical art set. It uses tileable albedo, normal, roughness and ambient-occlusion maps, lightweight procedural trees and reusable historical props. Nothing downloads at runtime.

```json
"visualStyle": {
  "quality": "standard",
  "materialPreset": "gothic-limestone",
  "environmentPreset": "gothic-urban",
  "vegetation": true,
  "environment": {"from": "restored", "count": 5, "exclusion": 0.68},
  "surfaces": {"stone": "limestone-paris", "slate": "slate-aged"},
  "decor": [
    {"type": "stone-blocks", "at": [18, -12], "scale": 1.1, "from": "choir", "until": "facade"}
  ]
}
```

## Quality

- `basic`: simple colours, reduced vegetation, no shadows. Use only for a rapid geometry draft or a weak GPU.
- `standard`: albedo, normal and roughness maps, soft 1024 px shadows and restrained props. This is the default build.
- `cinematic`: adds ambient occlusion, 2048 px shadows and denser vegetation. Use for showcase captures when performance has been checked.

## Presets

Material presets: `gothic-limestone`, `roman-weathered`, `marble-italian`, `historic-masonry`, `industrial-iron`.

Environment presets: `gothic-urban`, `mediterranean-lawn`, `roman-ruins`, `exposition-grounds`, `museum-neutral`. They control the ground, sky, fog and light. They never add neighbouring buildings or labels.

The five ready stone surfaces are `limestone-paris`, `limestone-weathered`, `marble-white`, `sandstone-warm` and `granite-grey`. Other surfaces are `brick-roman`, `oak-aged`, `slate-aged` and `terracotta-aged`. Grounds use `cobblestone` or `dry-grass`. Surface keys follow the engine kinds: `stone`, `wood`, `slate`, `tile`; `walls` aliases `stone` and `roof` aliases `slate`.

## Vegetation and props

Ready vegetation: `tree-oak`, `tree-cypress`, `tree-olive`. Ready props: `stone-blocks`, `cart-medieval`, `amphora`.

`vegetation: true` scatters the environment preset's small tree set outside `environment.exclusion × view.radius`. `environment.count` is the standard-quality count and `environment.from` can delay every scattered tree until a named phase. Prefer explicit `decor` for a documented site. Each item takes `type`, `at: [x,z]`, optional `y`, `scale`, `rot`, `from` and `until`.

Decor is presentation unless a cited source establishes its placement. Keep it out of `evidence.features`, state interpretive historical staging in `evidence.uncertainties`, and never use generic vegetation to hide an unfinished facade.

## Asset maintenance

The runtime assets live in `kit/assets/materials/`. Rebuild their PBR maps with:

```sh
node scripts/generate-materials.mjs 256
```

The source limestone texture is `scripts/assets/limestone-paris-source.jpg`; all other maps are deterministic and tileable. Do not add another asset pack without matching this set's scale, colour response and web budget.
