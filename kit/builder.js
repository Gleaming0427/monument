import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {resolveVisualStyle, pbrOptions, groundOptions, createEnvironment, disposeEnvironment} from './visuals.js';

// Construction engine: a monument file (phases + elements) becomes thousands of instanced pieces.
// Each piece is born (and sometimes removed) on the timeline; the shader drops it into place and
// lights it as it lands. One phase = one unit of time.
const PIXEL_RATIO = Math.min(2, Math.max(1.5, globalThis.devicePixelRatio ?? 1));
const FLY = 0.06;
const UP = new T.Vector3(0, 1, 0);
const KINDS = {
  stone: {roughness: .88, metalness: 0},
  metal: {roughness: .38, metalness: .6},
  slate: {roughness: .5, metalness: .15},
  tile: {roughness: .75, metalness: 0},
  wood: {roughness: .92, metalness: 0},
  cloth: {roughness: .9, metalness: 0},
  glass: {roughness: .1, metalness: .4},
};

function random(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const lerp = (points, x) => {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) if (x <= points[i][0]) { const [x0, y0] = points[i - 1], [x1, y1] = points[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  return points.at(-1)[1];
};

// ——— Kit: the elementary pieces ———
function kit(rand) {
  const pieces = [], m = new T.Matrix4(), q = new T.Quaternion(), p = new T.Vector3(), s = new T.Vector3(), e = new T.Euler();
  const tint = (hex, jitter = .1) => new T.Color(hex).multiplyScalar(1 + (rand() - .5) * 2 * jitter);
  const add = (kind, color, phase, order, top, extra) => pieces.push({kind, matrix: m.clone(), color, phase, order, top, ...extra});
  return {
    pieces, rand, tint,
    box(kind, [x, y, z], [sx, sy, sz], rotY, color, phase, order = y, extra = {}) {
      m.compose(p.set(x, y, z), q.setFromEuler(e.set(0, rotY, 0)), s.set(sx, sy, sz));
      add(kind, color, phase, order, y + sy / 2, extra);
    },
    beam(kind, a, b, thick, color, phase, extra = {}) {
      const d = b.clone().sub(a), len = d.length();
      m.compose(p.copy(a).add(b).multiplyScalar(.5), q.setFromUnitVectors(UP, d.normalize()), s.set(thick, len, thick));
      add(kind, color, phase, Math.min(a.y, b.y), Math.max(a.y, b.y), extra);
    },
    // Right-handed basis (x × y = z): tiles and slates laid on a slope.
    oriented(kind, pos, x, y, z, size, color, phase, order = pos.y, extra = {}) {
      m.makeBasis(x, y, z).scale(s.set(...size)).setPosition(pos);
      add(kind, color, phase, order, pos.y, extra);
    },
  };
}

// ——— Generators (bricks) ———
export const generators = {
  // Inclined masonry retaining base; dimensions refer to bottom and top footprints. curve > 1 gives the
  // fan-shaped profile of Japanese castle walls: flared at the foot, nearly vertical at the top.
  batteredBase(k, e, P) {
    const {center:[cx,cz],size:[w,d],top:[tw,td],height,rot=0,curve=1}=e;
    const co=Math.cos(rot),si=Math.sin(rot),palette=e.colors??[e.color??'#8e8c7c'];
    for(let y=0,row=0;y<height-.05;row++){const h=Math.min(height-y,.7+k.rand()*.55),t=1-(1-(y+h/2)/height)**curve,ww=w+(tw-w)*t,dd=d+(td-d)*t;
      for(const sign of [-1,1])for(const axis of [0,1]){const len=axis?dd:ww;
        // Stones of uneven length, joints staggered from one course to the next.
        for(let u=-len/2-(row%2)*.6;u<len/2;){const l=Math.min(1.2+k.rand()*1.5,len/2-u),mid=Math.max(-len/2,u)+(Math.min(len/2,u+l)-Math.max(-len/2,u))/2,size=Math.min(len/2,u+l)-Math.max(-len/2,u);
          // Uneven courses: some stones are split in two, each set slightly in or out and turned.
          if(size>.1)for(const [y1,h1] of k.rand()<.35?[[y,h*.45],[y+h*.45,h*.55]]:[[y,h]]){const out=(k.rand()-.5)*.14,x=axis?sign*(ww/2+out):mid,z=axis?mid:sign*(dd/2+out);k.box('stone',[cx+x*co+z*si,y1+h1/2,cz-x*si+z*co],[axis?1.3:size*.95,h1*.92,axis?size*.95:1.3],rot+(k.rand()-.5)*.04,k.tint(palette[Math.floor(k.rand()*palette.length)],.08),P(e.phase),y1*1e4+u);}
          u+=l;}
      }
      y+=h;
    }
  },

  // Exposed timber skeleton, usable for multi-storey wooden structures.
  timberFrame(k, e, P) {
    const {center:[cx,cz],size:[w,d],levels,y0=0,rot=0}=e,co=Math.cos(rot),si=Math.sin(rot);
    const v=(x,y,z)=>new T.Vector3(cx+x*co+z*si,y0+y,cz-x*si+z*co),c=()=>k.tint('#916b43',.09);
    // Optional full-height masts crossing the levels (Himeji's two central pillars, for instance).
    for(const x of e.pillars?.offsets??[])k.beam('wood',v(x,0,0),v(x,e.pillars.height,0),e.pillars.width??.95,c(),P(e.phase));
    // plans: optional [width, depth] per level in ken (e.ken metres); otherwise each level shrinks a little.
    levels.forEach((y,i)=>{const plan=e.plans?.[i],shrink=1-i*.13,ww=plan?plan[0]*(e.ken??1.97):w*shrink,dd=plan?plan[1]*(e.ken??1.97):d*shrink,prev=i?levels[i-1]:0;
      for(let x=-ww/2;x<=ww/2+.1;x+=ww/4)for(let z=-dd/2;z<=dd/2+.1;z+=dd/4){k.beam('wood',v(x,prev,z),v(x,y,z),.33,c(),P(e.phase));}
      for(let j=0;j<5;j++){const x=-ww/2+j*ww/4,z=-dd/2+j*dd/4;k.beam('wood',v(x,y,-dd/2),v(x,y,dd/2),.3,c(),P(e.phase));k.beam('wood',v(-ww/2,y,z),v(ww/2,y,z),.3,c(),P(e.phase));}
    });
  },

  // Japanese castle keep (tenshu): tiers of plastered walls with lattice windows, curved hip roofs whose
  // tile joints are plastered white, and gables placed face by face (kara, chidori, irimoya).
  // Plans are in ken (e.ken metres), heights in metres from eave to eave. Faces: s, n, e, w (z+ is south).
  tieredKeep(k, e, P) {
    const {center:[cx,cz], rot=0, y0=0, ken=1.97, tiers} = e, ph = P(e.phase);
    const co = Math.cos(rot), si = Math.sin(rot), pitch = Math.tan((e.pitch ?? 30) * Math.PI / 180);
    const WALL = e.wall ?? '#f3f1ec', TILE = e.tile ?? '#6a6f75', JOINT = e.joint ?? '#e2e0da', DARK = '#23262c', CAP = '#4a4f55';
    const at = (x, y, z) => new T.Vector3(cx + x*co + z*si, y, cz - x*si + z*co);
    // Outward normal (nx, nz) and tangent (tx, tz) pointing right when facing the wall from outside.
    const FACES = {s:[0,1,1,0], n:[0,-1,-1,0], e:[1,0,0,-1], w:[-1,0,0,1]}, ALL = ['s','n','e','w'];
    const alongX = f => f === 's' || f === 'n';
    const onFace = (f, along, out, y) => { const [nx,nz,tx,tz] = FACES[f]; return at(nx*out + tx*along, y, nz*out + tz*along); };
    const faceRot = f => rot + Math.atan2(-FACES[f][3], FACES[f][2]);
    const put = (kind, p, size, r, color) => k.box(kind, [p.x, p.y, p.z], size, r, color, ph, p.y);
    const beam = (kind, a, b, thick, color, extra) => k.beam(kind, a, b, thick, color, ph, extra);
    // Oriented piece lying on a surface: du across, ds down the slope.
    const lay = (kind, p, du, ds, size, color) => {
      const x = du.clone().normalize(), n = new T.Vector3().crossVectors(ds, du).normalize();
      if (n.y < 0) n.negate();
      k.oriented(kind, p, x, n, new T.Vector3().crossVectors(x, n).normalize(), size, color, ph, p.y);
    };
    const ridge = (a, b) => { beam('stone', a, b, .5, k.tint(WALL, .02)); beam('slate', a.clone().add(new T.Vector3(0,.24,0)), b.clone().add(new T.Vector3(0,.24,0)), .24, k.tint(CAP, .04)); };
    // Shachihoko: tile fish crowning a ridge end, tail up.
    const shachi = (p, r) => {
      const fwd = new T.Vector3(Math.sin(r), 0, Math.cos(r)), up = y => p.clone().add(new T.Vector3(0, y, 0));
      beam('slate', up(0), up(1.1).addScaledVector(fwd, .3), .5, k.tint(CAP, .03), {ornament: true});
      beam('slate', up(.95).addScaledVector(fwd, .3), up(1.75).addScaledVector(fwd, -.25), .32, k.tint(CAP, .03), {ornament: true});
    };
    const COL = .62;

    // Curved hip roof from the eave outline (ao, bo) up to the rectangle (ai, bi). lift(t) is the rise at
    // fraction t of the run; kara gables arch the eave; the soffit under the eave is plastered white.
    function skirt({ao, bo, ai, bi, base, lift, kara = [], wall}) {
      const bumpsOf = f => kara.filter(g => g.face === f);
      const shape = f => { const x = alongX(f); return {A0: x ? ao : bo, A1: x ? ai : bi, B0: x ? bo : ao, B1: x ? bi : ai, W: x ? wall[1] : wall[0]}; };
      const y = (f, along, t) => {
        const {A0, A1} = shape(f), half = A0 + (A1 - A0) * t, u = Math.min(1, Math.abs(along) / half);
        let h = base + lift(t) + .75 * u ** 6 * (1 - t) ** 2;
        for (const g of bumpsOf(f)) { const q = (along - g.at) / (g.width / 2); if (Math.abs(q) < 1) h += g.height * (1 + Math.cos(Math.PI * q)) / 2 * Math.max(0, 1 - t / .6) ** 1.5; }
        return h;
      };
      const point = (f, along, t) => { const {B0, B1} = shape(f); return onFace(f, along, B0 + (B1 - B0) * t, y(f, along, t)); };
      for (const f of ALL) {
        const {A0, A1, B0, B1, W} = shape(f), rows = Math.max(3, Math.ceil((B0 - B1) / .75)), n = Math.ceil(2 * A0 / COL);
        for (let r = 0; r < rows; r++) {
          const t0 = r / rows, t1 = (r + 1) / rows, tm = (t0 + t1) / 2, half = A0 + (A1 - A0) * tm;
          let edge = 0;
          for (let c = 0; c < n; c++) {
            const along = (c - (n - 1) / 2) * COL;
            if (Math.abs(along) + COL / 2 > half) continue;
            edge = Math.max(edge, Math.abs(along) + COL / 2);
            const p = point(f, along, tm), du = point(f, along + COL / 2, tm).sub(point(f, along - COL / 2, tm)), ds = point(f, along, t1).sub(point(f, along, t0));
            lay('slate', p, du, ds, [COL * .8, .2, ds.length() * 1.06], k.tint(TILE, .05));
            const j = point(f, along + COL / 2, tm);
            lay('stone', j, du, ds, [COL * .2, .24, ds.length() * 1.06], k.tint(JOINT, .02));
          }
          // Strips between the last full column and the hip line.
          for (const side of [-1, 1]) if (half - edge > .05) {
            const along = side * (edge + half) / 2, p = point(f, along, tm), ds = point(f, along, t1).sub(point(f, along, t0)), du = point(f, side * half, tm).sub(point(f, side * edge, tm));
            lay('slate', p, du, ds, [du.length() * 1.05, .2, ds.length() * 1.06], k.tint(TILE, .05));
          }
        }
        // White plastered soffit between the eave and the wall, then the eave board and its tile edge.
        const tw = Math.min(1, (B0 - W) / (B0 - B1));
        for (let along = -A0 + .6; along < A0; along += 1.2) {
          const a = Math.min(along, A0 - .6), p = point(f, a, tw / 2), ds = point(f, a, tw).sub(point(f, a, 0)), du = point(f, a + .6, tw / 2).sub(point(f, a - .6, tw / 2));
          const nrm = new T.Vector3().crossVectors(ds, du).normalize(); if (nrm.y < 0) nrm.negate();
          lay('stone', p.addScaledVector(nrm, -.32), du, ds, [1.26, .14, ds.length()], k.tint(WALL, .02));
        }
        for (let along = -A0; along < A0 - .01; along += .8) {
          const a0 = point(f, along, 0), a1 = point(f, Math.min(A0, along + .8), 0);
          beam('stone', a0.clone().add(new T.Vector3(0,-.22,0)), a1.clone().add(new T.Vector3(0,-.22,0)), .42, k.tint(WALL, .02));
          beam('slate', a0.clone().add(new T.Vector3(0,.08,0)), a1.clone().add(new T.Vector3(0,.08,0)), .24, k.tint(CAP, .04));
        }
        // Kara gable: white tympanum under the arched eave.
        for (const g of bumpsOf(f)) for (let a = g.at - g.width / 2 + .2; a < g.at + g.width / 2; a += .4) {
          const top = point(f, a, 0), flat = top.y - (y(f, a, 0) - (base + lift(0) + .75 * Math.min(1, Math.abs(a) / A0) ** 6)), h = top.y - flat;
          if (h > .15) put('stone', onFace(f, a, B0 - .35, flat + h / 2 - .2), [.42, h, .2], faceRot(f), k.tint(WALL, .02));
        }
      }
      // Hip ridges along the four diagonals.
      for (const f of ['s', 'n']) for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
        const {A0, A1} = shape(f), a = t => side * (A0 + (A1 - A0) * t);
        ridge(point(f, a(i / 4), i / 4), point(f, a((i + 1) / 4), (i + 1) / 4));
      }
      return {y, point, shape};
    }

    // Triangular gable standing on a roof face (chidori, or irimoya when large), with its own small roof.
    function gable(sk, g, backTo) {
      const f = g.face, {B0, B1} = sk.shape(f), t = g.slope ?? .3, out = B0 + (B1 - B0) * t, base = sk.y(f, g.at, t) - .2;
      const half = g.width / 2, apex = base + g.height, r = faceRot(f), depth = Math.max(1.5, out - backTo + .4);
      for (let i = 0; i < 10; i++) { const q = (i + .5) / 10; put('stone', onFace(f, g.at, out - .2, base - .4 + (g.height + .4) * q), [2 * half * (1 - q) + .3, (g.height + .4) / 10 + .02, .3], r, k.tint(WALL, .02)); }
      for (const side of [-1, 1]) {
        const pt = (a, b) => onFace(f, g.at + side * a * (half + .45), out + .55 - b * (depth + .55), apex + .2 - a * (g.height + .4));
        const rowsA = Math.ceil((half + .45) / .7), colsB = Math.ceil((depth + .55) / COL);
        for (let i = 0; i < rowsA; i++) for (let j = 0; j < colsB; j++) {
          const a = (i + .5) / rowsA, b = (j + .5) / colsB, p = pt(a, b), ds = pt((i + 1) / rowsA, b).sub(pt(i / rowsA, b)), du = pt(a, (j + 1) / colsB).sub(pt(a, j / colsB));
          lay('slate', p, du, ds, [du.length() * .8, .2, ds.length() * 1.06], k.tint(TILE, .05));
          lay('stone', pt(a, (j + 1) / colsB), du, ds, [du.length() * .2, .24, ds.length() * 1.06], k.tint(JOINT, .02));
          // Plastered underside, seen from the foot of the keep.
          if (a > .35) { const nrm = new T.Vector3().crossVectors(ds, du).normalize(); if (nrm.y < 0) nrm.negate(); lay('stone', p.clone().addScaledVector(nrm, -.3), du, ds, [du.length() * 1.02, .12, ds.length() * 1.04], k.tint(WALL, .02)); }
        }
        beam('stone', pt(0, 0).add(new T.Vector3(0,-.1,0)), pt(1, 0).add(new T.Vector3(0,-.25,0)), .46, k.tint(WALL, .02));
        beam('slate', pt(0, 0).add(new T.Vector3(0,.12,0)), pt(1, 0), .22, k.tint(CAP, .04));
      }
      const front = onFace(f, g.at, out + .55, apex + .2);
      ridge(front, onFace(f, g.at, out - depth, apex + .2));
      put('stone', onFace(f, g.at, out - .02, apex - .9), [.5, .9, .12], r, k.tint('#d9d2c2', .02));
      if (g.shachi !== false) shachi(front, r);
    }

    // Lattice windows in pairs (single, larger and without lattice on the top floor), and projecting bays.
    function windows(f, half, out, yc, tier, bays) {
      const pitchW = (tier.windowPitch ?? 2) * ken, n = Math.max(1, Math.floor(2 * half / pitchW)), r = faceRot(f);
      const single = tier.lattice === false;
      for (let i = 0; i < n; i++) {
        const along = (i - (n - 1) / 2) * pitchW;
        if (bays.some(b => Math.abs(along - (b.at ?? 0) * ken) < b.width * ken / 2 + .9)) continue;
        for (const dx of single ? [0] : [-.54, .54]) {
          const w = single ? 1.1 : .82, h = single ? 1.45 : 1.3;
          put('wood', onFace(f, along + dx, out + .03, yc), [w, h, .08], r, k.tint(DARK, .05));
          if (!single) for (let b = 0; b < 4; b++) put('stone', onFace(f, along + dx - w / 2 + (b + .5) * w / 4, out + .08, yc), [.07, h, .06], r, k.tint(WALL, .01));
          put('stone', onFace(f, along + dx, out + .05, yc - h / 2 - .06), [w + .14, .1, .12], r, k.tint(WALL, .01));
        }
      }
      for (const b of bays) {
        const w = b.width * ken, along = (b.at ?? 0) * ken, h = 1.7;
        put('wood', onFace(f, along, out + .3, yc), [w, h, .5], r, k.tint(DARK, .04));
        for (let x = -w / 2 + .12; x < w / 2; x += .24) put('stone', onFace(f, along + x, out + .58, yc), [.07, h, .07], r, k.tint(WALL, .01));
        put('stone', onFace(f, along, out + .35, yc + h / 2 + .12), [w + .3, .26, .72], r, k.tint(WALL, .02));
        put('stone', onFace(f, along, out + .35, yc - h / 2 - .12), [w + .3, .26, .72], r, k.tint(WALL, .02));
      }
    }

    let yb = y0, shown = y0;
    tiers.forEach((tier, i) => {
      const next = tiers[i + 1], hw = tier.plan[0] * ken / 2, hd = tier.plan[1] * ken / 2, E = yb + tier.height, o = tier.eave ?? 2.2;
      const gables = (tier.gables ?? []).map(g => ({...g, at: (g.at ?? 0) * ken, width: g.width * ken}));
      // Walls (south and north span the corners), windows, bays.
      for (const f of ALL) {
        const x = alongX(f), half = x ? hw : hd, out = x ? hd : hw, h = E - yb;
        put('stone', onFace(f, 0, out - .25, yb + h / 2), [x ? 2 * half : 2 * half - 1, h, .5], faceRot(f), k.tint(WALL, .015));
        const bays = (tier.bays ?? []).filter(b => b.face === f), yc = (shown + E - .9) / 2;
        windows(f, half, out, yc, tier, bays);
        if (tier.posts) for (let a = -half; a <= half + .01; a += ken) put('stone', onFace(f, a, out + .06, (shown + E) / 2), [.24, E - shown, .14], faceRot(f), k.tint('#e2ddd2', .02));
        if (tier.brackets) for (let a = -half + ken; a < half - ken / 2; a += 2 * ken) beam('stone', onFace(f, a, out + .05, E - 1.7), onFace(f, a, out + 1.6, E - .5), .22, k.tint(WALL, .02));
      }
      const kara = gables.filter(g => g.kind === 'kara').map(g => ({...g, height: g.height ?? 1.5}));
      if (next) {
        const ai = next.plan[0] * ken / 2, bi = next.plan[1] * ken / 2, rise = pitch * ((o + hw - ai) + (o + hd - bi)) / 2;
        const sk = skirt({ao: hw + o, bo: hd + o, ai, bi, base: E - .35, lift: t => rise * t ** 1.3, kara, wall: [hw, hd]});
        const nextOut = f => alongX(f) ? bi : ai;
        for (const g of gables.filter(g => g.kind !== 'kara')) gable(sk, g, nextOut(g.face));
        shown = E - .35 + rise;
      } else {
        // Top roof: hip-and-gable (irimoya), ridge along x, gable ends east and west.
        const R = tier.ridge ?? 3.6, sg = tier.hip ?? .4, ao = hw + o, bo = hd + o, zg = bo * (1 - sg), xg = ao - bo * sg, lift = s => R * s ** 1.3;
        const sk = skirt({ao, bo, ai: xg, bi: zg, base: E - .35, lift: t => lift(t * sg), kara, wall: [hw, hd]});
        for (const side of [-1, 1]) {
          const z = s => side * bo * (1 - s), xs = xg + .7, rows = 5, cols = Math.ceil(2 * xs / COL);
          for (let rr = 0; rr < rows; rr++) for (let c = 0; c < cols; c++) {
            const s0 = sg + (1 - sg) * rr / rows, s1 = sg + (1 - sg) * (rr + 1) / rows, sm = (s0 + s1) / 2, x = -xs + (c + .5) * 2 * xs / cols;
            const p = at(x, E - .35 + lift(sm), z(sm)), ds = at(x, E - .35 + lift(s1), z(s1)).sub(at(x, E - .35 + lift(s0), z(s0))), du = at(x + COL / 2, 0, 0).sub(at(x - COL / 2, 0, 0));
            lay('slate', p, du, ds, [COL * .8, .2, ds.length() * 1.06], k.tint(TILE, .05));
            lay('stone', at(x + COL / 2, E - .35 + lift(sm), z(sm)), du, ds, [COL * .2, .24, ds.length() * 1.06], k.tint(JOINT, .02));
          }
          // Gable end: white triangle set back under bargeboards.
          for (let q = 0; q < 8; q++) { const h0 = lift(sg), hq = h0 + (R - h0) * (q + .5) / 8; put('stone', at(side * xg, E - .35 + hq, 0), [.3, (R - h0) / 8 + .02, 2 * zg * (1 - (q + .5) / 8)], rot, k.tint(WALL, .02)); }
          for (const zs of [-1, 1]) {
            beam('stone', at(side * xs, E - .35 + lift(sg) - .25, zs * zg), at(side * xs, E - .1 + R, 0), .46, k.tint(WALL, .02));
          }
          shachi(at(side * (xs - .2), E - .1 + R, 0), rot + Math.PI / 2);
        }
        ridge(at(-xg - .7, E - .1 + R, 0), at(xg + .7, E - .1 + R, 0));
      }
      yb = E;
    });
  },

  // Round campanile of superposed arcades (Pisa type): a blind arcade on engaged columns at the foot,
  // open galleries of columns and arches around a cylindrical core, and a narrower belfry. Each storey
  // can belong to its own phase, so a tower built in several campaigns rises campaign by campaign.
  arcadedTower(k, e, P) {
    const {center:[cx,cz], radius:R, y0=0, color='#ece6d8', shade='#d6ccb9', core='#9f998e', dark='#2b2a30'} = e;
    const up = new T.Vector3(0, 1, 0);
    const pos = (a, r, y) => new T.Vector3(cx + Math.sin(a) * r, y, cz + Math.cos(a) * r);
    const box = (a, r, y, size, hex, ph) => { const p = pos(a, r, y); k.box('stone', [p.x, p.y, p.z], size, a, k.tint(hex, .035), ph, p.y); };
    // A ring of tangent blocks: a cylindrical wall, band or cornice.
    const ring = (r, y, h, t, hex, ph, step = .85) => { const n = Math.max(24, Math.round(2 * Math.PI * r / step)); for (let i = 0; i < n; i++) box((i + .5) / n * 2 * Math.PI, r, y + h / 2, [2 * Math.PI * r / n * 1.05, h, t], hex, ph); };
    // A round arch between two columns, laid voussoir by voussoir in the tangent plane.
    const arch = (a0, a1, r, spring, depth, hex, ph) => {
      const am = (a0 + a1) / 2, ra = r * Math.sin((a1 - a0) / 2), mid = pos(am, r * Math.cos((a1 - a0) / 2), spring), tan = new T.Vector3(Math.cos(am), 0, -Math.sin(am)), rad = new T.Vector3(Math.sin(am), 0, Math.cos(am));
      for (let j = 0; j < 7; j++) {
        const th = Math.PI * (j + .5) / 7, p = mid.clone().addScaledVector(tan, -ra * Math.cos(th)).addScaledVector(up, ra * Math.sin(th));
        const x = tan.clone().multiplyScalar(Math.sin(th)).addScaledVector(up, Math.cos(th)).normalize(), z = new T.Vector3().crossVectors(x, rad).normalize();
        k.oriented('stone', p, x, rad, z, [Math.PI * ra / 7 * 1.08, depth, .32], k.tint(hex, .035), ph, p.y);
      }
      return ra;
    };
    const column = (a, r, y, h, d, hex, ph) => { box(a, r, y + .18, [d * 1.5, .36, d * 1.5], hex, ph); box(a, r, y + h / 2, [d, h - .7, d], hex, ph); box(a, r, y + h - .17, [d * 1.55, .34, d * 1.55], hex, ph); };
    let y = y0;
    for (const s of e.storeys) {
      const ph = P(s.phase ?? e.phase), h = s.height;
      if (s.kind === 'blind') {
        ring(R + .35, y, .7, .9, shade, ph);
        ring(R - .6, y + .7, h - 1.15, 1.2, color, ph);
        const n = s.arches, spring = y + h * .78;
        for (let i = 0; i < n; i++) {
          const a = i / n * 2 * Math.PI;
          column(a, R + .12, y + .7, spring - y - .7, .55, color, ph);
          arch(a, (i + 1) / n * 2 * Math.PI, R + .08, spring, .4, color, ph);
        }
        ring(R - .45, y + h - .4, .4, 1.3, color, ph);
      } else if (s.kind === 'loggia') {
        // The gallery's back wall is darker: it stands in the shade of the floor above, as on photos.
        const rc = R - .25, n = s.columns, top = y + h - .4, ra = rc * Math.sin(Math.PI / n), spring = top - ra - .5, back = s.core ?? R - 1.9;
        ring(back, y, h, .9, core, ph, 1.1);
        for (let i = 0; i < n; i++) {
          const a = i / n * 2 * Math.PI;
          column(a, rc, y, spring - y, .34, color, ph);
          box(a, rc, spring + ra * .3, [ra * .95, ra * .6, .32], color, ph);
          arch(a, (i + 1) / n * 2 * Math.PI, rc, spring, .34, color, ph);
        }
        ring(rc - .02, spring + ra * .62, top - spring - ra * .62, .3, color, ph);
        ring((R + .1 + back) / 2, top, .4, R + .1 - back, color, ph);
      } else if (s.kind === 'belfry') {
        const rb = s.radius ?? R * .7, n = s.arches, top = y + h - .5, ra = rb * Math.sin(Math.PI / n), spring = top - ra - .45;
        ring(rb - 1.3, y, h - .5, .5, dark, ph, 1.1);
        for (let i = 0; i < n; i++) {
          const a = i / n * 2 * Math.PI;
          box(a, rb, y + (spring - y) / 2, [Math.PI * rb / n, spring - y, .8], color, ph);
          box(a, rb, spring + ra * .3, [ra * .9, ra * .6, .7], color, ph);
          arch(a, (i + 1) / n * 2 * Math.PI, rb, spring, .7, color, ph);
        }
        ring(rb, spring + ra * .62, top - spring - ra * .62, .7, color, ph);
        ring(rb + .2, top, .5, 1.1, color, ph);
        ring(rb - .2, top + .5, .6, .35, color, ph);
      }
      y += h;
    }
  },

  // Elliptical amphitheatre (Colosseum type), one part per element so each ring can have its own size,
  // phase and fate: `facade` (superposed arcades, optional engaged columns, an attic with pilasters,
  // windows and mast corbels), `cavea` (raked seating carried by radial walls) and `arena` (podium wall and
  // underground galleries). `arc` keeps only the bays between two angles in degrees (0 = east end of the
  // major axis, 90 = south), so a side that fell can be its own element with `until`.
  amphitheatre(k, e, P) {
    const {center:[cx,cz], rot=0, bays=80, color='#d8ccb3', brick='#a8724f', part='facade'} = e, ph = P(e.phase);
    const co = Math.cos(rot), si = Math.sin(rot), up = new T.Vector3(0, 1, 0);
    const world = (x, y, z) => new T.Vector3(cx + x * co + z * si, y, cz - x * si + z * co);
    const ell = (th, [a, b]) => ({p: new T.Vector3(a * Math.cos(th), 0, b * Math.sin(th)), n: new T.Vector3(b * Math.cos(th), 0, a * Math.sin(th)).normalize(), t: new T.Vector3(-a * Math.sin(th), 0, b * Math.cos(th)).normalize()});
    const inArc = th => { if (!e.arc) return true; const deg = (th * 180 / Math.PI % 360 + 360) % 360, [a0, a1] = e.arc; return a0 <= a1 ? deg >= a0 && deg <= a1 : deg >= a0 || deg <= a1; };
    const yaw = t => rot + Math.atan2(-t.z, t.x);
    const put = (p, y, size, t, hex) => { const w = world(p.x, y, p.z); k.box('stone', [w.x, w.y, w.z], size, yaw(t), k.tint(hex, .05), ph, w.y); };
    const turn = v => new T.Vector3(v.x * co + v.z * si, 0, -v.x * si + v.z * co);
    const arch = (p0, p1, spring, depth, hex) => {
      const mid = p0.clone().add(p1).multiplyScalar(.5), dir = p1.clone().sub(p0), ra = dir.length() / 2; dir.normalize();
      const y = turn(new T.Vector3(dir.z, 0, -dir.x)), along = turn(dir);
      for (let j = 0; j < 7; j++) {
        const th = Math.PI * (j + .5) / 7, q = mid.clone().addScaledVector(dir, -ra * Math.cos(th)), w = world(q.x, spring + ra * Math.sin(th), q.z);
        const x = along.clone().multiplyScalar(Math.sin(th)).addScaledVector(up, Math.cos(th)).normalize();
        k.oriented('stone', w, x, y, new T.Vector3().crossVectors(x, y), [Math.PI * ra / 7 * 1.12, depth, .75], k.tint(hex, .05), ph, w.y);
      }
    };
    const step = 2 * Math.PI / bays;
    if (part === 'facade') {
      const radii = e.radii;
      let y = e.y0 ?? 0;
      for (const s of e.storeys) {
        for (let i = 0; i < bays; i++) {
          const th = i * step; if (!inArc(th) || !inArc(th + step)) continue;
          const {p, n, t} = ell(th, radii), next = ell(th + step, radii).p, m = ell(th + step / 2, radii), bay = p.distanceTo(next);
          if (s.kind === 'attic') {
            put(m.p, y + s.height / 2, [bay * 1.03, s.height, 1.6], m.t, color);
            put(p.clone().addScaledVector(n, .5), y + s.height / 2, [.85, s.height - .5, .5], t, color);
            if (i % 2 === 0) put(m.p.clone().addScaledVector(m.n, .8), y + s.height * .5, [1.2, 1.9, .2], m.t, '#3f362e');
            for (const f of [.25, .75]) { const c = ell(th + step * f, radii); put(c.p.clone().addScaledVector(c.n, .95), y + s.height - 1.9, [.55, .7, .5], c.t, color); }
            put(m.p.clone().addScaledVector(m.n, .3), y + s.height - .35, [bay * 1.05, .7, 2.3], m.t, color);
            continue;
          }
          const open = bay * .62, spring = y + s.height * .6;
          put(p, y + (spring - y) / 2, [bay - open, spring - y, 2.4], t, color);
          if (s.column) put(p.clone().addScaledVector(n, 1.25), y + (s.height - 1.3) / 2, [.95, s.height - 1.3, .5], t, color);
          arch(p.clone().addScaledVector(t, (bay - open) / 2), next.clone().addScaledVector(t, -(bay - open) / 2), spring, 2.4, color);
          const top = y + s.height - 1.2, from = spring + open * .35;
          put(m.p, (from + top) / 2, [bay * 1.03, top - from, 2.2], m.t, color);
          put(p, spring + open * .2, [bay - open + .6, open * .4, 2.3], t, color);
          put(m.p.clone().addScaledVector(m.n, .35), y + s.height - .6, [bay * 1.05, 1.2, 3.1], m.t, color);
        }
        y += s.height;
      }
    } else if (part === 'cavea') {
      // Seats raked from the upper ring down to the podium round the arena, carried by radial walls.
      const {from, to, rows = 24} = e, lerp2 = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      if (e.seats !== false) for (let r = 0; r < rows; r++) {
        const f = (r + .5) / rows, radii = lerp2(from.radii, to.radii, f), y = from.height + (to.height - from.height) * f, depth = Math.hypot(from.radii[0] - to.radii[0], from.radii[1] - to.radii[1]) / Math.SQRT2 / rows;
        for (let i = 0; i < bays * 2; i++) {
          const th = (i + .5) * step / 2; if (!inArc(th)) continue;
          const {p, t} = ell(th, radii), len = p.distanceTo(ell(th + step / 2, radii).p);
          put(p, y - .45, [len * 1.05, .9, depth * 1.2], t, r % 6 === 5 ? '#c6b796' : color);
        }
      }
      if (e.walls !== false) for (let i = 0; i < bays; i++) {
        const th = i * step; if (!inArc(th)) continue;
        const a = ell(th, from.radii).p, b = ell(th, to.radii).p;
        const w = e.wallWidth ?? 1.2;
        k.beam('stone', world(a.x, from.height - 2, a.z), world(b.x, to.height - 1, b.z), w, k.tint(brick, .07), ph);
        const c = a.clone().lerp(b, .5); put(c, (from.height + to.height) / 4, [w * .85, (from.height + to.height) / 2, a.distanceTo(b) * .9], new T.Vector3(b.z - a.z, 0, a.x - b.x).normalize(), brick);
      }
      // Ring walls of the vaulted corridors under the seats (what a ruined cavea shows).
      for (const ring of e.rings ?? []) for (let i = 0; i < bays * 2; i++) {
        const th = (i + .5) * step / 2; if (!inArc(th)) continue;
        const {p, t} = ell(th, ring.radii), len = p.distanceTo(ell(th + step / 2, ring.radii).p);
        put(p, ring.height / 2, [len * 1.05, ring.height, ring.width ?? 2], t, brick);
      }
    } else if (part === 'arena') {
      // The podium wall round the arena, and the underground galleries (hypogeum) below its floor.
      const [a, b] = e.arena, podium = e.podium ?? 4;
      if (podium > 0) for (let i = 0; i < bays * 2; i++) { const th = (i + .5) * step / 2, {p, t} = ell(th, [a, b]), len = p.distanceTo(ell(th + step / 2, [a, b]).p); put(p, podium / 2, [len * 1.05, podium, 1.2], t, color); }
      if (e.hypogeum) for (let z = -b * .78; z <= b * .78 + .01; z += 3.4) { const half = a * Math.sqrt(Math.max(0, 1 - (z / b) ** 2)) * .88; put(new T.Vector3(0, 0, z), 1.1, [half * 2, 2.2, .7], new T.Vector3(1, 0, 0), brick); }
    }
  },

  // A sloping masonry buttress propping the end of a wall: courses shorten as they rise. `rot` turns it
  // so that it runs along `length` from the wall face (at its centre) outwards.
  buttress(k, e, P) {
    const {at:[x, z], rot=0, height, length, width=4, course=1.2, color='#a8724f'} = e, co = Math.cos(rot), si = Math.sin(rot);
    for (let y = 0; y < height - .05; y += course) {
      const l = length * (1 - y / height) + .8, c = l / 2;
      k.box('stone', [x + c * co, y + course / 2, z - c * si], [l, course * .94, width], rot, k.tint(color, .06), P(e.phase), y * 1e4);
    }
  },

  // Reusable facade with actual openings, stone surrounds and optional balconies.
  facade(k, e, P) {
    const {center:[cx,cz], length, floors=2, floorHeight=3.6, bays=5, rot=0, y0=0,
      thickness=.6, color='#c39e85', trim='#e1d0ae', phase}=e;
    const co=Math.cos(rot),si=Math.sin(rot), bay=length/bays, ww=e.windowWidth??bay*.45;
    const put=(x,y,z,w,h,d,kind='stone',hex=color)=>k.box(kind,[cx+x*co+z*si,y0+y,cz-x*si+z*co],[w,h,d],rot,k.tint(hex,.045),P(phase),(y0+y)*1e4+x);
    for(let f=0;f<floors;f++) for(let b=0;b<bays;b++) {
      const x=-length/2+(b+.5)*bay, base=f*floorHeight;
      const door=e.door&&f===0&&b===Math.floor(bays/2), sill=door?0:.85, wh=door?floorHeight-.5:floorHeight-1.45;
      const side=(bay-ww)/2;
      for(let row=0;row<Math.ceil(floorHeight/.3);row++){
        const y=base+(row+.5)*floorHeight/Math.ceil(floorHeight/.3),h=floorHeight/Math.ceil(floorHeight/.3)*.97;
        put(x-bay/2+side/2,y,0,side*.98,h,thickness);put(x+bay/2-side/2,y,0,side*.98,h,thickness);
        if(y<base+sill||y>base+sill+wh)put(x,y,0,ww,h,thickness);
      }
      put(x,base+sill+wh/2,-.04,ww*.96,wh,.08,door?'wood':'metal',door?'#614534':'#314856');
      for(const sign of [-1,1])put(x+sign*(ww/2+.07),base+sill+wh/2,.06,.14,wh+.24,thickness+.14,'stone',trim);
      for(const yy of [base+sill,base+sill+wh])put(x,yy,.08,ww+.32,.17,thickness+.22,'stone',trim);
      if(!door){put(x,base+sill+wh/2,.13,.06,wh,.07,'wood','#e7d7b6');put(x,base+sill+wh*.58,.13,ww,.06,.07,'wood','#e7d7b6');}
      if(e.balconies&&f===1){put(x,base+sill-.1,.55,ww+.5,.16,1,'stone',trim);for(let i=0;i<8;i++)put(x-ww/2+i*ww/7,base+sill+.43,1,.045,.85,.045,'metal','#353839');put(x,base+sill+.86,1,ww+.2,.05,.06,'metal','#353839');}
    }
    for(let f=0;f<=floors;f++)put(0,f*floorHeight,.08,length+.25,.18,thickness+.3,'stone',trim);
  },

  // Garden cut to a real outline: lawn in the middle, gravel border along the walls.
  lawn(k, e, P) {
    const {points, step = 1.6, grass = '#56703f', gravel = '#b8a98a', border = 2.4} = e;
    const xs = points.map(p => p[0]), zs = points.map(p => p[1]);
    const inside = (x, z) => { let c = false; for (let i = 0, j = points.length - 1; i < points.length; j = i++) { const [xi, zi] = points[i], [xj, zj] = points[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
    const edge = (x, z) => Math.min(...points.map((a, i) => { const b = points[(i + 1) % points.length], dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz))); return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz); }));
    for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) for (let z = Math.min(...zs) + step / 2; z < Math.max(...zs); z += step) {
      if (!inside(x, z)) continue;
      const near = edge(x, z) < border;
      k.box('tile', [x, near ? .05 : .09, z], [step * .97, near ? .1 : .18, step * .97], 0, k.tint(near ? gravel : grass, .1), P(e.phase), Math.hypot(x - xs[0], z - zs[0]));
    }
  },

  // Wrought-iron railing: posts, rails and bars along a line.
  fence(k, e, P) {
    const {points, height = 2.2, color = '#2d3033'} = e, V = (x, y, z) => new T.Vector3(x, y, z);
    for (let i = 0; i < points.length - 1; i++) {
      const [ax, az] = points[i], [bx, bz] = points[i + 1], len = Math.hypot(bx - ax, bz - az);
      for (const y of [.25, height - .15]) k.beam('metal', V(ax, y, az), V(bx, y, bz), .07, k.tint(color, .05), P(e.phase));
      for (let s = 0; s <= len; s += .32) {
        const f = s / len, x = ax + (bx - ax) * f, z = az + (bz - az) * f, post = Math.abs(s % 2.56) < .3;
        k.beam('metal', V(x, 0, z), V(x, post ? height + .25 : height, z), post ? .16 : .045, k.tint(color, .05), P(e.phase));
      }
    }
  },

  wing(k,e,P) {
    const {center:[cx,cz],size:[w,d],rot=0,floors=2,floorHeight=3.6,y0=0}=e;
    const co=Math.cos(rot),si=Math.sin(rot),world=(x,z)=>[cx+x*co+z*si,cz-x*si+z*co];
    for(const sign of [-1,1]){
      generators.facade(k,{...e,center:world(0,sign*d/2),length:w,rot:rot+(sign<0?Math.PI:0),bays:e.bays??Math.max(2,Math.round(w/3.4)),door:sign===1&&e.door},P);
      generators.facade(k,{...e,center:world(sign*w/2,0),length:d,rot:rot+sign*Math.PI/2,bays:e.sideBays??Math.max(1,Math.round(d/3.4)),door:false,balconies:false},P);
    }
    if(e.roof){const temp=kit(k.rand);generators.building(temp,{...e,height:floors*floorHeight,block:[1,.3],roof:{kind:'tile',color:'#985b44',height:2,tile:[.65,.5],...e.roof}},P);const roofPieces=temp.pieces.filter(p=>p.kind==='tile'||p.kind==='slate'||p.top>y0+floors*floorHeight+.3);if(e.roof.until)for(const piece of roofPieces)piece.until=P(e.roof.until);k.pieces.push(...roofPieces);}
  },

  wall(k, e, P) {
    const {points, closed = false, y0 = 0, height, thickness = 2.2, block = [2.4, 1], color = '#c9b28c', kind = 'stone'} = e;
    const bh = block[1], courses = Math.max(1, Math.round(height / bh));
    let dist = 0;
    for (let i = 0; i < points.length - (closed ? 0 : 1); i++) {
      const [ax, az] = points[i], [bx, bz] = points[(i + 1) % points.length];
      const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len, rot = Math.atan2(-uz, ux);
      for (let c = 0; c < courses; c++) {
        const y = y0 + c * bh + bh / 2;
        for (let s0 = -(c % 2) * block[0] / 2; s0 < len; s0 += block[0]) {
          const a = Math.max(0, s0), b = Math.min(len, s0 + block[0]);
          if (b - a < .35) continue;
          const mid = (a + b) / 2;
          k.box(kind, [ax + ux * mid, y, az + uz * mid], [(b - a) * .96, bh * .93, thickness], rot, k.tint(color), P(e.phase), y * 1e4 + dist + mid);
        }
      }
      if (e.crenel) {
        const {h = 1.5, w = 1.6, gap = 1.3} = e.crenel, y = y0 + courses * bh + h / 2;
        for (let s0 = gap / 2; s0 + w <= len; s0 += w + gap) k.box(kind, [ax + ux * (s0 + w / 2), y, az + uz * (s0 + w / 2)], [w * .96, h * .93, thickness], rot, k.tint(color), P(e.crenel.phase ?? e.phase), y * 1e4 + dist + s0, {crown: true});
      }
      dist += len;
    }
  },

  tower(k, e, P) {
    const {at: [x, z], radius: r, height, y0 = 0, block = [2.2, 1], thickness = 1.8, color = '#c9b28c', kind = 'stone'} = e;
    const n = Math.max(8, Math.round(2 * Math.PI * r / block[0])), bh = block[1], courses = Math.max(1, Math.round(height / bh));
    const chord = 2 * r * Math.sin(Math.PI / n);
    for (let c = 0; c < courses; c++) {
      const y = y0 + c * bh + bh / 2;
      for (let i = 0; i < n; i++) {
        const a = (i + (c % 2) * .5) / n * Math.PI * 2;
        k.box(kind, [x + r * Math.cos(a), y, z + r * Math.sin(a)], [chord * .97, bh * .93, thickness], -(a + Math.PI / 2), k.tint(color), P(e.phase), y * 1e4 + i, {tag: c === 0 && i === 0 ? e.tag : undefined});
      }
    }
    let top = y0 + courses * bh;
    if (e.crenel) {
      const h = e.crenel.h ?? 1.5;
      for (let i = 0; i < n; i += 2) {
        const a = i / n * Math.PI * 2;
        k.box(kind, [x + r * Math.cos(a), top + h / 2, z + r * Math.sin(a)], [chord * .97, h * .93, thickness], -(a + Math.PI / 2), k.tint(color), P(e.crenel.phase ?? e.phase), (top + h) * 1e4 + i, {crown: true});
      }
      top += h;
    }
    if (e.roof) generators.cone(k, {center: [x, top, z], radius: r * 1.2, height: r * 2.4, ...e.roof}, P);
  },

  cone(k, e, P) {
    const {center: [x, y, z], radius: R, height: H, color = '#3c4858', kind = 'slate', tile = [1.3, 1.1]} = e;
    const slant = Math.hypot(R, H), rows = Math.max(3, Math.round(slant / tile[1]));
    const sd = new T.Vector3(), t = new T.Vector3(), nrm = new T.Vector3();
    for (let r = 0; r < rows; r++) {
      const f = (r + .5) / rows, rr = Math.max(.15, R * (1 - f)), yy = y + H * f, n = Math.max(3, Math.round(2 * Math.PI * rr / tile[0]));
      for (let i = 0; i < n; i++) {
        const a = (i + (r % 2) * .5) / n * Math.PI * 2, ox = Math.cos(a), oz = Math.sin(a);
        sd.set(-ox * R, H, -oz * R).normalize(); t.set(-oz, 0, ox); nrm.crossVectors(sd, t);
        const pos = new T.Vector3(x + ox * rr, yy, z + oz * rr).addScaledVector(nrm, .15);
        k.oriented(kind, pos, t, nrm, sd, [2 * Math.PI * rr / n * 1.08, .22, slant / rows * 1.2], k.tint(color, .07), P(e.phase), yy * 1e4 + i);
      }
    }
  },

  // Rectangular building: walls, gables and a pitched roof (ridge along the length).
  building(k, e, P) {
    const {center: [cx, cz], size: [w, d], height, rot = 0, color = '#c9b28c', block = [1.8, .9], y0 = 0} = e;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const world = (lx, lz) => [cx + lx * cos + lz * sin, cz - lx * sin + lz * cos];
    generators.wall(k, {...e, points: [world(-w / 2, -d / 2), world(w / 2, -d / 2), world(w / 2, d / 2), world(-w / 2, d / 2)], closed: true, thickness: e.thickness ?? 1.2, block, crenel: undefined}, P);
    if (!e.roof) return;
    const rh = e.roof.height ?? w * .5, top = y0 + Math.round(height / block[1]) * block[1], roofColor = e.roof.color ?? '#3c4858', kind = e.roof.kind ?? 'slate';
    for (const side of [-1, 1]) for (let j = 0; j * block[1] < rh; j++) {
      const hw = w / 2 * (1 - j * block[1] / rh);
      for (let lx = -hw; lx < hw - .3; lx += block[0]) {
        const bw = Math.min(block[0], hw - lx), [x, z] = world(lx + bw / 2, side * d / 2);
        k.box('stone', [x, top + j * block[1] + block[1] / 2, z], [bw * .96, block[1] * .93, e.thickness ?? 1.2], rot, k.tint(color), P(e.phase), (top + j) * 1e4 + lx);
      }
    }
    const tile = e.roof.tile ?? [1.5, 1.2], eave = w / 2 * 1.12, slant = Math.hypot(eave, rh * 1.06), rows = Math.max(2, Math.round(slant / tile[1])), cols = Math.max(2, Math.round(d * 1.06 / tile[0]));
    for (const side of [-1, 1]) {
      const sd = new T.Vector3(-side * eave * cos, rh * 1.06, side * eave * sin).normalize();
      let t = new T.Vector3(sin, 0, cos), nrm = new T.Vector3().crossVectors(sd, t);
      if (nrm.y < 0) { t.negate(); nrm.crossVectors(sd, t); }
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const f = (r + .5) / rows, lx = side * eave * (1 - f), lz = -d * .53 + (c + .5) * d * 1.06 / cols, [x, z] = world(lx, lz);
        k.oriented(kind, new T.Vector3(x, top + rh * 1.06 * f, z).addScaledVector(nrm, .15), t, nrm, sd, [d * 1.06 / cols * 1.04, .22, slant / rows * 1.2], k.tint(roofColor, .07), P(e.roof.phase ?? e.phase), (top + rh * f) * 1e4 + c);
      }
    }
  },

  // Building mass fitted to an arbitrary measured footprint. It gives generated drafts a useful
  // present-day shell (masonry, openings and flat roof) before photograph-specific details are added.
  footprintBuilding(k, e, P) {
    const {points, height, floors = Math.max(1, Math.round(height / 3.6)), floorHeight = height / floors,
      thickness = 1, color = '#b9a58b', trim = '#ded0b9', y0 = 0} = e;
    generators.wall(k, {...e, points, closed: true, thickness, height, block: e.block ?? [1.8, .9]}, P);
    const center = points.reduce((sum, [x, z]) => [sum[0] + x / points.length, sum[1] + z / points.length], [0, 0]);
    const edges = points.map((a, i) => {
      const b = points[(i + 1) % points.length], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz), ux = dx / length, uz = dz / length;
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], n0 = [-uz, ux], sign = n0[0] * (mid[0] - center[0]) + n0[1] * (mid[1] - center[1]) >= 0 ? 1 : -1;
      return {a, length, ux, uz, nx: n0[0] * sign, nz: n0[1] * sign, rot: Math.atan2(-uz, ux)};
    }).filter(edge => edge.length > 1.8);
    const longest = Math.max(...edges.map(edge => edge.length));
    for (const edge of edges) {
      const bays = Math.max(1, Math.min(40, Math.round(edge.length / 3.4))), bay = edge.length / bays;
      for (let floor = 0; floor < floors; floor++) for (let i = 0; i < bays; i++) {
        const door = e.door !== false && edge.length === longest && floor === 0 && i === Math.floor(bays / 2);
        const w = Math.min(bay * (e.windowRatio ?? .48), door ? 1.8 : 1.55), h = door ? Math.max(2.2, floorHeight - .45) : Math.max(1.25, floorHeight * .5);
        const along = (i + .5) * bay, x = edge.a[0] + edge.ux * along + edge.nx * (thickness / 2 + .08), z = edge.a[1] + edge.uz * along + edge.nz * (thickness / 2 + .08), y = y0 + floor * floorHeight + (door ? h / 2 : floorHeight * .56);
        k.box(door ? 'wood' : 'metal', [x, y, z], [w, h, .12], edge.rot, k.tint(door ? '#5e4435' : '#304552', .04), P(e.phase), y * 1e4 + along);
        for (const side of [-1, 1]) k.box('stone', [x + edge.ux * side * (w / 2 + .08), y, z + edge.uz * side * (w / 2 + .08)], [.13, h + .25, .18], edge.rot, k.tint(trim, .03), P(e.phase), y * 1e4 + along + side);
        for (const dy of [-h / 2 - .08, h / 2 + .08]) k.box('stone', [x, y + dy, z], [w + .3, .14, .18], edge.rot, k.tint(trim, .03), P(e.phase), y * 1e4 + along + dy);
        if (door) {
          for (const side of [-1, 1]) for (const dy of [-.22, .22]) k.box('wood', [x + edge.ux * side * w * .24 + edge.nx * .08, y + dy * h, z + edge.uz * side * w * .24 + edge.nz * .08], [w * .38, h * .32, .09], edge.rot, k.tint('#765744', .025), P(e.phase), y * 1e4 + along + side + dy);
          k.box('metal', [x + edge.ux * w * .28 + edge.nx * .14, y, z + edge.uz * w * .28 + edge.nz * .14], [.06, .06, .08], edge.rot, k.tint('#c2a56d', .04), P(e.phase), y * 1e4 + along + 9);
        } else {
          k.box('metal', [x, y, z + 0], [.045, h * .9, .15], edge.rot, k.tint('#d6d0bd', .025), P(e.phase), y * 1e4 + along + 3);
          k.box('metal', [x, y + h * .06, z + 0], [w * .9, .045, .15], edge.rot, k.tint('#d6d0bd', .025), P(e.phase), y * 1e4 + along + 4);
        }
      }
      for (let floor = 1; floor <= floors; floor++) {
        const x = edge.a[0] + edge.ux * edge.length / 2 + edge.nx * (thickness / 2 + .1), z = edge.a[1] + edge.uz * edge.length / 2 + edge.nz * (thickness / 2 + .1);
        k.box('stone', [x, y0 + floor * floorHeight, z], [edge.length, .16, .18], edge.rot, k.tint(trim, .03), P(e.phase), (y0 + floor * floorHeight) * 1e4);
      }
      const x = edge.a[0] + edge.ux * edge.length / 2 + edge.nx * (thickness / 2 + .22), z = edge.a[1] + edge.uz * edge.length / 2 + edge.nz * (thickness / 2 + .22);
      k.box('stone', [x, y0 + height + .18, z], [edge.length + .25, .36, .5], edge.rot, k.tint(trim, .025), P(e.phase), (y0 + height) * 1e4 + edge.length);
    }
    if (!e.roof) return;
    const xs = points.map(point => point[0]), zs = points.map(point => point[1]), area = Math.max(1, (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs)));
    const step = Math.max(1.4, Math.sqrt(area / 3500)), inside = (x, z) => { let hit = false; for (let i = 0, j = points.length - 1; i < points.length; j = i++) { const [xi, zi] = points[i], [xj, zj] = points[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) hit = !hit; } return hit; };
    for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) for (let z = Math.min(...zs) + step / 2; z < Math.max(...zs); z += step) if (inside(x, z))
      k.box(e.roof.kind === 'flat' ? 'stone' : (e.roof.kind ?? 'slate'), [x, y0 + height + .18, z], [step * .98, .32, step * .98], 0, k.tint(e.roof.color ?? '#716d68', .04), P(e.roof.phase ?? e.phase), (y0 + height) * 1e4 + x + z);
    if (e.roof.kind === 'flat' && e.roof.parapet !== false) generators.wall(k, {...e, points, closed: true, y0: y0 + height + .34, height: .65, thickness: .42, block: [1.4, .65], color: trim, crenel: undefined, phase: e.roof.phase ?? e.phase}, P);
  },

  // Oval enclosure: continuous wall with towers at its vertices, and openings (`skip`, in degrees).
  enceinte(k, e, P) {
    const {center: [cx, cz], radii: [rx, rz], segments, wobble = 0, rotate = 0, skip = []} = e;
    const angle = i => i / segments * 360 + rotate;
    const open = deg => skip.some(([a, b]) => { const d = ((deg % 360) + 360) % 360; return a <= b ? d >= a && d <= b : d >= a || d <= b; });
    const pts = Array.from({length: segments}, (_, i) => {
      const a = angle(i) * Math.PI / 180, f = 1 + wobble * (Math.sin(3 * a + 1.3) * .6 + Math.cos(5 * a) * .4);
      return [cx + rx * f * Math.cos(a), cz + rz * f * Math.sin(a)];
    });
    // Segment j joins vertices j and j+1; it is kept unless its midpoint falls in an opening.
    const keep = j => !open(angle(j + .5)), runs = [];
    if (pts.every((_, j) => keep(j))) runs.push({points: pts, closed: true});
    else {
      let start = 0, current = null;
      while (keep((start - 1 + segments) % segments)) start++;
      for (let n = 0; n < segments; n++) {
        const j = (start + n) % segments;
        if (keep(j)) { current ??= [pts[j]]; current.push(pts[(j + 1) % segments]); }
        else if (current) { runs.push({points: current}); current = null; }
      }
      if (current) runs.push({points: current});
    }
    runs.forEach(run => generators.wall(k, {...e.wall, ...run, phase: e.phase}, P));
    if (e.towers) pts.forEach((p, i) => { if (i % (e.towers.every ?? 1) === 0 && !open(angle(i))) generators.tower(k, {...e.towers, at: p, phase: e.phase}, P); });
  },

  // Houses packed in an oval, avoiding areas already built.
  village(k, e, P) {
    const {center: [cx, cz], radii: [rx, rz], count, avoid = [], gap = 11} = e, placed = [];
    for (let tries = 0; placed.length < count && tries < count * 60; tries++) {
      const a = k.rand() * Math.PI * 2, r = Math.sqrt(k.rand()), x = cx + Math.cos(a) * rx * r, z = cz + Math.sin(a) * rz * r;
      if (avoid.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar) || placed.some(([px, pz]) => Math.hypot(x - px, z - pz) < gap)) continue;
      placed.push([x, z]);
      const w = e.width[0] + k.rand() * (e.width[1] - e.width[0]), d = e.depth[0] + k.rand() * (e.depth[1] - e.depth[0]), h = e.height[0] + k.rand() * (e.height[1] - e.height[0]);
      generators.building(k, {center: [x, z], size: [w, d], height: h, rot: Math.round(k.rand() * 4) * Math.PI / 2 + (k.rand() - .5) * .3, color: e.color, block: [1.6, .9], thickness: 1, phase: e.phase, roof: {height: w * .42, color: e.roof, kind: 'tile', tile: [1.3, 1.1]}}, P);
    }
  },

  // Solid block mass (foundations).
  slab(k, e, P) {
    const {center: [cx, cz], size: [w, h, d], y0 = 0, block = [3, 1.4, 3], color = '#a99c86'} = e;
    for (let y = 0; y < h; y += block[1]) for (let x = -w / 2; x < w / 2 - .2; x += block[0]) for (let z = -d / 2; z < d / 2 - .2; z += block[2])
      k.box('stone', [cx + x + block[0] / 2, y0 + y + block[1] / 2, cz + z + block[2] / 2], [block[0] * .95, block[1] * .93, block[2] * .95], 0, k.tint(color), P(e.phase), (y0 + y) * 1e4 + x + z);
  },

  // Timber scaffold: posts, ledgers and cross braces. It is removed at phase `until`.
  scaffold(k, e, P) {
    const {at: [x, z], size = 6, height, color = '#8a6a45'} = e, step = 3, h2 = size / 2, extra = {until: e.until && P(e.until)};
    const c = [[-h2, -h2], [h2, -h2], [h2, h2], [-h2, h2]].map(([a, b]) => [x + a, z + b]);
    for (let y = 0; y < height; y += step) {
      const y2 = Math.min(height, y + step);
      c.forEach(([a, b], i) => {
        const [na, nb] = c[(i + 1) % 4];
        k.beam('wood', new T.Vector3(a, y, b), new T.Vector3(a, y2, b), .35, k.tint(color), P(e.phase), extra);
        k.beam('wood', new T.Vector3(a, y2, b), new T.Vector3(na, y2, nb), .22, k.tint(color), P(e.phase), extra);
        if (i % 2 === 0) k.beam('wood', new T.Vector3(a, y, b), new T.Vector3(na, y2, nb), .16, k.tint(color), P(e.phase), extra);
      });
    }
  },

  // Suspension bridge: piers and anchorages, two towers (one after the other), cables spun from shore
  // to shore, then hangers and deck hung from the towers outwards.
  suspension(k, e, P) {
    const {span, side, tower: top, deck: dy, width: w, color = '#c0392b', step = 15.24, phases: ph} = e;
    const half = span / 2, end = half + side, zc = w / 2 + 3, low = dy + 5, saddle = top - 2, anchorY = e.anchorHeight ?? 28;
    const V = (x, y, z) => new T.Vector3(x, y, z), tint = () => k.tint(color, .05);
    for (const s of [1, -1]) {
      generators.slab(k, {center: [s * half, 0], size: [34, 10, 52], y0: -4, block: [4, 2, 4], color: '#8f8a80', phase: ph.fondations}, P);
      generators.slab(k, {center: [s * end, 0], size: [44, anchorY, 64], block: [4, 3, 4], color: '#9a958b', phase: ph.fondations}, P);
    }
    // The two towers, one after the other (`order` offset for the second).
    [1, -1].forEach((s, n) => {
      const x = s * half, offset = n * 1e9;
      for (const zs of [1, -1]) for (let y = 6; y < top; y += 6) {
        const f = y / top;
        k.box('metal', [x, y + 3, zs * zc], [11 - 4 * f, 5.8, 16 - 7 * f], 0, tint(), P(ph.tours), offset + y * 1e4 + zs);
      }
      for (const h of e.portals) k.box('metal', [x, h, 0], [7, 8, 2 * zc - 8], 0, tint(), P(ph.tours), offset + h * 1e4 + 5);
      for (const [y1, y2] of e.braces) {
        k.beam('metal', V(x, y1, -zc), V(x, y2, zc), 2.2, tint(), P(ph.tours), {order: offset + y1 * 1e4 + 6});
        k.beam('metal', V(x, y1, zc), V(x, y2, -zc), 2.2, tint(), P(ph.tours), {order: offset + y1 * 1e4 + 7});
      }
    });
    // Cable profile: parabola in the main span, slight sag towards the anchorages.
    const cable = x => {
      const ax = Math.abs(x);
      if (ax <= half) return low + (saddle - low) * (ax / half) ** 2;
      const t = Math.min(1, (ax - half) / side);
      return saddle + (anchorY - saddle) * t - 15 * 4 * t * (1 - t);
    };
    for (const zs of [1, -1]) for (let x = -end; x < end; x += 8) {
      const x2 = Math.min(end, x + 8);
      k.beam('metal', V(x, cable(x), zs * zc), V(x2, cable(x2), zs * zc), 1.4, tint(), P(ph.cables), {order: x});
    }
    // Truss deck, built symmetrically out from the towers.
    const fromTower = x => Math.abs(Math.abs(x) - half);
    for (let x = -end + step / 2; x < end - 10; x += step) {
      if (fromTower(x) < 8) continue;
      for (const zs of [1, -1]) k.beam('metal', V(x, dy + 1.5, zs * zc), V(x, cable(x) - .7, zs * zc), .35, tint(), P(ph.tablier), {order: fromTower(x) * 10});
    }
    const panel = step / 2, depth = 7.6;
    for (let x = -end; x < end - .1; x += panel) {
      const x2 = x + panel, order = fromTower(x + panel / 2) * 10 + 1;
      for (const zs of [1, -1]) {
        const z = zs * w / 2;
        k.beam('metal', V(x, dy, z), V(x2, dy, z), .8, tint(), P(ph.tablier), {order});
        k.beam('metal', V(x, dy - depth, z), V(x2, dy - depth, z), .8, tint(), P(ph.tablier), {order});
        k.beam('metal', V(x, dy - depth, z), V(x, dy, z), .5, tint(), P(ph.tablier), {order});
        k.beam('metal', V(x, dy - depth, z), V(x2, dy, z), .4, tint(), P(ph.tablier), {order});
      }
      k.beam('metal', V(x, dy, -w / 2), V(x, dy, w / 2), .6, tint(), P(ph.tablier), {order});
      k.box('stone', [x + panel / 2, dy + .5, 0], [panel * .98, .5, w - 1], 0, k.tint('#4f535a', .04), P(ph.tablier), order);
    }
  },

  // Four-legged wrought-iron lattice tower (Eiffel type).
  lattice(k, e, P) {
    const W = h => lerp(e.profile, h), L = h => lerp(e.legWidth, h), color = e.color ?? '#7b5a3c', step = e.ring ?? 4;
    const phaseAt = y => P((e.bands.find(b => y < b.to) ?? e.bands.at(-1)).phase);
    const V = (x, y, z) => new T.Vector3(x, y, z);
    const beam = (a, b, t) => k.beam('metal', a, b, t, k.tint(color, .06), phaseAt(Math.min(a.y, b.y)));
    const panel = (A, B) => {
      for (let q = 0; q < 4; q++) {
        const a0 = A[q], a1 = A[(q + 1) % 4], b0 = B[q], b1 = B[(q + 1) % 4];
        beam(a0, b0, 1.15);
        beam(b0, b1, .6);
        beam(a0, b1, .32); beam(a1, b0, .32);
        const ma = a0.clone().lerp(a1, .5), mb = b0.clone().lerp(b1, .5);
        beam(ma, mb, .26); beam(a0, mb, .2); beam(ma, b1, .2);
      }
    };
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
      const ring = h => { const o = W(h), i = Math.max(0, o - L(h)); return [[o, o], [o, i], [i, i], [i, o]].map(([a, b]) => V(sx * a, h, sz * b)); };
      for (let h = 0; h < e.merge; h += step) panel(ring(h), ring(Math.min(e.merge, h + step)));
    }
    const ring = h => [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => V(a * W(h), h, b * W(h)));
    for (let h = e.merge; h < e.shaft; h += step) panel(ring(h), ring(Math.min(e.shaft, h + step)));
    for (let h = e.shaft; h < e.height - 4; h += 3) panel(ring(h), ring(h + 3));
    // Decorative arches between the legs: in the sloping plane of each face, or in a vertical plane at
    // arch.at metres from the axis (hung under the first floor's edge girders).
    for (const [axis, sign] of [['x', 1], ['x', -1], ['z', 1], ['z', -1]]) {
      const pts = [];
      for (let i = 0; i <= 28; i++) {
        const t = i / 28 * Math.PI, y = e.arch.base + e.arch.rise * Math.sin(t), u = e.arch.span * Math.cos(t), f = sign * (e.arch.at ?? W(y) - .8);
        pts.push(axis === 'z' ? V(u, y, f) : V(f, y, u));
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1], up = V(0, e.arch.depth, 0);
        beam(a, b, .7); beam(a.clone().add(up), b.clone().add(up), .5); beam(a, b.clone().add(up), .22);
      }
    }
    for (const deck of e.decks) {
      const h = deck.y, edge = W(h), half = edge + deck.overhang, ph = phaseAt(h), c = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => V(a * half, h, b * half));
      for (let q = 0; q < 4; q++) {
        const a = c[q], b = c[(q + 1) % 4], n = Math.max(2, Math.round(a.distanceTo(b) / 4));
        beam(a, b, 1); beam(a.clone().setY(h + deck.gallery), b.clone().setY(h + deck.gallery), .6);
        for (let i = 0; i <= n; i++) { const p = a.clone().lerp(b, i / n); beam(p, p.clone().setY(h + deck.gallery), .35); }
      }
      // One side of the floor: u runs along it, d is the distance from the axis.
      const side = (axis, sign, kind, u, d, y, [len, height, thick], color, phase = ph) => k.box(kind, axis === 'x' ? [sign * d, y, u] : [u, y, sign * d], axis === 'x' ? [thick, height, len] : [len, height, thick], 0, color, phase);
      for (const [axis, sign] of [['x', 1], ['x', -1], ['z', 1], ['z', -1]]) {
        // The balcony floor, outside the edge girder.
        if (deck.overhang > .4) side(axis, sign, 'metal', 0, edge + deck.overhang / 2, h - .2, [2 * half, .4, deck.overhang], k.tint(color, .04));
        // frieze: the continuous girder below the floor, its consoles under the balcony and, between them,
        // the inscriptions (names: how many per side, in gold letters).
        if (deck.frieze) {
          const bays = deck.names ?? Math.max(2, Math.round(2 * edge / 4)), step = 2 * edge / bays;
          side(axis, sign, 'metal', 0, edge, h - deck.frieze / 2, [2 * edge, deck.frieze, .6], k.tint(color, .05));
          side(axis, sign, 'metal', 0, edge + .2, h - deck.frieze + .3, [2 * edge, .6, .7], k.tint(color, .05));
          for (let i = 0; i <= bays; i++) side(axis, sign, 'metal', -edge + i * step, edge + deck.overhang / 2, h - 1.1, [.6, 1.8, deck.overhang], k.tint(color, .05));
          if (deck.names) for (let i = 0; i < bays; i++) side(axis, sign, 'metal', -edge + (i + .5) * step, edge + .35, h - deck.frieze / 2, [step * .62, .6, .1], k.tint(deck.letters ?? '#c9a24a', .05));
        }
        // pavilions: glazed buildings along each side, between the legs, built in their own phase.
        if (deck.pavilions) {
          const pv = deck.pavilions, room = edge - L(h) - (pv.gap ?? 1), out = edge - (pv.setback ?? 1.5), inner = out - pv.depth, built = pv.phase ? P(pv.phase) : ph;
          if (room > 2) {
            side(axis, sign, 'glass', 0, (out + inner) / 2, h + pv.height / 2, [2 * room, pv.height, pv.depth], k.tint(pv.glass ?? '#53626c', .05), built);
            side(axis, sign, 'metal', 0, (out + inner) / 2, h + pv.height + .25, [2 * room + .6, .5, pv.depth + .6], k.tint(pv.roof ?? color, .05), built);
            for (let u = -room; u <= room + .01; u += pv.mullion ?? 3) side(axis, sign, 'metal', u, out + .1, h + pv.height / 2, [.18, pv.height, .2], k.tint(color, .04), built);
          }
        }
      }
    }
    const top = e.height;
    beam(V(0, e.height - 6, 0), V(0, top + e.flag.pole, 0), .45);
    e.flag.colors.forEach((c, i) => k.box('cloth', [1.2 + i * 1.6 + .8, top + e.flag.pole - 1.4, 0], [1.6, 2.6, .1], 0, new T.Color(c), P(e.flag.phase), top + 99));
  },
};

// ——— Scene ———
// Builds every piece of a monument (with its phase, removal and lean) without any scene, so that scripts
// can measure the model too: scripts/plan.mjs compares its footprint with the measured outline.
export function buildPieces(data) {
  const index = Object.fromEntries(data.phases.map((p, i) => [p.id, i]));
  const P = id => { if (!(id in index)) throw new Error(`Unknown phase: ${id}`); return index[id]; };
  const k = kit(random(data.seed ?? 7));
  for (const element of data.elements) {
    const before = k.pieces.length;
    if(!generators[element.type])throw new Error(`Unknown brick: ${element.type}. Add a generator before loading this monument.`);
    generators[element.type](k, element, P);
    if(element.type === "timberFrame")for(const piece of k.pieces.slice(before))piece.structural=true;
    if(element.until)for(const piece of k.pieces.slice(before))piece.until=P(element.until);
    if(element.lean)for(const piece of k.pieces.slice(before))piece.lean=1;
    if (element.ruin) {
      const fresh = k.pieces.slice(before), cut = (element.y0 ?? 0) + (element.height ?? 0) * (1 - (element.ruin.depth ?? .3));
      for (const piece of fresh) if (piece.phase < P(element.ruin.phase) && (piece.crown || piece.top > cut) && k.rand() < element.ruin.share) {
        piece.until = P(element.ruin.phase);
        if (element.ruin.restore) k.pieces.push({...piece, matrix: piece.matrix.clone(), phase: P(element.ruin.restore), until: undefined});
      }
    }
  }
  if (data.rotate) { const turn = new T.Matrix4().makeRotationY(data.rotate * Math.PI / 180); for (const piece of k.pieces) piece.matrix.premultiply(turn); }
  return {pieces: k.pieces, P, index};
}

export function createStage(host) {
  const renderer = new T.WebGLRenderer({antialias: true, powerPreference: 'high-performance'});
  renderer.setPixelRatio(PIXEL_RATIO);
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  host.prepend(renderer.domElement);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(38, 1, 1, 8000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.maxPolarAngle = Math.PI * .49; controls.autoRotateSpeed = .35;
  // Until the user moves the camera, every resize reframes the monument.
  let moved = false;
  controls.addEventListener('start', () => { moved = true; });
  const composer = new EffectComposer(renderer, new T.WebGLRenderTarget(1, 1, {type: T.HalfFloatType, samples: 4}));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new T.Vector2(1, 1), .55, .5, .82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const uniforms = {uTime: {value: 0}, uFly: {value: FLY}, uDrop: {value: 30}, uNight: {value: 0}, uSparkle: {value: 0}, uClock: {value: 0}, uHeight: {value: 100}, uNightColor: {value: new T.Color('#ff9a2e')},
    // One leaning group per monument (a tower sinking on soft ground): pivot, axis and angle over time.
    uLeanPivot: {value: new T.Vector3()}, uLeanAxis: {value: new T.Vector3(1, 0, 0)}, uLeanAngle: {value: 0}};
  // Sky, distant ground and fog share one horizon colour: no visible seam.
  const DUSK = new T.Color().setRGB(.15, .105, .13), NIGHT = new T.Color().setRGB(.03, .042, .085);
  const horizon = {value: DUSK.clone()}, zenith = {value: new T.Color('#1b213d')}, sunGlow = {value: new T.Color('#9d4e24')};
  let dayHorizon = DUSK.clone(), fogFactor = .4;

  // Sky: dusk gradient, darker at night.
  const sky = new T.Mesh(new T.SphereGeometry(4000, 32, 16), new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false, uniforms: {uNight: uniforms.uNight, uHorizon: horizon, uZenith: zenith, uSunGlow: sunGlow},
    vertexShader: 'varying vec3 vDir;void main(){vDir=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `uniform float uNight;uniform vec3 uHorizon,uZenith,uSunGlow;varying vec3 vDir;void main(){
      float h=max(vDir.y,0.);vec3 zen=mix(uZenith,vec3(.004,.006,.016),uNight);
      vec3 c=mix(uHorizon,zen,smoothstep(0.,.55,h));
      c+=uSunGlow*pow(max(dot(vDir,normalize(vec3(-.6,.12,.5))),0.),18.)*(1.-uNight);
      gl_FragColor=vec4(c,1.);}`,
  }));
  scene.add(sky);
  scene.fog = new T.FogExp2(DUSK.clone(), .0011);

  // Sol : mosaïque de losanges, comme un plan qui devient monument.
  const groundGeometry = new T.PlaneGeometry(1, 1); groundGeometry.setAttribute('uv1', groundGeometry.attributes.uv);
  const planGroundMaterial = new T.ShaderMaterial({
    uniforms: {uStep: {value: 4}, uRadius: {value: 600}, uNight: uniforms.uNight, uHorizon: horizon, uWater: {value: 0}},
    vertexShader: 'varying vec2 vXZ;void main(){vec4 w=modelMatrix*vec4(position,1.);vXZ=w.xz;gl_Position=projectionMatrix*viewMatrix*w;}',
    fragmentShader: `uniform float uStep,uRadius,uNight,uWater;uniform vec3 uHorizon;varying vec2 vXZ;
      void main(){vec2 g=vXZ/uStep,cell=floor(g)+.5,f=g-cell;float d=abs(f.x)+abs(f.y),aa=fwidth(d)+.002;
      float shape=mix(1.-smoothstep(.22-aa,.22+aa,d),.1,clamp(fwidth(g.x)*2.5-.8,0.,1.));
      float r=length(vXZ),fall=max(0.,1.-r/uRadius);vec3 base=mix(vec3(.03,.026,.034),vec3(.008,.011,.022),uNight);
      vec3 dot=mix(vec3(.5,.38,.26),vec3(.2,.3,.6),uNight)*.3;
      base=mix(base,vec3(.012,.026,.05),uWater);dot=mix(dot,vec3(.16,.32,.52)*.32,uWater);
      vec3 c=base+dot*shape*fall*fall;
      gl_FragColor=vec4(mix(c,uHorizon,smoothstep(uRadius*.5,uRadius*2.4,r)),1.);}`,
  });
  const ground = new T.Mesh(groundGeometry, planGroundMaterial);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const hemi = new T.HemisphereLight('#9fb4e0', '#3a2a1c', .7);
  const sun = new T.DirectionalLight('#ffcf9a', 3.1);
  const rim = new T.DirectionalLight('#5c7cff', .9);
  const ambient = new T.AmbientLight('#dbe6ef', 0);
  scene.add(hemi, sun, rim, ambient);
  // Low golden sun by default; view.light = "day" gives a higher, neutral daylight for buildings whose
  // whiteness is a feature (plaster, marble) and that golden light would turn beige.
  const LIGHTS = {
    golden: {sun: '#ffcf9a', sunI: 3.1, sky: '#9fb4e0', hemiI: .7, dir: [-1.2, .55, .9]},
    day: {sun: '#fff4e8', sunI: 2.5, sky: '#c4d6f6', hemiI: 1.15, dir: [.5, 1.1, 1], rimI: .3},
    'cool-day': {sun: '#fff5e8', sunI: 3.05, sky: '#c4d9ee', hemiI: 1.72, dir: [-.65, 1.15, .7], rimI: .22},
    'clear-day': {sun: '#fff0d2', sunI: 3.2, sky: '#c3dcf1', hemiI: 1.58, dir: [-.9, 1.05, .55], rimI: .28},
    'warm-day': {sun: '#ffe0b8', sunI: 3.35, sky: '#c8dced', hemiI: 1.62, dir: [-1.1, .92, .6], rimI: .42},
  };
  let light = LIGHTS.golden;
  let visual = resolveVisualStyle({quality: 'basic'}), realisticGroundMaterial = null, environmentGroup = null, environmentTimed = [], baseBloom = .5, ambientBase = 0;

  const meshes = [];
  // Human-scale construction tableaux, described and sourced per phase. They are deliberately kept
  // outside buildPieces(): workers, dust and temporary tools must not alter plan or height checks.
  const siteGroups = [], siteActors = [], siteDust = [], siteRigs = [];
  const siteBox = new T.BoxGeometry(1, 1, 1), siteCylinder = new T.CylinderGeometry(1, 1, 1, 8), siteHead = new T.SphereGeometry(1, 12, 8);
  const siteMaterials = new Map();
  const siteMaterial = (color, kind = 'matte') => {
    const key = `${color}:${kind}`;
    if (!siteMaterials.has(key)) siteMaterials.set(key, new T.MeshStandardMaterial({color, emissive: color, emissiveIntensity: .07, roughness: kind === 'metal' ? .42 : .9, metalness: kind === 'metal' ? .55 : 0}));
    return siteMaterials.get(key);
  };
  const siteMesh = (group, geometry, material, position, scale) => {
    const mesh = new T.Mesh(geometry, material); mesh.position.set(...position); mesh.scale.set(...scale); group.add(mesh); return mesh;
  };
  const siteBeam = (group, a, b, radius, material) => {
    const A = new T.Vector3(...a), B = new T.Vector3(...b), direction = B.clone().sub(A), mesh = siteMesh(group, siteCylinder, material, A.add(B).multiplyScalar(.5).toArray(), [radius, direction.length(), radius]);
    mesh.quaternion.setFromUnitVectors(UP, direction.normalize()); return mesh;
  };

  function makeWorker(parent, x, z, turn, palette, role, offset) {
    const actor = new T.Group(); actor.position.set(x, 0, z); actor.rotation.y = turn; parent.add(actor);
    const cloth = siteMaterial(palette[Math.floor(offset) % palette.length]), skin = siteMaterial('#9a6949'), dark = siteMaterial('#3c342d'), stone = siteMaterial('#a89a83');
    siteMesh(actor, siteCylinder, cloth, [0, 1.14, 0], [.19, .58, .19]);
    siteMesh(actor, siteHead, skin, [0, 1.59, 0], [.14, .16, .14]);
    siteMesh(actor, siteBox, dark, [0, 1.72, 0], [.22, .07, .2]);
    siteBeam(actor, [-.1, .84, 0], [-.11, .1, .02], .065, dark);
    siteBeam(actor, [.1, .84, 0], [.13, .1, -.02], .065, dark);
    const arms = [];
    for (const side of [-1, 1]) {
      const pivot = new T.Group(); pivot.position.set(side * .2, 1.38, 0); actor.add(pivot);
      siteMesh(pivot, siteCylinder, skin, [0, -.24, 0], [.055, .48, .055]);
      pivot.rotation.z = side * (role === 'lift' ? 2.45 : role === 'carry' ? 1.3 : .45); arms.push(pivot);
    }
    if (role === 'carry') siteMesh(actor, siteBox, stone, [0, 1.03, .28], [.5, .2, .28]);
    if (role === 'mason') { actor.scale.y = .82; siteMesh(actor, siteBox, stone, [0, .35, .45], [.32, .2, .34]); }
    actor.userData = {baseY: 0, baseTurn: turn, offset, arms, role}; siteActors.push(actor);
  }

  function makeWorksite(spec, phase, seed) {
    const group = new T.Group(), rand = random(seed), [cx, cz] = spec.at ?? [0, 0], radius = Math.max(4, spec.radius ?? 14), height = Math.max(3, spec.height ?? 9);
    const site = {group, phase, spec, scaffoldParts: [], progress: 0};
    group.position.set(cx, 0, cz); group.visible = false; scene.add(group); siteGroups.push(site);
    const fill = new T.PointLight('#ffd3a0', 24, radius * 3.5, 1.7); fill.position.set(0, Math.min(height, 12) * .75, 0); group.add(fill);
    const wood = siteMaterial(spec.wood ?? '#765236'), stone = siteMaterial(spec.materialColor ?? (spec.craft === 'metal' ? '#58616a' : '#a79579'), spec.craft === 'metal' ? 'metal' : 'matte');
    const rope = siteMaterial('#80684d'), palette = spec.clothes ?? ['#9a5b38', '#5c6f7b', '#7c6943', '#6d4c45'];

    if (spec.materials !== false) {
      if (spec.craft === 'timber' || spec.craft === 'metal') for (let i = 0; i < 9; i++) {
        const z = radius * .54 + (i % 3) * .24, y = .11 + Math.floor(i / 3) * .19;
        siteBeam(group, [-radius * .64, y, z], [-radius * .05, y, z + (rand() - .5) * .12], spec.craft === 'metal' ? .065 : .1, stone);
      } else for (let i = 0; i < 18; i++) {
        const row = Math.floor(i / 6), col = i % 6;
        siteMesh(group, siteBox, stone, [-radius * .62 + col * .55, .16 + row * .3, radius * .48 + (row % 2) * .16], [.48 + rand() * .06, .28, .36 + rand() * .08]);
      }
    }

    if (spec.scaffold) {
      const cfg = typeof spec.scaffold === 'object' ? spec.scaffold : {kind: 'facade'}, kind = cfg.kind ?? 'facade';
      const scaffold = new T.Group(), [ox, oz] = cfg.offset ?? [0, kind === 'facade' ? -radius * .32 : 0];
      scaffold.position.set(ox, 0, oz); scaffold.rotation.y = cfg.rot ?? 0; group.add(scaffold);
      const levelHeight = cfg.levelHeight ?? 2.3, levels = Math.max(2, Math.ceil((cfg.height ?? height) / levelHeight));
      const add = (mesh, level) => { mesh.userData.siteReveal = .04 + .88 * level / levels; site.scaffoldParts.push(mesh); return mesh; };
      const beam = (a, b, r, level) => add(siteBeam(scaffold, a, b, r, wood), level);
      const plank = (position, scale, turn, level) => { const mesh = add(siteMesh(scaffold, siteBox, wood, position, scale), level); mesh.rotation.y = turn; return mesh; };

      if (kind === 'ring') {
        const inner = Math.max(.8, cfg.radius ?? radius * .52), depth = cfg.depth ?? 1.55, outer = inner + depth;
        const segments = Math.max(8, Math.round(cfg.segments ?? Math.PI * 2 * outer / 2.4));
        const arc = (cfg.arc ?? 360) * Math.PI / 180, start = (cfg.start ?? -90) * Math.PI / 180;
        const closed = Math.abs(arc - Math.PI * 2) < .001, bays = closed ? segments : Math.max(1, segments - 1), point = (r, a, y) => [Math.cos(a) * r, y, Math.sin(a) * r];
        for (let level = 1; level <= levels; level++) {
          const y0 = (level - 1) * levelHeight, y1 = level * levelHeight;
          for (let i = 0; i < segments; i++) {
            const a = start + arc * i / (closed ? segments : segments - 1);
            for (const r of [inner, outer]) beam(point(r, a, y0), point(r, a, y1), .06, level);
          }
          for (let i = 0; i < bays; i++) {
            const a = start + arc * i / (closed ? segments : segments - 1), b = start + arc * (i + 1) / (closed ? segments : segments - 1), mid = (a + b) / 2;
            for (const r of [inner, outer]) beam(point(r, a, y1), point(r, b, y1), .05, level);
            beam(point(inner, a, y1), point(outer, a, y1), .045, level);
            beam(point(outer, a, level % 2 ? y0 : y1), point(outer, b, level % 2 ? y1 : y0), .035, level);
            plank(point((inner + outer) / 2, mid, y1 + .05), [Math.max(.4, 2 * outer * Math.sin(Math.abs(b - a) / 2) * .9), .08, depth * .78], Math.PI / 2 - mid, level);
          }
        }
      } else if (kind === 'tower') {
        const width = cfg.width ?? radius * .8, depth = cfg.depth ?? width, corners = [[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2]];
        for (let level = 1; level <= levels; level++) {
          const y0 = (level - 1) * levelHeight, y1 = level * levelHeight;
          for (const [x, z] of corners) beam([x, y0, z], [x, y1, z], .065, level);
          for (let i = 0; i < 4; i++) {
            const a = corners[i], b = corners[(i + 1) % 4];
            beam([a[0], y1, a[1]], [b[0], y1, b[1]], .055, level);
            beam([a[0], level % 2 ? y0 : y1, a[1]], [b[0], level % 2 ? y1 : y0, b[1]], .038, level);
          }
          for (let x = -width / 2 + .6; x < width / 2; x += 1.2) plank([x, y1 + .05, 0], [1.05, .08, depth * .86], 0, level);
        }
      } else {
        const width = cfg.width ?? radius * 1.45, depth = cfg.depth ?? 1.55, bays = Math.max(1, Math.ceil(width / 2.4)), step = width / bays, z = 0;
        for (let level = 1; level <= levels; level++) {
          const y0 = (level - 1) * levelHeight, y1 = level * levelHeight;
          for (let i = 0; i <= bays; i++) for (const d of [0, depth]) beam([-width / 2 + i * step, y0, z + d], [-width / 2 + i * step, y1, z + d], .065, level);
          for (let i = 0; i < bays; i++) {
            const x0 = -width / 2 + i * step, x1 = x0 + step;
            for (const d of [0, depth]) beam([x0, y1, z + d], [x1, y1, z + d], .055, level);
            beam([x0, level % 2 ? y0 : y1, z], [x1, level % 2 ? y1 : y0, z], .04, level);
            plank([(x0 + x1) / 2, y1 + .05, z + depth / 2], [step * .92, .09, depth * .86], 0, level);
          }
        }
      }
    }

    if (spec.hoist) {
      const cfg = typeof spec.hoist === 'object' ? spec.hoist : {kind: 'gin-pole'}, kind = cfg.kind ?? 'gin-pole', [hx, hz] = cfg.offset ?? [radius * .35, -radius * .08];
      const rig = new T.Group(); rig.position.set(hx, 0, hz); group.add(rig);
      const rigWood = kind === 'steam-crane' ? siteMaterial('#59636a', 'metal') : wood, hh = cfg.height ?? Math.min(kind === 'steam-crane' ? 11 : 18, height + 3);
      let load, boom, wheel;
      if (kind === 'treadwheel') {
        siteBeam(rig, [-1.3, 0, 0], [-1.3, hh, 0], .13, rigWood); siteBeam(rig, [1.3, 0, 0], [1.3, hh, 0], .13, rigWood);
        wheel = new T.Group(); wheel.position.set(0, hh * .43, 0); rig.add(wheel);
        const wr = Math.min(2.25, hh * .24), spokes = 12;
        for (let i = 0; i < spokes; i++) {
          const a = i / spokes * Math.PI * 2, b = (i + 1) / spokes * Math.PI * 2;
          siteBeam(wheel, [Math.cos(a) * wr, Math.sin(a) * wr, 0], [Math.cos(b) * wr, Math.sin(b) * wr, 0], .085, rigWood);
          if (i % 2 === 0) siteBeam(wheel, [0, 0, 0], [Math.cos(a) * wr, Math.sin(a) * wr, 0], .055, rigWood);
        }
        boom = new T.Group(); rig.add(boom); siteBeam(boom, [0, hh * .7, 0], [4.4, hh, 0], .14, rigWood); siteBeam(boom, [0, hh * .7, 0], [4.4, hh, 0], .045, rope);
        siteBeam(rig, [4.4, hh, 0], [4.4, 2.2, 0], .025, rope); load = siteMesh(rig, siteBox, stone, [4.4, 1.9, 0], [.75, .45, .65]);
      } else if (kind === 'steam-crane') {
        siteMesh(rig, siteBox, rigWood, [0, .35, 0], [3.4, .7, 2.3]); siteBeam(rig, [0, .7, 0], [0, hh, 0], .18, rigWood);
        boom = new T.Group(); rig.add(boom); siteBeam(boom, [0, hh * .78, 0], [6.4, hh + 2.5, 0], .16, rigWood); siteBeam(boom, [0, hh * .78, 0], [-2.4, hh + .5, 0], .13, rigWood);
        siteMesh(rig, siteBox, stone, [-2.5, hh + .45, 0], [1.2, .8, 1.1]); siteBeam(rig, [6.4, hh + 2.5, 0], [6.4, 2.5, 0], .025, rope);
        load = siteMesh(rig, siteBox, stone, [6.4, 2.2, 0], [.85, .45, .7]);
      } else {
        siteBeam(rig, [-2.2, 0, 0], [0, hh, 0], .14, rigWood); siteBeam(rig, [2.2, 0, 0], [0, hh, 0], .14, rigWood);
        boom = new T.Group(); rig.add(boom); siteBeam(boom, [-3.4, hh, 0], [3.4, hh, 0], .12, rigWood); siteBeam(rig, [2.7, hh, 0], [2.7, hh * .42, 0], .025, rope);
        load = siteMesh(rig, siteBox, stone, [2.7, hh * .38, 0], [.75, .45, .65]);
      }
      if (load) { load.userData = {hoist: true, baseY: load.position.y, offset: rand() * 9}; siteActors.push(load); }
      rig.userData = {site, kind, from: cfg.from ?? 0, to: cfg.to ?? Math.max(0, height - hh), start: cfg.start ?? .04, end: cfg.end ?? .94, boom, wheel, offset: rand() * 9};
      siteRigs.push(rig);
    }

    const workerCount = Math.max(0, Math.min(18, Math.round(spec.workers ?? 6)));
    for (let i = 0; i < workerCount; i++) {
      const angle = -Math.PI * .1 + (i + .5) / Math.max(1, workerCount) * Math.PI * 1.2, distance = radius * (.45 + rand() * .28);
      makeWorker(group, Math.cos(angle) * distance, Math.sin(angle) * distance, -angle + Math.PI / 2 + (rand() - .5) * .5, palette, ['mason', 'carry', 'lift'][i % 3], i * 1.7 + rand());
    }

    const dustAmount = Math.max(0, Math.min(1, spec.dust ?? .35)), count = Math.round(120 * dustAmount);
    if (count) {
      const positions = new Float32Array(count * 3), base = [];
      for (let i = 0; i < count; i++) { const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * radius; base.push([Math.cos(a) * r, rand() * Math.min(height, 8), Math.sin(a) * r, rand() * 10]); }
      const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
      const points = new T.Points(geometry, new T.PointsMaterial({color: spec.craft === 'metal' ? '#ffad57' : '#d7ba8e', size: Math.max(.06, radius * .009), transparent: true, opacity: spec.craft === 'metal' ? .75 : .32, depthWrite: false, blending: spec.craft === 'metal' ? T.AdditiveBlending : T.NormalBlending}));
      group.add(points); siteDust.push({points, base, radius, height: Math.min(height, 8), sparks: spec.craft === 'metal'});
    }
  }

  let monument = null, total = 1, heightTrack = [], tagTrack = {}, leaning = null;

  // Pieces grow into place, drop from above, are taken down and lean, in the colour pass and in the shadow
  // pass alike: a piece that is not built yet casts no shadow.
  function growVertex(shader, pbr) {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aLife; attribute float aSeed; attribute float aLean;
        uniform float uTime,uFly,uDrop,uLeanAngle; uniform vec3 uLeanPivot,uLeanAxis;
        varying float vGlow; varying float vWorldY; varying float vSeed;
        ${pbr ? 'varying vec3 vPbrPosition; varying vec3 vPbrNormal;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float kIn=clamp((uTime-aLife.x)/uFly,0.,1.);
        float kOut=clamp((uTime-aLife.y)/uFly,0.,1.);
        float eIn=1.-pow(1.-kIn,3.);
        float alive=step(aLife.x,uTime)*(1.-kOut);
        transformed*=alive*mix(.55,1.,eIn);
        vGlow=step(aLife.x,uTime)*(1.-smoothstep(0.,1.,(uTime-aLife.x)/(uFly*2.)));
        float drop=(1.-eIn)*uDrop-kOut*uDrop*.4;
        vSeed=aSeed;`)
      .replace('#include <project_vertex>', `vec4 mvPosition=vec4(transformed,1.);
        ${pbr ? 'vec3 pbrObjectNormal=objectNormal;' : ''}
        #ifdef USE_INSTANCING
          mvPosition=instanceMatrix*mvPosition;
          ${pbr ? 'pbrObjectNormal=mat3(instanceMatrix)*pbrObjectNormal;' : ''}
        #endif
        mvPosition.y+=drop;
        if(aLean>.5){vec3 p=mvPosition.xyz-uLeanPivot;float c=cos(uLeanAngle),s=sin(uLeanAngle);
          mvPosition.xyz=uLeanPivot+p*c+cross(uLeanAxis,p)*s+uLeanAxis*dot(uLeanAxis,p)*(1.-c);
          ${pbr ? 'pbrObjectNormal=pbrObjectNormal*c+cross(uLeanAxis,pbrObjectNormal)*s+uLeanAxis*dot(uLeanAxis,pbrObjectNormal)*(1.-c);' : ''}}
        ${pbr ? 'vPbrPosition=(modelMatrix*mvPosition).xyz;vPbrNormal=normalize(mat3(modelMatrix)*pbrObjectNormal);' : ''}
        vWorldY=(modelMatrix*mvPosition).y;
        mvPosition=modelViewMatrix*mvPosition;
        gl_Position=projectionMatrix*mvPosition;`);
  }

  function material(kind) {
    const {pbr, ...surface} = pbrOptions(kind, visual, renderer), mat = new T.MeshStandardMaterial({color: '#ffffff', ...KINDS[kind], ...surface});
    mat.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms);
      shader.uniforms.uGlow = {value: new T.Color(kind === 'metal' ? '#ffb15c' : kind === 'wood' ? '#ffcf8a' : '#ffd9a8')};
      shader.uniforms.uKind = {value: kind === 'metal' ? 1 : kind === 'stone' ? 0 : -1};
      if (pbr) Object.assign(shader.uniforms, {
        uPbrAlbedo: {value: pbr.albedo}, uPbrNormal: {value: pbr.normal ?? pbr.albedo}, uPbrRoughness: {value: pbr.roughness ?? pbr.albedo}, uPbrAo: {value: pbr.ao ?? pbr.albedo},
        uPbrScale: {value: pbr.scale}, uPbrNormalScale: {value: pbr.normal ? pbr.normalScale : 0},
      });
      growVertex(shader, pbr);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform vec3 uGlow,uNightColor; uniform float uNight,uSparkle,uClock,uHeight,uKind;
          varying float vGlow; varying float vWorldY; varying float vSeed;
          ${pbr ? `uniform sampler2D uPbrAlbedo,uPbrNormal,uPbrRoughness,uPbrAo;
          uniform float uPbrScale,uPbrNormalScale; varying vec3 vPbrPosition,vPbrNormal;
          vec3 pbrWeights(){vec3 w=pow(abs(vPbrNormal),vec3(5.));return w/(w.x+w.y+w.z+.0001);}
          vec4 pbrSample(sampler2D tex,vec3 w){return texture2D(tex,vPbrPosition.zy*uPbrScale)*w.x+texture2D(tex,vPbrPosition.xz*uPbrScale)*w.y+texture2D(tex,vPbrPosition.xy*uPbrScale)*w.z;}` : ''}`)
        .replace('#include <map_fragment>', pbr ? `vec3 pbrW=pbrWeights();vec4 pbrColor=pbrSample(uPbrAlbedo,pbrW);diffuseColor.rgb*=mix(vec3(1.),pbrColor.rgb,.7);diffuseColor.a*=pbrColor.a;` : '#include <map_fragment>')
        .replace('#include <roughnessmap_fragment>', pbr?.roughness ? `#include <roughnessmap_fragment>\n          roughnessFactor*=pbrSample(uPbrRoughness,pbrWeights()).r;` : '#include <roughnessmap_fragment>')
        .replace('#include <normal_fragment_maps>', pbr?.normal ? `#include <normal_fragment_maps>
          vec3 pbrWn=pbrWeights(),baseN=normalize(vPbrNormal);
          vec3 tx=texture2D(uPbrNormal,vPbrPosition.zy*uPbrScale).xyz*2.-1.,ty=texture2D(uPbrNormal,vPbrPosition.xz*uPbrScale).xyz*2.-1.,tz=texture2D(uPbrNormal,vPbrPosition.xy*uPbrScale).xyz*2.-1.;
          vec3 nx=vec3(tx.z*sign(baseN.x),tx.y,tx.x),ny=vec3(ty.x,ty.z*sign(baseN.y),ty.y),nz=vec3(tz.x,tz.y,tz.z*sign(baseN.z));
          vec3 pbrMapped=normalize(nx*pbrWn.x+ny*pbrWn.y+nz*pbrWn.z);normal=normalize(mix(normal,normalize(mat3(viewMatrix)*pbrMapped),min(.5,uPbrNormalScale*.45)));` : '#include <normal_fragment_maps>')
        .replace('#include <aomap_fragment>', pbr?.ao ? `#include <aomap_fragment>
          reflectedLight.indirectDiffuse*=mix(1.,pbrSample(uPbrAo,pbrWeights()).r,.65);` : '#include <aomap_fragment>')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance+=uGlow*vGlow*1.3;
          // At night: stone lit from the foot of the walls, golden metal, roofs in shadow.
          float up=1.-smoothstep(0.,uHeight,vWorldY);
          if(uKind>.5)totalEmissiveRadiance+=uNight*uNightColor*.55;
          else if(uKind>-.5)totalEmissiveRadiance+=uNight*vec3(.6,.36,.14)*(.04+.42*up*up);
          float tw=step(.985,fract(sin(vSeed*91.7+floor(uClock*9.)*13.1)*43758.5));
          totalEmissiveRadiance+=uSparkle*uKind*tw*vec3(4.,4.2,4.6);`);
    };
    return mat;
  }

  function shadowMaterial() {
    const mat = new T.MeshDepthMaterial({depthPacking: T.RGBADepthPacking});
    mat.onBeforeCompile = shader => { Object.assign(shader.uniforms, uniforms); growVertex(shader, null); };
    return mat;
  }

  function clear() {
    for (const mesh of meshes) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); mesh.customDepthMaterial?.dispose(); }
    meshes.length = 0;
    for (const {group} of siteGroups) scene.remove(group);
    siteGroups.length = 0; siteActors.length = 0; siteDust.length = 0; siteRigs.length = 0;
    if (environmentGroup) { scene.remove(environmentGroup); disposeEnvironment(environmentGroup); environmentGroup = null; environmentTimed = []; }
    if (realisticGroundMaterial) { for (const key of ['map', 'normalMap', 'roughnessMap', 'aoMap']) realisticGroundMaterial[key]?.dispose(); realisticGroundMaterial.dispose(); realisticGroundMaterial = null; }
    ground.material = planGroundMaterial; ground.receiveShadow = false;
  }

  function load(data) {
    clear();
    monument = data; moved = false;
    visual = resolveVisualStyle(data.visualStyle ?? {quality: 'basic'});
    renderer.setPixelRatio(Math.min(PIXEL_RATIO, visual.quality.pixelRatio));
    renderer.toneMappingExposure = visual.qualityName === 'basic' ? 1.05 : visual.qualityName === 'cinematic' ? 1.18 : 1.24;
    renderer.shadowMap.enabled = Boolean(visual.quality.shadows); renderer.shadowMap.type = T.PCFShadowMap;
    sun.castShadow = Boolean(visual.quality.shadows); sun.shadow.mapSize.setScalar(visual.quality.shadows || 512);
    baseBloom = visual.qualityName === 'basic' ? .5 : visual.qualityName === 'cinematic' ? .28 : .18;
    ambientBase = visual.qualityName === 'basic' ? 0 : visual.qualityName === 'cinematic' ? .5 : .44;
    // An element with `lean` tilts with all its pieces: angle (degrees) over time from `track`, towards `toward`.
    leaning = data.elements.find(element => element.lean)?.lean ?? null;
    uniforms.uLeanAngle.value = 0;
    if (leaning) {
      uniforms.uLeanPivot.value.set(...(leaning.pivot ?? [0, 0, 0]));
      uniforms.uLeanAxis.value.crossVectors(UP, new T.Vector3(...(leaning.toward ?? [0, 0, 1])).normalize()).normalize();
    }
    const {pieces: built, P, index} = buildPieces(data), k = {pieces: built, rand: random((data.seed ?? 7) + 1)};
    total = data.phases.length;
    // Within each phase, pieces are laid from the bottom up.
    const byPhase = data.phases.map(() => []);
    k.pieces.forEach(piece => byPhase[piece.phase].push(piece));
    byPhase.forEach((list, phase) => {
      list.sort((a, b) => a.order - b.order);
      list.forEach((piece, rank) => { piece.birth = phase + .03 + .86 * rank / Math.max(1, list.length); });
    });
    const death = phase => phase + .1 + .5 * k.rand();
    const groups = {};
    for (const piece of k.pieces) (groups[piece.kind] ??= []).push(piece);
    for (const [kind, list] of Object.entries(groups)) {
      const geometry = new T.BoxGeometry(1, 1, 1), life = new Float32Array(list.length * 2), seed = new Float32Array(list.length), lean = new Float32Array(list.length);
      geometry.setAttribute('uv1', geometry.attributes.uv);
      const mesh = new T.InstancedMesh(geometry, material(kind), list.length);
      list.forEach((piece, i) => {
        mesh.setMatrixAt(i, piece.matrix); mesh.setColorAt(i, piece.color);
        life[i * 2] = piece.birth; life[i * 2 + 1] = piece.until === undefined ? 1e6 : death(piece.until); seed[i] = k.rand() * 100; lean[i] = piece.lean ?? 0;
      });
      geometry.setAttribute('aLife', new T.InstancedBufferAttribute(life, 2));
      geometry.setAttribute('aSeed', new T.InstancedBufferAttribute(seed, 1));
      geometry.setAttribute('aLean', new T.InstancedBufferAttribute(lean, 1));
      mesh.frustumCulled = false;
      mesh.castShadow = mesh.receiveShadow = Boolean(visual.quality.shadows);
      mesh.customDepthMaterial = shadowMaterial();
      scene.add(mesh); meshes.push(mesh);
    }
    // Optional real context. The app hides this layer by default so it cannot compete with the monument.
    if (data.context) {
      const block = new T.MeshStandardMaterial({color: '#3a3e50', roughness: .95, metalness: 0});
      const line = new T.LineBasicMaterial({color: '#6b7393', transparent: true, opacity: .45});
      for (const b of data.context.buildings ?? []) {
        const shape = new T.Shape(b.points.map(([x, z]) => new T.Vector2(x, -z)));
        for (const hole of b.holes ?? []) shape.holes.push(new T.Path(hole.map(([x, z]) => new T.Vector2(x, -z))));
        const geometry = new T.ExtrudeGeometry(shape, {depth: b.height, bevelEnabled: false});
        geometry.rotateX(-Math.PI / 2);
        const mesh = new T.Mesh(geometry, block.clone());
        const edges = new T.LineSegments(new T.EdgesGeometry(geometry, 25), line.clone());
        scene.add(mesh, edges); meshes.push(mesh, edges);
      }
      const road = new T.MeshStandardMaterial({color: '#262936', roughness: 1});
      for (const street of data.context.streets ?? []) for (let i = 0; i < street.points.length - 1; i++) {
        const [ax, az] = street.points[i], [bx, bz] = street.points[i + 1], len = Math.hypot(bx - ax, bz - az);
        const mesh = new T.Mesh(new T.BoxGeometry(street.width, .06, len + street.width * .5), road.clone());
        mesh.position.set((ax + bx) / 2, .03, (az + bz) / 2); mesh.rotation.y = Math.atan2(bx - ax, bz - az);
        scene.add(mesh); meshes.push(mesh);
      }
    }
    data.phases.forEach((phase, i) => { if (phase.scene) makeWorksite(phase.scene, i, (data.seed ?? 7) + i * 977 + 41); });
    // Height reached and counters over time.
    const sorted = [...k.pieces].sort((a, b) => a.birth - b.birth);
    let max = 0;
    // Temporary scaffolds and ridge ornaments do not count towards the monument's height.
    heightTrack = sorted.map(piece => [piece.birth, max = Math.max(max, (piece.kind === 'wood' && !piece.structural) || piece.ornament ? 0 : piece.top)]);
    tagTrack = {};
    for (const piece of sorted) if (piece.tag) (tagTrack[piece.tag] ??= []).push(piece.birth);
    // Framing and scale specific to the monument.
    const {target, radius} = data.view;
    controls.target.set(...target);
    uniforms.uDrop.value = data.view.drop ?? radius * .12;
    uniforms.uHeight.value = data.view.height ?? radius;
    uniforms.uNightColor.value.set(data.view.night ?? '#ff9a2e');
    ground.scale.set(radius * 40, radius * 40, 1);
    const realisticGround = !data.view.water && groundOptions(visual, renderer, radius);
    if (realisticGround) { realisticGroundMaterial = new T.MeshStandardMaterial(realisticGround); realisticGroundMaterial.fog = true; ground.material = realisticGroundMaterial; ground.receiveShadow = Boolean(visual.quality.shadows); }
    else { ground.material = planGroundMaterial; planGroundMaterial.uniforms.uStep.value = data.view.dots ?? radius / 60; planGroundMaterial.uniforms.uRadius.value = radius * 3.2; planGroundMaterial.uniforms.uWater.value = data.view.water ? 1 : 0; }
    const environment = visual.environment;
    dayHorizon = new T.Color(environment?.horizon ?? DUSK); horizon.value.copy(dayHorizon); zenith.value.set(environment?.zenith ?? '#1b213d'); sunGlow.value.set(environment ? '#6b3a20' : '#9d4e24'); fogFactor = environment?.fog ?? .4;
    light = LIGHTS[environment?.light ?? data.view.light] ?? LIGHTS.golden;
    sun.color.set(light.sun); hemi.color.set(light.sky); hemi.groundColor.set(environment?.groundLight ?? '#3a2a1c');
    sun.position.set(...light.dir.map(v => v * radius));
    rim.position.set(radius, radius * .4, -radius);
    if (visual.quality.shadows) {
      const shadow = sun.shadow.camera; shadow.left = shadow.bottom = -radius * 1.45; shadow.right = shadow.top = radius * 1.45; shadow.near = 1; shadow.far = radius * 5; shadow.updateProjectionMatrix(); sun.shadow.bias = -.00015;
    }
    const builtEnvironment = createEnvironment(visual, data.view, data.seed ?? 7, index); environmentGroup = builtEnvironment.group; environmentTimed = builtEnvironment.timed; scene.add(environmentGroup);
    home();
    if (data.view.start) {
      const dir = camera.position.clone().sub(controls.target).normalize();
      controls.target.set(...data.view.start.target);
      camera.position.copy(controls.target).addScaledVector(dir, data.view.start.distance);
    }
    return {pieces: k.pieces.length};
  }

  // Screen area left free by the panels: the monument is centred and framed in it.
  let insets = {left: 0, top: 0, bottom: 0};
  const free = () => {
    const w = host.clientWidth, h = host.clientHeight;
    return {w, h, fw: Math.max(1, w - insets.left), fh: Math.max(1, h - insets.top - insets.bottom)};
  };
  // Distance needed to see the monument's full width; fog follows the distance.
  const fit = () => {
    const {distance, width = distance} = monument.view, {w, h, fw, fh} = free();
    const half = Math.atan(Math.tan(T.MathUtils.degToRad(camera.fov / 2)) * fw / fh);
    return Math.max(distance, width / 2 / Math.tan(half) * .85) * Math.max(1, h / fh * .9);
  };
  function home() {
    const dir = new T.Vector3(...(monument.view.direction ?? [.55, .32, .78])).normalize(), d = fit();
    camera.position.copy(controls.target).addScaledVector(dir, d);
    controls.minDistance = d * .35; controls.maxDistance = d * 2.2;
    scene.fog.density = fogFactor / d;
    controls.update();
  }

  const resize = () => {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h); composer.setSize(w, h);
    camera.aspect = w / h;
    // Shift the image centre to the middle of the free area.
    camera.setViewOffset(w, h, -insets.left / 2, (insets.bottom - insets.top) / 2, w, h);
    camera.updateProjectionMatrix();
    if (monument && !moved) home();
  };
  new ResizeObserver(resize).observe(host);
  resize();

  const at = (track, t) => { let lo = 0, hi = track.length - 1, best = 0; while (lo <= hi) { const mid = (lo + hi) >> 1; if (track[mid][0] <= t) { best = track[mid][1]; lo = mid + 1; } else hi = mid - 1; } return best; };

  return {
    load,
    home,
    setInsets(next) {
      if (next.left === insets.left && next.top === insets.top && next.bottom === insets.bottom) return;
      insets = next; resize();
    },
    // Camera plan: close to the foundations at first, then pulling back to the overall view.
    // With an active moment, the camera eases towards the piece concerned.
    cinematic(t, focus, closeDistance) {
      const start = monument.view.start ?? {target: monument.view.target, distance: fit()}, end = new T.Vector3(...monument.view.target);
      const f = Math.min(1, t / Math.max(1, total - 1)), s = f * f * (3 - 2 * f);
      const target = new T.Vector3(...start.target).lerp(end, s);
      let distance = start.distance + (fit() - start.distance) * s;
      if (focus) { target.lerp(new T.Vector3(...focus), Number.isFinite(closeDistance) ? .82 : .45); distance = Number.isFinite(closeDistance) ? closeDistance : distance * .72; }
      if(host.clientWidth <= 1100) distance=Math.max(distance,fit());
      const dir = camera.position.clone().sub(controls.target).normalize(), now = camera.position.distanceTo(controls.target);
      controls.target.lerp(target, .06);
      camera.position.copy(controls.target).addScaledVector(dir, now + (distance - now) * .06);
    },
    // Screen position of a scene point (to pin a moment).
    project(point) {
      const v = new T.Vector3(...point);
      // Pins on a leaning building lean with it.
      if (leaning && Math.hypot(v.x - uniforms.uLeanPivot.value.x, v.z - uniforms.uLeanPivot.value.z) < (leaning.radius ?? 30))
        v.sub(uniforms.uLeanPivot.value).applyAxisAngle(uniforms.uLeanAxis.value, uniforms.uLeanAngle.value).add(uniforms.uLeanPivot.value);
      v.project(camera);
      return {x: (v.x * .5 + .5) * host.clientWidth, y: (-v.y * .5 + .5) * host.clientHeight, visible: v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1};
    },
    get duration() { return total; },
    setTime(t) {
      uniforms.uTime.value = t;
      if (leaning) uniforms.uLeanAngle.value = lerp(leaning.track, t) * Math.PI / 180;
      const phase = monument.phases[Math.min(total - 1, Math.floor(t))];
      const night = phase?.mood === 'night' ? Math.min(1, (t - Math.floor(t)) * 3 + (t >= total ? 1 : 0)) : 0;
      uniforms.uNight.value = night;
      uniforms.uSparkle.value = phase?.sparkle ? night : 0;
      sun.intensity = light.sunI * (1 - night * .92); hemi.intensity = light.hemiI * (1 - night * .75); ambient.intensity = ambientBase * (1 - night * .7); rim.intensity = (light.rimI ?? .9) - night * .3;
      bloom.strength = baseBloom + night * .35;
      horizon.value.copy(dayHorizon).lerp(NIGHT, night);
      scene.fog.color.copy(horizon.value);
      for (const item of environmentTimed) item.object.visible = t >= item.from && t < item.until;
      const phaseIndex = Math.min(total - 1, Math.floor(t));
      for (const site of siteGroups) {
        site.group.visible = site.phase === phaseIndex;
        site.progress = Math.max(0, Math.min(1, t - site.phase));
        if (t >= total && site.phase === total - 1) site.progress = 1;
        for (const part of site.scaffoldParts) part.visible = part.userData.siteReveal <= site.progress;
      }
      for (const rig of siteRigs) {
        const u = rig.userData, raw = Math.max(0, Math.min(1, (u.site.progress - u.start) / Math.max(.01, u.end - u.start))), eased = raw * raw * (3 - 2 * raw);
        rig.visible = u.site.group.visible && u.site.progress >= u.start;
        rig.position.y = u.from + (u.to - u.from) * eased;
      }
    },
    height: t => at(heightTrack, t),
    count: (tag, t) => (tagTrack[tag] ?? []).filter(birth => birth <= t).length,
    // Fixed viewpoint for photo comparisons: azimuth in degrees from north (camera to the south = 180).
    look(azimuth, elevation, distance, ...target) {
      const az = azimuth * Math.PI / 180, el = elevation * Math.PI / 180;
      // Photos are often taken from the foot of the building, looking up: allow cameras below the target.
      moved = true; controls.maxPolarAngle = Math.PI * .97; controls.minDistance = Math.min(controls.minDistance, distance); controls.maxDistance = Math.max(controls.maxDistance, distance);
      if (target.length === 3) controls.target.set(...target); else controls.target.set(...monument.view.target);
      camera.position.copy(controls.target).add(new T.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).multiplyScalar(distance));
      controls.update();
    },
    // Vertical field of view of a reference photo's lens, in degrees.
    fov(degrees) { camera.fov = degrees; camera.updateProjectionMatrix(); },
    autoRotate(on) { controls.autoRotate = on; },
    render(clock) {
      uniforms.uClock.value = clock;
      for (const actor of siteActors) if (actor.parent?.visible) {
        const u = actor.userData;
        if (u.hoist) actor.position.y = u.baseY + Math.sin(clock * .65 + u.offset) * .35;
        else {
          const wave = Math.sin(clock * 2.1 + u.offset);
          actor.position.y = u.baseY + Math.abs(wave) * .018; actor.rotation.y = u.baseTurn + wave * .025;
          u.arms?.forEach((arm, i) => { const base = u.role === 'lift' ? 2.45 : u.role === 'carry' ? 1.3 : .45; arm.rotation.z = (i ? -1 : 1) * (base + wave * (u.role === 'mason' ? .4 : .12)); });
        }
      }
      for (const rig of siteRigs) if (rig.visible) {
        const u = rig.userData;
        if (u.boom) u.boom.rotation.y = Math.sin(clock * .16 + u.offset) * (u.kind === 'steam-crane' ? .16 : .07);
        if (u.wheel) u.wheel.rotation.z = clock * .22;
      }
      for (const dust of siteDust) if (dust.points.parent?.visible) {
        const position = dust.points.geometry.attributes.position;
        dust.base.forEach(([x, y, z, offset], i) => {
          const rise = (clock * (dust.sparks ? 2.4 : .3) + offset) % dust.height;
          position.setXYZ(i, x + Math.sin(clock * .45 + offset) * .18, (y + rise) % dust.height, z + Math.cos(clock * .37 + offset) * .18);
        });
        position.needsUpdate = true;
      }
      controls.update(); composer.render();
    },
    onInteract(callback) { controls.addEventListener('start', callback); },
  };
}
