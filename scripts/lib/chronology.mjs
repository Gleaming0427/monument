// Chronology validation: the order a monument is built in, held against what the film shows.
//
// The engine lays every piece of a phase from the bottom up between 3 % and 89 % of that phase (`layPieces`),
// and takes down what a later phase removes. A moment pins a card on a point of the building and brings the
// camera to it; a card that waits on a spire which is not up yet shows the reader empty air. Nothing else
// catches that: the golden baselines hold positions and counts, not when each piece stands.
//
// What is checked, per monument:
//   dates      the phases follow each other: each starts no earlier than the one before;
//   moments    listed in the order the film reaches them (the viewer shows the last one whose `at` has passed);
//   pins       when a moment shows, masonry stands at its anchor or round it, or something stood there in that very
//              phase and has just been taken down (a spire falling);
//   laying     a piece appears resting on, or leaning against, what already stands: at most one in a hundred
//              may hang in the air when they are born;
//   lifetimes  a piece is taken down in a phase after the one that raised it.
//
// The engine is passed in (`loadEngine`), not imported: the kit's own imports only resolve in a browser, and
// what is checked is the rule the viewer plays, `layPieces`, rather than a copy of it.
const PIN_REACH = 8;      // metres: a pin this close to a standing piece is on the building
const NEIGHBOURHOOD = 30; // metres: how far round a pin the masonry that frames it is looked for
const FLOATING_SHARE = .01;  // share of a phase's pieces that may be born with nothing under or against them (the collection stays under 0.3 %)
const SUPPORT_GAP = .45;  // metres a piece may sit from what holds it

// The year a phase begins, read from its dates: "c. 1208–1235", "480 BC", "12th century", "After 1349",
// "1687-09-26..." for a dated site. Null when the text carries no year (the order cannot be judged then).
export function startYear(phase) {
  if (phase.from) { const time = Date.parse(phase.from); return Number.isNaN(time) ? null : new Date(time).getUTCFullYear() + new Date(time).getUTCMonth() / 12; }
  const text = String(phase.when ?? ''), bc = /\bBCE?\b/i.test(text);
  const century = /\bcentur|\d(?:st|nd|rd|th)\s*c\b/i.test(text) ? /(\d{1,2})(?:st|nd|rd|th)\b/i.exec(text) : null;
  // The first number that is a year, not a day of the month ("15 April 2019") and not part of a century.
  const year = [...text.matchAll(/\b\d{1,4}\b/g)].find(m => !/^\s*(?:st|nd|rd|th)\b/i.test(text.slice(m.index + m[0].length)) && !/^\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(text.slice(m.index + m[0].length)));
  // "12th century" is its middle, "5th century BC" likewise: 1150 and -450.
  if (century && (!year || century.index < year.index)) return bc ? -(Number(century[1]) * 100 - 50) : (Number(century[1]) - 1) * 100 + 50;
  if (!year) return null;
  return bc ? -Number(year[0]) : Number(year[0]);
}

const boxOf = piece => {
  const m = piece.matrix.elements;
  const hx = (Math.abs(m[0]) + Math.abs(m[4]) + Math.abs(m[8])) / 2, hy = (Math.abs(m[1]) + Math.abs(m[5]) + Math.abs(m[9])) / 2, hz = (Math.abs(m[2]) + Math.abs(m[6]) + Math.abs(m[10])) / 2;
  return {x: m[12], y: m[13], z: m[14], x0: m[12] - hx, x1: m[12] + hx, y0: m[13] - hy, y1: m[13] + hy, z0: m[14] - hz, z1: m[14] + hz};
};

// A point of the monument file in the scene, after the monument's `rotate` (as the viewer places it).
export const toScene = (data, [x, y, z]) => {
  const turn = (data.rotate ?? 0) * Math.PI / 180, c = Math.cos(turn), s = Math.sin(turn);
  return [x * c + z * s, y, -x * s + z * c];
};

// Pieces that stand at time t (in phases): born, and not yet taken down. A piece is taken down at a random
// moment of the phase that removes it (DEATH), so up to its latest moment it is still counted: a pin on the
// last of a wall is not called empty.
function standing(pieces, t, DEATH) {
  const latest = DEATH.from + DEATH.span;
  return pieces.filter(piece => piece.birth <= t && (piece.until === undefined || t < piece.until + latest));
}

const nearest = (list, [x, y, z]) => list.reduce((best, piece) => { const m = piece.matrix.elements; return Math.min(best, Math.hypot(m[12] - x, m[13] - y, m[14] - z)); }, Infinity);

// The pin stands among the masonry rather than on it: inside the plan of what stands round it (within
// NEIGHBOURHOOD metres), and no more than PIN_REACH above or below it. That is a card in the middle of a hall,
// of a pier, or of the four blocks a leg stands on; a card over a spire that is not up yet fails both.
function among(list, [x, y, z]) {
  const box = {x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity};
  let any = false;
  for (const piece of list) {
    const m = piece.matrix.elements;
    if (Math.hypot(m[12] - x, m[13] - y, m[14] - z) > NEIGHBOURHOOD) continue;
    any = true;
    box.x0 = Math.min(box.x0, m[12]); box.x1 = Math.max(box.x1, m[12]); box.y0 = Math.min(box.y0, m[13]); box.y1 = Math.max(box.y1, m[13]); box.z0 = Math.min(box.z0, m[14]); box.z1 = Math.max(box.z1, m[14]);
  }
  return any && x >= box.x0 && x <= box.x1 && z >= box.z0 && z <= box.z1 && y >= box.y0 - PIN_REACH && y <= box.y1 + PIN_REACH;
}

export function audit(data, pieces, engine, at = data.id ?? 'monument') {
  const {layPieces, DEATH} = engine, problems = [], notes = [];
  layPieces(pieces, data.phases.length);

  // dates
  let before = null;
  data.phases.forEach((phase, i) => {
    const year = startYear(phase);
    if (year === null) { notes.push(`${at}: phase ${phase.id} carries no year in its dates, so its place in the order is not checked`); return; }
    if (before && year < before.year - 1e-9) problems.push(`${at}: phase ${phase.id} (${phase.when ?? phase.from}) begins before ${before.id} (${before.when}), which comes first in the film`);
    before = {id: phase.id, year, when: phase.when ?? phase.from};
  });

  // moments and pins
  data.phases.forEach((phase, i) => {
    let previous = -Infinity;
    for (const moment of phase.moments ?? []) {
      if (moment.at < previous) problems.push(`${at}: phase ${phase.id}: moment “${moment.title}” (at ${moment.at}) is listed after one at ${previous}; the viewer shows the last listed moment whose time has passed, so it would never show`);
      previous = Math.max(previous, moment.at);
      if (!moment.anchor) continue;
      const anchor = toScene(data, moment.anchor), t = i + moment.at, here = standing(pieces, t, DEATH);
      const distance = nearest(here, anchor);
      if (distance <= PIN_REACH || among(here, anchor)) continue;
      // Something stood here and came down in this very phase: the card marks where it was (a spire that fell).
      const lost = pieces.filter(piece => piece.until !== undefined && piece.until >= i && piece.until < i + 1 && piece.birth <= t);
      if (nearest(lost, anchor) <= PIN_REACH) continue;
      const finished = nearest(standing(pieces, i + 1, DEATH), anchor), from = (() => { for (let a = 0; a <= 1.0001; a += .01) { const list = standing(pieces, i + a, DEATH); if (nearest(list, anchor) <= PIN_REACH || among(list, anchor)) return +a.toFixed(2); } return null; })();
      problems.push(`${at}: phase ${phase.id}: moment “${moment.title}” shows at ${moment.at} with the nearest standing piece ${distance.toFixed(1)} m from its pin${finished <= PIN_REACH ? `; the pin is on the building from at ${from} (${finished.toFixed(1)} m at the end of the phase), so the moment belongs there or later` : `, and it is still ${finished.toFixed(1)} m from anything at the end of the phase: the anchor is off the building`}`);
    }
  });

  // laying
  const boxes = pieces.filter(piece => piece.kind !== 'glass').map(piece => ({piece, box: boxOf(piece)})), cell = 4, grid = new Map(), key = (i, j) => i * 100003 + j;
  for (const item of boxes) for (let i = Math.floor(item.box.x0 / cell); i <= Math.floor(item.box.x1 / cell); i++) for (let j = Math.floor(item.box.z0 / cell); j <= Math.floor(item.box.z1 / cell); j++) { const k = key(i, j); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(item); }
  const counts = data.phases.map(() => ({pieces: 0, floating: 0}));
  for (const item of boxes) {
    const {piece, box} = item;
    counts[piece.phase].pieces++;
    if (box.y0 < .6) continue;
    let held = false;
    scan: for (let i = Math.floor((box.x0 - SUPPORT_GAP) / cell); i <= Math.floor((box.x1 + SUPPORT_GAP) / cell); i++) for (let j = Math.floor((box.z0 - SUPPORT_GAP) / cell); j <= Math.floor((box.z1 + SUPPORT_GAP) / cell); j++) for (const other of grid.get(key(i, j)) ?? []) {
      if (other === item || other.piece.birth > piece.birth || (other.piece.until !== undefined && other.piece.until + DEATH.from <= piece.birth)) continue;
      const o = other.box;
      if (o.x1 < box.x0 - SUPPORT_GAP || o.x0 > box.x1 + SUPPORT_GAP || o.z1 < box.z0 - SUPPORT_GAP || o.z0 > box.z1 + SUPPORT_GAP) continue;
      if (o.y1 >= box.y0 - SUPPORT_GAP && o.y0 <= box.y1) { held = true; break scan; }
    }
    if (!held) counts[piece.phase].floating++;
  }
  counts.forEach((count, i) => {
    if (count.floating > Math.max(2, count.pieces * FLOATING_SHARE)) problems.push(`${at}: phase ${data.phases[i].id}: ${count.floating} of ${count.pieces} pieces are born with nothing under or against them (${(100 * count.floating / count.pieces).toFixed(1)} %, the limit is ${FLOATING_SHARE * 100} %)`);
  });

  // lifetimes
  const early = pieces.filter(piece => piece.until !== undefined && piece.until <= piece.phase);
  if (early.length) problems.push(`${at}: ${early.length} pieces are taken down in the phase that raises them or before it (first: element ${early[0].element}, phase ${early[0].phase}, until ${early[0].until})`);

  return {problems, notes, laying: counts};
}
