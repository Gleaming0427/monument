#!/usr/bin/env node
// Records a monument being built, from the first piece to the last phase, as a GIF and an MP4.
//   node scripts/record.mjs <id> [--dir monuments] [--cam azimuth,elevation,distance[,x,y,z]] [--size 640,400]
//                           [--frames 96] [--fps 12] [--hold 1.5] [--ease 8] [--out .] [--no-caption]
// The viewer is opened once in a headless Chrome; the timeline is moved frame by frame through
// window.monument.seek and each frame is photographed. ffmpeg turns the frames into <id>.gif and <id>.mp4.
// Each frame is drawn once, by hand (window.monument.step): the camera eases as --ease frames of playback would,
// and the page draws nothing in between, so a software renderer is not left with a queue of frames to get through
// before every screenshot.
import {execFileSync} from 'node:child_process';
import {mkdtemp, writeFile, rm, mkdir} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {startViewer, openBrowser} from './lib/browser.mjs';

const args = process.argv.slice(2), flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const id = args.find((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!id) { console.error('Usage: node scripts/record.mjs <id> [--dir monuments] [--cam az,el,dist[,x,y,z]] [--size 640,400] [--frames 96] [--fps 12] [--ease 8] [--out .]'); process.exit(1); }
const [width, height] = flag('size', '640,400').split(',').map(Number), frames = Number(flag('frames', 96)), fps = Number(flag('fps', 12)), ease = Number(flag('ease', 8));
const out = resolve(flag('out', '.'));
await mkdir(out, {recursive: true});

const viewer = await startViewer(flag('dir', 'monuments'), flag('port', 4195));
const shots = await mkdtemp(join(tmpdir(), 'monument-frames-'));
const browser = await openBrowser({width, height});

try {
  const query = new URLSearchParams({t: '0.001'});
  if (flag('cam')) query.set('cam', flag('cam'));
  await browser.open(`${viewer.base}?${query}&clean${args.includes('--no-caption') ? '' : '&caption'}#${id}`);
  const duration = await browser.run('monument.duration');
  for (let i = 0; i <= frames; i++) {
    await browser.run(`monument.seek(${(duration * i / frames).toFixed(4)})`);
    await browser.run(`monument.step(${ease}, ${(i / fps).toFixed(4)})`);
    await writeFile(join(shots, `${String(i).padStart(4, '0')}.png`), await browser.shot());
    if (i % 24 === 0) process.stdout.write(`frame ${i}/${frames}\r`);
  }

  const input = ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(shots, '%04d.png')], hold = `tpad=stop_mode=clone:stop_duration=${flag('hold', '1.5')}`;
  execFileSync('ffmpeg', [...input, '-vf', `${hold},split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, join(out, `${id}.gif`)], {stdio: 'inherit'});
  execFileSync('ffmpeg', [...input, '-vf', `${hold},format=yuv420p`, '-c:v', 'libx264', '-crf', '23', '-preset', 'slow', '-movflags', '+faststart', '-an', join(out, `${id}.mp4`)], {stdio: 'inherit'});
  console.log(`${join(out, `${id}.gif`)}\n${join(out, `${id}.mp4`)}`);
} catch (error) {
  if (error.code === 'ENOENT') { console.error(`ffmpeg not found: the frames are in ${shots}`); process.exitCode = 1; }
  else throw error;
} finally {
  await browser.close(); viewer.stop();
  if (!process.exitCode) await rm(shots, {recursive: true, force: true}).catch(() => {});
}
