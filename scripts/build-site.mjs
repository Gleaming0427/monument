#!/usr/bin/env node
// Builds the GitHub Pages site into _site/: node scripts/build-site.mjs
// site/ (pages), the viewer at view/ with the kit, the collection (examples/) and the community gallery
// (community/<id>/). With CAPTURE=1, community monuments without a thumbnail are photographed with Chrome.
import {readFile, writeFile, readdir, mkdir, cp, rm, mkdtemp, copyFile, access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url)), out = join(root, '_site');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const exists = path => access(path).then(() => true, () => false);
const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);

await rm(out, {recursive: true, force: true});
await cp(join(root, 'site'), out, {recursive: true});
await cp(join(root, 'kit'), join(out, 'view', 'kit'), {recursive: true});
await copyFile(join(root, 'kit', 'viewer.html'), join(out, 'view', 'index.html'));
await rm(join(out, 'view', 'kit', 'viewer.html'));
// GitHub Pages lets browsers keep files for ten minutes: versioned URLs keep the viewer, its engine and
// the monument files from two different deploys apart.
const version = (process.env.GITHUB_SHA ?? (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(); } catch { return String(Date.now()); } })()).slice(0, 8);
const stamp = async (file, pairs) => { let text = await readFile(file, 'utf8'); for (const [from, to] of pairs) { if (!text.includes(from)) throw new Error(`${from} not found in ${file}`); text = text.replaceAll(from, to); } await writeFile(file, text); };
await stamp(join(out, 'view', 'index.html'), [['href="kit/style.css"', `href="kit/style.css?v=${version}"`], ['src="kit/app.js"', `src="kit/app.js?v=${version}"`]]);
await stamp(join(out, 'view', 'kit', 'app.js'), [["from './builder.js'", `from './builder.js?v=${version}'`]]);
await stamp(join(out, 'view', 'kit', 'builder.js'), [["from './visuals.js'", `from './visuals.js?v=${version}'`]]);
await rm(join(out, 'collection.json'));
const monuments = join(out, 'view', 'monuments');
await mkdir(monuments, {recursive: true});

// The viewer's evidence mode draws the measured outline, and photo reliefs lay their images on the model:
// both travel with the monument file.
async function copyEvidence(dir, d, id) {
  const outline = d.evidence?.plan?.outline;
  if (typeof outline === 'string' && /^[a-z0-9-]+\.evidence\/outline\.json$/.test(outline) && await exists(join(dir, outline))) {
    await mkdir(join(monuments, `${id}.evidence`), {recursive: true});
    await copyFile(join(dir, outline), join(monuments, `${id}.evidence`, 'outline.json'));
  }
  for (const image of new Set(d.elements.filter(e => e.type === 'relief').map(e => e.image))) {
    if (typeof image !== 'string' || !new RegExp(`^${id}\\.evidence/reliefs/[a-z0-9-]+\\.(jpg|jpeg|png)$`).test(image) || !(await exists(join(dir, image)))) continue;
    await mkdir(join(monuments, `${id}.evidence`, 'reliefs'), {recursive: true});
    await copyFile(join(dir, image), join(monuments, image));
  }
}

// Collection: curated order and one line each.
const curated = await json(join(root, 'site', 'collection.json'));
const collection = [];
for (const {id, blurb} of curated) {
  const d = await json(join(root, 'examples', `${id}.json`));
  await copyFile(join(root, 'examples', `${id}.json`), join(monuments, `${id}.json`));
  await copyEvidence(join(root, 'examples'), d, id);
  collection.push({id, name: d.name, place: d.place, blurb, video: await exists(join(root, 'site', 'media', `${id}.mp4`))});
}

// Community: one folder per monument, with meta.json from scripts/publish.mjs.
const community = [];
for (const id of (await readdir(join(root, 'community')).catch(() => [])).sort()) {
  const dir = join(root, 'community', id);
  if (!(await exists(join(dir, 'monument.json')))) continue;
  const d = await json(join(dir, 'monument.json')), meta = await json(join(dir, 'meta.json')).catch(() => ({}));
  if (d.bricks && !/^[a-z0-9-]+\.bricks\.js$/.test(d.bricks)) throw new Error(`${id}: "bricks" must be a plain file name`);
  await copyFile(join(dir, 'monument.json'), join(monuments, `${id}.json`));
  await copyEvidence(dir, d, id);
  if (d.bricks) await copyFile(join(dir, d.bricks), join(monuments, d.bricks));
  let thumb = await exists(join(root, 'site', 'thumbs', `${id}.jpg`)) ? `${id}.jpg` : null;
  if (!thumb && process.env.CAPTURE) {
    const temp = await mkdtemp(join(tmpdir(), 'monument-'));
    await copyFile(join(dir, 'monument.json'), join(temp, `${id}.json`));
    if (d.bricks) await copyFile(join(dir, d.bricks), join(temp, d.bricks));
    try {
      execFileSync('node', [join(root, 'scripts', 'capture.mjs'), id, '--dir', temp, '--size', '960,640', '--out', join(out, 'thumbs', `${id}.png`)], {stdio: 'inherit'});
      thumb = `${id}.png`;
    } catch { console.warn(`No thumbnail for ${id}.`); }
  }
  community.push({id, name: d.name, place: d.place, thumb, video: await exists(join(root, 'site', 'media', `${id}.mp4`)), ...meta, title: meta.title ?? d.name});
}
community.sort((a, b) => String(b.date).localeCompare(String(a.date)));

// A recorded construction (site/media/<id>.mp4) plays in a loop; otherwise the thumbnail, or a placeholder.
const visual = (m, prefix) => m.video
  ? `<video src="${prefix}media/${esc(m.id)}.mp4" poster="${prefix}thumbs/${esc(m.id)}.jpg" autoplay muted loop playsinline preload="metadata" aria-label="${esc(m.name)} being built"></video>`
  : m.thumb === null ? `<span class="ph">${esc(m.id)}</span>` : `<img src="${prefix}thumbs/${esc(m.thumb ?? `${m.id}.jpg`)}" alt="${esc(m.name)}, the finished model" loading="lazy">`;
const card = (m, i, prefix) => `<a class="card" href="${prefix}view/#${esc(m.id)}">` + visual(m, prefix)
  + `<div><span class="n">${String(i + 1).padStart(2, '0')}</span><h3>${esc(m.title ?? m.name)}</h3><span class="place">${esc(m.place)}</span>`
  + (m.blurb ? `<p>${esc(m.blurb)}</p>` : '')
  + (m.prompt ? `<div class="prompt">${esc(m.prompt.length > 160 ? m.prompt.slice(0, 157) + '…' : m.prompt)}</div>` : '')
  + (m.author ? `<div class="by">@${esc(m.author)} · ${esc(m.model ?? 'Model not given')} · ${esc(m.date ?? '')}</div>` : '')
  + `</div></a>`;
const fill = async (page, values) => {
  let html = await readFile(join(out, page), 'utf8');
  for (const [marker, value] of Object.entries(values)) html = html.replaceAll(`<!--${marker}-->`, value);
  await writeFile(join(out, page), html);
};
const authors = new Set(community.map(m => m.author)).size, models = new Set(community.map(m => m.model)).size;
await fill('index.html', {
  COUNT: collection.length,
  STRIP: collection.map(m => `<a href="view/#${esc(m.id)}" aria-label="${esc(m.name)}">${visual(m, '')}</a>`).join(''),
  COLLECTION: collection.slice(0, 4).map((m, i) => card(m, i, '')).join(''),
});
await fill('collection/index.html', {COUNT: collection.length, COLLECTION: collection.map((m, i) => card(m, i, '../')).join('')});
await fill('community/index.html', {
  COMMUNITY_COUNT: community.length,
  COMMUNITY_META: community.length ? `<span>${authors} author${authors > 1 ? 's' : ''}</span><span>·</span><span>${models} model${models > 1 ? 's' : ''}</span><span>·</span><span>rebuilt from source</span>` : '<span>open to everyone</span><span>·</span><span>rebuilt from source</span>',
  COMMUNITY: community.length ? community.map((m, i) => card(m, i, '../')).join('') : '<div class="empty">No community monuments yet. Build one and be the first: <code>/monument &lt;building, city, country&gt;</code>, then “publish this monument to the community gallery”.</div>',
});
await writeFile(join(out, '.nojekyll'), '');
console.log(`_site: ${collection.length} in the collection, ${community.length} in the community gallery.`);
