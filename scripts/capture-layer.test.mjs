#!/usr/bin/env node
// The captured layer of the viewer, in a real browser: a monument with a `scan` gets a button, the button swaps the
// built model for the splats where the scan's matrix puts them, and swaps back. The scan here is a ball of red
// splats 18 m east of the Leaning Tower, in empty air: red appears at that point when the capture shows, and nowhere
// when the model does.
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startViewer, openBrowser} from './lib/browser.mjs';

const root = fileURLToPath(new URL('..', import.meta.url)), id = 'leaning-tower-of-pisa', dir = await mkdtemp(join(tmpdir(), 'monument-capture-'));
const at = [18, 30, 0];
try {
  // 4000 splats of 35 cm in a ball of 2 m, plain red; the .splat format is 32 bytes a gaussian.
  const count = 4000, splat = Buffer.alloc(count * 32);
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1, phi = Math.random() * 2 * Math.PI, r = 2 * Math.cbrt(Math.random()), s = Math.sqrt(1 - u * u);
    [r * s * Math.cos(phi), r * u, r * s * Math.sin(phi)].forEach((v, k) => { splat.writeFloatLE(at[k] + v, i * 32 + k * 4); splat.writeFloatLE(.35, i * 32 + 12 + k * 4); });
    splat.set([255, 30, 30, 255, 255, 128, 128, 128], i * 32 + 24);
  }
  await mkdir(join(dir, `${id}.evidence`, 'scan'), {recursive: true});
  await writeFile(join(dir, `${id}.evidence`, 'scan', 'capture.splat'), splat);
  const data = JSON.parse(await readFile(resolve(root, 'examples', `${id}.json`), 'utf8'));
  await writeFile(join(dir, `${id}.json`), JSON.stringify({...data, scan: {file: `${id}.evidence/scan/capture.splat`, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]}}));

  const viewer = await startViewer(dir, 4198), browser = await openBrowser({width: 960, height: 600});
  try {
    await browser.open(`${viewer.base}?t=6.97&cam=40,14,120,0,26,0&clean#${id}`);
    await browser.settle();
    const redNear = async () => {
      const point = await browser.run(`monument.project(${JSON.stringify(at)})`), png = (await browser.shot('png')).toString('base64');
      return browser.run(`(async () => {
        const image = new Image(); image.src = 'data:image/png;base64,${png}'; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
        const {x, y} = ${JSON.stringify(point)}, size = 70, data = context.getImageData(Math.max(0, x - size), Math.max(0, y - size), size * 2, size * 2).data;
        let red = 0; for (let i = 0; i < data.length; i += 4) if (data[i] > 150 && data[i + 1] < 110 && data[i + 2] < 110) red++;
        return red;
      })()`);
    };
    const pressed = () => browser.run(`document.getElementById('capture-toggle').getAttribute('aria-pressed')`);
    assert.equal(await browser.run(`document.getElementById('capture-toggle').hidden`), false, 'a monument with a scan shows the Captured button');
    assert.equal(await redNear(), 0, 'the built model has nothing red at that point');

    await browser.run(`document.getElementById('capture-toggle').click()`);
    for (let i = 0; i < 240 && (await pressed()) !== 'true'; i++) await browser.sleep(500);
    assert.equal(await pressed(), 'true', 'the scan loaded and the button is pressed');
    await browser.settle(); await browser.settle();
    const red = await redNear();
    assert.ok(red > 40, `the splats show where the matrix puts them: ${red} red pixels at the point`);

    await browser.run(`document.getElementById('capture-toggle').click()`);
    for (let i = 0; i < 60 && (await pressed()) !== 'false'; i++) await browser.sleep(250);
    await browser.settle(); await browser.settle();
    assert.equal(await redNear(), 0, 'back to the built model, the red is gone');
    console.log(`captured layer: ${red} red pixels with the scan, 0 without`);
  } finally { await browser.close(); viewer.stop(); }
} finally { await rm(dir, {recursive: true, force: true}); }
