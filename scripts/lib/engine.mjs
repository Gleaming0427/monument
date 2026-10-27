// Loads the kit's engine in Node, without a browser: bare 'three' imports point to the vendored build and
// the rendering-only add-ons are dropped, so scripts can build a monument's pieces and measure them.
import {readFile, writeFile, mkdtemp, mkdir, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL, fileURLToPath} from 'node:url';

const kit = fileURLToPath(new URL('../../kit/', import.meta.url));

export async function loadEngine(bricksFile) {
  const temp = await mkdtemp(join(tmpdir(), 'monument-engine-'));
  const three = pathToFileURL(join(kit, 'vendor', 'three', 'three.module.js')).href, builder = join(temp, 'builder.mjs'), visuals = join(temp, 'visuals.mjs'), geometry = join(temp, 'geometry.mjs'), masonry = join(temp, 'masonry.mjs'), renaissanceFile = join(temp, 'renaissance.mjs'), japaneseFile = join(temp, 'japanese.mjs');
  // 'three' and 'three/addons/…' both have to point at the vendored files: the browser resolves them through
  // an import map, Node does not, and an import quietly dropped here leaves the shape it serves undefined —
  // which is how a chamfered box could pass every test while throwing the moment anything built it.
  // An addon imports 'three' itself, so it is copied too — with that bare name pointed at the vendored core —
  // and the kit's own 'three/addons/…' imports are pointed at the copies. Rewriting only the importing file
  // would leave every addon unable to find the core.
  const addonsDir = join(kit, 'vendor', 'three', 'addons');
  for (const entry of await readdir(addonsDir, {withFileTypes: true, recursive: true})) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    const from = join(entry.parentPath ?? entry.path, entry.name), target = join(temp, 'addons', entry.parentPath.replace(addonsDir, ''), entry.name);
    await mkdir(join(target, '..'), {recursive: true});
    await writeFile(target, (await readFile(from, 'utf8')).replaceAll("from 'three'", `from '${three}'`));
  }
  const addons = pathToFileURL(join(temp, 'addons')).href;
  const resolveImports = source => source.replaceAll("from 'three/addons/", `from '${addons}/`);
  const visualSource = resolveImports(await readFile(join(kit, 'visuals.js'), 'utf8')).replaceAll("from 'three'", `from '${three}'`);
  await writeFile(visuals, visualSource);
  await writeFile(geometry, resolveImports(await readFile(join(kit, 'geometry.js'), 'utf8')).replaceAll("from 'three'", `from '${three}'`));
  await writeFile(masonry, (await readFile(join(kit, 'masonry.js'), 'utf8')).replaceAll("from 'three'", `from '${three}'`));
  await writeFile(renaissanceFile, (await readFile(join(kit, 'renaissance.js'), 'utf8')).replaceAll("from 'three'", `from '${three}'`).replaceAll("from './masonry.js'", `from '${pathToFileURL(masonry).href}'`));
  await writeFile(japaneseFile, (await readFile(join(kit, 'japanese.js'), 'utf8')).replaceAll("from 'three'", `from '${three}'`));
  const source = resolveImports(await readFile(join(kit, 'builder.js'), 'utf8')).replaceAll("from 'three'", `from '${three}'`).replace("from './visuals.js'", `from '${pathToFileURL(visuals).href}'`).replaceAll("from './geometry.js'", `from '${pathToFileURL(geometry).href}'`).replaceAll("from './masonry.js'", `from '${pathToFileURL(masonry).href}'`).replaceAll("from './renaissance.js'", `from '${pathToFileURL(renaissanceFile).href}'`).replaceAll("from './japanese.js'", `from '${pathToFileURL(japaneseFile).href}'`);
  await writeFile(builder, source);
  const engine = await import(pathToFileURL(builder).href);
  if (bricksFile) {
    const bricks = resolveImports(await readFile(bricksFile, 'utf8')).replaceAll("from 'three'", `from '${three}'`).replaceAll("from '../kit/builder.js'", `from '${pathToFileURL(builder).href}'`).replaceAll("from '../kit/geometry.js'", `from '${pathToFileURL(geometry).href}'`);
    await writeFile(join(temp, 'bricks.mjs'), bricks);
    const custom = await import(pathToFileURL(join(temp, 'bricks.mjs')).href);
    Object.assign(engine.SHAPES, custom.shapes ?? {});
    Object.assign(engine.generators, custom.default);
  }
  return engine;
}
