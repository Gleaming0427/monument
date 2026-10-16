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
};

export const MATERIAL_PRESETS = {
  'gothic-limestone': {stone: 'limestone-paris', wood: 'oak-aged', slate: 'slate-aged', tile: 'terracotta-aged'},
  'roman-weathered': {stone: 'limestone-weathered', wood: 'oak-aged', slate: 'slate-aged', tile: 'brick-roman'},
  'marble-italian': {stone: 'marble-white', wood: 'oak-aged', slate: 'slate-aged', tile: 'terracotta-aged'},
  'historic-masonry': {stone: 'limestone-weathered', wood: 'oak-aged', slate: 'slate-aged', tile: 'terracotta-aged'},
  'industrial-iron': {stone: 'limestone-weathered', wood: 'oak-aged', slate: 'slate-aged', tile: 'terracotta-aged'},
};

export const ENVIRONMENT_PRESETS = {
  'gothic-urban': {ground: 'cobblestone', light: 'cool-day', horizon: '#a6bacb', zenith: '#376b98', groundLight: '#776b59', fog: .28, vegetation: ['tree-oak'], count: 5, exclusion: .64},
  'mediterranean-lawn': {ground: 'dry-grass', light: 'clear-day', horizon: '#afc4d1', zenith: '#3d78a8', groundLight: '#766b4e', fog: .25, vegetation: ['tree-cypress', 'tree-olive'], count: 7, exclusion: .62},
  'roman-ruins': {ground: 'dry-grass', light: 'warm-day', horizon: '#b7bbb8', zenith: '#477ca7', groundLight: '#756449', fog: .25, vegetation: ['tree-cypress', 'tree-olive'], count: 6, exclusion: .72},
  'exposition-grounds': {ground: 'cobblestone', light: 'warm-day', horizon: '#b0bac3', zenith: '#466f98', groundLight: '#6f6255', fog: .28, vegetation: ['tree-oak'], count: 4, exclusion: .7},
  'museum-neutral': {ground: 'cobblestone', light: 'cool-day', horizon: '#afb9c4', zenith: '#4d6f91', groundLight: '#6e665c', fog: .3, vegetation: [], count: 0, exclusion: .7},
};

export const QUALITY = {
  basic: {maps: 0, shadows: 0, density: .45, pixelRatio: 1.5},
  standard: {maps: 3, shadows: 1024, density: 1, pixelRatio: 1.75},
  cinematic: {maps: 4, shadows: 2048, density: 1.65, pixelRatio: 2},
};

const textureCache = new Map(), loader = new T.TextureLoader();
function mapTexture(id, name, renderer) {
  const key = `${id}/${name}`;
  if (!textureCache.has(key)) {
    const texture = loader.load(new URL(`./assets/materials/${id}/${name}.png`, import.meta.url).href);
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

export function groundOptions(style, renderer, radius) {
  const id = style.environment?.ground;
  if (!id || !MATERIALS[id]) return null;
  const groundMap = name => {
    const texture = loader.load(new URL(`./assets/materials/${id}/${name}.png`, import.meta.url).href);
    texture.wrapS = texture.wrapT = T.RepeatWrapping; texture.repeat.setScalar(Math.max(24, radius * 8)); texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
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

function makeProp(type, seed, qualityName) {
  if (type.startsWith('tree-')) return tree(type, seed, qualityName);
  if (type === 'stone-blocks') return stoneBlocks(seed);
  if (type === 'cart-medieval') return cart();
  if (type === 'amphora') return amphora();
  return null;
}

function random(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export function createEnvironment(style, view, seed, phaseIndex) {
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
      const angle = (i + rand() * .65) / Math.max(1, count) * Math.PI * 2, distance = mix(inner, outer, .25 + rand() * .75);
      place({type: environment.vegetation[i % environment.vegetation.length], at: [Math.cos(angle) * distance, Math.sin(angle) * distance], scale: .72 + rand() * .42, from: environment.from}, index++);
    }
  }
  for (const type of style.props) {
    const angle = rand() * Math.PI * 2, distance = view.radius * mix(.54, .72, rand());
    place({type, at: [Math.cos(angle) * distance, Math.sin(angle) * distance], scale: .8 + rand() * .35}, index++);
  }
  for (const spec of style.decor) place(spec, index++);
  return {group, timed};
}

export function disposeEnvironment(group) {
  group?.traverse(object => { object.geometry?.dispose(); if (Array.isArray(object.material)) object.material.forEach(material => material.dispose()); else object.material?.dispose(); });
}
