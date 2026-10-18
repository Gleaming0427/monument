# Visual style library

Monument ships one semi-realistic historical art set: photo-scanned surfaces at their real size, generated ones where no photograph serves (gold leaf, water), plants built of foliage cards, animated figures and a few historical props. Every asset is in the kit (CC0 or generated), credited next to it; nothing downloads at runtime.

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
- `standard`: albedo, normal and roughness maps, soft 1024 px shadows, ambient occlusion and restrained props. This is the default build.
- `cinematic`: adds the ambient-occlusion map of the materials, 2048 px shadows and denser vegetation. Use for showcase captures when performance has been checked.

## Presentation

`"presentation": "site"` (the default) shows the monument in its setting: the preset's sky, ground, fog, trees and props. `"studio"` shows it alone on a seamless paper backdrop, lit from the front left by a key light that turns with the camera, with its shadow and ambient occlusion on the floor: a clean presentation for a report or a brochure. `"diorama"` shows it on its square of ground cut out as a museum model, standing on the paper: the four sides show the soil in section, and the water over its bed wherever a side crosses a pond or a river. Viewers switch with the Studio and Diorama buttons, `?studio`, `?diorama` or `?site`. Either way, the building's own detail is what counts: round columns with their orders, coursed walls, carving from photo reliefs.

The model's square is `visualStyle.diorama`: `size` (metres, 2.6 × `view.radius` by default), `depth` of the cut, `center` [x, z] and `cell` (the terrain's grid, 0.5 m). A monument with water (`water` in format.md) gets this terrain in the site presentation too, carved where the water is.

## Presets

Material presets: `gothic-limestone`, `roman-weathered`, `marble-italian`, `historic-masonry`, `industrial-iron`, `japanese-timber` (hinoki, white plaster, wooden shingles, gold leaf, dressed stone), `vernacular-timber` (weathered boards, rough plaster, mossy shingles).

Environment presets: `gothic-urban`, `mediterranean-lawn`, `roman-ruins`, `exposition-grounds`, `museum-neutral`, `japanese-garden` (moss, cloud-pruned pines, maples, clipped shrubs, green water over mud), `green-park` (lawn, oaks and shrubs, tufts of grass, clear water over gravel). They control the ground (`ground`, tinted by `groundTint`), sky, fog and light, the water's tint (`water`), the pond's bed (`bed`) and the cut soil (`soil`), and `grass`, the number of tufts scattered over the ground. They never add neighbouring buildings or labels.

The generated stone surfaces are `limestone-paris`, `limestone-weathered`, `marble-white`, `sandstone-warm` and `granite-grey`; other generated surfaces are `brick-roman`, `oak-aged`, `slate-aged`, `terracotta-aged`, the grounds `cobblestone` and `dry-grass`, and `gold-leaf` (beaten leaf in 10.9 cm squares with their seams).

Photo-scanned surfaces (Poly Haven, CC0), mapped at their real size:

| Family | Surfaces |
| --- | --- |
| Ground | `grass-lawn`, `grass-wild`, `moss-carpet`, `gravel-raked`, `gravel-fine`, `forest-floor` |
| Water and soil | `pond-mud` (a pond's bed), `soil-section` (the cut sides of the model) |
| Wood | `hinoki`, `cedar`, `wood-weathered`, `wood-rough`, `wood-old` |
| Plaster | `plaster-white`, `plaster-rough` |
| Roofs | `shingle-wood`, `shingle-mossy`, `thatch`, `tile-clay` |
| Stone | `stone-japanese`, `rock-mossy` |
| Bark | `bark-pine`, `bark-cedar` |

Surface keys follow the engine kinds: `stone`, `wood`, `slate`, `tile`, `plaster`, `shingle`, `gilt` (gold leaf on lacquer: it mirrors the sky) and `bark`; `walls` aliases `stone` and `roof` aliases `slate`. The engine lays a surface's texture at 70% over each piece's colour: the colour carries the hue (gold over `gold-leaf`, dark brown over `hinoki` for aged posts), the texture its grain.

## Vegetation and props

Ready vegetation: `tree-oak`, `tree-cypress`, `tree-olive`; plants built of foliage cards (leaves drawn in `assets/materials/foliage`, bark photo-scanned): `bush-round` (a clipped ball), `bush-mound` (a wide clipped mound, karikomi), `shrub-wild`, `pine-garden` (a cloud-pruned pine), `maple-japanese`, `grass-tuft` and `reeds`. Ready props: `stone-blocks`, `cart-medieval`, `amphora`.

`vegetation: true` scatters the environment preset's small tree set outside `environment.exclusion × view.radius`. A scattered tree never stands in a reference photo's view between its camera and the building: it moves round its ring, or is left out. `environment.count` is the standard-quality count and `environment.from` can delay every scattered tree until a named phase. Prefer explicit `decor` for a documented site. Each item takes `type`, `at: [x,z]`, optional `y`, `scale`, `rot`, `from` and `until`.

Trees, shrubs and tufts of grass keep off the water and off the monument's own ground. In the diorama only those standing on the model's square show.

Decor is presentation unless a cited source establishes its placement. Keep it out of `evidence.features`, state interpretive historical staging in `evidence.uncertainties`, and never use generic vegetation to hide an unfinished facade.

## Asset maintenance

## Figures

Worksite figures are animated characters (`kit/assets/characters`, CC0 by Quaternius, credited in `sources.json` there): a craftsman in shirt, trousers and hat before the industrial age, a builder in helmet and high-visibility vest after it. A scene chooses them with `figures` (`"traditional"` or `"modern"`), or from its scaffold (steel tubes: modern). They are dressed in the scene's `clothes` palette and play their role: working with a mallet, striking from the scaffold, carrying a load to and fro. They stand on dry ground, never on the water.

## Asset maintenance

The runtime assets live in `kit/assets/`. Rebuild the generated maps (and the gold leaf, the water's ripples, the foliage and grass atlases) with:

```sh
node scripts/generate-materials.mjs 256
```

Fetch the photo-scanned surfaces again from Poly Haven (1024 px albedo and normal, 512 px roughness and occlusion, JPEG) with:

```sh
node scripts/fetch-materials.mjs
```

The source limestone texture is `scripts/assets/limestone-paris-source.jpg`. `kit/assets/materials/sources.json` and `kit/assets/characters/sources.json` record each asset's source, authors and licence. Do not add another asset pack without matching this set's scale, colour response and web budget.
