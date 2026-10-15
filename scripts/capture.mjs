#!/usr/bin/env node
// Photographs a monument with a local Chrome, for photo comparisons and gallery thumbnails.
//   node scripts/capture.mjs <id> [--dir monuments] [--t 6] [--cam azimuth,elevation,distance[,x,y,z]]
//                            [--size 1200,800] [--out <id>.png] [--ui]
// Without --ui the interface is hidden (?clean). Set CHROME to the browser binary if it is not found.
import {spawn, execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const args = process.argv.slice(2), flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const id = args.find((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!id) { console.error('Usage: node scripts/capture.mjs <id> [--dir monuments] [--t 6] [--cam az,el,dist[,x,y,z]] [--size 1200,800] [--out file.png] [--ui]'); process.exit(1); }

const chrome = process.env.CHROME ?? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser',
].find(path => path.startsWith('/') ? existsSync(path) : (() => { try { execFileSync('which', [path], {stdio: 'ignore'}); return true; } catch { return false; } })());
if (!chrome) { console.error('No Chrome or Chromium found. Set CHROME=/path/to/chrome, or compare in the browser instead.'); process.exit(1); }

const serve = fileURLToPath(new URL('serve.mjs', import.meta.url));
const server = spawn(process.execPath, [serve, resolve(flag('dir', 'monuments')), '--port', flag('port', '4190')], {stdio: ['ignore', 'pipe', 'inherit']});
const base = await new Promise((done, fail) => {
  server.stdout.on('data', chunk => { const m = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+\//); if (m) done(m[0]); });
  server.on('exit', () => fail(new Error('The viewer server stopped.')));
});
const query = new URLSearchParams({t: flag('t', '99')});
if (flag('cam')) query.set('cam', flag('cam'));
const url = `${base}?${query}${args.includes('--ui') ? '' : '&clean'}#${id}`;
const out = resolve(flag('out', `${id}.png`));
try {
  execFileSync(chrome, ['--headless=new', '--hide-scrollbars', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-device-scale-factor=1',
    '--virtual-time-budget=9000', `--window-size=${flag('size', '1200,800')}`, `--screenshot=${out}`, url], {stdio: 'ignore', timeout: 120000});
  console.log(`${out}  ←  ${url}`);
} finally { server.kill(); }
