// Languages on a static site: English is the source — the pages are written in it — and every other language is
// a dictionary rendered into its own folder at build time. Nothing is translated at runtime, so a French page is
// a real French page for a crawler, for a reader without JavaScript, and for a link that can be shared.
//
// Three markers, all read from the source page:
//   data-i18n="key"        the element's own text, which must not hold child tags
//   data-i18n-html="key"   the element's inner HTML, for a sentence that carries <b>, <code> or a link
//   data-i18n-<attr>="key" one attribute, for a title, an aria-label or a meta's content
// A missing key is never papered over: `render` names it, so the build fails rather than shipping a page that
// quietly keeps its English in the middle of the French.
const MARK = /data-i18n(-html|-[a-z-]+)?="([^"]+)"/g;
const escapeText = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttribute = text => escapeText(text).replace(/"/g, '&quot;');

// The element a marker sits in: [open, end] over the page delimit its inner HTML. `end` is missing for a void
// element — `<meta>` has no closing tag, and a marker on one of its attributes never needs one.
function elementAt(html, from) {
  const gt = html.indexOf('>', from);
  if (gt < 0) return null;
  const start = html.lastIndexOf('<', gt), tag = /^<([a-z0-9]+)/i.exec(html.slice(start, gt + 1))?.[1];
  if (!tag) return null;
  const rest = html.slice(gt + 1), scan = new RegExp(`<(/?)${tag}\\b([^>]*)>`, 'gi');
  let depth = 1;                                   // the opening tag has been read already
  for (const hit of rest.matchAll(scan)) {
    if (hit[1]) { if (--depth === 0) return {start, tag, open: gt + 1, end: gt + 1 + hit.index}; }
    else if (!/\/\s*$/.test(hit[2])) depth++;
  }
  return {start, tag, open: gt + 1, end: null};    // void, or the page is malformed
}

// Every key the page asks for, with the form it is used in, and anything malformed.
export function keys(html) {
  const forms = {}, problems = [];
  for (const match of html.matchAll(MARK)) {
    const [, kind = '', key] = match, element = elementAt(html, match.index);
    if (!element) { problems.push(`${key}: no element around it`); continue; }
    if (kind === '' || kind === '-html') {
      if (element.end === null) { problems.push(`${key}: <${element.tag}> has no closing tag`); continue; }
      if (kind === '' && /<[a-z]/i.test(html.slice(element.open, element.end))) problems.push(`${key}: data-i18n replaces the element's own text, so it cannot hold child tags — use data-i18n-html`);
    }
    // A translation holding markup is injected raw in one place and escaped in another: the same key may be
    // used as text and as an attribute, never once as HTML and once as plain text.
    if (key in forms && (kind === '-html') !== (forms[key] === '-html')) problems.push(`${key}: used both as html and as plain text, so one of the two would break`);
    forms[key] = kind ?? '';
  }
  return {keys: Object.keys(forms), forms, problems};
}

// The page rendered into `language`. Every marker becomes its translation and the language is declared, so a
// screen reader, a crawler and a browser all read the same thing.
export function render(html, dictionary, language) {
  const edits = [];
  for (const match of html.matchAll(MARK)) {
    const [, kind = '', key] = match, element = elementAt(html, match.index);
    if (!element) throw new Error(`i18n: no element for ${key}`);
    const text = dictionary[key];
    if (typeof text !== 'string') throw new Error(`i18n: ${language} has no entry for ${key}`);
    // The marker has done its work: the published page carries no trace of the dictionary.
    edits.push({start: match.index, end: match.index + match[0].length, text: ''});
    if (kind === '') {
      const length = /[^<]*/.exec(html.slice(element.open))[0].length;
      edits.push({start: element.open, end: element.open + length, text: escapeText(text)});
    } else if (kind === '-html') edits.push({start: element.open, end: element.end, text});
    else {
      const found = new RegExp(`\\s${kind.slice(1)}="[^"]*"`).exec(html.slice(element.start, element.open));
      if (!found) throw new Error(`i18n: <${element.tag}> has no ${kind.slice(1)} for ${key}`);
      edits.push({start: element.start + found.index, end: element.start + found.index + found[0].length, text: ` ${kind.slice(1)}="${escapeAttribute(text)}"`});
    }
  }
  const page = edits.sort((a, b) => b.start - a.start).reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), html);
  return /<html[^>]*\slang="/.test(page) ? page.replace(/(<html[^>]*\s)lang="[^"]*"/, `$1lang="${language}"`) : page.replace('<html', `<html lang="${language}"`);
}

// The switcher every page shows. Written once here so the four pages cannot disagree about the markup or the
// label, and so a third language is one line in the build rather than an edit in every page.
export function switcher(languages, current, href) {
  return `<span class="langs">${languages.map(({code, label}) =>
    `<a class="lang" lang="${code}" hreflang="${code}" href="${href(code)}"${code === current ? ' aria-current="true"' : ''}>${label}</a>`).join('')}</span>`;
}

export const t = (dictionary, key, fallback = key) => typeof dictionary?.[key] === 'string' ? dictionary[key] : fallback;

// ——— Monument content ———
// A monument's dates, measurements and people are evidence: they stay as the source wrote them. What a
// language changes is the sentence around them — the phase titles, the texts, the anecdotes, the labels by
// the height and the note on what is measured. Phases are keyed by their authored `id`; the arrays that carry
// no key of their own are keyed by position, and `checkTranslation` says so when a phase gains a moment.

// A date written in numbers alone is evidence and never changes; one with words in it ("after 1930", "7 July 1945",
// "c. 1526–1547") is a phrase, and the words are the language's to say.
const hasWords = text => /[A-Za-zÀ-ÿ]/.test(String(text ?? ''));

// The map a footprint was taken from is named by the object alone ("OpenStreetMap way 5013364"): an identifier that
// stays as it is. When the source adds a remark ("(the lowest step of the krepis)"), the remark is words to translate.
const planRemark = source => Boolean(source) && !/^OpenStreetMap (?:way|relation) \d+$/.test(String(source).trim());

// The translation file a monument needs, with the English left in place to translate: every slot is already
// where it belongs, so filling it in cannot move a title or lose a moment. `blurb` is the line under a card of the
// collection, which lives in site/collection.json rather than in the monument.
export function translationSkeleton(monument, {blurb} = {}) {
  const evidence = monument.evidence ?? {}, views = (evidence.references ?? []).map(reference => ({view: reference.view ?? ''}));
  // What the evidence panel says (the page each source gave, what stayed simplified) and the note a piece shows when
  // it is clicked. Sources and uncertainties go by position; notes by the index of their element.
  const notes = Object.fromEntries(monument.elements.map((element, i) => [i, element.note]).filter(([, note]) => note));
  return {
    _read: 'Translate every string into this language. Keep every number, date, measurement and name exactly as written. Every `source` is not here: it never changes. A `when` is here only when it has words in it: translate the words, keep the numbers.',
    name: monument.name ?? '',
    place: monument.place ?? '',
    ...(blurb ? {blurb} : {}),
    modelNote: monument.modelNote ?? '',
    live: (monument.live ?? []).map(entry => ({label: entry.label})),
    facts: (monument.facts ?? []).map(fact => ({value: fact.value, label: fact.label})),
    phases: Object.fromEntries(monument.phases.map(phase => [phase.id, {
      title: phase.title ?? '',
      ...(hasWords(phase.when) ? {when: phase.when} : {}),
      text: phase.text ?? '',
      ...(phase.moments?.length ? {moments: phase.moments.map(moment => ({tag: moment.tag, title: moment.title, text: moment.text}))} : {}),
    }])),
    ...(views.length || evidence.sources?.length || evidence.uncertainties?.length || planRemark(evidence.plan?.source) ? {evidence: {
      ...(planRemark(evidence.plan?.source) ? {plan: {source: evidence.plan.source}} : {}),
      ...(views.length ? {references: views} : {}),
      ...(evidence.sources?.length ? {sources: evidence.sources.map(source => ({read: source.read ?? ''}))} : {}),
      ...(evidence.uncertainties?.length ? {uncertainties: [...evidence.uncertainties]} : {}),
    }} : {}),
    ...(Object.keys(notes).length ? {notes} : {}),
  };
}

// The monument in `language`, or a refusal naming the first slot left untranslated. Falling back to English
// here would be worse than failing: a half-French timeline reads as broken, not as bilingual.
export function mergeMonument(monument, translation, language, id) {
  const missing = [];
  const text = (value, where) => {
    if (typeof value !== 'string' || !value.trim()) { missing.push(`${id}: ${where}`); return value; }
    return value;
  };
  const out = {...monument};
  if (translation.name !== undefined) out.name = text(translation.name, 'name');
  if (translation.place !== undefined) out.place = text(translation.place, 'place');
  if (translation.modelNote !== undefined) out.modelNote = text(translation.modelNote, 'modelNote');
  if (translation.live) out.live = monument.live.map((entry, i) => ({...entry, label: text(translation.live[i]?.label, `live[${i}].label`)}));
  if (translation.facts) out.facts = monument.facts.map((fact, i) => ({
    ...fact, value: text(translation.facts[i]?.value, `facts[${i}].value`), label: text(translation.facts[i]?.label, `facts[${i}].label`),
  }));
  out.phases = monument.phases.map(phase => {
    const t$ = translation.phases?.[phase.id];
    if (!t$) { missing.push(`${id}: phases.${phase.id}`); return phase; }
    const next = {...phase, title: text(t$.title, `phases.${phase.id}.title`), text: text(t$.text, `phases.${phase.id}.text`)};
    if (hasWords(phase.when)) next.when = text(t$.when, `phases.${phase.id}.when`);
    if (phase.moments?.length) {
      if (!t$.moments) { missing.push(`${id}: phases.${phase.id}.moments`); return next; }
      next.moments = phase.moments.map((moment, i) => ({
        ...moment, tag: text(t$.moments[i]?.tag, `phases.${phase.id}.moments[${i}].tag`),
        title: text(t$.moments[i]?.title, `phases.${phase.id}.moments[${i}].title`),
        text: text(t$.moments[i]?.text, `phases.${phase.id}.moments[${i}].text`),
      }));
    }
    return next;
  });
  // The evidence panel: the footprint's source, the label of each photo, the page each source gave, and what stayed simplified.
  const evidence = monument.evidence, said = translation.evidence ?? {};
  if (evidence) {
    out.evidence = {...evidence};
    if (planRemark(evidence.plan?.source)) out.evidence.plan = {...evidence.plan, source: text(said.plan?.source, 'evidence.plan.source')};
    if (evidence.references?.some(reference => reference.view)) out.evidence.references = evidence.references.map((reference, i) => reference.view ? {...reference, view: text(said.references?.[i]?.view, `evidence.references[${i}].view`)} : reference);
    if (evidence.sources?.length) out.evidence.sources = evidence.sources.map((source, i) => source.read ? {...source, read: text(said.sources?.[i]?.read, `evidence.sources[${i}].read`)} : source);
    if (evidence.uncertainties?.length) out.evidence.uncertainties = evidence.uncertainties.map((line, i) => text(said.uncertainties?.[i], `evidence.uncertainties[${i}]`));
  }
  // The note a piece shows when it is clicked in evidence mode.
  out.elements = monument.elements.map((element, i) => element.note ? {...element, note: text(translation.notes?.[i], `notes.${i}`)} : element);
  if (missing.length) throw new Error(`i18n: ${missing.length} untranslated slot(s) in ${language}/${id}\n  ${missing.join('\n  ')}`);
  return out;
}

// The numbers in a text are the claim it makes. A translation that drops one, or invents another, has changed
// the evidence — so every figure has to survive, whatever language it is written in. How a language groups
// digits is not part of the number: 9,000 / 9 000 / 9.000 are the same thousand. The groups come out first,
// because "2 ans, 2 mois" is two figures and "2 000 pièces" is one.
const figures = text => {
  let groups = String(text);
  for (let pass = 0; pass < 4; pass++) groups = groups.replace(/(\d)[ ,.](?=\d{3}(?!\d))/g, '$1');
  // Whatever is left of a dot or a comma is now a decimal separator, not a group one.
  return [...groups.matchAll(/\d+(?:[.,]\d+)?/g)].map(match => match[0].replace(/[.,]/g, '')).sort();
};

// Typographic habits that are not errors of meaning but read as errors to a reader of that language. French
// writes 9 000 or 9.000: a comma is the decimal separator there, so an English "9,000" reads as nine.
const TYPOGRAPHY = {
  fr: [[/\d,\d{3}/g, 'séparateur de milliers anglais : en français, 9 000 ou 9.000 — la virgule se lit comme un décimal']],
};
export function checkTranslation(monument, translation, language, {blurb} = {}) {
  const problems = [], walk = (source, target, where) => {
    if (typeof source !== 'string' || source === target) return;
    if (typeof target !== 'string') { problems.push(`${where}: not translated`); return; }
    if (!target.trim()) { problems.push(`${where}: empty`); return; }
    const from = figures(source).sort(), to = figures(target).sort();
    if (from.join(' ') !== to.join(' ')) problems.push(`${where}: figures ${from.join(' ') || '—'} became ${to.join(' ') || '—'}`);
    // A comma before three digits is an English thousands separator unless the source wrote the same number with a
    // decimal point: 15.484 m is 15,484 m in French, and the three digits are decimals.
    for (const [pattern, complaint] of TYPOGRAPHY[language] ?? []) for (const hit of target.matchAll(pattern)) if (!source.includes(hit[0].replace(',', '.'))) problems.push(`${where}: « ${hit[0]} » — ${complaint}`);
  };
  walk(monument.name, translation.name, 'name');
  walk(monument.place, translation.place, 'place');
  if (blurb) walk(blurb, translation.blurb, 'blurb');
  if (monument.modelNote) walk(monument.modelNote, translation.modelNote, 'modelNote');
  monument.live?.forEach((entry, i) => walk(entry.label, translation.live?.[i]?.label, `live[${i}].label`));
  monument.facts?.forEach((fact, i) => {
    walk(fact.value, translation.facts?.[i]?.value, `facts[${i}].value`);
    walk(fact.label, translation.facts?.[i]?.label, `facts[${i}].label`);
  });
  monument.phases.forEach(phase => {
    const t$ = translation.phases?.[phase.id];
    if (!t$) { problems.push(`phases.${phase.id}: missing`); return; }
    walk(phase.title, t$.title, `phases.${phase.id}.title`);
    if (hasWords(phase.when)) walk(phase.when, t$.when, `phases.${phase.id}.when`);
    walk(phase.text, t$.text, `phases.${phase.id}.text`);
    phase.moments?.forEach((moment, i) => {
      walk(moment.tag, t$.moments?.[i]?.tag, `phases.${phase.id}.moments[${i}].tag`);
      walk(moment.title, t$.moments?.[i]?.title, `phases.${phase.id}.moments[${i}].title`);
      walk(moment.text, t$.moments?.[i]?.text, `phases.${phase.id}.moments[${i}].text`);
    });
  });
  const evidence = monument.evidence ?? {}, said = translation.evidence ?? {};
  if (planRemark(evidence.plan?.source)) walk(evidence.plan.source, said.plan?.source, 'evidence.plan.source');
  (evidence.references ?? []).forEach((reference, i) => walk(reference.view, said.references?.[i]?.view, `evidence.references[${i}].view`));
  (evidence.sources ?? []).forEach((source, i) => walk(source.read, said.sources?.[i]?.read, `evidence.sources[${i}].read`));
  (evidence.uncertainties ?? []).forEach((line, i) => walk(line, said.uncertainties?.[i], `evidence.uncertainties[${i}]`));
  monument.elements.forEach((element, i) => walk(element.note, translation.notes?.[i], `notes.${i}`));
  return problems;
}