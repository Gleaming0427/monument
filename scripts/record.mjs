#!/usr/bin/env node
// Records a monument being built, from the first piece to the last phase, as a GIF and an MP4.
//   node scripts/record.mjs <id> [--dir monuments] [--cam azimuth,elevation,distance[,x,y,z]] [--size 640,400]
//                           [--frames 96] [--fps 12] [--hold 1.5] [--ease 40] [--out .] [--no-caption]
//                           [--from 0] [--to <phases>] [--colors 192] [--dither bayer:bayer_scale=4] [--keep]
// The viewer is opened once in a headless Chrome; the timeline is moved frame by frame through
// window.monument.seek and each frame is photographed. ffmpeg turns the frames into <id>.gif and <id>.mp4.
// --from and --to cut the film to a stretch of the timeline, in phases (--to 5 stops at the end of the fifth phase):
// a short loop that ends on the look of the finished building rather than on the last small works.
// A fixed --cam keeps the picture still behind the building, which is also what makes a GIF small and clean.
// --colors and --dither tune the GIF's palette; --keep leaves the frames in a folder (printed) to encode again.
// Each frame is drawn once, by hand (window.monument.step): the camera eases as --ease frames of playback would,
// and the page draws nothing in between, so a software renderer is not left with a queue of frames to get through
// before every screenshot. The viewer plays a phase in 8 to 18 s: about 12 recorded frames, so 40 frames of easing
// each, which lets the camera finish a swing round to a moment's side instead of stopping half way over the top.
import {execFileSync} from 'node:child_process';
import {mkdtemp, writeFile, rm, mkdir} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {startViewer, openBrowser} from './lib/browser.mjs';

const args = process.argv.slice(2), flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const id = args.find((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!id) { console.error('Usage: node scripts/record.mjs <id> [--dir monuments] [--cam az,el,dist[,x,y,z]] [--size 640,400] [--frames 96] [--fps 12] [--ease 40] [--from 0] [--to <phases>] [--out .]'); process.exit(1); }
const [width, height] = flag('size', '640,400').split(',').map(Number), frames = Number(flag('frames', 96)), fps = Number(flag('fps', 12)), ease = Number(flag('ease', 40));
const out = resolve(flag('out', '.'));
await mkdir(out, {recursive: true});

const viewer = await startViewer(flag('dir', 'monuments'), flag('port', 4195));
const shots = await mkdtemp(join(tmpdir(), 'monument-frames-'));
const browser = await openBrowser({width, height});

try {
  const query = new URLSearchParams({t: '0.001'});
  if (flag('cam')) query.set('cam', flag('cam'));
  await browser.open(`${viewer.base}?${query}&clean${args.includes('--no-caption') ? '' : '&caption'}#${id}`);
  const duration = await browser.run('monument.duration'), from = Number(flag('from', 0)), to = Math.min(duration, Number(flag('to', duration)));
  for (let i = 0; i <= frames; i++) {
    await browser.run(`monument.seek(${(from + (to - from) * i / frames).toFixed(4)})`);
    await browser.run(`monument.step(${ease}, ${(i / fps).toFixed(4)})`);
    await writeFile(join(shots, `${String(i).padStart(4, '0')}.png`), await browser.shot());
    if (i % 24 === 0) process.stdout.write(`frame ${i}/${frames}\r`);
  }

  const input = ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(shots, '%04d.png')], hold = `tpad=stop_mode=clone:stop_duration=${flag('hold', '1.5')}`;
  execFileSync('ffmpeg', [...input, '-vf', `${hold},split[a][b];[a]palettegen=max_colors=${flag('colors', 192)}:stats_mode=diff[p];[b][p]paletteuse=dither=${flag('dither', 'bayer:bayer_scale=4')}:diff_mode=rectangle`, join(out, `${id}.gif`)], {stdio: 'inherit'});
  execFileSync('ffmpeg', [...input, '-vf', `${hold},format=yuv420p`, '-c:v', 'libx264', '-crf', '23', '-preset', 'slow', '-movflags', '+faststart', '-an', join(out, `${id}.mp4`)], {stdio: 'inherit'});
  console.log(`${join(out, `${id}.gif`)}\n${join(out, `${id}.mp4`)}`);
} catch (error) {
  if (error.code === 'ENOENT') { console.error(`ffmpeg not found: the frames are in ${shots}`); process.exitCode = 1; }
  else throw error;
} finally {
  await browser.close(); viewer.stop();
  if (args.includes('--keep')) console.log(`frames kept in ${shots}`);
  else if (!process.exitCode) await rm(shots, {recursive: true, force: true}).catch(() => {});
}
