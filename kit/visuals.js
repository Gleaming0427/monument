import * as T from 'three';

const mix = (a, b, t) => a + (b - a) * t;

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
  cobblestone: {roughness: .93, normalScale: 1.05, repeat: 36},
  'dry-grass': {roughness: .98, normalScale: .5, repeat: 44},
  // Photo-scanned surfaces from Poly Haven (CC0; scripts/fetch-materials.mjs, credits in
  // assets/materials/sources.json), at their real size: worldScale is one over the tile's width in metres.
  'grass-lawn': {roughness: .95, normalScale: .8, repeat: 1, worldScale: .5, ext: 'jpg'},
  'grass-wild': {roughness: .95, normalScale: .9, repeat: 1, worldScale: .5, ext: 'jpg'},
  'moss-carpet': {roughness: .96, normalScale: .7, repeat: 1, worldScale: .2, ext: 'jpg'},
  'gravel-raked': {roughness: .93, normalScale: 1, repeat: 1, worldScale: .5, ext: 'jpg'},
  'gravel-fine': {roughness: .92, normalScale: 1, repeat: 1, worldScale: .444, ext: 'jpg'},
  'forest-floor': {roughness: .95, normalScale: .9, repeat: 1, worldScale: .317, ext: 'jpg'},
  'soil-section': {roughness: .95, normalScale: 1, repeat: 1, worldScale: .5, ext: 'jpg'},
  'pond-mud': {roughness: .8, normalScale: .8, repeat: 1, worldScale: .426, ext: 'jpg'},
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

export const ENVIRONMENT_PRESETS = {
  'gothic-urban': {ground: 'cobblestone', light: 'cool-day', horizon: '#a6bacb', zenith: '#376b98', groundLight: '#776b59', fog: .28, vegetation: ['tree-oak'], count: 5, exclusion: .64},
  'mediterranean-lawn': {ground: 'dry-grass', light: 'clear-day', horizon: '#afc4d1', zenith: '#3d78a8', groundLight: '#766b4e', fog: .25, vegetation: ['tree-cypress', 'tree-olive'], count: 7, exclusion: .62},
  'roman-ruins': {ground: 'dry-grass', light: 'warm-day', horizon: '#b7bbb8', zenith: '#477ca7', groundLight: '#756449', fog: .25, vegetation: ['tree-cypress', 'tree-olive'], count: 6, exclusion: .72},
  'exposition-grounds': {ground: 'cobblestone', light: 'warm-day', horizon: '#b0bac3', zenith: '#466f98', groundLight: '#6f6255', fog: .28, vegetation: ['tree-oak'], count: 4, exclusion: .7},
  'museum-neutral': {ground: 'cobblestone', light: 'cool-day', horizon: '#afb9c4', zenith: '#4d6f91', groundLight: '#6e665c', fog: .3, vegetation: [], count: 0, exclusion: .7},
  // A stroll garden: moss under clipped shrubs, cloud-pruned pines and maples; the pond's water is green.
  'japanese-garden': {ground: 'moss-carpet', groundTint: '#a9c48e', light: 'clear-day', horizon: '#b6c8d0', zenith: '#3f78a6', groundLight: '#5c6a48', fog: .22, vegetation: ['pine-garden', 'bush-mound', 'maple-japanese', 'bush-round'], count: 22, exclusion: .45, grass: 0, water: 'green', bed: 'pond-mud', soil: 'soil-section'},
  // A park lawn with trees, shrubs and tufts of grass; clear water over a gravel bed.
  'green-park': {ground: 'grass-lawn', light: 'clear-day', horizon: '#b0c4d0', zenith: '#3d76a6', groundLight: '#66704c', fog: .24, vegetation: ['tree-oak', 'bush-round', 'shrub-wild'], count: 8, exclusion: .6, grass: 1400, water: 'clear', bed: 'gravel-fine', soil: 'soil-section'},
};

export const QUALITY = {
  basic: {maps: 0, shadows: 0, density: .45, pixelRatio: 1.5, ao: 0},
  standard: {maps: 3, shadows: 1024, density: 1, pixelRatio: 1.75, ao: 1},
  cinematic: {maps: 4, shadows: 2048, density: 1.65, pixelRatio: 2, ao: 1},
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
  const environmentPreset = ENVIRONMENT_PRESETS[input.environmentPreset] ? input.environmentPreset : null;
  const surfaces = {...MATERIAL_PRESETS[materialPreset], ...(input.surfaces ?? {})};
  if (input.surfaces?.walls) surfaces.stone = input.surfaces.walls;
  if (input.surfaces?.roof) surfaces.slate = input.surfaces.roof;
  return {
    qualityName, quality: QUALITY[qualityName], materialPreset, surfaces,
    environmentPreset, environment: environmentPreset ? {...ENVIRONMENT_PRESETS[environmentPreset], ...(input.environment ?? {})} : null,
    vegetation: input.vegetation ?? Boolean(environmentPreset), props: input.props ?? [], decor: input.decor ?? [],
  };
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

// The ground's material, for a square `extent` metres wide (the ground plane, or a terrain); `id` another
// surface than the environment's ground (a pond's bed, a cut face of soil).
export function groundOptions(style, renderer, radius, extent = radius * 40, id = style.environment?.ground) {
  if (!id || !MATERIALS[id]) return null;
  const spec0 = MATERIALS[id];
  const groundMap = name => {
    const texture = loader.load(new URL(`./assets/materials/${id}/${name}.${spec0.ext ?? 'png'}`, import.meta.url).href);
    // Photo-scanned surfaces keep their real size; the older ones repeat so many times over the plane.
    texture.wrapS = texture.wrapT = T.RepeatWrapping; texture.repeat.setScalar(spec0.ext ? extent * spec0.worldScale : Math.max(24, radius * 8)); texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if (name === 'albedo') texture.colorSpace = T.SRGBColorSpace; return texture;
  };
  const spec = MATERIALS[id], options = {color: '#ffffff', map: groundMap('albedo'), roughness: spec.roughness, metalness: 0};
  if (style.quality.maps >= 2) Object.assign(options, {normalMap: groundMap('normal'), normalScale: new T.Vector2(spec.normalScale, spec.normalScale), roughnessMap: groundMap('roughness')});
  if (style.quality.maps >= 4) Object.assign(options, {aoMap: groundMap('ao'), aoMapIntensity: .65});
  return options;
}

const propMaterial = (color, roughness = .9, metalness = 0) => new T.MeshStandardMaterial({color, roughness, metalness});
const addMesh = (group, geometry, material, position, scale = [1, 1, 1], rotation = [0, 0, 0]) => {
  const mesh = new T.Mesh(geometry, material); mesh.position.set(...position); mesh.scale.set(...scale); mesh.rotation.set(...rotation); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh); return mesh;
};
const addBeam = (group, a, b, radius, material) => {
  const A = new T.Vector3(...a), B = new T.Vector3(...b), direction = B.clone().sub(A), mesh = addMesh(group, new T.CylinderGeometry(1, 1, 1, 7), material, A.add(B).multiplyScalar(.5).toArray(), [radius, direction.length(), radius]);
  mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), direction.normalize()); return mesh;
};

function tree(type, seed, qualityName = 'standard') {
  const r = random(seed), group = new T.Group(), detail = qualityName === 'cinematic' ? 2 : qualityName === 'basic' ? 0 : 1;
  const olive = type === 'tree-olive', bark = propMaterial(olive ? '#625441' : '#513b2b', .96);
  const branch = (a, b, radius) => addBeam(group, a, b, radius, bark);
  const crown = (positions, colors) => {
    const materials = colors.map(color => propMaterial(color, .94));
    const geometry = new T.IcosahedronGeometry(1, detail > 1 ? 2 : 1);
    const kept = detail === 0 ? positions.filter((_, index) => index % 2 === 0) : positions;
    for (const [index, [x, y, z, sx, sy = sx, sz = sx]] of kept.entries()) {
      const jitter = .9 + r() * .18;
      addMesh(group, geometry, materials[index % materials.length], [x + (r() - .5) * .16, y + (r() - .5) * .12, z + (r() - .5) * .16], [sx * jitter, sy * jitter, sz * jitter], [r() * .35, r() * .45, r() * .35]);
    }
  };

  if (type === 'tree-cypress') {
    addMesh(group, new T.CylinderGeometry(.17, .4, 7.2, 10), bark, [0, 3.6, 0]);
    const needles = [propMaterial('#18392b', .95), propMaterial('#28503a', .95), propMaterial('#355b40', .95)];
    const tiers = detail === 0 ? 4 : detail === 1 ? 7 : 10;
    for (let i = 0; i < tiers; i++) {
      const t = i / Math.max(1, tiers - 1), radius = .96 * (1 - t * .5), height = 2.5 - t * .65;
      addMesh(group, new T.ConeGeometry(radius, height, detail > 1 ? 14 : 10), needles[i % needles.length], [(r() - .5) * .18, 3.4 + t * 5.25, (r() - .5) * .18], [1, 1, .82 + r() * .18], [(r() - .5) * .08, r() * .5, (r() - .5) * .08]);
    }
    return group;
  }

  if (olive) {
    // Low, twisted trunk and a loose silver-green crown leave readable gaps between branches.
    branch([0, 0, 0], [.12, 3.15, -.08], .38);
    const ends = [[-1.65, 4.35, .45], [1.5, 4.55, -.35], [-.45, 5.15, -1.15], [.65, 5.05, 1.05], [0, 5.65, .05]];
    for (const end of ends) {
      const fork = [(r() - .5) * .42, 2.55 + r() * .55, (r() - .5) * .38];
      branch([.08, 2.15, -.05], fork, .17); branch(fork, end, .11);
    }
    crown([
      [-1.9,4.45,.5,1.15,.65,1],[-1.05,4.8,.15,1.25,.72,1.05],[0,5.35,0,1.32,.75,1.12],[1.15,4.85,-.35,1.25,.7,1.05],
      [1.85,4.45,-.25,1.05,.62,.92],[-.45,5.65,-1.05,1.05,.58,.9],[.7,5.45,1.05,1.05,.6,.9],[-1.25,5.25,-.75,.95,.55,.82],
      [.2,4.75,-1.35,.95,.52,.82],[1.3,5.2,.6,.9,.52,.78],[-.35,4.6,1.2,.9,.5,.78],[-.1,6.05,.05,.88,.52,.78],
    ], ['#52664d', '#687a5b', '#7d8968']);
    return group;
  }

  addMesh(group, new T.CylinderGeometry(.28, .52, 5.2, 10), bark, [0, 2.6, 0], [1, 1, 1], [0, 0, (r() - .5) * .06]);
  const forks = [[-1.65,5.65,.3],[1.55,5.8,-.45],[-.45,6.75,-1.2],[.55,6.9,1.15],[0,7.65,.05]];
  for (const [i, end] of forks.entries()) {
    const joint = [(i - 2) * .12, 3.55 + (i % 2) * .35, (r() - .5) * .42];
    branch([0, 3.05, 0], joint, .22); branch(joint, end, .14);
    if (detail > 0) branch(end, [end[0] * 1.25, end[1] + .65, end[2] * .72], .08);
  }
  crown([
    [-2.35,5.6,.35,1.35,1.05,1.2],[-1.35,6.15,-.25,1.45,1.18,1.3],[-.25,6.2,-1.55,1.35,1.05,1.2],[.15,7.2,-.55,1.45,1.18,1.3],
    [1.25,6.35,-.65,1.45,1.14,1.25],[2.25,5.75,-.25,1.28,1,1.14],[1.45,6.7,.9,1.35,1.08,1.2],[.45,7.35,1.35,1.25,1,1.1],
    [-.85,7.45,.85,1.38,1.12,1.25],[-1.75,6.55,1.15,1.3,1.02,1.15],[-.2,8.25,.05,1.22,1,1.08],[.45,5.75,.6,1.38,1.08,1.22],
    [-.55,5.65,.35,1.3,1,1.16],[1.55,5.45,.8,1.12,.92,1],[-1.75,5.65,-.85,1.08,.9,.98],
  ], ['#284b32', '#365c3b', '#466a43']);
  return group;
}

function stoneBlocks(seed) {
  const r = random(seed), group = new T.Group(), stone = propMaterial('#a9987b');
  for (let i = 0; i < 8; i++) addMesh(group, new T.BoxGeometry(1, 1, 1), stone, [(i % 4 - 1.5) * 1.15, .34 + Math.floor(i / 4) * .64, (r() - .5) * .45], [1 + r() * .25, .58, .72 + r() * .2], [0, (r() - .5) * .15, 0]);
  return group;
}

function cart() {
  const group = new T.Group(), wood = propMaterial('#6b472d'), iron = propMaterial('#4a4641', .52, .35);
  addMesh(group, new T.BoxGeometry(1, 1, 1), wood, [0, 1.15, 0], [3.2, .38, 1.55]);
  for (const z of [-.92, .92]) for (const x of [-1.05, 1.05]) addMesh(group, new T.TorusGeometry(.58, .09, 8, 16), iron, [x, .62, z], [1, 1, 1], [Math.PI / 2, 0, 0]);
  for (const z of [-.55, .55]) addMesh(group, new T.CylinderGeometry(.055, .075, 3.8, 7), wood, [2.65, .95, z], [1, 1, 1], [0, 0, Math.PI / 2]);
  return group;
}

function amphora() {
  const group = new T.Group(), clay = propMaterial('#9f5e3f');
  const shape = [new T.Vector2(.08, 0), new T.Vector2(.42, .2), new T.Vector2(.65, .75), new T.Vector2(.5, 1.35), new T.Vector2(.22, 1.55), new T.Vector2(.2, 1.8), new T.Vector2(.35, 1.9)];
  addMesh(group, new T.LatheGeometry(shape, 18), clay, [0, 0, 0]);
  for (const x of [-1, 1]) addMesh(group, new T.TorusGeometry(.35, .06, 7, 12, Math.PI), clay, [x * .31, 1.55, 0], [1, 1, 1], [0, x * Math.PI / 2, Math.PI / 2]);
  return group;
}

// ——— Plants made of foliage cards ———
// Leaves are drawn in an atlas (scripts/generate-materials.mjs: assets/materials/foliage, four quadrants:
// a clipped shrub's small leaves, pine needles, maple leaves, broad leaves) and laid on many small cards. Each
// card's normals point out from the centre of its clump, so a clipped shrub or a pine's pad shades as one soft
// mass while its edge stays ragged, as foliage does against the sky.
const ATLAS = {shrub: [0, .5], needles: [.5, .5], maple: [0, 0], broad: [.5, 0]};
const atlasCache = new Map(), barkCache = new Map();
const atlasTexture = name => {
  if (!atlasCache.has(name)) {
    const texture = loader.load(new URL(`./assets/materials/${name}/albedo.png`, import.meta.url).href);
    texture.colorSpace = T.SRGBColorSpace; texture.anisotropy = 4; atlasCache.set(name, texture);
  }
  return atlasCache.get(name);
};
const foliageMaterial = (color, atlas = 'foliage') => new T.MeshStandardMaterial({color, map: atlasTexture(atlas), alphaTest: .42, side: T.DoubleSide, roughness: .86, metalness: 0});
// Bark: the photo-scanned pine or cedar bark, wrapped round the trunk's cylinders.
const barkMaterial = (id = 'bark-pine', tint = '#ffffff') => {
  const key = `${id}|${tint}`;
  if (!barkCache.has(key)) {
    const map = name => { const t = loader.load(new URL(`./assets/materials/${id}/${name}.jpg`, import.meta.url).href); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(1, 2); if (name === 'albedo') t.colorSpace = T.SRGBColorSpace; return t; };
    barkCache.set(key, new T.MeshStandardMaterial({color: tint, map: map('albedo'), normalMap: map('normal'), roughnessMap: map('roughness'), roughness: .95, metalness: 0}));
  }
  return barkCache.get(key);
};
// Cards: each {at: [x, y, z], size, centre: [x, y, z] of its clump, quadrant}. A random plane per card, its
// vertex normals blended towards the outward direction from the clump's centre.
function cardGeometry(list, r) {
  const pos = [], nor = [], uv = [], index = [];
  for (const card of list) {
    const [u0, v0] = ATLAS[card.quadrant] ?? card.quadrant, s = card.size / 2;
    const n = new T.Vector3(r() - .5, (r() - .5) * .8, r() - .5).normalize(), t = new T.Vector3().crossVectors(n, Math.abs(n.y) > .9 ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 1, 0)).normalize(), b = new T.Vector3().crossVectors(n, t);
    const spin = r() * Math.PI * 2, ct = Math.cos(spin), st = Math.sin(spin), tt = t.clone().multiplyScalar(ct).addScaledVector(b, st), bb = b.clone().multiplyScalar(ct).addScaledVector(t, -st);
    const base = pos.length / 3, centre = new T.Vector3(...card.centre);
    for (const [a, c, du, dv] of [[-1, -1, 0, 0], [1, -1, .5, 0], [1, 1, .5, .5], [-1, 1, 0, .5]]) {
      const p = new T.Vector3(...card.at).addScaledVector(tt, a * s).addScaledVector(bb, c * s);
      const out = p.clone().sub(centre).normalize().lerp(new T.Vector3(0, 1, 0), card.up ?? .25).normalize();
      pos.push(p.x, p.y, p.z); nor.push(out.x, out.y, out.z); uv.push(u0 + du, v0 + dv);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); g.setIndex(index);
  return g;
}
// A clump: `count` cards in an ellipsoid of radii [rx, ry, rz] about `centre`, most of them near its surface.
function clump(cards, centre, radii, count, size, quadrant, r, shell = .55, up) {
  for (let i = 0; i < count; i++) {
    const d = new T.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1); if (d.lengthSq() > 1 || d.lengthSq() < .01) { i--; continue; }
    d.normalize().multiplyScalar(shell + (1 - shell) * Math.sqrt(r()));
    cards.push({at: [centre[0] + d.x * radii[0], centre[1] + d.y * radii[1], centre[2] + d.z * radii[2]], size: size * (.8 + r() * .4), centre, quadrant, up});
  }
}
const addFoliage = (group, cards, material, r) => { const mesh = new T.Mesh(cardGeometry(cards, r), material); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh); return mesh; };
// A trunk or branch through `points`, tapering from r0 to r1, in bark.
function limb(group, points, r0, r1, material) {
  for (let i = 0; i < points.length - 1; i++) {
    const a = new T.Vector3(...points[i]), b = new T.Vector3(...points[i + 1]), d = b.clone().sub(a), f0 = i / (points.length - 1), f1 = (i + 1) / (points.length - 1);
    const mesh = new T.Mesh(new T.CylinderGeometry(mix(r0, r1, f1), mix(r0, r1, f0), d.length() + mix(r0, r1, f0) * .6, 9), material);
    mesh.position.copy(a).add(b).multiplyScalar(.5); mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize()); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
  }
}

function plant(type, seed, qualityName = 'standard') {
  const r = random(seed), group = new T.Group(), density = qualityName === 'cinematic' ? 1.5 : qualityName === 'basic' ? .5 : 1, n = k => Math.max(6, Math.round(k * density)), cards = [];
  if (type === 'bush-round') {
    // A clipped round shrub (box, azalea): a dense ball of small leaves.
    const R = .75 + r() * .2;
    clump(cards, [0, R * .85, 0], [R, R * .85, R], n(150), R * .55, 'shrub', r, .6);
    addFoliage(group, cards, foliageMaterial(['#5f8a4a', '#577f45', '#6a9050'][Math.floor(r() * 3)]), r);
  } else if (type === 'bush-mound') {
    // A clipped mound (karikomi): wide, low and smooth on top.
    const R = 1.25 + r() * .35;
    clump(cards, [0, R * .38, 0], [R * 1.35, R * .45, R], n(240), R * .42, 'shrub', r, .75, .45);
    addFoliage(group, cards, foliageMaterial(['#4f7a3e', '#5a8446'][Math.floor(r() * 2)]), r);
  } else if (type === 'shrub-wild') {
    // An unclipped shrub: three loose clumps of broad leaves on a few stems.
    const wood = barkMaterial('bark-cedar', '#8a7a68');
    for (let k = 0; k < 3; k++) {
      const a = k / 3 * Math.PI * 2 + r(), c = [Math.cos(a) * .45, .75 + r() * .45, Math.sin(a) * .45];
      limb(group, [[0, 0, 0], [c[0] * .6, c[1] * .6, c[2] * .6], c], .05, .025, wood);
      clump(cards, c, [.7, .6, .7], n(70), .5, 'broad', r, .4);
    }
    addFoliage(group, cards, foliageMaterial('#5d8443'), r);
  } else if (type === 'pine-garden') {
    // A cloud-pruned pine of Japanese gardens (niwaki): a leaning, twisting trunk, near-level branches, and
    // flat pads of needles at their ends and at the top.
    const bark = barkMaterial('bark-pine', '#b9aa98'), lean = (r() - .5) * .5, H = 4.6 + r() * 1.4;
    const trunk = [[0, 0, 0], [.35 + lean, H * .25, .1], [.05 + lean * 1.6, H * .5, -.2], [.55 + lean * 2, H * .78, .1], [.3 + lean * 2.2, H, 0]];
    limb(group, trunk, .24, .09, bark);
    const pads = [[...trunk[4], 1.1, .38, .95]];
    for (let k = 0; k < 6; k++) {
      const t = trunk[1 + Math.min(3, Math.floor(k / 1.8))], a = k * 2.1 + r(), reach = 1.3 + r() * 1.2, end = [t[0] + Math.cos(a) * reach, t[1] + .25 + r() * .5, t[2] + Math.sin(a) * reach];
      limb(group, [t, [mix(t[0], end[0], .6), t[1] + .15, mix(t[2], end[2], .6)], end], .09, .04, bark);
      pads.push([...end, .85 + r() * .4, .3, .7 + r() * .3]);
    }
    for (const [x, y, z, rx, ry, rz] of pads) clump(cards, [x, y + ry * .55, z], [rx, ry, rz], n(70), .55, 'needles', r, .55, .6);
    addFoliage(group, cards, foliageMaterial('#46684a'), r);
  } else if (type === 'maple-japanese') {
    // A Japanese maple (momiji): a few slender stems spreading into a light, layered crown.
    const bark = barkMaterial('bark-cedar', '#9a8d80'), H = 3.6 + r() * 1.1;
    for (let k = 0; k < 3; k++) {
      const a = k / 3 * Math.PI * 2 + r() * .6, top = [Math.cos(a) * 1.1, H * .8, Math.sin(a) * 1.1];
      limb(group, [[0, 0, 0], [top[0] * .3, H * .35, top[2] * .3], top], .1, .035, bark);
      clump(cards, top, [1.3, .75, 1.3], n(60), .7, 'maple', r, .35, .5);
    }
    clump(cards, [0, H, 0], [1.4, .8, 1.4], n(70), .7, 'maple', r, .35, .5);
    addFoliage(group, cards, foliageMaterial(['#6f9a46', '#7aa04c'][Math.floor(r() * 2)]), r);
  } else if (type === 'grass-tuft' || type === 'reeds') {
    // Three crossed cards of grass blades (assets/materials/grass), or taller reeds by the water.
    const h = type === 'reeds' ? 1.2 + r() * .4 : .38 + r() * .2, w = type === 'reeds' ? .8 : .55, mesh = new T.Mesh(tuftGeometry(Math.floor(r() * 4)), foliageMaterial(type === 'reeds' ? '#8a9a60' : '#7f9a5a', 'grass'));
    mesh.scale.set(w, h, w); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
  } else return null;
  return group;
}
// A tuft: three upright cards crossing at 60°, one metre wide and high, its foot at the origin.
function tuftGeometry(quadrant) {
  const pos = [], nor = [], uv = [], index = [], u0 = (quadrant % 2) * .5, v0 = quadrant < 2 ? .5 : 0;
  for (let k = 0; k < 3; k++) {
    const a = k * Math.PI / 3, c = Math.cos(a) * .5, s = Math.sin(a) * .5, base = pos.length / 3;
    for (const [x, y, z, du, dv] of [[-c, 0, -s, 0, 0], [c, 0, s, .5, 0], [c, 1, s, .5, .5], [-c, 1, -s, 0, .5]]) { pos.push(x, y, z); nor.push(0, 1, 0); uv.push(u0 + du, v0 + dv); }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); g.setIndex(index);
  return g;
}
// Grass over the ground: one instanced mesh of tufts, scattered in a ring and kept out of `keepOut(x, z)` (the
// building, the water, the reference photos' views).
function grassField(count, inner, outer, seed, keepOut) {
  const r = random(seed + 811), geometry = tuftGeometry(0), material = foliageMaterial('#7d9858', 'grass'), mesh = new T.InstancedMesh(geometry, material, count), m = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler();
  let placed = 0;
  for (let i = 0; i < count * 3 && placed < count; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(mix(inner * inner, outer * outer, r())), x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (keepOut(x, z)) continue;
    const h = .3 + r() * .3, w = .4 + r() * .3;
    m.compose(new T.Vector3(x, 0, z), q.setFromEuler(e.set(0, r() * Math.PI, 0)), new T.Vector3(w, h, w)); mesh.setMatrixAt(placed++, m);
  }
  mesh.count = placed; mesh.receiveShadow = true;
  return mesh;
}

function makeProp(type, seed, qualityName) {
  if (type.startsWith('tree-')) return tree(type, seed, qualityName);
  const grown = plant(type, seed, qualityName); if (grown) return grown;
  if (type === 'stone-blocks') return stoneBlocks(seed);
  if (type === 'cart-medieval') return cart();
  if (type === 'amphora') return amphora();
  return null;
}

function random(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// A tree that would stand in a reference photo's view between its camera and the building (sights: the
// cameras and targets on the ground, with the photo's vertical field of view in radians). The width of the
// view allows a 16:10 screen, plus a crown's reach.
const hides = ([x, z], sights) => sights.some(({camera: [cx, cz], target: [tx, tz], fov}) => {
  const fx = tx - cx, fz = tz - cz, reach = Math.hypot(fx, fz), qx = x - cx, qz = z - cz;
  if (reach < 1) return false;
  const depth = (qx * fx + qz * fz) / reach, side = Math.abs(qx * fz - qz * fx) / reach;
  return depth > -4 && depth < reach && side < Math.max(0, depth) * Math.tan(fov / 2) * 1.6 + 4;
});

// `keepOut(x, z)`: places where no tree or tuft of grass may stand (the water, the building's footprint).
export function createEnvironment(style, view, seed, phaseIndex, sights = [], keepOut = () => false) {
  const group = new T.Group(), timed = [], rand = random(seed + 6029), environment = style.environment;
  if (!environment) return {group, timed};
  const place = (spec, i) => {
    const object = makeProp(spec.type, seed + i * 97 + 13, style.qualityName); if (!object) return;
    const at = spec.at ?? [0, 0]; object.position.set(at[0], spec.y ?? 0, at[1]); object.rotation.y = spec.rot ?? rand() * Math.PI * 2; object.scale.setScalar(spec.scale ?? 1); group.add(object);
    timed.push({object, from: spec.from ? phaseIndex[spec.from] ?? 0 : 0, until: spec.until ? phaseIndex[spec.until] ?? Infinity : Infinity});
  };
  let index = 0;
  if (style.vegetation && environment.vegetation.length) {
    const count = Math.round(environment.count * style.quality.density), inner = view.radius * environment.exclusion, outer = view.radius * .9;
    for (let i = 0; i < count; i++) {
      const angle = (i + rand() * .65) / Math.max(1, count) * Math.PI * 2, distance = mix(inner, outer, .25 + rand() * .75), scale = .72 + rand() * .42;
      // Out of the reference photos' views: moved round the ring by up to half a gap each way, or left out.
      const turn = [0, .15, -.15, .3, -.3, .45, -.45].map(k => angle + k / Math.max(1, count) * Math.PI * 2).find(a => !hides([Math.cos(a) * distance, Math.sin(a) * distance], sights) && !keepOut(Math.cos(a) * distance, Math.sin(a) * distance));
      if (turn === undefined) { rand(); index++; continue; }
      place({type: environment.vegetation[i % environment.vegetation.length], at: [Math.cos(turn) * distance, Math.sin(turn) * distance], scale, from: environment.from}, index++);
    }
  }
  for (const type of style.props) {
    const angle = rand() * Math.PI * 2, distance = view.radius * mix(.54, .72, rand());
    place({type, at: [Math.cos(angle) * distance, Math.sin(angle) * distance], scale: .8 + rand() * .35}, index++);
  }
  for (const spec of style.decor) place(spec, index++);
  if (environment.grass && style.quality.density > .5) {
    const field = grassField(Math.round(environment.grass * style.quality.density), view.radius * .2, view.radius * .95, seed, keepOut);
    group.add(field); timed.push({object: field, from: environment.from ? phaseIndex[environment.from] ?? 0 : 0, until: Infinity});
  }
  return {group, timed};
}

export function disposeEnvironment(group) {
  group?.traverse(object => { object.geometry?.dispose(); if (Array.isArray(object.material)) object.material.forEach(material => material.dispose()); else object.material?.dispose(); });
}
