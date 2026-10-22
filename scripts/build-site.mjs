#!/usr/bin/env node
// Builds the GitHub Pages site into _site/: node scripts/build-site.mjs [--out <folder>]
// site/ (pages), the viewer at view/ with the kit, the collection (examples/) and the community gallery
// (community/<id>/). With CAPTURE=1, community monuments without a thumbnail are photographed with Chrome.
// Every language in i18n/ gets the same site, in its own folder: English as the pages are written, the others
// rendered from their dictionary. One shared viewer serves them all, told which language by its own <html lang>.
import {readFile, writeFile, readdir, mkdir, cp, rm, mkdtemp, copyFile, access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {expand} from './lib/compact.mjs';
import {mergeMonument, render, switcher, t} from './lib/i18n.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
// `--out <folder>` builds somewhere else, so a test can read a whole site without touching the one a developer
// is looking at.
const outIndex = process.argv.indexOf('--out');
const out = outIndex >= 0 ? resolve(process.argv[outIndex + 1]) : join(root, '_site');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const exists = path => access(path).then(() => true, () => false);
const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);

// English is the language the pages are written in; every other one is a dictionary rendered into its own
// folder. Each language is a real folder of real pages, so a link can be shared and a crawler can read it.
const PAGES = ['index.html', 'collection/index.html', 'community/index.html'];
const LANGUAGES = [{code: 'en', label: 'EN'}, {code: 'fr', label: 'FR'}], SOURCE = LANGUAGES[0].code;
const dictionaries = Object.fromEntries(await Promise.all(LANGUAGES.filter(l => l.code !== SOURCE).map(async l => [l.code, await json(join(root, 'i18n', 'site', `${l.code}.json`))])));

// Where a language's pages live. A translated site sits one folder deeper, and inside it everything — a sister
// page, the viewer — keeps the same relative place, so the only thing that climbs further is what the whole
// site shares: the stylesheet, the thumbnails, the films.
const depth = folder => (folder.match(/\//g) ?? []).length;
const up = folder => '../'.repeat(depth(folder));                              // back to this language's root
const siteRoot = (folder, language) => up(folder) + (language === SOURCE ? '' : '../');   // back to the site root
const tree = code => code === SOURCE ? '' : `${code}/`;
const at = (code, folder, language) => code === language ? './' : `${siteRoot(folder, language)}${tree(code)}${folder}`;
const viewerAt = (code, folder, language) => code === language ? `${up(folder)}view/` : `${siteRoot(folder, language)}${tree(code)}view/`;
const nest = (html, levels) => levels
  ? html.replace(/(\s(?:href|src|content)=")((?:\.\.\/)*)(site\.css|thumbs\/|media\/)/gi, (whole, prefix, up_, first) => `${prefix}${'../'.repeat(levels)}${up_}${first}`)
  : html;

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

// Every monument, once expanded: the same object is written in each language it is published in.
const published = new Map();
const writeMonument = async (id, d) => {
  published.set(id, d);
  await writeFile(join(monuments, `${id}.json`), `${JSON.stringify(d, null, 2)}\n`);
};

// Collection: curated order and one line each.
const curated = await json(join(root, 'site', 'collection.json'));
const collection = [];
for (const {id, blurb} of curated) {
  const d = expand(await json(join(root, 'examples', `${id}.json`)), id);
  await writeMonument(id, d);
  await copyEvidence(join(root, 'examples'), d, id);
  collection.push({id, name: d.name, place: d.place, blurb, video: await exists(join(root, 'site', 'media', `${id}.mp4`))});
}

// Community: one folder per monument, with meta.json from scripts/publish.mjs.
const community = [];
for (const id of (await readdir(join(root, 'community')).catch(() => [])).sort()) {
  const dir = join(root, 'community', id);
  if (!(await exists(join(dir, 'monument.json')))) continue;
  const d = expand(await json(join(dir, 'monument.json')), id), meta = await json(join(dir, 'meta.json')).catch(() => ({}));
  if (d.bricks && !/^[a-z0-9-]+\.bricks\.js$/.test(d.bricks)) throw new Error(`${id}: "bricks" must be a plain file name`);
  await writeMonument(id, d);
  await copyEvidence(dir, d, id);
  if (d.bricks) await copyFile(join(dir, d.bricks), join(monuments, d.bricks));
  // A thumbnail is an asset, not something to re-photograph on every deploy: a photograph committed under
  // site/thumbs/ is reused as it stands. Only a monument with neither a committed .jpg nor a committed .png
  // needs Chrome, and that is a deliberate `CAPTURE=1` run, not a default.
  let thumb = null;
  for (const extension of ['jpg', 'png']) {
    if (await exists(join(root, 'site', 'thumbs', `${id}.${extension}`))) { thumb = `${id}.${extension}`; break; }
  }
  if (thumb) await copyFile(join(root, 'site', 'thumbs', thumb), join(out, 'thumbs', thumb));
  if (!thumb && process.env.CAPTURE) {
    const temp = await mkdtemp(join(tmpdir(), 'monument-'));
    await writeFile(join(temp, `${id}.json`), `${JSON.stringify(d, null, 2)}\n`);
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
// The strings a card carries are interface too, so they come from the same dictionary as the page around them.
// `{n}` is the count and `{s}` its plural suffix, empty for one and for none — French and English agree here,
// which is why one marker serves both. A language that does not would write its own rule in this function.
const say = (dictionary, key, fallback, args = {}) => {
  const args$ = {...args};
  if ('n' in args$ && typeof args$.n === 'number') args$.s = args$.n > 1 ? 's' : '';
  return Object.entries(args$).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), t(dictionary, key, fallback));
};
const visual = (m, assets, dictionary) => m.video
  ? `<video src="${assets}media/${esc(m.id)}.mp4" poster="${assets}thumbs/${esc(m.id)}.jpg" autoplay muted loop playsinline preload="metadata" aria-label="${esc(say(dictionary, 'card.building', `${m.name} being built`, {name: m.name}))}"></video>`
  : m.thumb === null ? `<span class="ph">${esc(m.id)}</span>` : `<img src="${assets}thumbs/${esc(m.thumb ?? `${m.id}.jpg`)}" alt="${esc(say(dictionary, 'card.finished', `${m.name}, the finished model`, {name: m.name}))}" loading="lazy">`;
const card = (m, i, assets, viewer, dictionary) => `<a class="card" href="${viewer}#${esc(m.id)}">` + visual(m, assets, dictionary)
  + `<div><span class="n">${String(i + 1).padStart(2, '0')}</span><h3>${esc(m.title ?? m.name)}</h3><span class="place">${esc(m.place)}</span>`
  + (m.blurb ? `<p>${esc(m.blurb)}</p>` : '')
  + (m.prompt ? `<div class="prompt">${esc(m.prompt.length > 160 ? m.prompt.slice(0, 157) + '…' : m.prompt)}</div>` : '')
  + (m.author ? `<div class="by">@${esc(m.author)} · ${esc(m.model ?? say(dictionary, 'card.model', 'Model not given'))} · ${esc(m.date ?? '')}</div>` : '')
  + `</div></a>`;
const fill = async (page, values, language) => {
  const target = join(out, language === SOURCE ? '' : language, page);
  let html = await readFile(target, 'utf8');
  for (const [marker, value] of Object.entries(values)) html = html.replaceAll(`<!--${marker}-->`, value);
  await writeFile(target, html);
};
// The head tells a crawler and a browser which page is the same page in another language, and the nav offers
// them. Both are written here, once, so the pages cannot disagree.
const chrome = (page, language) => {
  const folder = page.replace(/index\.html$/, '');
  const alternates = LANGUAGES.map(({code}) => `<link rel="alternate" hreflang="${code}" href="${at(code, folder, language)}">`).join('');
  return html => html.replace('</head>', `${alternates}\n</head>`).replace('<!--LANGS-->', switcher(LANGUAGES, language, code => at(code, folder, language)));
};
const authors = new Set(community.map(m => m.author)).size, models = new Set(community.map(m => m.model)).size;
const communityMeta = dictionary => community.length
  ? `<span>${say(dictionary, 'gallery.authors', `${authors} author${authors > 1 ? 's' : ''}`, {n: authors})}</span><span>·</span><span>${say(dictionary, 'gallery.models', `${models} model${models > 1 ? 's' : ''}`, {n: models})}</span><span>·</span><span>${t(dictionary, 'gallery.rebuilt', 'rebuilt from source')}</span>`
  : `<span>${t(dictionary, 'gallery.open', 'open to everyone')}</span><span>·</span><span>${t(dictionary, 'gallery.rebuilt', 'rebuilt from source')}</span>`;
const emptyGallery = dictionary => `<div class="empty">${t(dictionary, 'gallery.empty', 'No community monuments yet. Build one and be the first: <code>/monument &lt;building, city, country&gt;</code>, then “publish this monument to the community gallery”.')}</div>`;

// One folder per language, each with the same pages. The viewer is one application, so a translated site gets
// its own shell pointing back at the shared kit rather than a second copy of three.js; the dictionary travels
// beside it and the application reads its language off its own <html lang>.
for (const {code: language} of LANGUAGES) {
  const dictionary = dictionaries[language] ?? {}, deeper = language === SOURCE ? 0 : 1, tree = language === SOURCE ? '' : language;
  for (const page of PAGES) {
    const source = await readFile(join(root, 'site', page), 'utf8'), target = join(out, tree, page);
    await mkdir(join(target, '..'), {recursive: true});
    await writeFile(target, chrome(page, language)(nest(deeper ? render(source, dictionary, language) : source, deeper)));
  }
  // The English shell is already version-stamped above, and the other shells are made from it, so every
  // language ships the same cache-busting stamp rather than each inventing one. The dictionary travels beside
  // the shared kit, one file per language, and the application reads its own <html lang> to pick one.
  await mkdir(join(out, 'view', 'kit', 'i18n'), {recursive: true});
  await writeFile(join(out, 'view', 'kit', 'i18n', `${language}.json`), `${JSON.stringify(dictionary, null, 2)}\n`);
  if (deeper) for (const [id, monument] of published) {
    const translation = await json(join(root, 'i18n', 'monuments', language, `${id}.json`)).catch(() => null);
    if (!translation) continue;                       // a monument with no translation stays in its own language
    await writeFile(join(out, 'view', 'monuments', `${id}.${language}.json`), `${JSON.stringify(mergeMonument(monument, translation, language, id), null, 2)}\n`);
  }
  if (deeper) {
    const target = join(out, language, 'view', 'index.html');
    await mkdir(join(target, '..'), {recursive: true});
    // The shell is the English one, in French. A <base> pointing at the shared viewer folder makes every
    // relative reference — the kit, the monuments, the fonts — resolve exactly as it does in English, so the
    // application needs no second copy and no second set of paths. Only the way home is one level further out.
    await writeFile(target, render(await readFile(join(out, 'view', 'index.html'), 'utf8'), dictionary, language)
      .replace('<head>', '<head><base href="../../view/">').replace('href="../"', 'href="../../"'));
  }
  const home = '', assets = siteRoot(home, language), viewer = viewerAt(language, home, language);
  await fill('index.html', {
    COUNT: collection.length,
    STRIP: collection.map(m => `<a href="${viewer}#${esc(m.id)}" aria-label="${esc(m.name)}">${visual(m, assets, dictionary)}</a>`).join(''),
    COLLECTION: collection.slice(0, 4).map((m, i) => card(m, i, assets, viewer, dictionary)).join(''),
  }, language);
  await fill('collection/index.html', {COUNT: collection.length, COLLECTION: collection.map((m, i) => card(m, i, siteRoot('collection/', language), viewerAt(language, 'collection/', language), dictionary)).join('')}, language);
  await fill('community/index.html', {
    COMMUNITY_COUNT: community.length,
    COMMUNITY_META: communityMeta(dictionary),
    COMMUNITY: community.length ? community.map((m, i) => card(m, i, siteRoot('community/', language), viewerAt(language, 'community/', language), dictionary)).join('') : emptyGallery(dictionary),
  }, language);
}
await writeFile(join(out, '.nojekyll'), '');
console.log(`_site: ${collection.length} in the collection, ${community.length} in the community gallery, ${LANGUAGES.map(l => l.code).join(' + ')}.`);
