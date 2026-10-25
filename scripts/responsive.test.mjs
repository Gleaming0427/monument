#!/usr/bin/env node
// Runs the production viewer in Chrome at the three supported breakpoints. The assertions use the actual
// panel rectangles and the camera's reserved insets: a card cannot pass while sitting over the monument.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {access, mkdir, readFile, writeFile} from 'node:fs/promises';
import {extname, join, normalize, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openBrowser} from './lib/browser.mjs';

const root = fileURLToPath(new URL('..', import.meta.url)), site = join(root, '_site'), shots = join(root, '.artifacts', 'responsive');
await access(join(site, 'view', 'index.html')).catch(() => { throw new Error('Build _site first with: node scripts/build-site.mjs'); });
await mkdir(shots, {recursive: true});
const types = {'.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png'};
// What this test reads is where the panels sit and where the camera stops, and neither depends on how the scene is drawn.
// A CI runner has no GPU: Chrome paints every frame on the CPU, and a frame of the standard quality (shadows, ambient
// occlusion, texture maps) took 18 s at 390×844 where a basic one takes 3, which four page loads multiplied into fifteen
// minutes. So the monument is served at the cheapest quality the viewer has; RESPONSIVE_QUALITY=standard looks at the
// scene as a visitor gets it.
const QUALITY = process.env.RESPONSIVE_QUALITY ?? 'basic';
const MONUMENT_FILE = /^\/view\/monuments\/[a-z0-9-]+\.json$/;
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname), rest = pathname === '/' ? 'index.html' : pathname.slice(1);
  let file = normalize(join(site, rest));
  if (!file.startsWith(site + sep)) { response.writeHead(403); return response.end(); }
  if (!extname(file)) file = join(file, 'index.html');
  try {
    let body = await readFile(file);
    if (MONUMENT_FILE.test(pathname)) { const data = JSON.parse(body); data.visualStyle = {...data.visualStyle, quality: QUALITY}; body = JSON.stringify(data); }
    response.writeHead(200, {'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store'}); response.end(body);
  }
  catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
const base = `http://127.0.0.1:${server.address().port}/view/`, browser = await openBrowser({width: 1440, height: 900});

const pageState = `(() => {
  const rect = selector => { const node = document.querySelector(selector), r = node.getBoundingClientRect(); return {left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height, display:getComputedStyle(node).display}; };
  // Reviewed Parthenon envelope: 69.5 × 30.9 m at the stylobate, 29 m maximum height.
  const footprint = [[-34.75,0,-15.45],[-34.75,0,15.45],[34.75,0,-15.45],[34.75,0,15.45],[-34.75,29,-15.45],[-34.75,29,15.45],[34.75,29,-15.45],[34.75,29,15.45]].map(monument.project);
  return {viewport:[innerWidth,innerHeight], insets:monument.insets, footprint, body:[...document.body.classList], header:rect('.top'), story:rect('.story'), moment:rect('#moment'), live:rect('.live'), timeline:rect('.timeline'), proof:rect('#proof'), scroll:[document.documentElement.scrollWidth,document.documentElement.scrollHeight]};
})()`;

const cases = [
  {name: 'phone', width: 390, height: 844},
  {name: 'tablet', width: 1024, height: 768},
  {name: 'desktop', width: 1440, height: 900},
];
const caseFlag = process.argv.indexOf('--case'), selected = caseFlag < 0 ? cases : cases.filter(test => test.name === process.argv[caseFlag + 1]);
if (!selected.length) throw new Error(`Unknown responsive case. Choose one of: ${cases.map(test => test.name).join(', ')}`);
try {
  for (const test of selected) {
    await browser.send('Emulation.setDeviceMetricsOverride', {width: test.width, height: test.height, deviceScaleFactor: 1, mobile: test.name === 'phone'});
    await browser.open(`${base}?t=14.97&responsive-test=${test.name}#parthenon`);
    await browser.settle();
    const state = await browser.run(pageState);
    await writeFile(join(shots, `${test.name}.png`), await browser.shot());
    assert.deepEqual(state.viewport, [test.width, test.height]);
    assert.ok(state.body.includes('has-moment'), `${test.name}: the regression scene must show its moment card`);
    assert.ok(state.timeline.bottom <= test.height && state.header.top >= 0, `${test.name}: controls must stay inside the viewport`);
    assert.ok(state.scroll[0] <= test.width && state.scroll[1] <= test.height, `${test.name}: the viewer must not create page scrollbars`);
    assert.ok(state.insets.top >= state.header.bottom, `${test.name}: camera must reserve the header`);
    assert.ok(state.insets.bottom >= test.height - state.timeline.top - 2, `${test.name}: camera must reserve the timeline`);
    const scene = {left: state.insets.left, right: test.width - state.insets.right, top: state.insets.top, bottom: test.height - state.insets.bottom};
    for (const point of state.footprint) {
      assert.ok(point.x >= scene.left - 8 && point.x <= scene.right + 8, `${test.name}: projected x=${point.x.toFixed(1)} outside ${scene.left.toFixed(1)}–${scene.right.toFixed(1)}`);
      assert.ok(point.y >= scene.top - 8 && point.y <= scene.bottom + 8, `${test.name}: projected y=${point.y.toFixed(1)} outside ${scene.top.toFixed(1)}–${scene.bottom.toFixed(1)}`);
    }
    if (test.name === 'phone') {
      assert.equal(state.story.display, 'none', 'phone: the moment replaces the story instead of stacking over the monument');
      assert.equal(state.live.display, 'none', 'phone: the statistics rail is removed');
      assert.ok(state.moment.bottom <= state.timeline.top, 'phone: the moment sits above the timeline');
      assert.ok(state.insets.bottom >= test.height - state.moment.top, 'phone: the camera stops above the bottom dock');
      assert.equal(state.insets.left, 0); assert.equal(state.insets.right, 0);
    } else if (test.name === 'tablet') {
      assert.equal(state.story.display, 'none', 'tablet: the moment replaces the story in the rail');
      assert.equal(state.live.display, 'none', 'tablet: the statistics rail is removed');
      assert.ok(state.insets.left >= state.moment.right, 'tablet: the camera begins after the information rail');
      assert.equal(state.insets.right, 0);
      assert.ok(test.width - state.insets.left >= 600, 'tablet: enough horizontal room remains for the monument');
    } else {
      assert.equal(state.story.display, 'block'); assert.equal(state.live.display, 'block');
      assert.ok(state.insets.left >= state.story.right, 'desktop: the camera begins after the story rail');
      assert.ok(test.width - state.insets.right <= state.moment.left, 'desktop: the camera ends before the moment rail');
      assert.ok(test.width - state.insets.right <= state.live.left, 'desktop: the camera ends before the statistics rail');
      assert.ok(test.width - state.insets.left - state.insets.right >= 600, 'desktop: enough horizontal room remains for the monument');
    }
    console.log(`${test.name}: ${test.width}×${test.height}, camera ${JSON.stringify(state.insets)}`);
  }
  // ?clean&caption is what comparisons and recordings are shot in, at 960×600: inside the tablet range, where the
  // story card is pinned to the top of the screen. It must stay a title at the foot of the scene, not stretch from
  // the top to the bottom edge as an empty panel in front of the monument.
  if (selected.length === cases.length) {
    await browser.send('Emulation.setDeviceMetricsOverride', {width: 960, height: 600, deviceScaleFactor: 1, mobile: false});
    await browser.open(`${base}?t=14.97&clean&caption#parthenon`);
    await browser.settle();
    const card = await browser.run(`(() => { const r = document.querySelector('.story').getBoundingClientRect(); return {top: r.top, bottom: r.bottom, height: r.height, width: r.width}; })()`);
    assert.ok(card.height <= 120, `caption: the phase title is ${Math.round(card.height)} px tall, a stretched panel and not a caption`);
    assert.ok(card.bottom <= 600 - 8 && card.top >= 600 / 2, `caption: the title sits at the foot of the scene (${Math.round(card.top)}–${Math.round(card.bottom)} px of 600)`);
    console.log(`caption: 960×600, title ${Math.round(card.width)}×${Math.round(card.height)} at ${Math.round(card.top)} px`);
  }
} finally { await browser.close(); await new Promise(done => server.close(done)); }
