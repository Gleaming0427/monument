#!/usr/bin/env node
// Builds the GitHub Pages site into _site/: node scripts/build-site.mjs [--out <folder>]
// site/ (pages), the viewer at view/ with the kit, the collection (examples/) and the community gallery
// (community/<id>/). With CAPTURE=1, community monuments without a thumbnail are photographed with Chrome.
// Every language in i18n/ gets the same site, in its own folder: English as the pages are written, the others
// rendered from their dictionary. One shared viewer serves them all, told which language by its own <html lang>.
import {readFile, writeFile, readdir, mkdir, cp, rm, mkdtemp, copyFile, access, rename} from 'node:fs/promises';
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
// The build writes beside the site and moves it into place at the end. A build that is interrupted — by a
// Ctrl-C, by a deploy that times out, by a capture that fails halfway — then leaves the last good site
// standing rather than half a site whose markers were never filled and whose cards were never written.
const staging = `${out}.building`;
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
  ? html.replace(/(\s(?:href|src|content)=")((?:\.\.\/)*)(site\.css|site\.js|thumbs\/|media\/)/gi, (whole, prefix, up_, first) => `${prefix}${'../'.repeat(levels)}${up_}${first}`)
  : html;

await rm(staging, {recursive: true, force: true});
await cp(join(root, 'site'), staging, {recursive: true});
await cp(join(root, 'kit'), join(staging, 'view', 'kit'), {recursive: true});
await copyFile(join(root, 'kit', 'viewer.html'), join(staging, 'view', 'index.html'));
await rm(join(staging, 'view', 'kit', 'viewer.html'));
// GitHub Pages lets browsers keep files for ten minutes: versioned URLs keep the viewer, its engine and
// the monument files from two different deploys apart.
const version = (process.env.GITHUB_SHA ?? (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(); } catch { return String(Date.now()); } })()).slice(0, 8);
const stamp = async (file, pairs) => { let text = await readFile(file, 'utf8'); for (const [from, to] of pairs) { if (!text.includes(from)) throw new Error(`${from} not found in ${file}`); text = text.replaceAll(from, to); } await writeFile(file, text); };
await stamp(join(staging, 'view', 'index.html'), [['href="kit/style.css"', `href="kit/style.css?v=${version}"`], ['src="kit/app.js"', `src="kit/app.js?v=${version}"`]]);
// Every module names the others through the same stamp: the kit's own (app → builder → visuals, geometry, masonry)
// and a monument's bricks, which import the engine they extend. A bare `../kit/builder.js` in a bricks file is
// another URL than the stamped one the viewer loads: a browser that kept the old file for ten minutes hands the
// new bricks an engine that lacks what they ask for ("does not provide an export named 'gothic'"), and a clean
// one runs the engine twice. Relative `.js` specifiers only: `three` and the rest come through the import map.
const RELATIVE_IMPORT = /(\bfrom\s*|\bimport\s*\(\s*)(['"])(\.{1,2}\/[^'"?]+\.js)\2/g;
const stampImports = text => text.replace(RELATIVE_IMPORT, (whole, head, quote, specifier) => `${head}${quote}${specifier}?v=${version}${quote}`);
const stampModule = async file => { const text = await readFile(file, 'utf8'); await writeFile(file, stampImports(text)); };
for (const name of (await readdir(join(staging, 'view', 'kit'))).filter(name => name.endsWith('.js'))) await stampModule(join(staging, 'view', 'kit', name));
for (const [file, specifier] of [['app.js', './builder.js'], ['builder.js', './visuals.js']]) {
  if (!(await readFile(join(staging, 'view', 'kit', file), 'utf8')).includes(`${specifier}?v=${version}`)) throw new Error(`${file} does not import ${specifier} through the deploy's stamp`);
}
await rm(join(staging, 'collection.json'));
const monuments = join(staging, 'view', 'monuments');
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
  if (thumb) await copyFile(join(root, 'site', 'thumbs', thumb), join(staging, 'thumbs', thumb));
  if (!thumb && process.env.CAPTURE) {
    const temp = await mkdtemp(join(tmpdir(), 'monument-'));
    await writeFile(join(temp, `${id}.json`), `${JSON.stringify(d, null, 2)}\n`);
    if (d.bricks) await copyFile(join(dir, d.bricks), join(temp, d.bricks));
    try {
      execFileSync('node', [join(root, 'scripts', 'capture.mjs'), id, '--dir', temp, '--size', '960,640', '--out', join(staging, 'thumbs', `${id}.png`)], {stdio: 'inherit'});
      thumb = `${id}.png`;
    } catch { console.warn(`No thumbnail for ${id}.`); }
  }
  community.push({id, name: d.name, place: d.place, thumb, video: await exists(join(root, 'site', 'media', `${id}.mp4`)), ...meta, title: meta.title ?? d.name});
}
community.sort((a, b) => String(b.date).localeCompare(String(a.date)));
// The bricks are copied as they stand; the engine they import carries the stamp too (see above).
for (const name of (await readdir(monuments)).filter(name => name.endsWith('.bricks.js'))) await stampModule(join(monuments, name));

// A recorded construction (site/media/<id>.mp4) plays in a loop; otherwise the thumbnail, or a placeholder.
// The strings a card carries are interface too, so they come from the same dictionary as the page around them.
// `{n}` is the count and `{s}` its plural suffix, empty for one and for none — French and English agree here,
// which is why one marker serves both. A language that does not would write its own rule in this function.
const say = (dictionary, key, fallback, args = {}) => {
  const args$ = {...args};
  if ('n' in args$ && typeof args$.n === 'number') args$.s = args$.n > 1 ? 's' : '';
  return Object.entries(args$).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), t(dictionary, key, fallback));
};
// Every picture sits in a frame that reserves its place before the file lands and reports how it ended, so a
// slow connection shows a shape rather than a hole and a missing file says it is missing instead of sitting
// blank. The frame is a data-frame so site.js can settle it; without the script it is simply the picture.
// The shimmer belongs to a file that is still on its way, so only a frame holding one carries it.
const loading = '<span class="media__load" aria-hidden="true"></span>';
const frame = (inner, modifier = '') => `<span class="media${modifier}" data-frame>${inner}</span>`;
// A monument with no thumbnail is not an error — it is one that has not been photographed yet, and the card
// says which one it is rather than showing an empty rectangle that reads as a broken image.
const absent = (id, dictionary) => frame(`<span class="media__none" role="img" aria-label="${esc(say(dictionary, 'card.pending', `${id}: no photograph yet`, {id}))}">`
  + `<b>${esc(t(dictionary, 'card.pendingLabel', 'No photograph yet'))}</b><span>${esc(id)}</span></span>`, ' media--none');
const visual = (m, assets, dictionary) => m.video
  // A recorded construction sits over its own photograph. The poster is not a fallback bolted on after a
  // failure: it is the layer underneath, so a video that is slow, blocked or refused always shows the
  // finished model instead of an empty grey rectangle. The video fades in over it when it can play.
  ? frame(loading + `<img class="media__poster" src="${assets}thumbs/${esc(m.thumb ?? `${m.id}.jpg`)}" alt="" aria-hidden="true" loading="lazy" decoding="async">`
    + `<video src="${assets}media/${esc(m.id)}.mp4" autoplay muted loop playsinline preload="metadata" aria-label="${esc(say(dictionary, 'card.building', `${m.name} being built`, {name: m.name}))}"></video>`, ' media--video')
  : m.thumb === null ? absent(m.id, dictionary)
  : frame(loading + `<img src="${assets}thumbs/${esc(m.thumb ?? `${m.id}.jpg`)}" alt="${esc(say(dictionary, 'card.finished', `${m.name}, the finished model`, {name: m.name}))}" loading="lazy" decoding="async">`);
// A card is a link, so its parts each say one thing: the picture names the model, the heading names the
// building, the credit names who made it. The index is a plate reference, not information, so it is hidden.
const card = (m, i, assets, viewer, dictionary) => `<a class="card" href="${viewer}#${esc(m.id)}" data-reveal>`
  + visual(m, assets, dictionary)
  + `<span class="card__body"><span class="card__n" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span><h3>${esc(m.title ?? m.name)}</h3><span class="place">${esc(m.place)}</span>`
  + (m.blurb ? `<p>${esc(m.blurb)}</p>` : '')
  + (m.prompt ? `<span class="prompt">${esc(m.prompt.length > 160 ? m.prompt.slice(0, 157) + '…' : m.prompt)}</span>` : '')
  // A submission with no credit still says so: an empty line reads as an omission, a named gap reads as a fact.
  + (m.author
    ? `<span class="by">@${esc(m.author)} · ${esc(m.model ?? say(dictionary, 'card.model', 'Model not given'))}${m.date ? ` · ${esc(m.date)}` : ''}</span>`
    : `<span class="by na">${esc(t(dictionary, 'card.uncredited', 'Author not given'))}${m.date ? ` · ${esc(m.date)}` : ''}</span>`)
  + `</span></a>`;
// What a card says in a language: the monument's own name and place, and the line under a card of the collection.
// A monument with no translation stays in the language it was written in, like its viewer page; a collection card
// with a translation and no blurb is a gap, and stops the build rather than leaving one English line in a French row.
const localized = (m, translation, language) => {
  if (language === SOURCE || !translation) return m;
  const local = {...m, name: translation.name ?? m.name, place: translation.place ?? m.place};
  if (m.blurb !== undefined) {
    if (typeof translation.blurb !== 'string' || !translation.blurb.trim()) throw new Error(`i18n: ${language}/${m.id} has no blurb`);
    local.blurb = translation.blurb;
  }
  // A title the author chose for the gallery stays as chosen; one that is only the monument's name follows it.
  if (m.title !== undefined && m.title === m.name) local.title = local.name;
  return local;
};
const fill = async (page, values, language) => {
  const target = join(staging, language === SOURCE ? '' : language, page);
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
    const source = await readFile(join(root, 'site', page), 'utf8'), target = join(staging, tree, page);
    await mkdir(join(target, '..'), {recursive: true});
    await writeFile(target, chrome(page, language)(nest(deeper ? render(source, dictionary, language) : source, deeper)));
  }
  // The English shell is already version-stamped above, and the other shells are made from it, so every
  // language ships the same cache-busting stamp rather than each inventing one. The dictionary travels beside
  // the shared kit, one file per language, and the application reads its own <html lang> to pick one.
  await mkdir(join(staging, 'view', 'kit', 'i18n'), {recursive: true});
  await writeFile(join(staging, 'view', 'kit', 'i18n', `${language}.json`), `${JSON.stringify(dictionary, null, 2)}\n`);
  const translations = new Map();
  if (deeper) for (const [id] of published) translations.set(id, await json(join(root, 'i18n', 'monuments', language, `${id}.json`)).catch(() => null));
  const local = m => localized(m, translations.get(m.id), language);
  if (deeper) for (const [id, monument] of published) {
    const translation = translations.get(id);
    if (!translation) continue;                       // a monument with no translation stays in its own language
    await writeFile(join(staging, 'view', 'monuments', `${id}.${language}.json`), `${JSON.stringify(mergeMonument(monument, translation, language, id), null, 2)}\n`);
  }
  if (deeper) {
    const target = join(staging, language, 'view', 'index.html');
    await mkdir(join(target, '..'), {recursive: true});
    // The shell is the English one, in French. A <base> pointing at the shared viewer folder makes every
    // relative reference — the kit, the monuments, the fonts — resolve exactly as it does in English, so the
    // application needs no second copy and no second set of paths. Only the way home differs, and it is measured from
    // that <base> too: from /view/, the French home is ../fr/ — `../../` would climb out of the site.
    await writeFile(target, render(await readFile(join(staging, 'view', 'index.html'), 'utf8'), dictionary, language)
      .replace('<head>', '<head><base href="../../view/">').replace('href="../"', `href="../${language}/"`));
  }
  const home = '', assets = siteRoot(home, language), viewer = viewerAt(language, home, language);
  await fill('index.html', {
    COUNT: collection.length,
    // Three monuments across the opening panel: a collage, not a grid. A fourth would leave an orphan cell,
    // and the rest of the collection is one click away.
    STRIP: collection.slice(0, 3).map(m => `<a href="${viewer}#${esc(m.id)}" aria-label="${esc(local(m).name)}">${visual(local(m), assets, dictionary)}</a>`).join(''),
  }, language);
  await fill('collection/index.html', {COUNT: collection.length, COLLECTION: collection.map((m, i) => card(local(m), i, siteRoot('collection/', language), viewerAt(language, 'collection/', language), dictionary)).join('')}, language);
  await fill('community/index.html', {
    COMMUNITY_COUNT: community.length,
    COMMUNITY_META: communityMeta(dictionary),
    COMMUNITY: community.length ? community.map((m, i) => card(local(m), i, siteRoot('community/', language), viewerAt(language, 'community/', language), dictionary)).join('') : emptyGallery(dictionary),
  }, language);
}
await writeFile(join(staging, '.nojekyll'), '');
// Everything above wrote to the staging folder. The old site is only now taken away, so the swap itself is the
// first moment the published folder can be wrong — and it cannot be left half-built by an earlier failure.
await rm(out, {recursive: true, force: true});
await rename(staging, out);
console.log(`${out === join(root, '_site') ? '_site' : out}: ${collection.length} in the collection, ${community.length} in the community gallery, ${LANGUAGES.map(l => l.code).join(' + ')}.`);
