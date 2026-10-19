import * as T from 'three';

// Small, curated art library. It stays deliberately finite so monuments share one visual language
// instead of mixing unrelated asset packs.
export const MATERIALS = {
  'limestone-paris': {roughness: .84, normalScale: .62, repeat: 2.6, worldScale: .34},
  'limestone-weathered': {roughness: .9, normalScale: .85, repeat: 2.4, worldScale: .38},
  'marble-white': {roughness: .62, normalScale: .24, repeat: 1.8, worldScale: .18},
  'sandstone-warm': {roughness: .9, normalScale: .62, repeat: 2.4, worldScale: .32},
  'granite-grey': {roughness: .78, normalScale: .48, repeat: 2.7, worldScale: .4},
  'brick-roman': {roughness: .9, normalScale: .95, repeat: 2.2, worldScale: .48},
  'oak-aged': {roughness: .84, normalScale: .7, repeat: 2.1, worldScale: .34},
  'slate-aged': {roughness: .68, normalScale: .62, repeat: 2.4, worldScale: .42},
  'terracotta-aged': {roughness: .86, normalScale: .72, repeat: 2.5, worldScale: .44},
  // Photo-scanned surfaces from Poly Haven (CC0; scripts/fetch-materials.mjs, credits in
  // assets/materials/sources.json), at their real size: worldScale is one over the tile's width in metres.
  hinoki: {roughness: .78, normalScale: .55, repeat: 1, worldScale: .529, ext: 'jpg'},
  cedar: {roughness: .8, normalScale: .6, repeat: 1, worldScale: .885, ext: 'jpg'},
  'wood-weathered': {roughness: .88, normalScale: .8, repeat: 1, worldScale: .5, ext: 'jpg'},
  'wood-rough': {roughness: .9, normalScale: .9, repeat: 1, worldScale: 2, ext: 'jpg'},
  'wood-old': {roughness: .86, normalScale: .7, repeat: 1, worldScale: .5, ext: 'jpg'},
  'plaster-white': {roughness: .9, normalScale: .35, repeat: 1, worldScale: .5, ext: 'jpg'},
  'plaster-rough': {roughness: .92, normalScale: .6, repeat: 1, worldScale: 1, ext: 'jpg'},
  'shingle-wood': {roughness: .86, normalScale: .9, repeat: 1, worldScale: .333, ext: 'jpg'},
  'shingle-mossy': {roughness: .9, normalScale: .9, repeat: 1, worldScale: .5, ext: 'jpg'},
  thatch: {roughness: .95, normalScale: 1, repeat: 1, worldScale: 1.852, ext: 'jpg'},
  'tile-clay': {roughness: .8, normalScale: .9, repeat: 1, worldScale: .25, ext: 'jpg'},
  'stone-japanese': {roughness: .88, normalScale: .9, repeat: 1, worldScale: .526, ext: 'jpg'},
  'rock-mossy': {roughness: .9, normalScale: .9, repeat: 1, worldScale: .333, ext: 'jpg'},
  'bark-pine': {roughness: .95, normalScale: 1, repeat: 1, worldScale: .5, ext: 'jpg'},
  'bark-cedar': {roughness: .95, normalScale: 1, repeat: 1, worldScale: .5, ext: 'jpg'},
  // Generated (scripts/generate-materials.mjs): beaten gold leaf in 10.9 cm squares, six to a tile.
  'gold-leaf': {roughness: .3, normalScale: .35, repeat: 1, worldScale: 1.53},
};

export const MATERIAL_PRESETS = {
  'gothic-limestone': {stone: 'limestone-paris', wood: 'oak-aged', slate: 'slate-aged', tile: 'terracotta-aged'},
  'roman-weathered': {stone: 'limestone-weathered', wood: 'oak-aged', slate: 'slate-aged', tile: 'brick-roman'},
  'marble-italian': {stone: 'marble-white', wood: 'oak-aged', slate: 'slate-aged', tile: 'terracotta-aged'},
  'historic-masonry': {stone: 'limestone-weathered', wood: 'oak-aged', slate: 'slate-aged', tile: 'terracotta-aged'},
  'industrial-iron': {stone: 'limestone-weathered', wood: 'oak-aged', slate: 'slate-aged', tile: 'terracotta-aged'},
  // Timber halls of Japan: hinoki, white plaster, wooden shingles, gold leaf on lacquer, dressed stone.
  'japanese-timber': {stone: 'stone-japanese', wood: 'hinoki', slate: 'shingle-wood', tile: 'tile-clay', plaster: 'plaster-white', shingle: 'shingle-wood', gilt: 'gold-leaf', bark: 'bark-pine'},
  // Farmhouses, barns and mills: weathered boards, rough plaster, mossy shingles.
  'vernacular-timber': {stone: 'granite-grey', wood: 'wood-weathered', slate: 'shingle-mossy', tile: 'tile-clay', plaster: 'plaster-rough', shingle: 'shingle-mossy', gilt: 'gold-leaf', bark: 'bark-pine'},
};

export const QUALITY = {
  basic: {maps: 0, shadows: 0, pixelRatio: 1.5, ao: 0},
  standard: {maps: 3, shadows: 1024, pixelRatio: 1.75, ao: 1},
  cinematic: {maps: 4, shadows: 2048, pixelRatio: 2, ao: 1},
};

const textureCache = new Map(), loader = new T.TextureLoader();
function mapTexture(id, name, renderer) {
  const key = `${id}/${name}`;
  if (!textureCache.has(key)) {
    const texture = loader.load(new URL(`./assets/materials/${id}/${name}.${MATERIALS[id].ext ?? 'png'}`, import.meta.url).href);
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.repeat.setScalar(MATERIALS[id].repeat);
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if (name === 'albedo') texture.colorSpace = T.SRGBColorSpace;
    textureCache.set(key, texture);
  }
  return textureCache.get(key);
}

export function resolveVisualStyle(input = {}) {
  const qualityName = QUALITY[input.quality] ? input.quality : QUALITY[input.visualQuality] ? input.visualQuality : 'standard';
  const materialPreset = MATERIAL_PRESETS[input.materialPreset] ? input.materialPreset : 'historic-masonry';
  const surfaces = {...MATERIAL_PRESETS[materialPreset], ...(input.surfaces ?? {})};
  if (input.surfaces?.walls) surfaces.stone = input.surfaces.walls;
  if (input.surfaces?.roof) surfaces.slate = input.surfaces.roof;
  return {qualityName, quality: QUALITY[qualityName], materialPreset, surfaces};
}

export function pbrOptions(kind, style, renderer) {
  const id = style.surfaces[kind];
  if (!id || !MATERIALS[id] || style.quality.maps === 0) return {};
  const spec = MATERIALS[id];
  return {roughness: spec.roughness, pbr: {
    albedo: mapTexture(id, 'albedo', renderer), normal: style.quality.maps >= 2 ? mapTexture(id, 'normal', renderer) : null,
    roughness: style.quality.maps >= 2 ? mapTexture(id, 'roughness', renderer) : null, ao: style.quality.maps >= 4 ? mapTexture(id, 'ao', renderer) : null,
    scale: spec.worldScale, normalScale: spec.normalScale,
  }};
}
