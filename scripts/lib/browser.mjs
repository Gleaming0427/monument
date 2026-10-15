// Shared by capture.mjs and record.mjs: find a local Chrome and run the viewer server for a while.
import {spawn, execFileSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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
export const GL = ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--force-device-scale-factor=1'];

export async function startViewer(dir, port = 4190) {
  const serve = fileURLToPath(new URL('../serve.mjs', import.meta.url));
  const server = spawn(process.execPath, [serve, resolve(dir), '--port', String(port)], {stdio: ['ignore', 'pipe', 'inherit']});
  const base = await new Promise((done, fail) => {
    server.stdout.on('data', chunk => { const m = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+\//); if (m) done(m[0]); });
    server.on('exit', () => fail(new Error('The viewer server stopped.')));
  });
  return {base, stop: () => server.kill()};
}

// A headless Chrome driven over the DevTools protocol: open the viewer on a URL, wait until the monument
// is built, run code in the page and take screenshots. Used by record.mjs and compare.mjs.
export async function openBrowser({width, height}) {
  const profile = await mkdtemp(join(tmpdir(), 'monument-chrome-'));
  const chrome = spawn(findChrome(), ['--headless=new', ...GL, '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--window-size=${width},${height}`, 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']});
  const sleep = ms => new Promise(done => setTimeout(done, ms));
  const port = await new Promise((done, fail) => {
    chrome.stderr.on('data', chunk => { const m = String(chunk).match(/ws:\/\/127\.0\.0\.1:(\d+)\//); if (m) done(m[1]); });
    chrome.on('exit', () => fail(new Error('Chrome stopped.')));
  });
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(done => socket.addEventListener('open', done, {once: true}));
  let next = 0; const waiting = new Map();
  socket.addEventListener('message', event => { const msg = JSON.parse(event.data); waiting.get(msg.id)?.(msg); waiting.delete(msg.id); });
  const send = (method, params = {}) => new Promise((done, fail) => {
    const id = ++next; waiting.set(id, msg => msg.error ? fail(new Error(`${method}: ${msg.error.message}`)) : done(msg.result));
    socket.send(JSON.stringify({id, method, params}));
  });
  const run = async expression => (await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true})).result.value;
  await send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
  return {
    send, run, sleep,
    async open(url) {
      await send('Page.navigate', {url});
      await sleep(300);
      for (let i = 0; i < 160 && !(await run('Boolean(window.monument?.ready)').catch(() => false)); i++) await sleep(250);
      await run('document.fonts.ready.then(() => true)');
      await sleep(1200);
      if (!(await run('monument.duration'))) throw new Error(`The monument did not load: ${url}`);
    },
    // Two animation frames after any change, so the scene has caught up before the picture.
    settle: () => run('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))'),
    async shot(format = 'png', quality = 85) { return Buffer.from((await send('Page.captureScreenshot', {format, ...(format === 'jpeg' ? {quality} : {})})).data, 'base64'); },
    async close() { socket.close(); chrome.kill(); await rm(profile, {recursive: true, force: true}).catch(() => {}); },
  };
}
