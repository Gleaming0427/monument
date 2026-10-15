// Loads the kit's engine in Node, without a browser: bare 'three' imports point to the vendored build and
// the rendering-only add-ons are dropped, so scripts can build a monument's pieces and measure them.
import {readFile, writeFile, mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL, fileURLToPath} from 'node:url';

const kit = fileURLToPath(new URL('../../kit/', import.meta.url));

export async function loadEngine(bricksFile) {
  const temp = await mkdtemp(join(tmpdir(), 'monument-engine-'));
  const three = pathToFileURL(join(kit, 'vendor', 'three', 'three.module.js')).href, builder = join(temp, 'builder.mjs');
  const source = (await readFile(join(kit, 'builder.js'), 'utf8')).replace(/^import \{[^}]+\} from 'three\/addons\/[^']+';\n/gm, '').replaceAll("from 'three'", `from '${three}'`);
  await writeFile(builder, source);
  const engine = await import(pathToFileURL(builder).href);
  if (bricksFile) {
    const bricks = (await readFile(bricksFile, 'utf8')).replaceAll("from 'three'", `from '${three}'`).replaceAll("from '../kit/builder.js'", `from '${pathToFileURL(builder).href}'`);
    await writeFile(join(temp, 'bricks.mjs'), bricks);
    Object.assign(engine.generators, (await import(pathToFileURL(join(temp, 'bricks.mjs')).href)).default);
  }
  return engine;
}
