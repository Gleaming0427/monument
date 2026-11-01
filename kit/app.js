import {createStage, generators, PROVENANCE, SHAPES} from './builder.js';

const $ = id => document.getElementById(id);
// The interface speaks the language of the page it is on: the shell is written in that language by the site
// build, and the strings this file writes at runtime come from the dictionary that sits beside it, one file
// per language. English is the source, so English asks for nothing and a missing file changes nothing.
const LANGUAGE = new URLSearchParams(location.search).get('lang') ?? document.documentElement.lang ?? 'en';
const DICTIONARY = await (async () => {
  if (LANGUAGE === 'en') return {};
  try { return await (await fetch(new URL(`i18n/${LANGUAGE}.json`, import.meta.url))).json(); } catch { return {}; }
})();
const t = (key, fallback) => typeof DICTIONARY[key] === 'string' ? DICTIONARY[key] : fallback;
const say = (key, fallback, args = {}) => Object.entries(args).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), t(key, fallback));
// One page = one building (#<id>). Its file, monuments/<id>.json (dated, sourced phases and the
// elements to build), is written by the /monument skill when someone asks for the building.
// Pacing follows reading: a phase lasts as long as its text takes to read (about 3 words a second),
// a moment holds playback while its card is read, and the viewer can slow everything down.
const WORDS_PER_SECOND = 3;
const words = text => String(text ?? '').split(/\s+/).filter(Boolean).length;
const phaseSeconds = phase => Math.min(18, Math.max(8, words(phase.text) / WORDS_PER_SECOND + 3));
const SPEEDS = [1, .5, .25, 2];
let speed = 1;
try { speed = SPEEDS.includes(Number(localStorage.getItem('monument-speed'))) ? Number(localStorage.getItem('monument-speed')) : 1; } catch {}
// The website stamps its deploy on the module URL (?v=…); monument files carry the same stamp, so a
// cached engine and a newer monument file are never mixed.
const version = new URL(import.meta.url).search;
const params = new URLSearchParams(location.search);

let stage = null, data = null, time = 0, playing = false, touched = false, last = performance.now(), shown = '', sectionChosen = false;
// Active construction moment: pinned in 3D; playback slows down long enough to read it.
let moment = null, momentKey = '', momentSince = 0, reading = 0;

// A date the monument gives in numbers and months follows the language of the page.
const LOCALE = LANGUAGE === 'en' ? 'en-GB' : LANGUAGE;
// A decimal reads with the language's own mark: 0,3 % in French, 0.3% in English.
const num = value => LANGUAGE === 'en' ? value : String(value).replace('.', ',');
function when(phase, local) {
  if (phase.when) return phase.when;
  const from = Date.parse(phase.from), to = Date.parse(phase.to);
  return new Date(from + (to - from) * Math.min(1, local)).toLocaleDateString(LOCALE, {month: 'long', year: 'numeric'});
}

// Short date of a phase for the timeline: "Jul 1887" for a dated site, otherwise the period.
// The word joiner after the dash keeps "1920–1925" in one piece when the date wraps.
const short = phase => phase.when ? phase.when.replace(/–/g, '–\u2060') : new Date(Date.parse(phase.from)).toLocaleDateString(LOCALE, {month: 'short', year: 'numeric'});

// With no request, or for a building not built yet, the page says how to ask for it.
function empty(id) {
  document.body.classList.add('empty');
  $('empty-title').textContent = id ? say('viewer.missing', '“{id}” hasn\'t been built yet', {id}) : t('viewer.which', 'Which building do you want to see built?');
  document.title = t('viewer.title', 'Monument');
}

async function open(id) {
  // The monument carries its own words. In another language the site builds publishes `<id>.<lang>.json` with
  // the dates, measurements and sources untouched and the sentences around them translated; without one — an
  // untranslated monument — the English file answers and the timeline reads in the language it was written in.
  const translated = LANGUAGE === 'en' || !id ? null : await fetch(`monuments/${id}.${LANGUAGE}.json${version}`);
  const response = id ? (translated?.ok ? translated : await fetch(`monuments/${id}.json${version}`)) : null;
  if (!response?.ok) return empty(id);
  data = await response.json();
  // A monument may bring its own bricks: a module next to its file whose default export holds generators.
  if (data.bricks) {
    // Only a plain file name, loaded from the same origin as the monument file: never a remote script.
    const bricksUrl = new URL(data.bricks, response.url);
    if (!/^[a-z0-9-]+\.bricks\.js$/.test(data.bricks) || bricksUrl.origin !== location.origin) { data = null; return empty(id); }
    // Custom bricks are deployment-versioned just like the engine and JSON. Without this query a returning
    // visitor can keep an old module in the HTTP/module cache while seeing the new monument description.
    bricksUrl.search = version;
    const custom = await import(bricksUrl.href);
    Object.assign(SHAPES, custom.shapes ?? {});
    Object.assign(generators, custom.default);
  }
  // The requested building is the default scene. Real map context is available explicitly with
  // `view.context: true` or the `?context` query parameter.
  const showContext = params.has('context') || data.view?.context === true;
  document.body.classList.remove('empty');
  stage.load(showContext ? data : {...data, context: undefined}, {base: response.url});
  // ?section opens the monument on the side facing the camera.
  if (params.has('section')) { sectionChosen = true; stage.section(true); $('section-toggle').setAttribute('aria-pressed', 'true'); }
  // A monument with a scan can be shown as it was captured: ?scan opens on it, the button switches.
  $('capture-toggle').hidden = !stage.hasCapture; $('capture-toggle').setAttribute('aria-pressed', 'false');
  if (params.has('scan') && stage.hasCapture) capture(true);
  $('name').textContent = data.name; $('place').textContent = data.place ?? '';
  document.title = `${data.name} — Monument`;
  $('model-note').textContent = data.modelNote ?? t('viewer.modelNote', 'Simplified 3D model · sourced dates and figures.');
  $('model-note').hidden = false;
  document.querySelector('.live').hidden=!data.live.length&&!data.facts.length;
  $('facts').innerHTML = '';
  for (const fact of data.facts) {
    const li = document.createElement('li');
    li.innerHTML = `<b></b> `; li.firstChild.textContent = fact.value; li.append(fact.label);
    $('facts').append(li);
  }
  // Timeline: one segment per phase (date, title, bar); moments are diamonds on its bar.
  $('phases').innerHTML = '';
  data.phases.forEach((phase, i) => {
    const seg = document.createElement('li'), label = document.createElement('button'), bar = document.createElement('div');
    seg.className = 'seg'; label.className = 'seg-label'; bar.className = 'seg-bar';
    label.innerHTML = '<span class="seg-date"></span><span class="seg-title"></span>';
    label.firstChild.textContent = short(phase); label.lastChild.textContent = phase.title;
    label.title = `${short(phase)} · ${phase.title}${phase.disputed?.length ? ` · ${t('viewer.disputedMark', 'the sources disagree on a date')}` : ''}`;
    seg.classList.toggle('disputed', Boolean(phase.disputed?.length));
    label.onclick = () => { time = i + .001; play(true); };
    bar.innerHTML = '<i class="seg-fill"></i>';
    for (const m of phase.moments ?? []) {
      const tick = document.createElement('button');
      tick.className = 'tick'; tick.style.left = `${m.at * 100}%`;
      const mark = m.disputed?.length ? ` · ${t('viewer.disputedMark', 'the sources disagree on a date')}` : '';
      tick.title = m.title + mark; tick.setAttribute('aria-label', say('viewer.moment', 'Moment: {title}', {title: m.title}) + mark); tick.dataset.at = i + m.at;
      tick.classList.toggle('disputed', Boolean(m.disputed?.length));
      tick.onclick = () => { time = i + m.at + .001; play(true); };
      bar.append(tick);
    }
    seg.append(label, bar);
    $('phases').append(seg);
  });
  fitTimeline();
  $('labels').innerHTML = '';
  for (const label of showContext ? data.labels ?? [] : []) {
    const span = document.createElement('span');
    span.textContent = label.text; span.dataset.at = JSON.stringify(label.at);
    $('labels').append(span);
  }
  buildProof();
  if (proofOn) setProof(true);
  // The path is kept as the page has it: a translated shell carries a <base> onto the shared viewer, and a URL
  // that is only `?query#id` is measured against that base, which would send the address bar to the English page.
  history.replaceState(null, '', `${location.pathname}${location.search}#${id}`);
  shown = ''; touched = false;
  // ?t=2.5 opens the construction at a given instant (in phases), paused.
  const at = Number(params.get('t'));
  if (at) { time = Math.min(at, stage.duration); play(false); } else { time = 0; play(true); }
  // ?cam=azimuth,elevation,distance[,x,y,z]: fixed camera to compare the model with a photo taken from the
  // same spot (azimuth in degrees from north, 180 = seen from the south). ?clean hides the interface.
  const cam = params.get('cam')?.split(',').map(Number);
  if (cam?.length >= 3 && cam.every(Number.isFinite)) { touched = true; stage.autoRotate(false); stage.look(...cam); }
  // ?fov=70: the vertical field of view of the reference photo's lens, from a wide angle close up to a long
  // lens a few hundred metres away (calibrate.mjs fits a few degrees).
  if (Number(params.get('fov')) >= 1) stage.fov(Number(params.get('fov')));
  // ?shift=0.2: a photo with straightened verticals, its horizon that many photo heights below the middle.
  if (Number(params.get('shift'))) stage.shift(Number(params.get('shift')));
}

function play(on) {
  if (on && time >= stage.duration) time = 0;
  playing = on; last = performance.now();
  $('play').innerHTML = on ? '<svg viewBox="0 0 14 14"><rect x="2.5" y="1.5" width="3" height="11" rx="1"/><rect x="8.5" y="1.5" width="3" height="11" rx="1"/></svg>'
    : '<svg viewBox="0 0 14 14"><path d="M3.5 1.8v10.4a.8.8 0 0 0 1.2.7l8.3-5.2a.8.8 0 0 0 0-1.4L4.7 1.1a.8.8 0 0 0-1.2.7z"/></svg>';
  $('play').setAttribute('aria-label', on ? t('viewer.pause', 'Pause') : t('viewer.play', 'Play'));
  stage.autoRotate(on && !touched);
}

function update() {
  const total = stage.duration, index = Math.max(0, Math.min(total - 1, Math.floor(time))), phase = data.phases[index], local = time - index;
  stage.setTime(time);
  const key = `${data.id}:${index}`;
  if (key !== shown) {
    shown = key;
    $('title').textContent = phase.title;
    $('text').textContent = phase.text;
    $('disputed').replaceChildren(...disputes(phase.disputed)); $('disputed').hidden = !phase.disputed?.length;
    $('source').href = phase.source;
    $('source').textContent = say('viewer.source', 'Source: {host}', {host: new URL(phase.source).hostname.replace(/^www\./, '')});
    [...$('phases').children].forEach((seg, i) => {
      seg.classList.toggle('on', i === index); seg.classList.toggle('done', i < index);
      seg.querySelector('.seg-fill').style.width = i < index ? '100%' : '0%';
    });
  }
  $('when').textContent = when(phase, local);
  moment = null;
  for (const m of phase.moments ?? []) if (local >= m.at) moment = m;
  const pinned = moment ? `${data.id}:${index}:${moment.at}` : '';
  if (pinned !== momentKey) {
    momentKey = pinned; momentSince = performance.now(); reading = moment ? (words(moment.title) + words(moment.text)) / WORDS_PER_SECOND * 1000 + 1500 : 0;
    document.body.classList.toggle('has-moment', Boolean(moment));
    $('moment').hidden = !moment;
    if (moment) {
      $('m-tag').textContent = moment.tag; $('m-title').textContent = moment.title; $('m-text').textContent = moment.text;
      $('m-disputed').replaceChildren(...disputes(moment.disputed)); $('m-disputed').hidden = !moment.disputed?.length;
      $('m-source').href = moment.source; $('m-source').textContent = say('viewer.source', 'Source: {host}', {host: new URL(moment.source).hostname.replace(/^www\./, '')});
      $('moment').style.animation = 'none'; void $('moment').offsetWidth; $('moment').style.animation = '';
    }
    requestAnimationFrame(layout);
  }
  for (const tick of $('phases').querySelectorAll('.tick')) tick.classList.toggle('seen', Number(tick.dataset.at) <= time);
  $('live').replaceChildren(...data.live.flatMap(stat => {
    const label = document.createElement('span'), value = document.createElement('b');
    label.textContent = stat.label;
    value.textContent = stat.kind === 'height' ? Math.round(stage.height(time)) + ' m' : stage.count(stat.tag, time);
    return [label, value];
  }));
  const bar = $('phases').children[index].querySelector('.seg-bar'), done = Math.min(1, local);
  bar.firstChild.style.width = `${done * 100}%`;
  $('head').style.left = `${bar.offsetLeft + done * bar.offsetWidth}px`;
  $('head').style.top = `${bar.offsetTop + bar.offsetHeight / 2}px`;
  $('scrub').value = Math.round(time / total * 1000);
}

// Fixed plan labels (streets, courtyard, garden) follow their point in the scene.
function placeLabels() {
  for (const span of $('labels').children) {
    const p = stage.project(JSON.parse(span.dataset.at));
    span.hidden = !p.visible;
    span.style.transform = `translate(${p.x}px,${p.y}px) translate(-50%,-50%)`;
  }
}

// The moment card uses a reserved rail instead of covering the monument. On smaller screens it replaces
// the story card in the same dock; the pin is deliberately omitted there to keep the scene legible.
function pinMoment() {
  const card = $('moment'), pin = $('pin'), leader = $('leader');
  if (!moment) { pin.hidden = leader.hidden = true; return; }
  if (innerWidth <= 1100 || proofOn) {
    card.style.removeProperty('left'); card.style.removeProperty('right'); card.style.removeProperty('top');
    pin.hidden = leader.hidden = true;
    return;
  }
  const p = stage.project(moment.anchor), w = card.offsetWidth, h = card.offsetHeight;
  const x = innerWidth - w - 20;
  const live = document.querySelector('.live').getBoundingClientRect();
  const top = live.height ? live.bottom + 12 : document.querySelector('.top').getBoundingClientRect().bottom + 12;
  const maxY = document.querySelector('.timeline').getBoundingClientRect().top - h - 12;
  const y = Math.max(top, Math.min(maxY, p.y - h / 2));
  card.style.left = 'auto'; card.style.right = '20px'; card.style.top = `${y}px`;
  pin.hidden = leader.hidden = !p.visible;
  if (!p.visible) return;
  pin.style.left = `${p.x}px`; pin.style.top = `${p.y}px`;
  const ex = Math.max(x, Math.min(x + w, p.x)), ey = p.y < y ? y : y + h, dx = ex - p.x, dy = ey - p.y;
  leader.style.left = `${p.x}px`; leader.style.top = `${p.y}px`;
  leader.style.width = `${Math.hypot(dx, dy)}px`; leader.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
}

// The recorder (scripts/record.mjs, capture.mjs) draws by hand through monument.step(): once it has, the loop only
// schedules itself. A software renderer takes seconds over a frame, and a loop left running piles frames up
// behind every screenshot, which then waits for all of them.
let stepping = false;

function frame(now) {
  requestAnimationFrame(frame);
  if (!data) return stage.render(now / 1000);
  if (stepping) return;
  advance(now);
  draw(now);
}

// One step of the film: the timeline, the story, and the camera easing a little towards where the film wants it.
function advance(now) {
  const phase = data.phases[Math.min(data.phases.length - 1, Math.floor(time))];
  if (playing) {
    // A frame timestamp can precede the start of playback: never a negative time.
    const slow = momentKey && now - momentSince < reading / speed ? .12 : 1;
    time = Math.max(0, time + Math.min(.1, Math.max(0, now - last) / 1000) * slow * speed / phaseSeconds(phase));
    if (time >= stage.duration) { time = stage.duration; play(false); }
  }
  last = now;
  update();
  // Sourced worksite tableaux keep the camera at human scale between the more precise pinned moments.
  const siteFocus = phase.scene?.focus ?? (phase.scene?.at ? [phase.scene.at[0], (phase.scene.height ?? data.view.height ?? 12) * .55, phase.scene.at[1]] : null);
  if (!touched) stage.cinematic(time, moment?.anchor ?? siteFocus, moment?.distance ?? phase.scene?.distance, moment?.look);
  // A moment inside the building (`inside`) opens the section view while it shows, when the film holds the
  // camera; once the reader has set the section view themselves, it is theirs.
  if (!sectionChosen) {
    const open = Boolean(moment?.inside) && (!touched || stage.sectioning);
    if (open !== stage.sectioning) { stage.section(open); $('section-toggle').setAttribute('aria-pressed', String(open)); }
  }
}

function draw(now) {
  stage.render(now / 1000);
  pinMoment();
  placeLabels();
}

// Timeline titles stay while they all fit (bold included); otherwise only dates, since the current
// phase title is already in the story card.
function fitTimeline() {
  const phases = $('phases');
  phases.classList.remove('dates'); phases.classList.add('measure');
  const over = [...phases.querySelectorAll('.seg-title')].some(title => title.scrollWidth > title.parentNode.clientWidth);
  phases.classList.remove('measure'); phases.classList.toggle('dates', over);
}

// The monument is framed in the space the panels leave: between two rails on desktop, beside one compact
// rail on tablets, and above a short bottom dock on phones.
// ?embed keeps only the scene and the timeline, for a live preview inside another page.
function layout() {
  fitTimeline();
  if (clean || photoRef || document.body.classList.contains('empty')) return stage.setInsets({left: 0, right: 0, top: 0, bottom: 0});
  const bar = document.querySelector('.timeline').getBoundingClientRect();
  if (embed) return stage.setInsets({left: 0, right: 0, top: 0, bottom: Math.round(innerHeight - bar.top)});
  const story = document.querySelector('.story').getBoundingClientRect();
  const top = Math.ceil(document.querySelector('.top').getBoundingClientRect().bottom + 12);
  if (proofOn && innerWidth <= 1100) {
    const proof = $('proof').getBoundingClientRect();
    return stage.setInsets({left: 0, right: 0, top, bottom: Math.round(innerHeight - proof.top + 8)});
  }
  const card = moment ? $('moment').getBoundingClientRect() : story;
  if (innerWidth <= 720) {
    return stage.setInsets({left: 0, right: 0, top, bottom: Math.round(innerHeight - card.top + 8)});
  }
  if (innerWidth <= 1100) {
    return stage.setInsets({left: Math.round(card.right + 12), right: 0, top, bottom: Math.round(innerHeight - bar.top)});
  }
  const rightPanels = [document.querySelector('.live'), moment && $('moment'), proofOn && $('proof')].filter(Boolean)
    .filter(node => !node.hidden && getComputedStyle(node).display !== 'none')
    .map(node => innerWidth - node.getBoundingClientRect().left + 12);
  stage.setInsets({
    left: Math.round(story.right + 12),
    right: Math.round(Math.max(0, ...rightPanels)),
    top,
    bottom: Math.round(innerHeight - bar.top),
  });
}

$('play').onclick = () => play(!playing);
// Playback speed: the button cycles 1× → 0.5× → 0.25× → 2×; − and + step through it.
function setSpeed(next) {
  speed = next;
  $('speed').textContent = `${String(speed).replace(/^0/, '')}×`;
  $('speed').setAttribute('aria-label', say('viewer.speedValue', 'Playback speed {speed}×', {speed}));
  try { localStorage.setItem('monument-speed', String(speed)); } catch {}
}
$('speed').onclick = () => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]);
setSpeed(speed);
$('scrub').oninput = event => { time = event.target.value / 1000 * stage.duration; play(false); };
let scrubbing = false;
function seek(x) {
  const bars = [...$('phases').querySelectorAll('.seg-bar')];
  let i = 0;
  bars.forEach((bar, j) => { if (x >= bar.getBoundingClientRect().left - 3) i = j; });
  const r = bars[i].getBoundingClientRect();
  time = Math.min(stage.duration, i + Math.max(0, Math.min(1, (x - r.left) / r.width)));
  play(false);
}
$('phases').addEventListener('pointerdown', event => {
  if (!event.target.closest('.seg-bar') || event.target.closest('.tick')) return;
  scrubbing = true; $('phases').setPointerCapture(event.pointerId); seek(event.clientX);
});
$('phases').addEventListener('pointermove', event => { if (scrubbing) seek(event.clientX); });
$('phases').addEventListener('pointerup', () => { scrubbing = false; });
$('phases').addEventListener('pointercancel', () => { scrubbing = false; });
addEventListener('keydown', event => {
  if (event.target !== document.body) return;
  if (event.code === 'Space') { event.preventDefault(); play(!playing); }
  const order = [.25, .5, 1, 2], i = order.indexOf(speed);
  if (event.key === '-' && i > 0) setSpeed(order[i - 1]);
  if ((event.key === '+' || event.key === '=') && i < order.length - 1) setSpeed(order[i + 1]);
});

// ——— Evidence mode ———
// Every piece takes the colour of where its element comes from (element.provenance). The panel gives the
// measured outline and how closely the model fits it, the reference photos (each one laid over the model
// from its own viewpoint, with a sliding divider), the pages read and what remains uncertain. Clicking a
// piece names its phase and the page that dates it.
const PROOF_LABELS = {
  measured: [t('proof.measured', 'Measured'), t('proof.measuredNote', 'Placed on the measured plan and the published dimensions')],
  documented: [t('proof.documented', 'Documented'), t('proof.documentedNote', 'Read in the sources and the reference photos')],
  interpreted: [t('proof.interpreted', 'Interpreted'), t('proof.interpretedNote', 'Not documented: a reasoned reconstruction, said as such')],
  unstated: [t('proof.unstated', 'Not stated'), t('proof.unstatedNote', 'No provenance given in the monument file')],
};
let proofOn = false, photoRef = null, outlineFor = '';
const host = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
const commonsImage = (url, width) => { const m = /commons\.wikimedia\.org\/wiki\/(File:[^?#]+)/.exec(url ?? ''); return m ? `https://commons.wikimedia.org/wiki/Special:FilePath/${m[1].slice(5)}?width=${width}` : null; };
const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children); return node; };
const link = (href, text) => el('a', {href, textContent: text, target: '_blank', rel: 'noreferrer'});
// A date the pages read disagree on: what it is the date of, then each page's date linked to the page, the one the
// film follows among them. Pages that give the same date share it; two pages of one site go by their own names.
function disputes(list) {
  return (list ?? []).map(dispute => {
    const dates = new Map(), hosts = dispute.claims.map(claim => host(claim.source));
    for (const claim of dispute.claims) dates.set(claim.when, [...dates.get(claim.when) ?? [], claim.source]);
    const name = url => hosts.filter(h => h === host(url)).length > 1 ? `${host(url)} › ${decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? '').replace(/_/g, ' ')}` : host(url);
    const groups = [...dates].map(([when, sources]) => [`${when} (`, ...sources.flatMap((source, i) => [...(i ? [', '] : []), link(source, name(source))]), ')']);
    const line = el('p', {}, say('viewer.disputed', 'Sources disagree on {what}: ', {what: dispute.what}));
    for (const part of new Intl.ListFormat(LOCALE, {type: 'disjunction'}).formatToParts(groups.map((_, i) => String(i)))) line.append(...(part.type === 'element' ? groups[Number(part.value)] : [part.value]));
    return line;
  });
}

function buildProof() {
  const panel = $('proof'), ev = data.evidence ?? {};
  panel.replaceChildren();
  panel.append(el('h2', {textContent: t('proof.title', 'Where every piece comes from')}), el('p', {textContent: t('proof.intro', 'Each piece of the model takes the colour of its source. Click a piece to see when it was built and which page says so.')}));
  const legend = el('div', {className: 'legend'});
  panel.append(legend);
  if (ev.plan) {
    const fit = ev.plan.fit, box = el('input', {type: 'checkbox', checked: true});
    box.onchange = () => stage.showOutline(box.checked);
    panel.append(el('h3', {textContent: t('proof.plan', 'Measured plan')}),
      el('p', {}, `${t('proof.footprint', 'Footprint from')} `, link(ev.plan.url, ev.plan.source), fit ? say('proof.fit', ". The model's edges seen from above lie within {p90} m of it along 90% of their length (largest gap {max} m).", {p90: num(fit.p90), max: num(fit.max)}) : '.'),
      el('label', {}, box, t('proof.draw', 'Draw it on the ground (gold)')));
  }
  const refs = (ev.references ?? []).filter(r => Number.isFinite(r.azimuth));
  if (refs.length) {
    const grid = el('div', {className: 'photos'});
    for (const r of refs) {
      const thumb = commonsImage(r.url, 360), button = el('button', {title: say('proof.layPhoto', 'Lay this photo over the model: {view}', {view: r.view ?? ''})});
      if (thumb) button.append(el('img', {src: thumb, alt: '', loading: 'lazy'}));
      button.append(el('span', {textContent: `${r.view ?? ''}${r.calibration ? say('proof.within', ' · within {rms}%', {rms: num(r.calibration.rms)}) : ''}`}));
      button.onclick = () => showPhoto(r);
      grid.append(button);
    }
    panel.append(el('h3', {textContent: t('proof.photos', 'Reference photos')}), el('p', {textContent: t('proof.photosNote', 'Each one opens over the model, seen from the photographer\'s place. Drag the divider to compare.')}), grid);
  }
  // Carving shown as photographs: each one credited, as its licence requires.
  const reliefs = data.elements.filter(e => e.type === 'relief' && e.credit);
  if (reliefs.length) {
    const credits = new Map();
    for (const e of reliefs) { const c = credits.get(e.credit.file) ?? {...e.credit, names: []}; c.names.push(e.name ?? t('proof.carvingDefault', 'carving')); credits.set(e.credit.file, c); }
    panel.append(el('h3', {textContent: t('proof.carving', 'Carving from photographs')}),
      el('p', {textContent: t('proof.carvingNote', 'Sculpture too fine to build piece by piece is a photograph laid on the model, straightened and given its depth back.')}),
      el('ul', {}, ...[...credits.values()].map(c => el('li', {}, `${[...new Set(c.names)].join(', ')}: `, link(c.file, say('proof.photoBy', 'photo by {author}', {author: c.author})), `, ${c.license}`))));
  }
  if (ev.sources?.length) panel.append(el('h3', {textContent: t('proof.pages', 'Pages read')}), ...ev.sources.map(s => el('details', {}, el('summary', {}, link(s.url, host(s.url))), el('p', {textContent: s.read ?? ''}))));
  if (ev.uncertainties?.length) panel.append(el('h3', {textContent: t('proof.uncertain', 'Interpreted or simplified')}), el('ul', {}, ...ev.uncertainties.map(u => el('li', {textContent: u}))));
  if (data.modelNote) panel.append(el('h3', {textContent: t('proof.oneLine', 'In one line')}), el('p', {textContent: data.modelNote}));
}

async function setProof(on) {
  proofOn = on;
  document.body.classList.toggle('proof', on);
  $('proof').hidden = !on; $('pick').hidden = true;
  $('proof-toggle').setAttribute('aria-pressed', String(on));
  stage.proof(on);
  if (on) {
    const counts = stage.provenance(), total = counts.reduce((a, b) => a + b, 0) || 1;
    $('proof').querySelector('.legend').replaceChildren(...[...PROVENANCE, 'unstated'].flatMap((key, i) => counts[i] || i < 3 ? [el('div', {}, el('i', {}), el('b', {textContent: PROOF_LABELS[key][0]}), el('span', {textContent: `${Math.round(counts[i] / total * 100)}%`}), el('small', {textContent: PROOF_LABELS[key][1]}))] : []));
    [...$('proof').querySelectorAll('.legend > div')].forEach((row, i) => { row.dataset.p = [...PROVENANCE, 'unstated'][i]; });
    // The measured outline, loaded once per monument from <id>.evidence/.
    if (outlineFor !== data.id && data.evidence?.plan?.outline) {
      outlineFor = data.id;
      const outline = await fetch(`monuments/${data.evidence.plan.outline}${version}`).then(r => r.ok ? r.json() : null).catch(() => null);
      if (outline) stage.outline([...(outline.polygons ?? []).map(p => [p, true]), ...(outline.lines ?? []).map(l => [l, false])]);
    }
    stage.showOutline($('proof').querySelector('input[type=checkbox]')?.checked ?? true);
  } else stage.showOutline(false);
}
$('proof-toggle').onclick = () => setProof(!proofOn);
async function capture(on) {
  const button = $('capture-toggle');
  button.disabled = true;
  try { button.setAttribute('aria-pressed', String(await stage.capture(on))); }
  catch (error) { console.warn('The scan could not be shown.', error); button.title = String(error?.message ?? error); stage.capture(false).catch(() => {}); }
  button.disabled = false;
}
$('capture-toggle').onclick = () => capture(!stage.capturing);
$('section-toggle').onclick = () => { sectionChosen = true; const on = stage.section(!stage.sectioning); $('section-toggle').setAttribute('aria-pressed', String(on)); };

// A click (not a drag) on the scene, in evidence mode, names the piece under it.
let downAt = null;
$('stage').addEventListener('pointerdown', event => { downAt = [event.clientX, event.clientY]; });
$('stage').addEventListener('pointerup', event => {
  if (!proofOn || !downAt || Math.hypot(event.clientX - downAt[0], event.clientY - downAt[1]) > 5) return;
  const hit = stage.pick(event.clientX, event.clientY, time), pick = $('pick');
  if (!hit) { pick.hidden = true; return; }
  const element = data.elements[hit.element] ?? {}, phase = data.phases[hit.phase], key = PROVENANCE.includes(element.provenance) ? element.provenance : 'unstated';
  pick.replaceChildren(el('b', {textContent: `${short(phase)} · ${phase.title}`}), el('span', {className: 'prov', textContent: PROOF_LABELS[key][0]}));
  pick.lastChild.dataset.p = key;
  if (element.note) pick.append(el('p', {textContent: element.note}));
  pick.append(...disputes(phase.disputed));
  pick.append(el('br'), link(phase.source, say('viewer.source', 'Source: {host}', {host: host(phase.source)})));
  pick.hidden = false;
  pick.style.left = `${Math.min(innerWidth - pick.offsetWidth - 12, event.clientX + 14)}px`;
  pick.style.top = `${Math.min(innerHeight - pick.offsetHeight - 12, event.clientY + 14)}px`;
});

// A reference photo over the model: the camera goes where the photographer stood, with the same lens, in the
// state the photo shows; a divider slides between photo and model.
function showPhoto(ref) {
  photoRef = ref; play(false); touched = true; stage.autoRotate(false);
  const i = ref.phase ? data.phases.findIndex(p => p.id === ref.phase) : data.phases.findLastIndex(p => p.mood !== 'night');
  time = i < 0 ? stage.duration : i + .97;
  document.body.classList.add('photo');
  stage.proof(false);
  layout();
  stage.look(ref.azimuth, ref.elevation, ref.distance, ...(ref.target ?? data.view.target));
  stage.fov(ref.fov ?? 38); stage.shift(ref.shift ?? 0);
  const box = $('photo'), image = box.querySelector('img');
  image.src = commonsImage(ref.url, 1800) ?? ref.url;
  const fit = ref.calibration ? say('photo.fitted', " · viewpoint fitted on {points} points, model within {rms}% of the photo's height", {points: ref.calibration.points, rms: num(ref.calibration.rms)}) : t('photo.notFitted', " · viewpoint from the photo's recorded position, not fitted");
  box.querySelector('.photo-caption').replaceChildren(`${ref.view ?? t('photo.reference', 'Reference photo')} · `, link(ref.url, t('photo.thePhoto', 'the photo')), fit);
  box.style.setProperty('--split', '50%'); box.classList.remove('fade'); box.querySelector('.photo-fade').setAttribute('aria-pressed', 'false');
  box.hidden = false;
}
function hidePhoto() {
  photoRef = null; $('photo').hidden = true;
  document.body.classList.remove('photo');
  stage.proof(proofOn); stage.fov(); stage.shift(); layout();
}
{
  const box = $('photo');
  let dragging = false;
  const slide = x => box.style.setProperty('--split', `${Math.max(0, Math.min(100, x / innerWidth * 100))}%`);
  box.addEventListener('pointerdown', event => { if (event.target.closest('.photo-bar')) return; dragging = true; box.setPointerCapture(event.pointerId); slide(event.clientX); });
  box.addEventListener('pointermove', event => { if (dragging) slide(event.clientX); });
  box.addEventListener('pointerup', () => { dragging = false; });
  box.querySelector('.photo-close').onclick = hidePhoto;
  box.querySelector('.photo-fade').onclick = event => { const on = box.classList.toggle('fade'); event.currentTarget.setAttribute('aria-pressed', String(on)); };
  addEventListener('keydown', event => { if (event.key === 'Escape' && photoRef) hidePhoto(); });
}

// When the 3D scene cannot start, say why and how to fix it, and play the recorded construction instead
// (the website keeps one per monument in ../media/<id>.mp4).
function fallback(error) {
  console.error('3D rendering unavailable', error);
  let webgl2 = false;
  try { webgl2 = Boolean(document.createElement('canvas').getContext('webgl2')); } catch {}
  const box = $('fallback'), title = document.createElement('b'), help = document.createElement('span');
  title.textContent = webgl2 ? t('viewer.failed', 'The 3D scene could not start.') : t('viewer.noWebgl', 'This browser has WebGL 2 turned off, and the 3D scene needs it.');
  help.textContent = webgl2 ? String(error?.message ?? error)
    : t('viewer.webglHelp', 'In Chrome or Edge, turn on Settings › System › Use graphics acceleration, then restart the browser. In Firefox, webgl.disabled must be false in about:config. Privacy extensions that block WebGL do this too. Safari 15 and later support it.');
  box.replaceChildren(title, help);
  const id = decodeURIComponent(location.hash.slice(1));
  if (id) {
    const video = Object.assign(document.createElement('video'), {src: `../media/${encodeURIComponent(id)}.mp4`, autoplay: true, muted: true, loop: true, playsInline: true});
    video.onerror = () => video.remove();
    box.prepend(video);
  }
  box.hidden = false;
  document.body.classList.add('failed');
}

const clean = params.has('clean'), embed = params.has('embed');
document.body.classList.toggle('clean', clean);
document.body.classList.toggle('embed', embed);
try {
  stage = createStage($('stage'));
  stage.onInteract(() => { touched = true; stage.autoRotate(false); });
  new ResizeObserver(layout).observe(document.querySelector('.story'));
  new ResizeObserver(layout).observe($('moment'));
  addEventListener('resize', () => { pinMoment(); layout(); });
  await open(decodeURIComponent(location.hash.slice(1)));
  layout();
  // ?proof opens the evidence mode; ?photo=<n> lays reference photo n over the model.
  if (data && (params.has('proof') || params.has('photo'))) await setProof(true);
  const photoIndex = Number(params.get('photo'));
  if (data && params.has('photo') && data.evidence?.references?.[photoIndex]) showPhoto(data.evidence.references[photoIndex]);
  document.fonts.ready.then(fitTimeline);
  requestAnimationFrame(frame);
} catch (error) {
  fallback(error);
}

// Recording tools (scripts/record.mjs) drive the timeline frame by frame through this hook.
window.monument = {
  capture(on) { return capture(on); },
  seek(t) { time = Math.max(0, Math.min(stage.duration, t)); play(false); },
  // `frames` steps of the film, which ease the camera as that many frames of playback would, then one drawing, at
  // `clock` seconds (what the worksite figures sway with). The page stays still afterwards, until the next step.
  step(frames = 1, clock = performance.now() / 1000) {
    stepping = true;
    for (let i = 0; i < Math.max(1, frames); i++) advance(clock * 1000);
    draw(clock * 1000);
  },
  get duration() { return stage?.duration ?? 0; },
  get ready() { return Boolean(data) && stage.ready; },
  get eye() { return stage?.eye ?? []; },
  get insets() { return stage?.insets ?? {left: 0, right: 0, top: 0, bottom: 0}; },
  get reliefs() { return stage?.reliefs ?? []; },
  project(point) { return stage?.project(point) ?? {x: 0, y: 0, visible: false}; },
  // The monument's outline from a reference photo's viewpoint, in the state the photo shows (scripts/silhouette.mjs):
  // `cam` is [azimuth, elevation, distance, x, y, z], as ?cam takes it. The page stays still afterwards.
  // The monument at time `t` from `cam`, drawn once on a plain backdrop, the section plane following the camera when the
  // section view is on, with or without its photo reliefs (scripts/relief.test.mjs). The page stays still afterwards.
  photograph({t = stage.duration, cam, fov = 38, backdrop = '#000000', reliefs = true, shadows = true}) {
    stepping = true; touched = true;
    time = Math.max(0, Math.min(stage.duration, t)); play(false); update();
    stage.autoRotate(false); stage.look(...cam); stage.fov(fov); stage.shift(0);
    stage.photograph(backdrop, {reliefs, shadows});
    return true;
  },
  silhouette({t = stage.duration, cam, fov = 38, shift = 0}) {
    stepping = true; touched = true;
    time = Math.max(0, Math.min(stage.duration, t)); play(false); update();
    stage.autoRotate(false); stage.look(...cam); stage.fov(fov); stage.shift(shift);
    return stage.silhouette();
  },
};

// Direct links can change only the fragment without reloading the document.
addEventListener('hashchange', () => {
  const id = decodeURIComponent(location.hash.slice(1));
  if (stage && id !== data?.id) open(id).then(layout).catch(fallback);
});
