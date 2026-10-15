#!/usr/bin/env node
// Photographs a monument with a local Chrome, for photo comparisons and gallery thumbnails.
//   node scripts/capture.mjs <id> [--dir monuments] [--t 6] [--cam azimuth,elevation,distance[,x,y,z]]
//                            [--size 1200,800] [--out <id>.png] [--ui]
// Without --ui the interface is hidden (?clean). Set CHROME to the browser binary if it is not found.
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {findChrome, startViewer, GL} from './lib/browser.mjs';

const args = process.argv.slice(2), flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const id = args.find((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!id) { console.error('Usage: node scripts/capture.mjs <id> [--dir monuments] [--t 6] [--cam az,el,dist[,x,y,z]] [--size 1200,800] [--out file.png] [--ui]'); process.exit(1); }

const chrome = findChrome(), viewer = await startViewer(flag('dir', 'monuments'), flag('port', 4190));
const query = new URLSearchParams({t: flag('t', '99')});
if (flag('cam')) query.set('cam', flag('cam'));
const url = `${viewer.base}?${query}${args.includes('--ui') ? '' : '&clean'}#${id}`;
const out = resolve(flag('out', `${id}.png`));
try {
  execFileSync(chrome, ['--headless=new', ...GL, '--virtual-time-budget=9000', `--window-size=${flag('size', '1200,800')}`, `--screenshot=${out}`, url], {stdio: 'ignore', timeout: 120000});
  console.log(`${out}  ←  ${url}`);
} finally { viewer.stop(); }
