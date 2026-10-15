// Shared by capture.mjs and record.mjs: find a local Chrome and run the viewer server for a while.
import {spawn, execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function findChrome() {
  const found = process.env.CHROME || [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser',
  ].find(path => path.startsWith('/') ? existsSync(path) : (() => { try { execFileSync('which', [path], {stdio: 'ignore'}); return true; } catch { return false; } })());
  if (!found) { console.error('No Chrome or Chromium found. Set CHROME=/path/to/chrome.'); process.exit(1); }
  return found;
}

// Software WebGL, so that recordings look the same on a laptop and on a CI runner.
export const GL = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--force-device-scale-factor=1'];

export async function startViewer(dir, port = 4190) {
  const serve = fileURLToPath(new URL('../serve.mjs', import.meta.url));
  const server = spawn(process.execPath, [serve, resolve(dir), '--port', String(port)], {stdio: ['ignore', 'pipe', 'inherit']});
  const base = await new Promise((done, fail) => {
    server.stdout.on('data', chunk => { const m = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+\//); if (m) done(m[0]); });
    server.on('exit', () => fail(new Error('The viewer server stopped.')));
  });
  return {base, stop: () => server.kill()};
}
