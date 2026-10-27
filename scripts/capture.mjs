#!/usr/bin/env node
// Photographs a monument with a local Chrome, for photo comparisons and gallery thumbnails.
//   node scripts/capture.mjs <id> [--dir monuments] [--t 6] [--cam azimuth,elevation,distance[,x,y,z]]
//                            [--fov degrees] [--size 1200,800] [--out <id>.png] [--ui] [--section]
// Without --ui the interface is hidden (?clean). --section opens the monument on the camera's side (its
// vaults, roof frames and furnishings). The picture is taken once the monument is built and its photo
// reliefs are in. Set CHROME to the browser binary if it is not found.
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {startViewer, openBrowser} from './lib/browser.mjs';

const args = process.argv.slice(2), flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const valued = ['--dir', '--t', '--cam', '--fov', '--size', '--out', '--port'];
const id = args.find((arg, i) => !arg.startsWith('--') && !valued.includes(args[i - 1]));
if (!id) { console.error('Usage: node scripts/capture.mjs <id> [--dir monuments] [--t 6] [--cam az,el,dist[,x,y,z]] [--fov degrees] [--size 1200,800] [--out file.png] [--ui] [--section]'); process.exit(1); }

const [width, height] = flag('size', '1200,800').split(',').map(Number);
const viewer = await startViewer(flag('dir', 'monuments'), Number(flag('port', 4190))), browser = await openBrowser({width, height});
const query = new URLSearchParams({t: flag('t', '99')});
if (flag('cam')) query.set('cam', flag('cam'));
if (flag('fov')) query.set('fov', flag('fov'));
if (args.includes('--section')) query.set('section', '');
const url = `${viewer.base}?${query}${args.includes('--ui') ? '' : '&clean'}#${id}`;
const out = resolve(flag('out', `${id}.png`));
try {
  // Once the monument is built and its photo reliefs are in.
  await browser.open(url);
  // Without --cam, the film's camera eases from its opening shot to the overall view, 6 % of the way each frame:
  // 240 steps bring it to rest, then the page draws once (a software renderer draws a frame in seconds, and one
  // left running piles up frames behind the screenshot).
  await browser.run(`monument.step(${flag('cam') ? 1 : 240})`);
  await writeFile(out, await browser.shot(out.endsWith('.jpg') ? 'jpeg' : 'png'));
  console.log(`${out}  ←  ${url}`);
} finally { await browser.close(); viewer.stop(); }
