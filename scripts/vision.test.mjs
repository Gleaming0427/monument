#!/usr/bin/env node
// Every window, door and dormer, in every view. The viewer is asked which openings stand (every pane and door leaf the kit
// lays carries the number of its opening), and each one is looked at from each view by casting rays from the camera, as
// the picture is drawn: through the middle of its pane and a third of its height above and below, and on the wall either
// side of it (scripts/lib/vision.mjs). In a view, an opening is then:
//   - seen: a ray meets it (its glass, its leaf, its bars or its frame), and none meets what should not be there;
//   - hidden: what the rays meet stands in front of its wall (another wing, a tower, a balustrade), which a view may show;
//   - covered: a ray meets something else inside its opening, between the face of its wall and its glass (a panel laid
//     over it, a cornice run across its head, the wall of another building), or passes where its glass should be: a fault,
//     in any view.
// An opening is looked at from the outside of its wall only, when that is known (its element's other openings stand
// behind it): from inside a building, a window is not seen.
// The views are the monument's reference photos (evidence.references), and its own: four elevations square to its walls
// (the front, the back and both profiles), the plan from above, four bird's-eye views on the diagonals, and a detail of
// every wall of every element, in stretches of 20 m at most. An opening no view has seen is looked at last from close,
// square to it, halfway to what stands straight in front of its wall; when that stands less than 1.6 m out, the opening
// opens onto it. The openings standing at the end are looked at then; an opening gone by the end, at the end of every
// phase it stands in. Every opening must be seen in at least one view and covered in none. $VISION_DIR keeps the picture of every view, $VISION_REPORT=1
// prints what each view judged and every covered opening. Name monuments to hold only them:
//   node scripts/vision.test.mjs chateau-de-chambord
import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {readdir, readFile, writeFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';
import {startViewer, openBrowser} from './lib/browser.mjs';
import {expand} from './lib/compact.mjs';
import {loadEngine} from './lib/engine.mjs';
import {referenceView} from './lib/silhouette.mjs';
import {FRAME, openingsOf, viewsOf, outward, closeUp, outlook, sampleRays, verdict} from './lib/vision.mjs';

const root = fileURLToPath(new URL('..', import.meta.url)), only = process.argv.slice(2).filter(arg => !arg.startsWith('-'));
const REPORT = process.env.VISION_REPORT === '1', DIR = process.env.VISION_DIR;
// The nearest something may stand in front of an opening's wall and leave room for a camera to look at it.
const ROOM = 1.6;
const files = [
  ...(await readdir(join(root, 'examples'))).filter(name => name.endsWith('.json')).map(name => [name.slice(0, -5), join(root, 'examples', name), join(root, 'examples')]),
  ...(await readdir(join(root, 'community'), {withFileTypes: true})).filter(entry => entry.isDirectory()).map(entry => [entry.name, join(root, 'community', entry.name, 'monument.json'), join(root, 'community', entry.name)]),
];
// A monument whose pieces carry no opening (the kit tags its panes and leaves; a community brick in its own file, or holes
// without a pane, carry none) is not opened in the browser: the pieces are built here first, as the golden test builds them.
const monuments = [];
for (const [id, file, dir] of files) {
  const raw = JSON.parse(await readFile(file, 'utf8').catch(() => 'null') ?? 'null');
  if (!raw || (only.length && !only.includes(id))) continue;
  const d = expand(raw, id), engine = await loadEngine(d.bricks ? resolve(dirname(file), d.bricks) : undefined);
  const built = engine.buildPieces(d);
  monuments.push({id, dir, d, tagged: built.pieces.some(piece => piece.pane) || built.apertures.length > 0});
}

const json = async expression => JSON.parse(await browser.run(`JSON.stringify(${expression})`));
const results = new Map();
const browser = monuments.some(m => m.tagged) ? await openBrowser({width: FRAME[0], height: FRAME[1]}) : null;
after(async () => { await browser?.close(); });

// One view: its picture, and the openings in its frame that are not seen edge on and show at least 5 pixels wide (only
// those of `keys` when given), with their rays and what the rays meet, all cast in one call. An opening is looked at
// only from the outside of its wall (`sides`, from vision.mjs's outward): a camera inside a building, as a detail of
// another wall may stand, does not see its windows from the room.
async function look(id, view, sides, {keys = null, both = false} = {}) {
  // The picture is drawn only to be kept: the rays need the camera, not the picture.
  await browser.run(`monument.view(${JSON.stringify({t: view.t, cam: view.cam, fov: view.fov, shift: view.shift ?? 0, picture: Boolean(DIR)})})`);
  if (DIR) { await browser.settle(); await mkdir(DIR, {recursive: true}); await writeFile(join(DIR, `${id}-${view.name.replace(/[^a-z0-9]+/gi, '-')}.png`), await browser.shot('png')); }
  const openings = openingsOf(await json('monument.openings()')).filter(o => !keys || o.aliases.some(k => keys.includes(k))), eye = (await json('monument.eye')).slice(0, 3);
  const inFrame = s => s.z > -1 && s.z < 1 && s.x > 6 && s.x < FRAME[0] - 6 && s.y > 6 && s.y < FRAME[1] - 6;
  const centres = await json(`monument.screen(${JSON.stringify(openings.map(o => o.centre))})`);
  const outside = o => { const allowed = sides.get(o.key) ?? [1, -1], v = (eye[0] - o.centre[0]) * o.n[0] + (eye[1] - o.centre[1]) * o.n[1] + (eye[2] - o.centre[2]) * o.n[2]; return allowed.includes(Math.sign(v)); };
  const asked = openings.map((o, i) => inFrame(centres[i]) && outside(o) && {o, rays: sampleRays(o, eye)}).filter(a => a && a.rays);
  if (!asked.length) return {eye, judged: [], points: [], hits: [], count: openings.length};
  const screen = await json(`monument.screen(${JSON.stringify(asked.flatMap(a => [...a.rays.points, ...a.rays.ends]))})`);
  asked.forEach((a, i) => { a.at = screen.slice(i * 7, i * 7 + 7); });
  const judged = asked.filter(a => Math.hypot(a.at[5].x - a.at[6].x, a.at[5].y - a.at[6].y) >= 5);
  const points = judged.flatMap(a => a.at.slice(0, 5).map(s => [s.x, s.y]));
  const hits = await json(`monument.pick(${JSON.stringify(points)}, ${both})`);
  judged.forEach((a, i) => { a.verdict = verdict(a.o, a.rays, hits.slice(i * 5, i * 5 + 5), eye); });
  return {eye, judged, points, hits, count: openings.length};
}

for (const {id, dir, d, tagged} of monuments) {
  if (!tagged) { results.set(id, {standing: []}); if (REPORT) console.log(`${id}: no opening carries a number; not looked at`); continue; }
  const viewer = await startViewer(dir, 4233);
  try {
    await browser.open(`${viewer.base}?t=99&clean#${id}`);
    // The openings standing at the end of the last daylight phase, judged in the reference views and in the monument's
    // own; then, phase by phase back to the first, the openings that stood earlier and are gone by then (the dormers of a
    // roof that burnt, the windows of a church built in a temple), at the end of every phase they stand in, in views of
    // their own.
    const daylight = d.phases.findLastIndex(p => p.mood !== 'night'), day = (daylight < 0 ? d.phases.length - 1 : daylight) + .97;
    const sides = new Map(), standing = [], seenOnce = new Set(), covered = [], tally = {seen: 0, hidden: 0, covered: 0, unknown: 0}, mismatched = [], looked = new Map();
    let checked = 0, viewCount = 0, closeUps = 0;
    const note = (view, a) => {
      const v = a.verdict, l = looked.get(a.o.key) ?? {views: 0, oblique: 0, nearest: null};
      tally[v.kind]++; l.views++;
      if (v.kind === 'unknown') l.oblique++;
      // For an opening no view sees: the nearest thing found in front of it, and from which side of its wall.
      if (v.kind === 'hidden' && !(l.nearest?.gap <= v.gap)) l.nearest = {gap: v.gap, by: v.by, face: v.face, side: v.side, view: view.name};
      looked.set(a.o.key, l);
      if (v.kind === 'seen') for (const k of a.o.aliases) seenOnce.add(k);
      if (v.kind === 'covered') { covered.push({view: view.name, o: a.o, why: v.why}); if (REPORT) console.log(`${id} · ${view.name} · the ${a.o.role} ${a.o.key}: ${v.why}`); }
    };
    const judge = async view => {
      const {judged, points, hits, count} = await look(id, view, sides);
      viewCount++;
      // In the first views, 200 of the rays are cast one by one too, as a click is (stage.pick): the two must meet the same
      // thing at the same point.
      if (checked < 200 && points.length) {
        const some = points.slice(0, 200 - checked), each = await json(`monument.pickEach(${JSON.stringify(some)})`);
        some.forEach((p, k) => {
          const a = hits[k], b = each[k], same = !a && !b || a && b && a.element === b.element && a.kind === b.kind && a.opening === b.opening && Math.hypot(a.point[0] - b.point[0], a.point[1] - b.point[1], a.point[2] - b.point[2]) < 1e-3;
          if (!same) mismatched.push(`${view.name}, at ${p.map(Math.round).join(', ')}: ${a ? `${a.kind} of element ${a.element}` : 'nothing'} instead of ${b ? `${b.kind} of element ${b.element}` : 'nothing'}`);
        });
        checked += some.length;
      }
      judged.forEach(a => note(view, a));
      if (REPORT) console.log(`${id} · ${view.name}: ${judged.length} judged of ${count}`);
    };
    // The openings no view has seen, from close. Where a view found something in front of one, the room straight in front
    // of it is measured first, from its wall's face outwards; with 1.6 m or more, it is looked at from halfway (6 m at
    // most). An opening no view faced is looked at from 6 m out. These rays meet faces from behind too, so that a camera
    // standing inside a wall meets it, and does not see through it.
    const closeLook = async (list, t) => {
      for (const o of list.filter(o => !o.aliases.some(k => seenOnce.has(k)))) {
        const l = looked.get(o.key), near = l?.nearest;
        for (const side of near ? [near.side] : sides.get(o.key) ?? [1, -1]) {
          let distance = 6;
          if (near) {
            const {view, from} = outlook(o, side, near.face, t);
            await browser.run(`monument.view(${JSON.stringify({t: view.t, cam: view.cam, fov: view.fov, shift: 0, picture: false})})`);
            const [hit] = await json(`monument.pick([[${FRAME[0] / 2}, ${FRAME[1] / 2}]], true)`);
            l.room = hit ? {metres: Math.hypot(hit.point[0] - from[0], hit.point[1] - from[1], hit.point[2] - from[2]), by: hit.element} : {metres: Infinity};
            if (l.room.metres < ROOM) continue;
            // The camera sees nothing nearer than 1 m: it stands 1.2 m from the glass at the least.
            distance = Math.max(1.2, near.face + Math.min(6, l.room.metres / 2));
          }
          const view = closeUp(o, side, distance, t), {judged} = await look(id, view, sides, {keys: o.aliases, both: true});
          closeUps++;
          for (const a of judged) {
            note(view, a);
            if (a.verdict.kind === 'hidden') looked.get(o.key).closeUp = {gap: a.verdict.gap, by: a.verdict.by};
          }
          if (o.aliases.some(k => seenOnce.has(k))) break;
        }
      }
    };
    const openingsAt = async t => {
      await browser.run(`monument.view({t: ${t}, cam: [0, 30, 200, ...${JSON.stringify(d.view?.target ?? [0, 0, 0])}], picture: false})`);
      return openingsOf(await json('monument.openings()'));
    };
    const final = await openingsAt(day), lasting = new Set(final.flatMap(o => o.aliases));
    for (const [k, v] of outward(final, d)) sides.set(k, v);
    standing.push(...final);
    for (const view of [...(d.evidence?.references ?? []).map((r, i) => ({name: `reference ${i}${r.view ? ` (${r.view})` : ''}`, ...referenceView(d, r)})), ...viewsOf(d, final, day)]) await judge(view);
    await closeLook(final, day);
    for (let p = d.phases.length - 1; p >= 0; p--) {
      const t = p + .97;
      if (Math.abs(t - day) < 1e-6) continue;
      const all = await openingsAt(t), gone = all.filter(o => !o.aliases.some(k => lasting.has(k)));
      if (!gone.length) continue;
      const had = new Set(standing.flatMap(o => o.aliases)), fresh = gone.filter(o => !o.aliases.some(k => had.has(k)));
      for (const [k, v] of outward(all, d)) if (!sides.has(k)) sides.set(k, v);
      standing.push(...fresh);
      if (REPORT) console.log(`${id}: ${gone.length} openings gone by the end stand at the end of phase ${d.phases[p].id} (${fresh.length} met there first)`);
      for (const view of viewsOf(d, gone, t)) await judge({...view, name: `${d.phases[p].id}: ${view.name}`});
      await closeLook(gone, t);
    }
    results.set(id, {standing, seenOnce, covered, tally, mismatched, checked, looked});
    if (REPORT) console.log(`${id}: ${standing.length} openings, ${viewCount} views and ${closeUps} close-ups; looks: ${tally.seen} seen, ${tally.hidden} hidden, ${tally.covered} covered, ${tally.unknown} too oblique; seen at least once: ${standing.filter(o => o.aliases.some(k => seenOnce.has(k))).length}`);
  } finally { viewer.stop(); }
}

for (const {id} of monuments) {
  const r = results.get(id);
  if (!r || !r.standing.length) continue;
  test(`${id}: the rays cast all at once meet what they meet one by one`, () => {
    assert.ok(r.checked > 0, 'no ray was cast one by one');
    assert.deepEqual(r.mismatched, []);
  });
  test(`${id}: no window, door or dormer is covered in any view`, () => {
    assert.deepEqual(r.covered.map(c => `${c.view}: the ${c.o.role} ${c.o.key} of element ${c.o.element} at [${c.o.centre.map(x => x.toFixed(1)).join(', ')}] — ${c.why}`), []);
  });
  test(`${id}: every window, door and dormer is seen in at least one view`, () => {
    const why = o => {
      const l = r.looked.get(o.key);
      if (!l) return 'no view faces it';
      const near = l.nearest ? `at the nearest, element ${l.nearest.by} stands ${l.nearest.gap.toFixed(2)} m in front of its wall (${l.nearest.view})` : `too obliquely in ${l.oblique}`;
      const room = l.room ? `; straight in front of its wall, ${l.room.metres === Infinity ? 'nothing stands' : `element ${l.room.by} stands ${l.room.metres.toFixed(2)} m out`}` : '';
      const close = l.closeUp ? `; from close, element ${l.closeUp.by} stands ${l.closeUp.gap.toFixed(2)} m in front of it` : l.room && l.room.metres < ROOM ? `, too near for a camera (${ROOM} m)` : '';
      return `looked at in ${l.views} views, hidden or too oblique in all; ${near}${room}${close}`;
    };
    assert.deepEqual(r.standing.filter(o => !o.aliases.some(k => r.seenOnce.has(k))).map(o => `the ${o.role} ${o.key} of element ${o.element} at [${o.centre.map(x => x.toFixed(1)).join(', ')}]: ${why(o)}`), []);
  });
}
test('the vision test looked at every monument it read', () => assert.ok(monuments.length > 0 && monuments.every(m => results.has(m.id)), 'a monument was not looked at'));
