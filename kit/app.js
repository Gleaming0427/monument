import {createStage, generators} from './builder.js';

const $ = id => document.getElementById(id);
// One page = one building (#<id>). Its file, monuments/<id>.json (dated, sourced phases and the
// elements to build), is written by the /monument skill when someone asks for the building.
const SECONDS_PER_PHASE = 6;
const params = new URLSearchParams(location.search);

let stage = null, data = null, time = 0, playing = false, touched = false, last = performance.now(), shown = '';
// Active construction moment: pinned in 3D; playback slows down long enough to read it.
let moment = null, momentKey = '', momentSince = 0;
const READING = 4500;

function when(phase, local) {
  if (phase.when) return phase.when;
  const from = Date.parse(phase.from), to = Date.parse(phase.to);
  return new Date(from + (to - from) * Math.min(1, local)).toLocaleDateString('en-GB', {month: 'long', year: 'numeric'});
}

// Short date of a phase for the timeline: "Jul 1887" for a dated site, otherwise the period.
// The word joiner after the dash keeps "1920–1925" in one piece when the date wraps.
const short = phase => phase.when ? phase.when.replace(/–/g, '–\u2060') : new Date(Date.parse(phase.from)).toLocaleDateString('en-GB', {month: 'short', year: 'numeric'});

// With no request, or for a building not built yet, the page says how to ask for it.
function empty(id) {
  document.body.classList.add('empty');
  $('empty-title').textContent = id ? `“${id}” hasn't been built yet` : 'Which building do you want to see built?';
  document.title = 'Monument';
}

async function open(id) {
  const response = id ? await fetch(`monuments/${id}.json`) : null;
  if (!response?.ok) return empty(id);
  data = await response.json();
  // A monument may bring its own bricks: a module next to its file whose default export holds generators.
  if (data.bricks) Object.assign(generators, (await import(new URL(data.bricks, response.url))).default);
  document.body.classList.remove('empty');
  stage.load(data);
  $('name').textContent = data.name; $('place').textContent = data.place ?? '';
  document.title = `${data.name} — Monument`;
  $('model-note').textContent = data.modelNote ?? 'Simplified 3D model · sourced dates and figures.';
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
    label.title = `${short(phase)} · ${phase.title}`;
    label.onclick = () => { time = i + .001; play(true); };
    bar.innerHTML = '<i class="seg-fill"></i>';
    for (const m of phase.moments ?? []) {
      const tick = document.createElement('button');
      tick.className = 'tick'; tick.style.left = `${m.at * 100}%`;
      tick.title = m.title; tick.setAttribute('aria-label', `Moment: ${m.title}`); tick.dataset.at = i + m.at;
      tick.onclick = () => { time = i + m.at + .001; play(true); };
      bar.append(tick);
    }
    seg.append(label, bar);
    $('phases').append(seg);
  });
  fitTimeline();
  $('labels').innerHTML = '';
  for (const label of data.labels ?? []) {
    const span = document.createElement('span');
    span.textContent = label.text; span.dataset.at = JSON.stringify(label.at);
    $('labels').append(span);
  }
  history.replaceState(null, '', `${location.search}#${id}`);
  shown = ''; touched = false;
  // ?t=2.5 opens the construction at a given instant (in phases), paused.
  const at = Number(params.get('t'));
  if (at) { time = Math.min(at, stage.duration); play(false); } else { time = 0; play(true); }
  // ?cam=azimuth,elevation,distance[,x,y,z]: fixed camera to compare the model with a photo taken from the
  // same spot (azimuth in degrees from north, 180 = seen from the south). ?clean hides the interface.
  const cam = params.get('cam')?.split(',').map(Number);
  if (cam?.length >= 3 && cam.every(Number.isFinite)) { touched = true; stage.autoRotate(false); stage.look(...cam); }
}

function play(on) {
  if (on && time >= stage.duration) time = 0;
  playing = on; last = performance.now();
  $('play').innerHTML = on ? '<svg viewBox="0 0 14 14"><rect x="2.5" y="1.5" width="3" height="11" rx="1"/><rect x="8.5" y="1.5" width="3" height="11" rx="1"/></svg>'
    : '<svg viewBox="0 0 14 14"><path d="M3.5 1.8v10.4a.8.8 0 0 0 1.2.7l8.3-5.2a.8.8 0 0 0 0-1.4L4.7 1.1a.8.8 0 0 0-1.2.7z"/></svg>';
  $('play').setAttribute('aria-label', on ? 'Pause' : 'Play');
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
    $('source').href = phase.source;
    $('source').textContent = `Source: ${new URL(phase.source).hostname.replace(/^www\./, '')}`;
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
    momentKey = pinned; momentSince = performance.now();
    $('moment').hidden = !moment;
    if (moment) {
      $('m-tag').textContent = moment.tag; $('m-title').textContent = moment.title; $('m-text').textContent = moment.text;
      $('m-source').href = moment.source; $('m-source').textContent = `Source: ${new URL(moment.source).hostname.replace(/^www\./, '')}`;
      $('moment').style.animation = 'none'; void $('moment').offsetWidth; $('moment').style.animation = '';
    }
  }
  for (const tick of $('phases').querySelectorAll('.tick')) tick.classList.toggle('seen', Number(tick.dataset.at) <= time);
  $('live').innerHTML = data.live.map(stat => `<span>${stat.label}</span><b>${stat.kind === 'height' ? Math.round(stage.height(time)) + ' m' : stage.count(stat.tag, time)}</b>`).join('');
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

// The moment card sits near its pin, inside the screen and clear of the panels.
function pinMoment() {
  const card = $('moment'), pin = $('pin'), leader = $('leader');
  if (!moment) { pin.hidden = leader.hidden = true; return; }
  const p = stage.project(moment.anchor), w = card.offsetWidth, h = card.offsetHeight;
  const minX = innerWidth > 1100 ? document.querySelector('.story').getBoundingClientRect().right + 16 : 12;
  const maxY = document.querySelector(innerWidth > 1100 || embed ? '.timeline' : '.story').getBoundingClientRect().top - h - 12;
  const x = Math.min(innerWidth - w - 12, Math.max(minX, p.x + 40));
  // Below the figures panel when it shares the same column.
  const live = document.querySelector('.live').getBoundingClientRect(), top = x + w > live.left - 12 ? live.bottom + 12 : 72;
  const y = Math.min(maxY, Math.max(top, p.y - h - 40));
  card.style.left = `${x}px`; card.style.top = `${y}px`;
  pin.hidden = leader.hidden = !p.visible;
  if (!p.visible) return;
  pin.style.left = `${p.x}px`; pin.style.top = `${p.y}px`;
  const ex = Math.max(x, Math.min(x + w, p.x)), ey = p.y < y ? y : y + h, dx = ex - p.x, dy = ey - p.y;
  leader.style.left = `${p.x}px`; leader.style.top = `${p.y}px`;
  leader.style.width = `${Math.hypot(dx, dy)}px`; leader.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
}

function frame(now) {
  requestAnimationFrame(frame);
  if (!data) return stage.render(now / 1000);
  if (playing) {
    // A frame timestamp can precede the start of playback: never a negative time.
    const slow = momentKey && now - momentSince < READING ? .22 : 1;
    time = Math.max(0, time + Math.min(.1, Math.max(0, now - last) / 1000) * slow / SECONDS_PER_PHASE);
    if (time >= stage.duration) { time = stage.duration; play(false); }
  }
  last = now;
  update();
  if (!touched) stage.cinematic(time, moment?.anchor);
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

// The monument is framed in the space the panels leave (left on wide screens, above on phones).
// ?embed keeps only the scene and the timeline, for a live preview inside another page.
function layout() {
  fitTimeline();
  if (clean || document.body.classList.contains('empty')) return stage.setInsets({left: 0, top: 0, bottom: 0});
  if (embed) return stage.setInsets({left: 0, top: 0, bottom: Math.round(innerHeight - document.querySelector('.timeline').getBoundingClientRect().top)});
  const story = document.querySelector('.story').getBoundingClientRect(), bar = document.querySelector('.timeline').getBoundingClientRect();
  const wide = innerWidth > 1100;
  stage.setInsets({
    left: wide ? Math.round(story.right) : 0,
    top: Math.ceil(document.querySelector('.top').getBoundingClientRect().bottom + 14),
    bottom: Math.round(innerHeight - (wide ? bar.top : story.top)),
  });
}

$('play').onclick = () => play(!playing);
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
addEventListener('keydown', event => { if (event.code === 'Space' && event.target === document.body) { event.preventDefault(); play(!playing); } });

// When the 3D scene cannot start, say why and how to fix it, and play the recorded construction instead
// (the website keeps one per monument in ../media/<id>.mp4).
function fallback(error) {
  console.error('3D rendering unavailable', error);
  let webgl2 = false;
  try { webgl2 = Boolean(document.createElement('canvas').getContext('webgl2')); } catch {}
  const box = $('fallback'), title = document.createElement('b'), help = document.createElement('span');
  title.textContent = webgl2 ? 'The 3D scene could not start.' : 'This browser has WebGL 2 turned off, and the 3D scene needs it.';
  help.textContent = webgl2 ? String(error?.message ?? error)
    : 'In Chrome or Edge, turn on Settings › System › Use graphics acceleration, then restart the browser. In Firefox, webgl.disabled must be false in about:config. Privacy extensions that block WebGL do this too. Safari 15 and later support it.';
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
  addEventListener('resize', layout);
  await open(decodeURIComponent(location.hash.slice(1)));
  layout();
  document.fonts.ready.then(fitTimeline);
  requestAnimationFrame(frame);
} catch (error) {
  fallback(error);
}

// Recording tools (scripts/record.mjs) drive the timeline frame by frame through this hook.
window.monument = {
  seek(t) { time = Math.max(0, Math.min(stage.duration, t)); play(false); },
  get duration() { return stage?.duration ?? 0; },
  get ready() { return Boolean(data); },
};

// Direct links can change only the fragment without reloading the document.
addEventListener('hashchange', () => {
  const id = decodeURIComponent(location.hash.slice(1));
  if (stage && id !== data?.id) open(id).then(layout).catch(fallback);
});
