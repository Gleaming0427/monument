# Visual style library

Monument ships one semi-realistic historical art set: photo-scanned surfaces at their real size, generated ones where no photograph serves (gold leaf), and animated figures for the worksites. Every asset is in the kit (CC0 or generated), credited next to it; nothing downloads at runtime.

```json
"visualStyle": {
  "quality": "standard",
  "materialPreset": "gothic-limestone",
  "surfaces": {"stone": "limestone-paris", "slate": "slate-aged"}
}
```

## Quality

- `basic`: simple colours, no shadows. Use only for a rapid geometry draft or a weak GPU.
- `standard`: albedo, normal and roughness maps, soft shadows and ambient occlusion. This is the default build.
- `cinematic`: adds the ambient-occlusion map of the materials. Use for showcase captures when performance has been checked.

## The studio

The viewer shows the monument alone in a studio, as a model photographed for a report or a brochure: on a seamless paper backdrop, lit from the front left by a key light that turns with the camera, with its shadow and ambient occlusion on the floor. There is no sky, ground, vegetation, water or surroundings; the building's own detail is what counts: round columns with their orders, coursed walls, carving from photo reliefs. Gold leaf mirrors the studio round it. In a night phase (`mood: "night"`) the paper darkens to night blue and the monument's own lighting shows.

## Presets

Material presets: `gothic-limestone`, `roman-weathered`, `marble-italian`, `historic-masonry`, `industrial-iron`, `japanese-timber` (hinoki, white plaster, wooden shingles, gold leaf, dressed stone), `vernacular-timber` (weathered boards, rough plaster, mossy shingles).

The generated stone surfaces are `limestone-paris`, `limestone-weathered`, `marble-white`, `sandstone-warm` and `granite-grey`; other generated surfaces are `brick-roman`, `oak-aged`, `slate-aged`, `terracotta-aged` and `gold-leaf` (beaten leaf in 10.9 cm squares with their seams).

Photo-scanned surfaces (Poly Haven, CC0), mapped at their real size:

| Family | Surfaces |
| --- | --- |
| Wood | `hinoki`, `cedar`, `wood-weathered`, `wood-rough`, `wood-old` |
| Plaster | `plaster-white`, `plaster-rough` |
| Roofs | `shingle-wood`, `shingle-mossy`, `thatch`, `tile-clay` |
| Stone | `stone-japanese`, `rock-mossy` |
| Bark | `bark-pine`, `bark-cedar` |

Surface keys follow the engine kinds: `stone`, `wood`, `slate`, `tile`, `plaster`, `shingle`, `gilt` (gold leaf on lacquer: it mirrors the studio) and `bark`; `walls` aliases `stone` and `roof` aliases `slate`. The engine lays a surface's texture at 70% over each piece's colour: the colour carries the hue (gold over `gold-leaf`, dark brown over `hinoki` for aged posts), the texture its grain.

## Figures

Worksite figures are animated characters (`kit/assets/characters`, CC0 by Quaternius, credited in `sources.json` there): a craftsman in shirt, trousers and hat before the industrial age, a builder in helmet and high-visibility vest after it. A scene chooses them with `figures` (`"traditional"` or `"modern"`), or from its scaffold (steel tubes: modern). They are dressed in the scene's `clothes` palette and play their role: working with a mallet, striking from the scaffold, carrying a load to and fro.

## Asset maintenance

The runtime assets live in `kit/assets/`. Rebuild the generated maps (and the gold leaf) with:

```sh
node scripts/generate-materials.mjs 256
```

Fetch the photo-scanned surfaces again from Poly Haven (1024 px albedo and normal, 512 px roughness and occlusion, JPEG) with:

```sh
node scripts/fetch-materials.mjs
```

The source limestone texture is `scripts/assets/limestone-paris-source.jpg`. `kit/assets/materials/sources.json` and `kit/assets/characters/sources.json` record each asset's source, authors and licence. Do not add another asset pack without matching this set's scale, colour response and web budget.
