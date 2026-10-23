#!/usr/bin/env node
// The site at the three breakpoints it is read on, in a real browser. The site tests check the source; this
// checks what that source actually produces: nothing off the side of a phone, every frame either arrived or
// named itself as missing, and every control big enough to press with a thumb.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {mkdir, readFile, writeFile, access} from 'node:fs/promises';
import {extname, join, normalize, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openBrowser} from './lib/browser.mjs';

const root = fileURLToPath(new URL('..', import.meta.url)), site = join(root, '_site'), shots = join(root, '.artifacts', 'site-responsive');
await access(join(site, 'index.html')).catch(() => { throw new Error('Build _site first with: node scripts/build-site.mjs'); });
await mkdir(shots, {recursive: true});

const types = {'.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4'};
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname), rest = pathname === '/' ? 'index.html' : pathname.slice(1);
  let file = normalize(join(site, rest));
  if (!file.startsWith(site + sep)) { response.writeHead(403); return response.end(); }
  if (!extname(file)) file = join(file, 'index.html');
  // A file the page asks for and the build does not carry — a favicon, a font — is a 404, not a crash.
  let body;
  try { body = await readFile(file); } catch { response.writeHead(404); return response.end('Not found'); }
  response.writeHead(200, {'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Content-Length': body.length, 'Accept-Ranges': 'bytes'});
  response.end(body);
});
await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
const base = `http://127.0.0.1:${server.address().port}/`;

const PAGES = [['home', ''], ['collection', 'collection/'], ['community', 'community/']];
const CASES = [{name: 'phone', width: 390, height: 844}, {name: 'tablet', width: 768, height: 1024}, {name: 'desktop', width: 1440, height: 900}];

// What a layout is judged on, read out of the live page rather than out of the stylesheet.
const probe = `(() => {
  const view = innerWidth, out = {overflow: [], pending: [], failed: [], stuck: [], hidden: []};
  // Nothing may sit outside the column. The page clips its own overflow, so this reads the boxes
  // themselves: a clipped box is still a box that is in the wrong place.
  for (const el of document.querySelectorAll('body *')) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.position === 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.right > view + 1 || r.left < -1))
      out.overflow.push((el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '')) + ' @ ' + Math.round(r.left) + '→' + Math.round(r.right));
  }
  for (const frame of document.querySelectorAll('.media')) {
    const r = frame.getBoundingClientRect();
    // A frame the stylesheet removed has no box and is never going to load one; on a phone the strip
    // thins itself out on purpose, and a picture that is not on the page cannot be pending.
    if (!r.width || !r.height) continue;
    const seen = r.bottom > -200 && r.top < innerHeight + 200;      // what a reader could be looking at
    if (!seen) continue;                                            // a lazy frame below the fold is meant to wait
    if (frame.classList.contains('is-pending')) out.pending.push(frame.querySelector('img')?.getAttribute('src') ?? 'unwatched');
    if (frame.classList.contains('is-failed')) out.failed.push(frame.querySelector('img')?.getAttribute('src') ?? frame.textContent.trim().slice(0, 40));
  }
  // A card the reader has scrolled past must be visible. Two ways to be: it arrived, or the entrance
  // animation never claimed it (reduced motion, no IntersectionObserver) — both are fine. What is not fine
  // is a card still waiting to arrive while sitting on screen, which is content the reader cannot see.
  for (const card of document.querySelectorAll('[data-reveal]')) {
    const r = card.getBoundingClientRect();
    if (!r.width) continue;
    if (r.top < innerHeight && r.bottom > 0 && card.classList.contains('is-waiting') && !card.classList.contains('is-in'))
      out.stuck.push(card.querySelector('h3')?.textContent ?? 'card');
  }
  out.tap = [...document.querySelectorAll('nav.site a, summary')].map(el => Math.round(el.getBoundingClientRect().height));
  out.nav = [...document.querySelectorAll('nav.site a')].map(el => { const r = el.getBoundingClientRect(); return {text: el.textContent.trim().slice(0, 18), right: Math.round(r.right), w: Math.round(r.width)}; });
  out.scroll = [document.documentElement.scrollWidth, innerWidth];
  out.lang = document.querySelectorAll('nav.site .lang').length;
  return out;
})()`;

const browser = await openBrowser({width: 1440, height: 900});
try {
  for (const {name, width, height} of CASES) {
    await browser.send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: name === 'phone'});
    for (const [page, folder] of PAGES) {
      const label = `${page}/${name}`;
      await browser.send('Page.navigate', {url: `${base}${folder}`});
      await browser.sleep(1400);
      await browser.run('document.fonts.ready.then(() => true)');
      // Every frame is given its chance to land before it is judged.
      await browser.sleep(1200);
      const state = await browser.run(probe);
      await writeFile(join(shots, `${page}-${name}.png`), await browser.shot());

      assert.deepEqual(state.overflow, [], `${label}: these sit outside a ${width}px viewport:\n  ${state.overflow.slice(0, 6).join('\n  ')}`);
      assert.deepEqual(state.pending, [], `${label}: a media frame never settled: ${state.pending.join(', ')}`);
      assert.deepEqual(state.stuck, [], `${label}: a card in view never arrived: ${state.stuck.join(', ')}`);
      assert.ok(state.lang === 2, `${label}: the language switcher offers ${state.lang} of 2`);
      for (const link of state.nav) {
        assert.ok(link.w > 0, `${label}: the nav link "${link.text}" has no width`);
        assert.ok(link.right <= width + 1, `${label}: the nav link "${link.text}" ends at ${link.right}, past ${width}`);
      }
      if (name === 'phone') for (const height$ of state.tap) assert.ok(height$ >= 32, `${label}: a control is ${height$}px tall; a thumb needs room`);
      console.log(`${label}: ${width}×${height}, ${state.failed.length} frame(s) without a file, ${state.tap.length} controls`);
    }
  }
} finally { await browser.close(); await new Promise(done => server.close(done)); }