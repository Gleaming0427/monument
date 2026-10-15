#!/usr/bin/env node
// Records a monument being built, from the first piece to the last phase, as a GIF and an MP4.
//   node scripts/record.mjs <id> [--dir monuments] [--cam azimuth,elevation,distance[,x,y,z]] [--size 640,400]
//                           [--frames 96] [--fps 12] [--hold 1.5] [--out .] [--no-caption]
// The viewer is opened once in a headless Chrome; the timeline is moved frame by frame through
// window.monument.seek and each frame is photographed. ffmpeg turns the frames into <id>.gif and <id>.mp4.
import {spawn, execFileSync} from 'node:child_process';
import {mkdtemp, writeFile, rm, mkdir} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {findChrome, startViewer, GL} from './lib/browser.mjs';

const args = process.argv.slice(2), flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const id = args.find((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!id) { console.error('Usage: node scripts/record.mjs <id> [--dir monuments] [--cam az,el,dist[,x,y,z]] [--size 640,400] [--frames 96] [--fps 12] [--out .]'); process.exit(1); }
const [width, height] = flag('size', '640,400').split(',').map(Number), frames = Number(flag('frames', 96)), fps = Number(flag('fps', 12));
const out = resolve(flag('out', '.'));
await mkdir(out, {recursive: true});

const viewer = await startViewer(flag('dir', 'monuments'), flag('port', 4195));
const profile = await mkdtemp(join(tmpdir(), 'monument-chrome-')), shots = await mkdtemp(join(tmpdir(), 'monument-frames-'));
const chrome = spawn(findChrome(), ['--headless=new', ...GL, '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--window-size=${width},${height}`, 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']});
const sleep = ms => new Promise(done => setTimeout(done, ms));

try {
  // Chrome prints its DevTools address on stderr; the page target is listed on that port.
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
  const query = new URLSearchParams({t: '0.001'});
  if (flag('cam')) query.set('cam', flag('cam'));
  await send('Page.navigate', {url: `${viewer.base}?${query}&clean${args.includes('--no-caption') ? '' : '&caption'}#${id}`});
  for (let i = 0; i < 120 && !(await run('Boolean(window.monument?.ready)').catch(() => false)); i++) await sleep(250);
  await run('document.fonts.ready.then(() => true)');
  await sleep(1500);
  const duration = await run('monument.duration');
  if (!duration) throw new Error(`“${id}” did not load.`);

  for (let i = 0; i <= frames; i++) {
    // Two animation frames after each seek, so the scene and the caption have caught up.
    await run(`monument.seek(${(duration * i / frames).toFixed(4)}); new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`);
    const {data} = await send('Page.captureScreenshot', {format: 'png'});
    await writeFile(join(shots, `${String(i).padStart(4, '0')}.png`), Buffer.from(data, 'base64'));
    if (i % 24 === 0) process.stdout.write(`frame ${i}/${frames}\r`);
  }
  socket.close();

  const input = ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(shots, '%04d.png')], hold = `tpad=stop_mode=clone:stop_duration=${flag('hold', '1.5')}`;
  execFileSync('ffmpeg', [...input, '-vf', `${hold},split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, join(out, `${id}.gif`)], {stdio: 'inherit'});
  execFileSync('ffmpeg', [...input, '-vf', `${hold},format=yuv420p`, '-c:v', 'libx264', '-crf', '23', '-preset', 'slow', '-movflags', '+faststart', '-an', join(out, `${id}.mp4`)], {stdio: 'inherit'});
  console.log(`${join(out, `${id}.gif`)}\n${join(out, `${id}.mp4`)}`);
} catch (error) {
  if (error.code === 'ENOENT') { console.error(`ffmpeg not found: the frames are in ${shots}`); process.exitCode = 1; }
  else throw error;
} finally {
  chrome.kill(); viewer.stop();
  await rm(profile, {recursive: true, force: true}).catch(() => {});
  if (!process.exitCode) await rm(shots, {recursive: true, force: true}).catch(() => {});
}
