import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone as cloneSkinned} from 'three/addons/utils/SkeletonUtils.js';
import {resolveVisualStyle, pbrOptions} from './visuals.js';
import {adaptive, adaptiveContext, profiledGeometry, segmentsForChordError} from './geometry.js';
import {masonry} from './masonry.js';
import {renaissance} from './renaissance.js';
import {japanese} from './japanese.js';
export {CURVE_QUALITY, chordError, segmentsForChordError, profileAt, sampleProfile, profiledGeometry, adaptiveContext} from './geometry.js';
export {Soup, Layers, moulding, stack, outline, sweep, plate, foil, frameOf, radiusOf as archRadius} from './masonry.js';

// Construction engine: a monument file (phases + elements) becomes thousands of instanced pieces.
// Each piece is born (and sometimes removed) on the timeline; the shader drops it into place and
// lights it as it lands. One phase = one unit of time.
const PIXEL_RATIO = Math.min(2, Math.max(1.5, globalThis.devicePixelRatio ?? 1));
const FLY = 0.06;
// Where each element of a monument comes from (element.provenance); anything else counts as unstated.
export const PROVENANCE = ['measured', 'documented', 'interpreted'];
const provenanceOf = element => { const i = PROVENANCE.indexOf(element?.provenance); return i < 0 ? 3 : i; };
const UP = new T.Vector3(0, 1, 0);
const KINDS = {
  stone: {roughness: .88, metalness: 0},
  metal: {roughness: .38, metalness: .6},
  slate: {roughness: .5, metalness: .15},
  tile: {roughness: .75, metalness: 0},
  wood: {roughness: .92, metalness: 0},
  cloth: {roughness: .9, metalness: 0},
  glass: {roughness: .16, metalness: .25},
  lead: {roughness: .72, metalness: .12},
  // Lime or clay plaster, wooden shingles and thatch, gold leaf on lacquer (it mirrors the studio), tree bark.
  plaster: {roughness: .92, metalness: 0},
  shingle: {roughness: .86, metalness: 0},
  gilt: {roughness: .44, metalness: .5},
  bark: {roughness: .95, metalness: 0},
};

// The joints of a wall of patches, drawn by its material. `vMason` is [s along the wall, height, course height]: the
// coursing is a grid of beds every `course` metres and heads staggered from course to course, blocks 0.5–1.2 m long
// whose joints wander by a few centimetres; each block takes its own tone, as the stone of a real wall does. A joint
// is 1.4 cm wide and its contrast fades out where a pixel covers more than that, so that it never aliases.
const MASON_PARS = `
  varying vec3 vMason;
  float mh11(float p){p=fract(p*.1031);p*=p+33.33;p*=p+p;return fract(p);}
  float mh21(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
  // Weathering: value noise at three sizes, from a stone to a stretch of wall, so that a face is never one flat colour.
  float mnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mh21(i),mh21(i+vec2(1.,0.)),f.x),mix(mh21(i+vec2(0.,1.)),mh21(i+vec2(1.,1.)),f.x),f.y);}
  float weathering(vec2 p){return .5*mnoise(p/.8)+.3*mnoise(p/2.7+7.3)+.2*mnoise(p/10.+3.1);}
  // Rows of slates or scales: x the shade across a course (dark under the overlap, lighter up it), y 1 on a joint, z a tone.
  vec3 slates(vec3 m){
    float c=abs(m.z),v=m.y/c,row=floor(v),fy=v-row,w=c*1.1;
    float x=m.x/w+.5*mod(row,2.)+mh11(row*3.1)*5.,k=floor(x),fx=x-k;
    float fp=max(max(fwidth(m.x),fwidth(m.y)),1e-4);
    return vec3(.55+.45*smoothstep(0.,.3,fy),(1.-smoothstep(.004,.004+fp,min(fx,1.-fx)*w))*clamp(.008/fp,0.,1.),mh21(vec2(k,row)));
  }
  vec3 masonBump(vec3 pos,vec3 n,vec2 dH){
    vec3 sx=dFdx(pos),sy=dFdy(pos),R1=cross(sy,n),R2=cross(n,sx);
    float det=dot(sx,R1);
    return normalize(abs(det)*n-sign(det)*(dH.x*R1+dH.y*R2));
  }`;
const SLATE_BODY = `
    vec3 sl=slates(vMason);
    float sq=clamp(.1/max(max(fwidth(vMason.x),fwidth(vMason.y)),1e-4),0.,1.);
    diffuseColor.rgb*=mix(.78,sl.x,sq)*(1.-.4*sl.y*sq)*(.86+.28*sl.z)*(.9+.2*weathering(vMason.xy*.6));`;
const SLATE_COLOR = `
  float mH=0.;
  if(vMason.z>0.){${SLATE_BODY}
  }`;
const MASON_COLOR = `
  float mH=0.;
  if(vMason.z<0.){${SLATE_BODY}
  }
  else if(vMason.z>0.){
    float c=vMason.z,by=vMason.y/c,ky=floor(by);
    // Beds: the joints between courses wander a few centimetres, so courses are not all one height.
    float b0=ky-1.+.5*(mh21(vec2(ky-1.,3.7))-.5),b1=ky+.5*(mh21(vec2(ky,3.7))-.5),b2=ky+1.+.5*(mh21(vec2(ky+1.,3.7))-.5),b3=ky+2.+.5*(mh21(vec2(ky+2.,3.7))-.5);
    bool uy=by>=b2,my=by>=b1;
    float row=uy?ky+1.:(my?ky:ky-1.),bl=uy?b2:(my?b1:b0),bu=uy?b3:(my?b2:b1);
    float L=c*(1.9+2.4*mh11(row*1.37));
    float x=vMason.x/L+mh11(row*5.17)*7.,k=floor(x);
    float e0=k-1.+.62*(mh21(vec2(k-1.,row))-.5),e1=k+.62*(mh21(vec2(k,row))-.5),e2=k+1.+.62*(mh21(vec2(k+1.,row))-.5),e3=k+2.+.62*(mh21(vec2(k+2.,row))-.5);
    bool hi=x>=e2,mi=x>=e1;
    float id=hi?k+1.:(mi?k:k-1.),lft=hi?e2:(mi?e1:e0),rgt=hi?e3:(mi?e2:e1);
    float d=min(min(x-lft,rgt-x)*L,min(by-bl,bu-by)*c);
    float fp=max(max(fwidth(vMason.x),fwidth(vMason.y)),1e-4);
    float j=(1.-smoothstep(.008,.008+fp,d))*clamp(.016/fp,0.,1.);
    float t1=mh21(vec2(id,row+17.)),t2=mh21(vec2(id+3.1,row+41.)),t3=mh21(vec2(floor(vMason.x*.9),floor(vMason.y*.9))),spot=mh21(vec2(id*1.7,row+91.));
    // A wall is never one tone: a few blocks darker (a harder bed, a stain), a few paler, a tone each, a slow weathering.
    float wx=weathering(vMason.xy),dirt=smoothstep(.55,.9,weathering(vMason.xy*vec2(.5,.18)+11.)),odd=spot<.09?-.26:spot>.93?.16:0.;
    float luma=dot(diffuseColor.rgb,vec3(.299,.587,.114));
    diffuseColor.rgb=mix(vec3(luma),diffuseColor.rgb,.8)*.9;
    diffuseColor.rgb*=(1.+.28*(t1-.5)+.05*(t3-.5)+odd)*vec3(1.+.07*(t2-.5),1.,1.-.09*(t2-.5))*(.88+.24*wx)*(1.-.24*dirt);
    // The mortar: paler than the stone, and in the shade of the bed above it.
    diffuseColor.rgb=mix(diffuseColor.rgb*(1.-.18*j),vec3(luma*.92,luma*.9,luma*.84),j*.4);
    mH=-j*.005;
  }`;
// Leaded glass: panes between lead cames 1.2 cm wide, an iron bar every third row, each pane a little lighter or
// darker, bluer or greyer than the next: `vMason.z` is the pane's height in metres (its width is 0.72 of it).
const GLASS_COLOR = `
  if(vMason.z>0.){
    float ph=vMason.z,pw=ph*.72;
    vec2 cell=vec2(vMason.x/pw,vMason.y/ph),id=floor(cell),f=fract(cell);
    float fp=max(max(fwidth(vMason.x),fwidth(vMason.y)),1e-4);
    float edge=min(min(f.x*pw,(1.-f.x)*pw),min(f.y*ph,(1.-f.y)*ph));
    float lead=(1.-smoothstep(.008,.008+fp,edge))*clamp(.016/fp,0.,1.);
    float bar=mod(id.y,4.)<.5?(1.-smoothstep(.012,.012+fp,abs(f.y*ph-.02)))*clamp(.024/fp,0.,1.):0.;
    float tone=mh21(id);
    diffuseColor.rgb*=(.93+.14*tone)*vec3(.97+.06*mh21(id+1.7),.98+.04*mh21(id+3.3),1.);
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.2,.21,.23),max(lead,bar)*.92);
  }`;
const MASON_NORMAL = `
  if(vMason.z>0.)normal=masonBump(-vViewPosition,normal,vec2(dFdx(mH),dFdy(mH)));`;

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
  // A flat or empty piece (a zero size) has no normals to light it, and its NaN would spread through the bloom.
  const add = (kind, color, phase, order, top, extra) => { if (Math.abs(m.determinant()) > 1e-9) pieces.push({kind, matrix: m.clone(), color, phase, order, top, ...extra}); };
  return {
    pieces, rand, tint, flats: [], reliefs: new Map(),
    // A photo relief laid by a brick (a dormer's carved front): `name` is a `relief` element without `at`, the brick
    // gives the foot of the panel's middle [x, y, z] in the scene and its outward normal [x, z]. Returns false when the
    // monument has no relief of that name, so the brick builds its own geometry instead.
    lay(name, [x, y, z], [nx, nz], phase, until) {
      const template = this.reliefs.get(name);
      if (!template) return false;
      const spec = template.spec, length = Math.hypot(nx, nz) || 1, position = new T.Vector3(x, y + spec.size[1] / 2, z).addScaledVector(new T.Vector3(nx / length, 0, nz / length), spec.offset ?? .04);
      this.flats.push({phase, until, position, yaw: Math.atan2(nx, nz), spec, element: template.index});
      return true;
    },
    box(kind, [x, y, z], [sx, sy, sz], rotY, color, phase, order = y, extra = {}) {
      m.compose(p.set(x, y, z), q.setFromEuler(e.set(0, rotY, 0)), s.set(sx, sy, sz));
      add(kind, color, phase, order, y + sy / 2, extra);
    },
    beam(kind, a, b, thick, color, phase, extra = {}) {
      const d = b.clone().sub(a), len = d.length();
      if (len < 1e-3) return;
      m.compose(p.copy(a).add(b).multiplyScalar(.5), q.setFromUnitVectors(UP, d.normalize()), s.set(thick, len, thick));
      add(kind, color, phase, Math.min(a.y, b.y), Math.max(a.y, b.y), extra);
    },
    // Right-handed basis (x × y = z): tiles and slates laid on a slope.
    oriented(kind, pos, x, y, z, size, color, phase, order = pos.y, extra = {}) {
      m.makeBasis(x, y, z).scale(s.set(...size)).setPosition(pos);
      add(kind, color, phase, order, pos.y, extra);
    },
    // A patch of real surface (kit/masonry.js): a bounding box for a matrix, its triangles in that box.
    patch(kind, soup, color, phase, extra = {}) {
      const made = soup.toPiece();
      if (made) pieces.push({kind, matrix: made.matrix, color, phase, order: (extra.orderBase ?? 0) + made.centerY, top: made.top, mesh: made.mesh, ...extra});
    },
    // A turned piece in the box's unit: `size` is [diameter, height, diameter] (an oval when the two differ).
    // Shapes (SHAPES below): drum, shaft (a monolith tapering by an eighth), flare (wider at the top: an
    // echinus, a capital's bell), cone, torus (a moulding), ball, bell (a cast bell), octagon, spike (an
    // octagonal cone).
    turned(shape, kind, [x, y, z], [sx, sy, sz = sx], rotY, color, phase, order = y, extra = {}) {
      m.compose(p.set(x, y, z), q.setFromEuler(e.set(0, rotY, 0)), s.set(sx, sy, sz));
      add(kind, color, phase, order, y + sy / 2, {...extra, shape});
    },
    // A turned piece lying along `axis` (a volute's bolster, a roll moulding).
    lying(shape, kind, pos, axis, [d, len], color, phase, order = pos.y, extra = {}) {
      const a = axis.clone().normalize(), x = Math.abs(a.y) > .9 ? new T.Vector3(1, 0, 0) : new T.Vector3().crossVectors(UP, a).normalize(), z = new T.Vector3().crossVectors(x, a);
      m.makeBasis(x, a, z).scale(s.set(d, len, d)).setPosition(pos);
      add(kind, color, phase, order, pos.y + d / 2, {...extra, shape});
    },
    // A column standing at [x, y, z]: `height` from the foot of its base to the top of its abacus, `diameter`
    // at the foot of the shaft, in one of the orders (proportions in diameters, after Vitruvius and Vignola):
    //   tuscan      square plinth and torus; astragal, echinus and square abacus
    //   doric       no base; echinus and abacus
    //   ionic       attic base (plinth, torus, scotia, torus); two volutes either side of the echinus
    //   corinthian  attic base; a bell wrapped in two rows of acanthus leaves, corner volutes, thin abacus
    //   romanesque  attic base; a cushion-like bell and a deep abacus, as in Pisa
    //   gothic      octagonal plinth and moulded base; a crocket capital under an octagonal abacus
    // The shaft is laid drum by drum (`drum` metres; 0 for a monolith) and tapers by `taper` (a sixth) above
    // its lower third. `out` [x, z] is the way the column faces: its volutes and leaves are set square to it.
    column(kind, [x, y, z], {height, diameter: D, order = 'tuscan', drum = 1.2, drums, taper = 1 / 6, out = [0, 1], profile, flutes = 0, rendering = {}}, color, phase, extra = {}) {
      const self = this, yaw = Math.atan2(out[0], out[1]), f = new T.Vector3(out[0], 0, out[1]).normalize(), r = new T.Vector3().crossVectors(UP, f);
      const at = (dy, side = 0, front = 0) => [x + r.x * side + f.x * front, y + dy, z + r.z * side + f.z * front];
      const c = () => tint(color, .04);
      const piece = (shape, dy, size, geometry) => self.turned(shape, kind, at(dy + size[1] / 2), size, yaw, c(), phase, y + dy, geometry ? {...extra, geometry} : extra);
      const block = (dy, w, h) => self.box(kind, at(dy + h / 2), [w, h, w], yaw, c(), phase, y + dy, extra);
      const small = (shape, dy, side, front, size, turn = 0) => self.turned(shape, kind, at(dy, side, front), size, yaw + turn, c(), phase, y + dy, extra);
      const attic = ['ionic', 'corinthian', 'romanesque', 'composite'].includes(order);
      // Base.
      let b = 0;
      if (order === 'gothic') { piece('octagon', 0, [D * 1.45, D * .32]); piece('torus', D * .32, [D * 1.28, D * .18]); piece('drum', D * .5, [D * 1.08, D * .08]); b = D * .58; }
      else if (attic) { block(0, D * 1.38, D * .17); piece('torus', D * .17, [D * 1.3, D * .14]); piece('drum', D * .31, [D * 1.1, D * .08]); piece('torus', D * .39, [D * 1.18, D * .11]); b = D * .5; }
      else if (order === 'tuscan') { block(0, D * 1.36, D * .25); piece('torus', D * .25, [D * 1.28, D * .22]); b = D * .47; }
      // Shaft, drum by drum, with its entasis.
      const cap = {tuscan: .47, doric: .45, ionic: .62, corinthian: 1.17, composite: 1.17, romanesque: .8, gothic: .87}[order] ?? .5;
      const shaft = Math.max(D, height - b - D * cap);
      const shaftProfile = profile ?? [[0, 1], [.18, 1], [1 / 3, 1], [.7, 1 - taper * .42], [1, 1 - taper]];
      const ratioAt = t => {
        if (t <= shaftProfile[0][0]) return shaftProfile[0][1];
        for (let i = 1; i < shaftProfile.length; i++) if (t <= shaftProfile[i][0]) {
          const [a, ra] = shaftProfile[i - 1], [b2, rb] = shaftProfile[i], u = (t - a) / (b2 - a), smooth = u * u * (3 - 2 * u);
          return ra + (rb - ra) * smooth;
        }
        return shaftProfile.at(-1)[1];
      };
      const Dt = D * ratioAt(1), geometry = (from, to) => ({profile: [[0, ratioAt(from)], [.5, ratioAt((from + to) / 2)], [1, ratioAt(to)]], master: shaftProfile, span: [from, to], flutes, ...rendering});
      if ((drums > 0 || drum > 0) && (drums > 1 || shaft > drum * 1.4)) {
        const n = Math.max(1, drums > 0 ? Math.round(drums) : Math.round(shaft / drum));
        for (let i = 0; i < n; i++) piece('profiledShaft', b + shaft * i / n, [D, shaft / n * 1.001], geometry(i / n, (i + 1) / n));
      } else piece('profiledShaft', b, [D, shaft], {profile: shaftProfile, flutes, ...rendering});
      const y0 = b + shaft;
      // Capital: the astragal ringing the top of the shaft, then the order's own.
      if (order !== 'doric') piece('torus', y0 - D * .045, [Dt * 1.14, D * .09]);
      if (order === 'tuscan' || order === 'doric') { piece('flare', y0 + D * .05, [D * 1.3, D * .2]); block(y0 + D * .25, D * 1.36, D * .2); }
      else if (order === 'ionic') {
        piece('flare', y0 + D * .05, [D * 1.2, D * .18]);
        // The volutes either side, their bolsters running back to front, joined by the channel.
        for (const side of [-1, 1]) self.lying('drum', kind, new T.Vector3(...at(y0 + D * .34, side * D * .52)), f, [D * .4, D * .92], c(), phase, y + y0, extra);
        self.box(kind, at(y0 + D * .43), [D * 1.04, D * .18, D * .9], yaw, c(), phase, y + y0, extra);
        block(y0 + D * .52, D * 1.3, D * .1);
      } else if (order === 'corinthian' || order === 'composite') {
        piece('flare', y0 + D * .05, [D * 1.22, D * .96]);
        // Two rows of eight acanthus leaves curling out, the second row between the first.
        for (const [row, h, lean] of [[0, .36, .47], [1, .6, .55]]) for (let i = 0; i < 8; i++) {
          const a = (i + row * .5) / 8 * Math.PI * 2;
          small('ball', y0 + D * (.08 + h * .72), Math.sin(a) * D * lean, Math.cos(a) * D * lean, [D * .3, D * h, D * .22], a);
        }
        // Corner volutes under the abacus, and the abacus with its flower.
        for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) small('ball', y0 + D * .9, sx * D * .55, sz * D * .55, [D * .26, D * .22]);
        block(y0 + D * 1.01, D * 1.42, D * .14);
        small('ball', y0 + D * 1.08, 0, D * .72, [D * .16, D * .16]);
      } else if (order === 'romanesque') {
        piece('flare', y0 + D * .05, [D * 1.36, D * .55]);
        for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) small('ball', y0 + D * .5, sx * D * .5, sz * D * .5, [D * .3, D * .26]);
        block(y0 + D * .6, D * 1.46, D * .18);
      } else if (order === 'gothic') {
        piece('flare', y0 + D * .05, [D * 1.5, D * .6]);
        // Crockets curling under the corners of the abacus.
        for (let i = 0; i < 4; i++) { const a = (i + .5) / 4 * Math.PI * 2; small('ball', y0 + D * .56, Math.sin(a) * D * .62, Math.cos(a) * D * .62, [D * .28, D * .26], a); }
        piece('octagon', y0 + D * .65, [D * 1.62, D * .2]);
      }
    },
  };
}
// The block: a unit cube with its arrises cut at 45°, each face set back r from them. Each corner of the cube stands for three vertices,
// one at the corner of the flat part of each face it touches, with that face's normal; a chamfer runs between the
// vertices of two faces and its light turns from one face's to the other's, as on a rounded arris. 24 vertices
// and 44 triangles, wound outwards.
function chamferedBox(r) {
  const inner = .5 - r, signs = [-1, 1], position = [], normal = [], index = [], id = new Map();
  const corners = signs.flatMap(x => signs.flatMap(y => signs.map(z => [x, y, z])));
  for (const s of corners) for (let axis = 0; axis < 3; axis++) {
    id.set(`${s}|${axis}`, position.length / 3);
    position.push(...s.map((sign, i) => sign * (i === axis ? .5 : inner))); normal.push(...s.map((sign, i) => i === axis ? sign : 0));
  }
  const vertex = (signed, face) => { const s = [0, 0, 0]; for (const [i, sign] of signed) s[i] = sign; return id.get(`${s}|${face}`); };
  const at = i => position.slice(i * 3, i * 3 + 3);
  const fan = ring => { for (let i = 1; i < ring.length - 1; i++) {
    const [a, b, c] = [ring[0], ring[i], ring[i + 1]].map(at), u = b.map((x, n) => x - a[n]), v = c.map((x, n) => x - a[n]);
    const out = (u[1] * v[2] - u[2] * v[1]) * (a[0] + b[0] + c[0]) + (u[2] * v[0] - u[0] * v[2]) * (a[1] + b[1] + c[1]) + (u[0] * v[1] - u[1] * v[0]) * (a[2] + b[2] + c[2]);
    index.push(ring[0], ...(out > 0 ? [ring[i], ring[i + 1]] : [ring[i + 1], ring[i]]));
  } };
  for (let axis = 0; axis < 3; axis++) {
    const a = (axis + 1) % 3, b = (axis + 2) % 3;
    // The flat part of the two faces across this axis, then the chamfers along the four arrises parallel to it.
    for (const side of signs) fan([[-1, -1], [-1, 1], [1, 1], [1, -1]].map(([u, v]) => vertex([[axis, side], [a, u], [b, v]], axis)));
    for (const sa of signs) for (const sb of signs) fan([[-1, a], [1, a], [1, b], [-1, b]].map(([end, face]) => vertex([[axis, end], [a, sa], [b, sb]], face)));
  }
  for (const s of corners) fan([0, 1, 2].map(axis => id.get(`${s}|${axis}`)));
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new T.Float32BufferAttribute(normal, 3));
  geometry.setIndex(index);
  return geometry;
}
// Turned pieces: one geometry per shape, in the box's unit cube (diameter 1, height 1, centred).
const flat = geometry => { const g = geometry.toNonIndexed(); g.computeVertexNormals(); return g; };
export const SHAPES = {
  // A block with its arrises taken off. On a plain cube an arris is a jump of normals and it dies as a hard
  // black line: the stone reads as untextured plastic, and a monument of such blocks reads as unbuilt. The
  // chamfer gives that line something to catch the light on, and every piece of every monument gets it,
  // because they all share this one geometry — still one draw call. Every block of every pass (colour and shadow)
  // runs the vertex shader on each of its vertices, so the chamfer is cut with as few as a cube has: 24, where
  // three.js's rounded box, which cannot be told from it in the viewer, was a soup of 324.
  box: () => chamferedBox(.018),
  drum: adaptive(context => new T.CylinderGeometry(.5, .5, 1, context.radialSegments), {multiple: 2}),
  shaft: adaptive(context => profiledGeometry({...context, profile: [[0, 1], [.25, 1], [.55, .97], [1, .88]]}), {multiple: 2}),
  profiledShaft: adaptive(context => profiledGeometry(context), {multiple: 2}),
  flare: adaptive(context => profiledGeometry({...context, profile: [[0, .68], [.3, .73], [.7, .9], [1, 1]]}), {multiple: 2}),
  cone: adaptive(context => new T.CylinderGeometry(0, .5, 1, context.radialSegments), {multiple: 2}),
  torus: adaptive(context => { const tube = segmentsForChordError(context.diameter * .125, context.maxChordErrorMm, {min: 6, max: Math.max(12, Math.round(context.radialSegments / 3)), multiple: 2}); const g = new T.TorusGeometry(.375, .125, tube, context.radialSegments); g.rotateX(Math.PI / 2); g.scale(1, 4, 1); return g; }, {multiple: 2}),
  ball: adaptive(context => new T.SphereGeometry(.5, context.radialSegments, Math.max(6, Math.round(context.radialSegments / 2))), {multiple: 2}),
  bell: adaptive(context => profiledGeometry({...context, profile: [[0, 0], [.01, .98], [.04, 1], [.25, .72], [.6, .52], [.9, .34], [.99, 0]]}), {multiple: 2}),
  octagon: () => flat(new T.CylinderGeometry(.5, .5, 1, 8).rotateY(Math.PI / 8)),
  spike: () => flat(new T.CylinderGeometry(0, .5, 1, 8).rotateY(Math.PI / 8)),
};

// ——— Gothic churches: shared toolkit ———
// The Gothic bricks share one frame: u along the element's axis, v across it, y up, placed by `center` [x, z]
// and `rot` like the other bricks. Walls are coursed ashlar with their openings cut out; the glass sits inside
// the wall, so it shows only through the openings, behind stone tracery. Roofs are laid in strips, eave to
// ridge, so they grow during their phase; a roof with `until` burns or falls then, and `rebuild` lays it again.
function gothic(k, e, P) {
  const [cx, cz] = e.center ?? [0, 0], rot = e.rot ?? 0, co = Math.cos(rot), si = Math.sin(rot);
  const stone = e.color ?? '#d6c8a8', lead = e.lead ?? '#8e979f', glass = e.glass ?? '#34404f', phase = P(e.phase);
  const V = (u, y, v) => new T.Vector3(cx + u * co + v * si, y, cz - u * si + v * co);
  const tint = (hex, j = .06) => k.tint(hex, j);
  // A box at [u, v] and height y (its centre), its length along the frame direction [du, dv].
  const box = (kind, [u, v], y, [l, h, t], [du, dv], color, ph = phase, extra = {}) => {
    const p = V(u, y, v);
    k.box(kind, [p.x, p.y, p.z], [l, h, t], rot + Math.atan2(-dv, du), color, ph, p.y, extra);
  };
  const beam = (kind, a, b, thick, color, ph = phase, extra = {}) => k.beam(kind, V(...a), V(...b), thick, color, ph, extra);
  // Lifecycle of a part: built in its phase, gone at `until`, laid again at `rebuild`.
  const life = (spec, fn) => {
    fn(spec?.phase ? P(spec.phase) : phase, spec?.until ? {until: P(spec.until)} : {});
    if (spec?.rebuild) fn(P(spec.rebuild), {});
  };
  // Half-width of an opening at height y, or -1 outside it.
  // Pointed arches are equilateral unless `rise` (the apex's height above the springing) says otherwise.
  const radiusOf = (w, rise) => rise ? (w * w / 4 + rise * rise) / w : w;
  const span = (o, y) => {
    if (o.kind === 'circle') { const q = o.r * o.r - (y - o.y) ** 2; return q > 0 ? Math.sqrt(q) : -1; }
    if (y < o.sill) return -1;
    if (y <= o.spring) return o.w / 2;
    if (o.kind === 'rect') return -1;
    if (o.kind === 'round') { const q = (o.w / 2) ** 2 - (y - o.spring) ** 2; return q > 0 ? Math.sqrt(q) : -1; }
    const r = radiusOf(o.w, o.rise), q = r * r - (y - o.spring) ** 2; return q > 0 ? Math.sqrt(q) - (r - o.w / 2) : -1;
  };
  const top = o => o.kind === 'circle' ? o.y + o.r : o.kind === 'rect' ? o.spring : o.spring + (o.kind === 'round' ? o.w / 2 : o.rise ?? o.w * .866);

  // An arch outline (pointed, round or flat) as a chain of stones, centred at s on a wall seen through F.
  function arch(F, s, w, spring, off, thick, ph, extra, kind = 'pointed', segs = 4, rise) {
    const pts = [];
    if (kind === 'round') for (let i = 0; i <= 2 * segs; i++) { const a = Math.PI * (1 - i / (2 * segs)); pts.push([s + Math.cos(a) * w / 2, spring + Math.sin(a) * w / 2]); }
    else if (kind === 'rect') pts.push([s - w / 2, spring], [s + w / 2, spring]);
    else {
      // Two arcs of radius r, each centred on the springing line on the far side, meeting at the apex.
      const r = radiusOf(w, rise), end = Math.acos((w / 2 - r) / r);
      for (let i = 0; i <= segs; i++) { const a = Math.PI - (Math.PI - end) * i / segs; pts.push([s - w / 2 + r + r * Math.cos(a), spring + r * Math.sin(a)]); }
      for (let i = 1; i <= segs; i++) { const a = (Math.PI - end) * (1 - i / segs); pts.push([s + w / 2 - r + r * Math.cos(a), spring + r * Math.sin(a)]); }
    }
    for (let i = 0; i < pts.length - 1; i++) beam('stone', F(pts[i][0], pts[i][1], off), F(pts[i + 1][0], pts[i + 1][1], off), thick, tint(stone), ph, extra);
  }
  function ring(F, s, y, r, off, thick, n, ph, extra) {
    for (let i = 0; i < n; i++) {
      const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2;
      beam('stone', F(s + Math.cos(a0) * r, y + Math.sin(a0) * r, off), F(s + Math.cos(a1) * r, y + Math.sin(a1) * r, off), thick, tint(stone), ph, extra);
    }
  }
  // Glass and tracery of one opening. F(s, y, off) is a point on the wall, `off` towards the outside.
  function opening(F, o, t, ph, extra) {
    const W = o.kind === 'circle' ? 2 * o.r : o.w, y0 = o.kind === 'circle' ? o.y - o.r : o.sill, y1 = top(o), face = t / 2 + .08;
    const [a, b] = [F(o.s - 1, 0, 0), F(o.s + 1, 0, 0)], dir = [(b[0] - a[0]) / 2, (b[2] - a[2]) / 2];
    // An opening whose tracery is a photo relief (`photo`) keeps only its glass, set back in the wall: the
    // photo covers it outside, and from inside the window is glazed, not open to the sky.
    if (o.photo) {
      const cols = Math.max(1, Math.round(W / 1.4)), rows = Math.max(1, Math.round((y1 - y0) / 1.4)), pw = W / cols, ph2 = (y1 - y0) / rows;
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const p = F(o.s - W / 2 + (i + .5) * pw, 0, -t * .2);
        box('glass', [p[0], p[2]], y0 + (j + .5) * ph2, [pw, ph2, .1], dir, tint(o.colors ? o.colors[Math.floor(k.rand() * o.colors.length)] : glass, .2), ph, extra);
      }
      return;
    }
    if (o.door) {
      // The leaf stands to the springing of the arch, or to `doorHeight` (the crown, to fill a round head).
      const p = F(o.s, 0, t / 2 - .4), dh = o.doorHeight ?? o.spring ?? 4;
      box('wood', [p[0], p[2]], dh / 2, [W, dh, .25], dir, tint(o.door, .05), ph, extra);
    } else if (o.louvres) {
      for (let y = y0 + .4; y < y1 - .3; y += .75) {
        const hw = Math.max(.2, span(o, y + .1)), p = F(o.s, 0, 0);
        box('wood', [p[0], p[2]], y, [2 * hw, .12, t * .5], dir, tint(o.louvres, .06), ph, extra);
      }
    } else if (o.glass !== false) {
      const cols = Math.max(1, Math.round(W / 1.4)), rows = Math.max(1, Math.round((y1 - y0) / 1.9)), pw = W / cols, ph2 = (y1 - y0) / rows;
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const p = F(o.s - W / 2 + (i + .5) * pw, 0, 0);
        box('glass', [p[0], p[2]], y0 + (j + .5) * ph2, [pw, ph2, .1], dir, tint(o.colors ? o.colors[Math.floor(k.rand() * o.colors.length)] : glass, .2), ph, extra);
      }
    }
    if (o.kind === 'circle') {
      // A rose: frame on the face, two inner rings, spokes.
      ring(F, o.s, o.y, o.r + .25, face, .7, 32, ph, extra);
      ring(F, o.s, o.y, o.r * .66, 0, .32, 24, ph, extra);
      ring(F, o.s, o.y, o.r * .3, 0, .3, 14, ph, extra);
      const n = o.spokes ?? 16;
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        beam('stone', F(o.s + c * o.r * .3, o.y + s * o.r * .3, 0), F(o.s + c * o.r, o.y + s * o.r, 0), .26, tint(stone), ph, extra);
        if (i % 2 === 0) beam('stone', F(o.s + c * o.r * .08, o.y + s * o.r * .08, 0), F(o.s + c * o.r * .3, o.y + s * o.r * .3, 0), .22, tint(stone), ph, extra);
      }
      return;
    }
    // The arch frame on the face, its jambs, and the tracery: a mullion, two lancets and an oculus.
    arch(F, o.s, W + .35, o.spring, face, .45, ph, extra, o.kind);
    if (o.spring - y0 > .1) for (const side of [-1, 1]) beam('stone', F(o.s + side * (W / 2 + .1), y0, face), F(o.s + side * (W / 2 + .1), o.spring, face), .4, tint(stone), ph, extra);
    if (o.twin && W > 1.6) {
      beam('stone', F(o.s, y0, 0), F(o.s, o.spring + W * .18, 0), .3, tint(stone), ph, extra);
      for (const side of [-1, 1]) arch(F, o.s + side * W / 4, W / 2 - .12, o.spring, 0, .24, ph, extra, 'pointed', 3);
      if (o.oculus !== false && o.kind !== 'rect') ring(F, o.s, o.spring + W * .5, W * .19, 0, .22, 10, ph, extra);
    }
  }
  // Coursed ashlar from a to b ([u, v]) between y0 and y1, thickness t, `out` its outward normal ([u, v]),
  // with its openings cut out. An opening without `s` is centred and narrowed to fit the wall.
  function wall(a, b, y0, y1, t, out, openings = [], ph = phase, extra = {}, course = .8) {
    const du = b[0] - a[0], dv = b[1] - a[1], len = Math.hypot(du, dv);
    if (len < .3 || y1 - y0 < .2) return;
    const dir = [du / len, dv / len], at = s => [a[0] + dir[0] * s, a[1] + dir[1] * s];
    const F = (s, y, off) => [a[0] + dir[0] * s + out[0] * off, y, a[1] + dir[1] * s + out[1] * off];
    const holes = openings.filter(Boolean).map(o => {
      if (o.kind === 'circle') return {...o, s: o.s ?? len / 2};
      const w = Math.min(o.width ?? o.w ?? 2, len - (o.margin ?? 1.4));
      return w > .7 ? {...o, w, s: o.s ?? len / 2} : null;
    }).filter(Boolean);
    for (let y = y0, row = 0; y < y1 - .05; row++) {
      const h = Math.min(course * (.85 + .3 * k.rand()), y1 - y), ym = y + h / 2;
      let spans = [[0, len]];
      for (const o of holes) {
        const hw = span(o, ym);
        if (hw > 0) spans = spans.flatMap(([p, q]) => [[p, Math.min(q, o.s - hw)], [Math.max(p, o.s + hw), q]]).filter(([p, q]) => q - p > .06);
      }
      for (const [p, q] of spans) for (let s = p - (row % 2) * .6; s < q - .05;) {
        const l = 1.1 + .7 * k.rand(), from = Math.max(p, s), to = Math.min(q, s + l);
        if (to - from > .06) box('stone', at((from + to) / 2), ym, [to - from - .03, h * .95, t], dir, tint(stone), ph, extra);
        s += l;
      }
      y += h;
    }
    for (const o of holes) opening(F, o, t, ph, extra);
  }
  // A triangular gable on a wall line from a to b, base at y0, apex at y1, with an optional oculus.
  function gable(a, b, y0, y1, t, out, ph = phase, extra = {}, oculus) {
    const du = b[0] - a[0], dv = b[1] - a[1], len = Math.hypot(du, dv), dir = [du / len, dv / len];
    const F = (s, y, off) => [a[0] + dir[0] * s + out[0] * off, y, a[1] + dir[1] * s + out[1] * off], H = y1 - y0;
    for (let y = y0, row = 0; y < y1 - .3; row++) {
      const h = Math.min(.8, y1 - y), hw = len / 2 * (1 - (y + h / 2 - y0) / H), c = len / 2;
      let spans = [[c - hw, c + hw]];
      if (oculus) { const q = oculus.r ** 2 - (y + h / 2 - oculus.y) ** 2; if (q > 0) { const w = Math.sqrt(q); spans = [[c - hw, c - w], [c + w, c + hw]].filter(([p, q2]) => q2 - p > .06); } }
      for (const [p, q] of spans) for (let s = p - (row % 2) * .5; s < q - .05;) {
        const l = 1.2 + .6 * k.rand(), from = Math.max(p, s), to = Math.min(q, s + l), m = F((from + to) / 2, 0, 0);
        if (to - from > .06) box('stone', [m[0], m[2]], y + h / 2, [to - from - .03, h * .95, t], dir, tint(stone), ph, extra);
        s += l;
      }
      y += h;
    }
    if (oculus) opening(F, {kind: 'circle', s: len / 2, y: oculus.y, r: oculus.r, spokes: 8}, t, ph, extra);
    // Coping along the rakes, crockets, and a finial.
    for (const side of [0, len]) {
      beam('stone', F(side, y0, t / 2), F(len / 2, y1 + .3, t / 2), .55, tint(stone), ph, extra);
      for (let f = .12; f < .95; f += .14) { const p = F(side + (len / 2 - side) * f, 0, t / 2 + .25); box('stone', [p[0], p[2]], y0 + H * f + .45, [.35, .45, .35], dir, tint(stone), ph, extra); }
    }
    const p = F(len / 2, 0, t / 2);
    box('stone', [p[0], p[2]], y1 + 1, [.5, 1.6, .5], dir, tint(stone), ph, extra);
    box('stone', [p[0], p[2]], y1 + 1.6, [1.2, .3, .3], dir, tint(stone), ph, extra);
  }
  // A pinnacle: a square shaft with a gablet on each face, an octagonal spire with crockets up its arrises and
  // a finial, centred on [u, v].
  function pinnacle(c, y0, h, w, ph = phase, extra = {}) {
    const [x, , z] = V(c[0], 0, c[1]).toArray(), at = y => [x, y, z];
    box('stone', c, y0 + h * .17, [w, h * .34, w], [1, 0], tint(stone), ph, extra);
    k.turned('octagon', 'stone', at(y0 + h * .36), [w * 1.08, h * .04], rot, tint(stone), ph, y0, extra);
    k.turned('spike', 'stone', at(y0 + h * .38 + h * .28), [w * .92, h * .56], rot, tint(stone), ph, y0 + h * .4, extra);
    for (let i = 1; i < 4; i++) for (let j = 0; j < 4; j++) {
      const f = i / 4, a = rot + (j + .5) * Math.PI / 2, r = w * .46 * (1 - f) + .06, y = y0 + h * (.38 + f * .56);
      k.turned('ball', 'stone', [x + Math.cos(a) * r, y, z - Math.sin(a) * r], [Math.max(.14, w * .16), Math.max(.16, w * .2)], a, tint(stone), ph, y, extra);
    }
    k.turned('ball', 'stone', at(y0 + h * .97), [Math.max(.22, w * .28), Math.max(.3, h * .07)], rot, tint(stone), ph, y0 + h, extra);
  }
  // A strip roof over the quad: eave edge e0–e1 at ye up to the ridge edge r0–r1 at yr (r0 = r1 for a cone).
  function panel(A, B, C, D, color, ph, extra, kind = 'lead', strip = 1.25, lift = .12) {
    const ea = A.clone().lerp(B, .5), ra = C.clone().lerp(D, .5), slope = ea.distanceTo(ra), n = Math.max(1, Math.round(slope / strip));
    for (let j = 0; j < n; j++) {
      const t = (j + .5) / n, L = A.clone().lerp(C, t), R = B.clone().lerp(D, t), len = L.distanceTo(R);
      if (len < .12) continue;
      const tg = R.clone().sub(L).normalize(), sd = ra.clone().sub(ea).normalize(), nrm = new T.Vector3().crossVectors(sd, tg);
      if (nrm.y < 0) { tg.negate(); nrm.crossVectors(sd, tg); }
      nrm.normalize();
      const z = new T.Vector3().crossVectors(tg, nrm).normalize();
      k.oriented(kind, L.clone().lerp(R, .5).addScaledVector(nrm, lift), tg, nrm, z, [len * 1.02 + .1, .24, slope / n * 1.12], tint(color, .05), ph, L.y, extra);
    }
  }
  const quad = (e0, e1, ye, r0, r1, yr, color, ph, extra, kind) => panel(V(e0[0], ye, e0[1]), V(e1[0], ye, e1[1]), V(r0[0], yr, r0[1]), V(r1[0], yr, r1[1]), color, ph, extra, kind);
  // A stone balustrade along a line.
  function rail(a, b, y, ph = phase, extra = {}) {
    beam('stone', [a[0], y + 1, a[1]], [b[0], y + 1, b[1]], .26, tint(stone), ph, extra);
    beam('stone', [a[0], y + .15, a[1]], [b[0], y + .15, b[1]], .3, tint(stone), ph, extra);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(len / 1.4));
    for (let i = 0; i <= n; i++) { const f = i / n, u = a[0] + (b[0] - a[0]) * f, v = a[1] + (b[1] - a[1]) * f; box('stone', [u, v], y + .55, [.2, .8, .2], [b[0] - a[0], b[1] - a[1]], tint(stone), ph, extra); }
  }
  // A carved figure on a console, facing `out`: a robe falling in folds to the feet, shoulders and a head.
  function statue([u, v], y, h, out, color, ph = phase, extra = {}) {
    const dir = [-out[1], out[0]], yaw = rot + Math.atan2(-dir[1], dir[0]), c = () => tint(color, .08);
    const at = (yy, f = 0) => V(u + out[0] * f, yy, v + out[1] * f).toArray();
    k.turned('octagon', 'stone', at(y + .15), [h * .34, .3, h * .3], yaw, tint(stone), ph, y, extra);
    k.turned('shaft', 'stone', at(y + .3 + h * .37), [h * .27, h * .74, h * .2], yaw, c(), ph, y + .3, extra);
    k.turned('ball', 'stone', at(y + .3 + h * .72), [h * .3, h * .12, h * .2], yaw, c(), ph, y + .3, extra);
    k.turned('ball', 'stone', at(y + .3 + h * .86, h * .02), [h * .12, h * .17, h * .13], yaw, c(), ph, y + .3, extra);
  }
  // A round column (or a colonnette) at [u, v] standing at y, `h` to the top of its capital (k.column).
  function column([u, v], y, h, d, ph = phase, extra = {}, order = 'gothic', drum = 0, out = [-1, 0]) {
    const p = V(u, y, v), o = V(out[0], 0, out[1]).sub(V(0, 0, 0));
    k.column('stone', [p.x, y, p.z], {height: h, diameter: d, order, drum, taper: drum ? 0 : .04, out: [o.x, o.z]}, stone, ph, extra);
  }
  const toolkit = {V, P, phase, stone, lead, glass, tint, box, beam, life, span, top, radiusOf, arch, ring, opening, wall, gable, pinnacle, panel, quad, rail, statue, column};
  // A monument that asks for `masonry: "mesh"` gets its walls and gables as continuous surfaces cut by the true
  // outline of their openings (kit/masonry.js), not as courses of boxes. The toolkit is the same either way.
  if (k.masonry === 'mesh') {
    const frame = {point: ([u, y, v]) => V(u, y, v).toArray(), vector: ([a, y, b]) => [a * co + b * si, y, -a * si + b * co]};
    const M = masonry({k, frame, rand: k.rand, tol: k.tolerance, tint, stone, glass, phase, V, rot, span, top, box, opening: (...args) => toolkit.opening(...args), jointCourse: e.jointCourse});
    Object.assign(toolkit, {wall: M.wall, gable: M.gable, arch: M.arch, ring: M.ring, opening: M.opening, panel: M.panel, quad: M.quad, rail: M.rail, pinnacle: M.pinnacle, mesh: M});
  }
  return toolkit;
}
export {gothic};

// ——— Generators (bricks) ———
export const generators = {
  // Declarative architectural column: one measured profile drives every LOD. `profile` stations are
  // [height fraction, diameter ratio]; flute count and rendering tolerance do not alter its dimensions.
  profiledColumn(k, e, P) {
    const positions = e.positions ?? [e.center ?? [0, 0]], shaft = e.shaft ?? {}, rot = e.rot ?? 0;
    const out = e.out ?? [Math.sin(rot), Math.cos(rot)], drum = e.drumHeight ?? 0;
    for (const [x, z] of positions) k.column(e.kind ?? 'stone', [x, e.y0 ?? 0, z], {
      height: e.height,
      diameter: e.diameter,
      order: e.order ?? 'doric',
      drum,
      drums: e.drums,
      taper: e.taper ?? .12,
      out,
      profile: shaft.profile ?? e.profile,
      flutes: shaft.flutes ?? e.flutes ?? 0,
      rendering: e.rendering ?? {},
    }, e.color ?? '#d6c8a8', P(e.phase), e.extra ?? {});
  },

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
    // A filled top: the earth platform the base retains, a flat slab level with the topmost course.
    if(e.deck){const t=e.deck.thickness??.6;k.box('stone',[cx,height-t/2,cz],[tw-.3,t,td-.3],rot,k.tint(e.deck.color??'#8f8878',.03),P(e.phase),height*1e4);}
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
    const box = (a, r, y, size, hex, ph, extra) => { const p = pos(a, r, y); k.box('stone', [p.x, p.y, p.z], size, a, k.tint(hex, .035), ph, p.y, extra); };
    // The marble's own variety (`marble`): most blocks white to light grey, a share of them (`share`) veined
    // grey towards `grey`, as the grey-veined blocks of San Giuliano marble are. Without it, every block is
    // the colour given, within a few percent.
    const marble = e.marble, vein = new T.Color(marble?.grey ?? '#9b9d98');
    const veined = hex => { if (!marble) return hex; const f = k.rand() < (marble.share ?? .3) ? .35 + .55 * k.rand() : .28 * k.rand(); return new T.Color(hex).lerp(vein, f); };
    // A ring of tangent blocks: a cylindrical wall, band or cornice. A wall is laid in courses (`course`
    // metres high, 0.62 by default) with the joints staggered from one course to the next, as the marble is.
    // The blocks meet at the face with a fine joint (`joint` metres, 0.012 by default) where the core of the
    // wall shows 3 cm back, a little darker (`jointTint`), so the courses read without a dark grid. Options:
    // `veins` (each block takes the marble's variety), `bands` (a thin course of grey stone `height` metres
    // high at the top of every `every`th course, `color`), `shelter` (a piece in the shade of a gallery: see
    // material() in createStage).
    const joint = e.joint ?? .012, jointTint = e.jointTint ?? .8;
    const ring = (r, y, h, t, hex, ph, step = .85, {veins = false, bands, shelter} = {}) => {
      const course = e.course ?? .62, rows = h > course * 1.6 ? Math.round(h / course) : 1, rh = h / rows, n = Math.max(24, Math.round(2 * Math.PI * r / (rows > 1 ? Math.max(step, 1.35) : step)));
      const half = Math.tan(Math.PI / n), face = r + t / 2, gap = rows > 1 ? joint : 0, extra = shelter ? {shelter} : undefined;
      const lay = (j, yc, hc, tone) => { for (let i = 0; i < n; i++) box((i + .5 + (j % 2) * .5) / n * 2 * Math.PI, r, yc, [2 * face * half - joint, hc - gap, t], tone(), ph, extra); };
      for (let j = 0; j < rows; j++) {
        const band = rows > 1 && bands && j % bands.every === bands.every - 1 ? Math.min(bands.height ?? .14, rh / 2) : 0, y1 = y + rh * j;
        if (band) lay(j, y1 + rh - band / 2, band, () => bands.color ?? '#81847f');
        lay(j, y1 + (rh - band) / 2, rh - band, () => veins ? veined(hex) : hex);
      }
      if (rows > 1) { const back = .03, mortar = new T.Color(hex).multiplyScalar(jointTint); for (let i = 0; i < n; i++) box((i + .5) / n * 2 * Math.PI, r - back / 2, y + h / 2, [2 * (face - back) * half * 1.002, h - joint, t - back], mortar, ph, extra); }
    };
    // A round arch between two columns, laid voussoir by voussoir in the tangent plane (every other one in
    // `alt`, for an arch of two marbles).
    const arch = (a0, a1, r, spring, depth, hex, ph, alt) => {
      const am = (a0 + a1) / 2, ra = r * Math.sin((a1 - a0) / 2), mid = pos(am, r * Math.cos((a1 - a0) / 2), spring), tan = new T.Vector3(Math.cos(am), 0, -Math.sin(am)), rad = new T.Vector3(Math.sin(am), 0, Math.cos(am));
      for (let j = 0; j < 7; j++) {
        const th = Math.PI * (j + .5) / 7, p = mid.clone().addScaledVector(tan, -ra * Math.cos(th)).addScaledVector(up, ra * Math.sin(th));
        const x = tan.clone().multiplyScalar(Math.sin(th)).addScaledVector(up, Math.cos(th)).normalize(), z = new T.Vector3().crossVectors(x, rad).normalize();
        k.oriented('stone', p, x, rad, z, [Math.PI * ra / 7 * 1.08, depth, .32], k.tint(alt && j % 2 ? alt : hex, .035), ph, p.y);
      }
      return ra;
    };
    // The spandrel between two arches over the column at angle a, stepped to follow both arches' backs, so that
    // each opening keeps its full semicircle; the band above starts at the crowns.
    const spandrel = (a, r, spring, ra, depth, hex, ph) => {
      const ext = ra + .16;
      for (let h0 = .5 * ra; h0 < ext - .02;) {
        const h1 = Math.min(ext, h0 + Math.max(.1, (ext - h0) / 2)), w = 2 * (ra - Math.sqrt(Math.max(0, ext * ext - h0 * h0)));
        if (w > .06) box(a, r, spring + (h0 + h1) / 2, [w, h1 - h0, depth], hex, ph);
        h0 = h1;
      }
    };
    // Round columns: monolithic marble shafts with attic bases and leafy capitals (`order`, corinthian by default),
    // each of its own marble.
    const column = (a, r, y, h, d, hex, ph) => { const p = pos(a, r, y); k.column('stone', [p.x, y, p.z], {height: h, diameter: d, order: e.order ?? 'corinthian', drum: 0, taper: .1, out: [Math.sin(a), Math.cos(a)]}, veined(hex), ph); };
    // A lozenge set flat in the wall: a white frame round an inlay of darker marble and a small boss.
    const lozenge = (a, r, yc, side, ph) => {
      const tan = new T.Vector3(Math.cos(a), 0, -Math.sin(a)), rad = new T.Vector3(Math.sin(a), 0, Math.cos(a));
      const x = tan.clone().add(up).normalize(), z = new T.Vector3().crossVectors(x, rad).normalize();
      for (const [f, out, hex] of [[1, 0, color], [.74, .05, e.inlay ?? '#a39d90'], [.5, .08, e.inlayDark ?? '#7d8580'], [.2, .12, color]]) k.oriented('stone', pos(a, r + out, yc), x, rad, z, [side * f, .12, side * f], k.tint(hex, .03), ph, yc);
    };
    let y = y0;
    // The plinth's steps round the foot (`base`: [[outwards, height], …] from the wall out).
    let inner = R + .8;
    for (const [out, h] of e.base ?? []) { const outer = R + out; ring((inner + outer) / 2, y0 - .02, h, outer - inner, shade, P(e.phase), .9); inner = outer; }
    for (const s of e.storeys) {
      const ph = P(s.phase ?? e.phase), h = s.height;
      if (s.kind === 'blind') {
        ring(R + .35, y, .7, .9, shade, ph);
        // The wall in veined courses, with thin grey bands (`bands`: {every, height, color}).
        ring(R - .6, y + .7, h - 1.15, 1.2, color, ph, .85, {veins: true, bands: s.bands});
        const n = s.arches, spring = y + h * .78;
        for (let i = 0; i < n; i++) {
          const a = i / n * 2 * Math.PI;
          column(a, R + .12, y + .7, spring - y - .7, .55, color, ph);
          arch(a, (i + 1) / n * 2 * Math.PI, R + .08, spring, .4, color, ph);
          // In each blind arch, a lozenge under its crown (`lozenges`: false to leave them out).
          if (s.lozenges !== false) lozenge((i + .5) / n * 2 * Math.PI, R + .02, spring + .2, Math.min(1.5, (R + .08) * Math.sin(Math.PI / n) * .85), ph);
        }
        // The door (`door`: {angle, width, height}; angle in degrees, 0 = south, 90 = east), in the nearest bay.
        if (s.door) {
          const a = (Math.round((s.door.angle ?? 0) / 360 * n - .5) + .5) / n * 2 * Math.PI, w = s.door.width ?? 1.6, dh = s.door.height ?? 3.4;
          box(a, R + .02, y + .7 + dh / 2, [w, dh, .2], s.door.color ?? '#4a3b2f', ph);
          for (const side of [-1, 1]) { const q = pos(a, R + .1, 0), t2 = new T.Vector3(Math.cos(a), 0, -Math.sin(a)).multiplyScalar(side * (w / 2 + .14)); k.box('stone', [q.x + t2.x, y + .7 + dh / 2, q.z + t2.z], [.26, dh, .3], a, k.tint(color, .03), ph, y); }
          box(a, R + .12, y + .7 + dh + .2, [w + .6, .4, .32], color, ph);
        }
        ring(R - .45, y + h - .4, .4, 1.3, color, ph);
      } else if (s.kind === 'loggia') {
        // The gallery's back wall is darker: it stands in the shade of the floor above, as on photos, and takes
        // no light that the sun's shadow cannot stop (`shelter`).
        const rc = R - .25, n = s.columns, top = y + h - .4, ra = rc * Math.sin(Math.PI / n), spring = top - ra - .5, back = s.core ?? R - 1.9;
        ring(back, y, h, .9, core, ph, 1.1, {veins: true, shelter: 1});
        for (let i = 0; i < n; i++) {
          const a = i / n * 2 * Math.PI;
          column(a, rc, y, spring - y, .34, color, ph);
          spandrel(a, rc, spring, ra, .32, color, ph);
          arch(a, (i + 1) / n * 2 * Math.PI, rc, spring, .34, color, ph);
        }
        ring(rc - .02, spring + ra + .16, top - spring - ra - .16, .3, color, ph);
        ring((R + .1 + back) / 2, top, .4, R + .1 - back, color, ph);
        // The corbels carrying the gallery's cornice, close set under its projecting edge.
        const corbels = Math.round(2 * Math.PI * R / .7);
        for (let i = 0; i < corbels; i++) box((i + .5) / corbels * 2 * Math.PI, R - .08, top - .14, [.18, .28, .34], color, ph);
      } else if (s.kind === 'belfry') {
        // The bell chamber: open arches between piers faced with engaged columns, the bells hanging inside
        // (`bells`: their count), a dim core behind; arches of white and grey voussoirs (`voussoirs`: the grey).
        const rb = s.radius ?? R * .7, n = s.arches, top = y + h - .5, ra = rb * Math.sin(Math.PI / n), spring = top - ra - .45;
        ring(rb - 1.6, y, h - .5, .45, dark, ph, 1.1, {shelter: 1});
        ring(rb, y, .5, .9, color, ph);
        for (let i = 0; i < n; i++) {
          const a = i / n * 2 * Math.PI;
          box(a, rb, y + (spring - y) / 2, [2 * Math.PI * rb / n * .32, spring - y, .8], color, ph);
          column(a, rb + .45, y + .5, spring - y - .5, .32, color, ph);
          spandrel(a, rb, spring, ra, .7, color, ph);
          arch(a, (i + 1) / n * 2 * Math.PI, rb, spring, .7, color, ph, s.voussoirs);
        }
        for (let i = 0; i < (s.bells ?? 0); i++) {
          const a = (Math.floor(i * n / s.bells) + .5) / n * 2 * Math.PI, d = 1.5 - .7 * (i % 3) / 2, q = pos(a, rb - .75, spring - d * .6);
          k.turned('bell', 'metal', [q.x, q.y, q.z], [d, d * 1.05], a, k.tint(e.bronze ?? '#7c6a43', .06), ph, spring);
          k.box('wood', [q.x, spring - .05, q.z], [.25, .25, 1.4], a, k.tint('#5a4632', .05), ph, spring);
        }
        ring(rb, spring + ra + .16, top - spring - ra - .16, .7, color, ph);
        ring(rb + .2, top, .5, 1.1, color, ph);
        ring(rb - .2, top + .5, .6, .35, color, ph);
      }
      y += h;
    }
    // Iron railings round the terraces (`railings`: {phase, rings: [[radius, height], …], color}).
    for (const [r, yr] of e.railings?.rings ?? []) {
      const ph = P(e.railings.phase ?? e.phase), hex = e.railings.color ?? '#3f4144', n = Math.max(12, Math.round(2 * Math.PI * r / 1.1));
      for (let i = 0; i < n; i++) {
        const a = i / n * 2 * Math.PI, q = pos(a, r, yr + .55);
        k.box('metal', [q.x, q.y, q.z], [.05, 1.1, .05], a, k.tint(hex, .03), ph, yr + 100);
        for (const dy of [.5, 1.08]) { const m = pos(a + Math.PI / n, r, yr + dy); k.box('metal', [m.x, m.y, m.z], [2 * Math.PI * r / n * 1.02, .04, .04], a + Math.PI / n, k.tint(hex, .03), ph, yr + 100); }
      }
    }
    // The flag on top (`flag`): a pole standing on the top of the last storey's core (0.5 m under its top),
    // at `at` [x, z] from the axis, `height` metres high, and a cloth of `size` [length, height] flying from it
    // towards `toward` [x, z] with a slight wave, in `color` with a white cross (`crossColor`) whose arms end in
    // knobs, as Pisa's. Neither counts in the tower's height.
    if (e.flag) {
      const f = e.flag, ph = P(f.phase ?? e.phase), [fx, fz] = f.at ?? [0, 0], H = f.height ?? 5, [L, FH] = f.size ?? [2.1, 1.4], foot = y - .5, px = cx + fx, pz = cz + fz;
      k.turned('drum', 'metal', [px, foot + H / 2, pz], [.1, H], 0, k.tint(f.pole ?? '#6b6e70', .02), ph, foot + 100, {ornament: true});
      k.turned('ball', 'metal', [px, foot + H + .06, pz], [.18, .18], 0, k.tint(f.pole ?? '#6b6e70', .02), ph, foot + 100, {ornament: true});
      const [tx, tz] = f.toward ?? [-1, 0], dl = Math.hypot(tx, tz) || 1, dx = tx / dl, dz = tz / dl, cols = 15, rows = 11, wave = f.wave ?? .16;
      const cross = (i, j) => { const di = Math.abs(i - (cols - 1) / 2), dj = Math.abs(j - (rows - 1) / 2); return di === 0 && dj <= 3 || dj === 0 && di <= 3 || di === 1 && dj === 2 || dj === 1 && di === 2; };
      for (let i = 0; i < cols; i++) {
        const u = (i + .5) / cols, side = wave * u * Math.sin(2.4 * Math.PI * u), slope = wave * (Math.sin(2.4 * Math.PI * u) + 2.4 * Math.PI * u * Math.cos(2.4 * Math.PI * u)) / L;
        const ax = dx - dz * slope, az = dz + dx * slope, x = px + dx * (u * L + .06) - dz * side, z = pz + dz * (u * L + .06) + dx * side;
        for (let j = 0; j < rows; j++) k.box('cloth', [x, foot + H - .12 - (j + .5) / rows * FH - .08 * u * u, z], [L / cols * 1.08, FH / rows * 1.02, .03], Math.atan2(-az, ax), k.tint(cross(i, j) ? f.crossColor ?? '#f3f1ec' : f.color ?? '#c41e2f', .03), ph, foot + 100, {ornament: true});
      }
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
    // `start`: the angle (degrees) of the first pier, so that the axial entrances fall where they are.
    const step = 2 * Math.PI / bays, start = (e.start ?? 0) * Math.PI / 180;
    if (part === 'facade') {
      // One ring of the facade, storey by storey, in coursed stone: piers and round arches with their imposts,
      // engaged half-columns with bases and capitals (pilasters on an attic), an entablature and a projecting
      // cornice; on an attic, windows in alternate bays and the corbels of the awning masts; a brick storey
      // with windows; vaults over the ring's gallery (`vaults`: the radii of the wall it spans to), the stubs
      // of lost vaults (`stubs`), and the pits left by the iron clamps (`pits`).
      const radii = e.radii, T2 = e.thick ?? 2.4, course = e.course ?? .72, worn = e.worn ?? .18, pits = e.pits ?? 0;
      const stone = (hex, j = .07) => { const c = k.tint(hex, j); return k.rand() < worn ? c.multiplyScalar(.8 + .1 * k.rand()) : c; };
      const block = (p, y, size, t, hex) => { const w = world(p.x, y, p.z); k.box('stone', [w.x, w.y, w.z], size, yaw(t), stone(hex), ph, w.y); };
      const ringPoint = (th, out = 0) => { const q = ell(th, radii); return q.p.clone().addScaledVector(q.n, out); };
      let y = e.y0 ?? 0;
      for (const s of e.storeys) {
        const H = s.height, E = s.kind === 'brick' ? 0 : s.entablature ?? Math.min(2.2, H * .17), wallHex = s.kind === 'brick' ? brick : color;
        for (let i = 0; i < bays; i++) {
          const th = start + i * step; if (!inArc(th) || !inArc(th + step)) continue;
          const a = ell(th, radii), b = ell(th + step, radii), m = ell(th + step / 2, radii), bay = a.p.distanceTo(b.p), t = b.p.clone().sub(a.p).normalize();
          const at = (u, out = 0) => m.p.clone().addScaledVector(t, u).addScaledVector(m.n, out);
          const O = s.kind === 'brick' || s.kind === 'attic' ? 0 : bay * (s.open ?? .62), spring = y + (s.arch ?? H * .62) - O / 2;
          const win = s.kind === 'attic' || s.kind === 'brick' ? (i % (s.every ?? 2) === 0 ? {w: s.window?.[0] ?? 1.6, h: s.window?.[1] ?? 2.2, y: y + (s.windowAt ?? H * .45)} : null) : null;
          // The wall of the bay, course by course, cut round its arch or its window.
          for (let yc = y, row = 0; yc < y + H - E - .05; row++) {
            const h = Math.min(course, y + H - E - yc), ym = yc + h / 2;
            let hw = -1;
            if (O && ym > y + (s.sill ?? 0)) hw = ym < spring ? O / 2 : (O / 2) ** 2 - (ym - spring) ** 2 > 0 ? Math.sqrt((O / 2) ** 2 - (ym - spring) ** 2) : -1;
            if (win && ym > win.y - win.h / 2 && ym < win.y + win.h / 2) hw = win.w / 2;
            const spans = hw > 0 ? [[-bay / 2, -hw], [hw, bay / 2]] : [[-bay / 2, bay / 2]];
            for (const [u0, u1] of spans) {
              // Long courses split into two or three blocks, joints staggered.
              const n = Math.max(1, Math.round((u1 - u0) / 1.6)), w = (u1 - u0) / n, shift = row % 2 ? w / 2 : 0;
              for (let j = 0; j < n + (shift ? 1 : 0); j++) {
                const v0 = Math.max(u0, u0 + j * w - shift), v1 = Math.min(u1, u0 + (j + 1) * w - shift);
                if (v1 - v0 > .08) block(at((v0 + v1) / 2), ym, [v1 - v0 - .03, h * .95, T2], t, wallHex);
              }
            }
            yc += h;
          }
          if (O) {
            arch(at(-O / 2 - .05), at(O / 2 + .05), spring, T2 + .1, color);
            for (const side of [-1, 1]) block(at(side * (O / 2 + .25), T2 / 2 + .08), spring - .2, [.7, .4, .35], t, color);
          }
          if (win) {
            block(at(0, T2 / 2 - .3), win.y + win.h / 2 + .2, [win.w + .5, .4, .7], t, wallHex);
            block(at(0, T2 / 2 - .3), win.y - win.h / 2 - .15, [win.w + .5, .3, .8], t, wallHex);
          }
          // Orders between the arches: engaged half-columns, round and tapering, carved in the facade's own courses
          // (`order`: tuscan, ionic, corinthian…; `diameter`), on a pedestal where the storey has a parapet;
          // flat pilasters on an attic, as the Colosseum's are.
          const p = ringPoint(th, 0), n = a.n;
          if (s.column) {
            const D = s.diameter ?? .95, sill = s.sill ?? 0, q = p.clone().addScaledVector(n, T2 / 2 + D * .06), wq = world(q.x, y, q.z), out = turn(n);
            if (sill) { const qp = p.clone().addScaledVector(n, T2 / 2 + D * .2), wp = world(qp.x, y + sill / 2, qp.z); k.box('stone', [wp.x, wp.y, wp.z], [D * 1.5, sill, D * .9], yaw(a.t), stone(color, .05), ph, wp.y); }
            k.column('stone', [wq.x, y + sill, wq.z], {height: H - E - sill, diameter: D, order: s.order ?? 'tuscan', drum: course, out: [out.x, out.z]}, color, ph);
          } else if (s.kind === 'attic') {
            const col = (yy, hh, w2, d2) => { const q = p.clone().addScaledVector(n, T2 / 2 + d2 / 2 - .1), wq = world(q.x, yy, q.z); k.box('stone', [wq.x, wq.y, wq.z], [w2, hh, d2], yaw(a.t), stone(color, .05), ph, wq.y); };
            const shaft = H - E - 1.6;
            col(y + .2, .4, 1.15, .65);
            for (let yc = y + .4; yc < y + .4 + shaft - .05; yc += course) { const hh = Math.min(course, y + .4 + shaft - yc); col(yc + hh / 2, hh * .97, .8, .35); }
            // A Corinthian pilaster capital: a flaring block of leaves under the abacus.
            col(y + .4 + shaft + .3, .6, .95, .45); col(y + .4 + shaft + .75, .3, 1.15, .6);
          }
          // Entablature in three bands (architrave, frieze, projecting cornice); on an attic, three corbels per
          // bay for the awning masts.
          if (E) {
            const y1 = y + H - E;
            block(at(0, .3), y1 + E * .18, [bay * 1.01, E * .34, T2 + .6], t, color);
            block(at(0, .15), y1 + E * .5, [bay * 1.01, E * .3, T2 + .3], t, color);
            block(at(0, .5), y1 + E * .74, [bay * 1.03, E * .18, T2 + 1], t, color);
            block(at(0, .75), y1 + E * .91, [bay * 1.04, E * .18, T2 + 1.5], t, color);
          }
          if (s.kind === 'attic') for (const f of [-1 / 3, 0, 1 / 3]) block(at(f * bay, T2 / 2 + .45), y + H - E - 1.4, [.55, .75, .9], t, color);
          // Pits where the iron clamps were hacked out of the joints.
          for (let j = 0; j < pits; j++) { const u = (k.rand() - .5) * bay, yy = y + k.rand() * (H - E); if (O && Math.abs(u) < O / 2 + .1 && yy < spring + O / 2) continue; block(at(u, T2 / 2 + .02), yy, [.22, .2, .08], t, '#4f473e'); }
          // The stubs of the gallery vaults that once leaned on this wall.
          if (e.stubs) block(ringPoint(th, T2 / 2 + .6), y + H - .9, [1.1, .9, 1.3], a.t, color);
          // The vault over the gallery behind this storey.
          if (e.vaults && s.kind !== 'attic' && s.kind !== 'brick') {
            const inner = ell(th + step / 2, e.vaults), from = m.p.clone().addScaledVector(m.n, -T2 / 2), to = inner.p, d = from.distanceTo(to);
            if (d > 1) { const c2 = from.clone().lerp(to, .5), wq = world(c2.x, y + H - .45, c2.z); k.box('stone', [wq.x, wq.y, wq.z], [bay * (1 - .1 * d / Math.max(radii[0], 1)), .9, d], yaw(m.t), stone(e.vaultColor ?? color), ph, wq.y); }
          }
        }
        y += H;
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
        const th = start + i * step; if (!inArc(th)) continue;
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

  // A photograph of carved work laid on a face of the monument: a tympanum, a gallery of statues, a frieze,
  // whatever is too fine to build piece by piece. The photo is rectified in the viewer from four points
  // (`corners`, in the image file's pixels: top left, top right, bottom right, bottom left of the carved
  // panel), cut to its outline (`shape`: rect, round or pointed, with `spring` in metres above its foot),
  // given its depth back (its light and shade read as relief, `depth` metres) and toned to the stone around
  // it (`tone`, a colour; the element's `color` by default). It is placed like the other bricks: `center`,
  // `rot`, then `at` [u, y, v] (the panel's centre), `size` [width, height] and `facing` [u, v] (outwards).
  // `image` is a path next to the monument file; `credit` names the photo's file page, author and licence.
  // It has a phase like any piece, and `until`/`rebuild` like a Gothic part.
  // Without `at`, it is a photo that bricks lay themselves, wherever they build the detail it shows: a dormer whose
  // `relief` names it carries it on its front, foot to foot (see `k.lay`). `outline` (image pixels, a polygon) cuts the
  // panel to the carving's own edge, so that a crest of ornaments stands against what is behind it, not on a rectangle.
  relief(k, e, P) {
    if (!e.at) return;
    const [cx, cz] = e.center ?? [0, 0], rot = e.rot ?? 0, co = Math.cos(rot), si = Math.sin(rot), [u, y, v] = e.at, [fu, fv] = e.facing ?? [-1, 0];
    const position = new T.Vector3(cx + u * co + v * si, y, cz - u * si + v * co), normal = new T.Vector3(fu * co + fv * si, 0, -fu * si + fv * co).normalize();
    const record = phase => ({phase, position: position.clone().addScaledVector(normal, e.offset ?? .04), yaw: Math.atan2(normal.x, normal.z), spec: e});
    k.flats.push({...record(P(e.phase)), until: e.until ? P(e.until) : undefined});
    if (e.rebuild) k.flats.push(record(P(e.rebuild)));
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
    // Lifts (`lifts`), built with the floors they serve. Up a leg ({leg: [sx, sz], the corner of the plan; `to`,
    // the floor it serves; `breaks`, the heights where its straight runs meet to follow the leg's curve;
    // `cabin`, the height a car stands at}): two rails along the leg's middle and a car. Up the axis ({axis:
    // true, from, to, landing}): a central guide with a shorter one on either side, the landing halfway where
    // the two cars meet, and the cars.
    for (const lift of e.lifts ?? []) {
      const ph = P(lift.phase ?? e.bands.at(-1).phase), metal = k.tint(lift.color ?? '#3c3d40', .05), car = k.tint(lift.car ?? '#6b4a35', .05);
      if (lift.axis) {
        const {from, to, landing = (from + to) / 2} = lift;
        for (const [x, y0, y1] of [[0, from, to], [-1.6, from, landing + 1], [1.6, landing - 1, to]]) k.beam('metal', V(x, y0, 0), V(x, y1, 0), .35, metal, ph);
        k.box('metal', [0, landing, 0], [5, .3, 4], 0, metal, ph, landing);
        for (const [x, y] of [[-.8, (from + landing) / 2], [.8, (landing + to) / 2]]) k.box('wood', [x, y, 0], [1.3, 3.2, 3], 0, car, ph, y);
        continue;
      }
      const [sx, sz] = lift.leg, mid = h => { const d = W(h) - L(h) / 2; return V(sx * d, h, sz * d); }, side = V(-sz, 0, sx).normalize().multiplyScalar(.9);
      const stops = [lift.from ?? 1, ...(lift.breaks ?? []), lift.to].map(mid);
      for (let i = 0; i < stops.length - 1; i++) for (const o of [1, -1]) k.beam('metal', stops[i].clone().addScaledVector(side, o), stops[i + 1].clone().addScaledVector(side, o), .25, metal, ph);
      // The car: a box along the run, at `cabin`.
      const y = lift.cabin ?? (stops[0].y + stops[1].y) / 2, i = Math.max(0, stops.findIndex((p, j) => j > 0 && p.y >= y) - 1), a = stops[i], b = stops[i + 1];
      const c = a.clone().lerp(b, (y - a.y) / (b.y - a.y)), dir = b.clone().sub(a).normalize();
      k.beam('wood', c.clone().addScaledVector(dir, -1.7), c.clone().addScaledVector(dir, 1.7), 2.6, car, ph);
    }
    const top = e.height;
    beam(V(0, e.height - 6, 0), V(0, top + e.flag.pole, 0), .45);
    e.flag.colors.forEach((c, i) => k.box('cloth', [1.2 + i * 1.6 + .8, top + e.flag.pole - 1.4, 0], [1.6, 2.6, .1], 0, new T.Color(c), P(e.flag.phase), top + 99));
  },  // Basilican body of a Gothic church: a central vessel lit by a clerestory under a steep roof, aisles under
  // lean-to roofs, chapels between the buttresses, buttress piers with pinnacles and flying buttresses. One
  // element is one run: straight (`from`, `to`, `bays`, `sides`) or a hemicycle (`apse`: {sides, start, end}
  // in degrees, 0 = +u) around `center`.
  basilica(k, e, P) {
    const G = gothic(k, e, P), {vessel, aisles, chapels, buttresses: butt, flyers} = e, roof = e.roof ?? {};
    const lines = [];
    if (e.apse) {
      const {sides, start = -90, end = 90} = e.apse, list = [];
      for (let i = 0; i <= sides; i++) { const a = (start + (end - start) * i / sides) * Math.PI / 180; list.push({A: [0, 0], n: [Math.cos(a), Math.sin(a)]}); }
      lines.push(list);
    } else for (const side of e.sides ?? [-1, 1]) {
      const list = [];
      for (let i = 0; i <= e.bays; i++) list.push({A: [e.from + (e.to - e.from) * i / e.bays, 0], n: [0, side]});
      lines.push(list);
    }
    const at = (s, d) => [s.A[0] + s.n[0] * d, s.A[1] + s.n[1] * d];
    const mid = (s0, s1) => { const n = [s0.n[0] + s1.n[0], s0.n[1] + s1.n[1]], l = Math.hypot(...n); return [n[0] / l, n[1] / l]; };
    const base = aisles ? aisles.top - 1.2 : 0, chapelPhase = chapels?.phase ? P(chapels.phase) : G.phase, eaveOut = vessel.half + .9;
    // Temporary or plain end walls with their gables (`ends`: {at: ['from', 'to'], until}).
    if (e.ends && !e.apse) for (const which of e.ends.at ?? ['from', 'to']) {
      const u = which === 'from' ? e.from : e.to, extra = e.ends.until ? {until: P(e.ends.until)} : {}, o = [which === 'from' ? -1 : 1, 0];
      G.wall([u, -eaveOut], [u, eaveOut], 0, vessel.eave, 1.2, o, [], G.phase, extra);
      G.gable([u, -eaveOut], [u, eaveOut], vessel.eave, vessel.ridge, 1.1, o, G.phase, extra);
    }
    // The high vault: a pointed barrel from `spring` to `crown` between the clerestory walls (a half dome
    // round an apse), with a transverse rib at every bay; laid after the roof, as vaults were, under cover.
    const vault = vessel.vault, w = vessel.half - (vessel.thick ?? 1.2) / 2, profile = [];
    if (vault) {
      const a = vault.crown - vault.spring, r = (w * w + a * a) / (2 * w), end = Math.acos((r - w) / r);
      for (let j = 0; j <= 6; j++) { const th = end * j / 6; profile.push([Math.max(0, w - r + r * Math.cos(th)), vault.spring + r * Math.sin(th)]); }
    }
    const P3 = (p2, y) => G.V(p2[0], y, p2[1]), rib = s => { for (let j = 0; j < 6; j++) { const a2 = at(s, profile[j][0]), b2 = at(s, profile[j + 1][0]); G.beam('stone', [a2[0], profile[j][1], a2[1]], [b2[0], profile[j + 1][1], b2[1]], .5, G.tint(G.stone), G.phase, {order: 2e4 + profile[j][1]}); } };
    // Rib vaults (the default; `vault.kind: "barrel"` keeps a plain pointed barrel). Each bay is a set of webs,
    // each ruled between its boundary arch and the two diagonal ribs that meet at the bay's keystone: a
    // transverse arch, or a wall arch stilted up to the clerestory's springing so that the windows show.
    // Points are [u, y, v] in the run's frame.
    const ribbed = vault && vault.kind !== 'barrel', V3 = p => G.V(p[0], p[1], p[2]);
    const diagonal = (K, C, ys, yc, n = 6) => Array.from({length: n + 1}, (_, i) => { const th = Math.PI / 2 * i / n, f = 1 - Math.cos(th); return [K[0] + (C[0] - K[0]) * f, ys + (yc - ys) * Math.sin(th), K[1] + (C[1] - K[1]) * f]; });
    const archPoints = (A, B, ys, yw, ya, n = 8) => {
      const len = Math.hypot(B[0] - A[0], B[1] - A[1]), rise = Math.max(.3, ya - yw), r = G.radiusOf(len, rise), pts = [[A[0], ys, A[1]]];
      if (yw > ys + .05) pts.push([A[0], yw, A[1]]);
      for (let i = 1; i < n; i++) {
        const x = -len / 2 * Math.cos(Math.PI * i / n), f = x / len + .5, y = yw + Math.sqrt(Math.max(0, r * r - (Math.abs(x) + r - len / 2) ** 2));
        pts.push([A[0] + (B[0] - A[0]) * f, y, A[1] + (B[1] - A[1]) * f]);
      }
      if (yw > ys + .05) pts.push([B[0], yw, B[1]]);
      pts.push([B[0], ys, B[1]]);
      return pts;
    };
    // A polyline resampled to m points evenly along its length.
    const resample = (pts, m) => {
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
      return Array.from({length: m}, (_, j) => {
        const d = cum.at(-1) * j / (m - 1); let i = 1;
        while (i < cum.length - 1 && cum[i] < d) i++;
        const f = (d - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
        return pts[i - 1].map((v, c) => v + (pts[i][c] - v) * f);
      });
    };
    const chain = (pts, thick, ph, extra) => { if (G.mesh) return G.mesh.tube(pts, thick, ph, {...extra, orderBase: 2e4}); for (let i = 0; i < pts.length - 1; i++) G.beam('stone', pts[i], pts[i + 1], thick, G.tint(G.stone), ph, {...extra, order: 2e4 + pts[i][1]}); };
    // One web: the arch from corner A to corner B and the diagonals from both to the keystone C ([u, v]).
    const web = (A, B, C, ys, yc, yw, color, ph, extra = {}, archThick = .3) => {
      const len = Math.hypot(B[0] - A[0], B[1] - A[1]), arc = archPoints(A, B, ys, yw, Math.min(yc - .15, yw + len * .866));
      const F = resample(arc, 9), Gd = resample([...diagonal(A, C, ys, yc), ...diagonal(B, C, ys, yc).reverse().slice(1)], 9);
      for (let i = 0; i < 8; i++) G.panel(V3(F[i]), V3(F[i + 1]), V3(Gd[i]), V3(Gd[i + 1]), color, ph, {...extra, order: 2e4 + F[i][1]}, 'stone', 1.6, 0);
      if (archThick) chain(arc, archThick, ph, extra);
    };
    // A quadripartite bay over the corners [u, v] (in order round it), springing at ys, its keystone at yc;
    // `stilts[i]`: where the arch from corner i to corner i + 1 springs (a window's springing).
    const ribBay = (corners, ys, yc, stilts, color, ph, extra = {}, thick = [.3, .5, .3, .5]) => {
      const C = [corners.reduce((s, c) => s + c[0], 0) / 4, corners.reduce((s, c) => s + c[1], 0) / 4];
      corners.forEach((A, i) => web(A, corners[(i + 1) % 4], C, ys, yc, Math.max(ys, stilts[i] ?? ys), color, ph, extra, thick[i]));
      for (const K of corners) chain(diagonal(K, C, ys, yc), .42, ph, extra);
    };
    // `open`: stretches where the vessel walls give way, [from, to, height] along the run: at a crossing (no
    // height) the walls are left out; where aisles or chapels pass under (a height), the wall starts at it.
    // A bay is cut at their ends, so the walls stop exactly there.
    const cuts = (u0, u1) => {
      const lo = Math.min(u0, u1), hi = Math.max(u0, u1), marks = [lo, hi, ...(e.open ?? []).flatMap(([f, t]) => [f, t]).filter(x => x > lo && x < hi)].sort((x, y) => x - y), out2 = [];
      for (let j = 0; j < marks.length - 1; j++) { if (marks[j + 1] - marks[j] < .05) continue; const m = (marks[j] + marks[j + 1]) / 2, o = (e.open ?? []).find(([f, t]) => m > f && m < t); out2.push([marks[j], marks[j + 1], o ? (o[2] ?? Infinity) : base, !o]); }
      return u0 <= u1 ? out2 : out2.reverse().map(([x0, x1, f, plain]) => [x1, x0, f, plain]);
    };
    // Inside a crossing (an `open` stretch with no height) no pier stands.
    const crossing = u => (e.open ?? []).some(([f, t, h]) => h === undefined && u > f + .05 && u < t - .05);
    for (const line of lines) {
      for (let i = 0; i < line.length - 1; i++) {
        const s0 = line[i], s1 = line[i + 1], out = mid(s0, s1);
        // The clerestory: in every bay, twin lancets under an oculus.
        // With `vessel.arcade` {spring}, the wall stands on the arcade: in every bay a pointed arch springing from
        // the round piers' capitals, and `vessel.tribune` {width, sill, spring}, the tribune's twin openings.
        for (const [u0, u1, start, plain] of e.apse ? [[null, null, base, true]] : cuts(s0.A[0], s1.A[0])) {
          if (start === Infinity) continue;
          const a0 = e.apse ? s0 : {A: [u0, 0], n: s0.n}, a1 = e.apse ? s1 : {A: [u1, 0], n: s1.n}, arcade = plain && aisles && vessel.arcade, from = arcade ? arcade.spring : Math.max(base, start);
          const len = Math.hypot(at(a1, vessel.half)[0] - at(a0, vessel.half)[0], at(a1, vessel.half)[1] - at(a0, vessel.half)[1]);
          const windows = vessel.windows && vessel.windows.sill > from && (e.apse || len > (vessel.windows.width ?? 3) + 1) ? [{kind: 'pointed', twin: true, ...vessel.windows}] : [];
          if (arcade) windows.push({kind: 'pointed', w: len - (e.piers ?? 1.3) * .7, sill: from, spring: from, glass: false, margin: 0});
          if (arcade && vessel.tribune && len > (vessel.tribune.width ?? 3) + 1) windows.push({kind: 'pointed', twin: true, oculus: false, glass: false, ...vessel.tribune});
          G.wall(at(a0, vessel.half), at(a1, vessel.half), from, vessel.eave, vessel.thick ?? 1.2, out, windows, G.phase);
          if (G.mesh) G.mesh.string(at(a0, vessel.half), at(a1, vessel.half), vessel.eave - .55, vessel.thick ?? 1.2, out, G.phase);
          G.rail(at(a0, eaveOut - .2), at(a1, eaveOut - .2), vessel.eave, G.phase);
        }
        if (vault && !ribbed) {
          for (let j = 0; j < 6; j++) G.panel(P3(at(s0, profile[j][0]), profile[j][1]), P3(at(s1, profile[j][0]), profile[j][1]), P3(at(s0, profile[j + 1][0]), profile[j + 1][1]), P3(at(s1, profile[j + 1][0]), profile[j + 1][1]), vault.color ?? G.stone, G.phase, {order: 2e4 + profile[j][1]}, 'stone', 1.4, 0);
          rib(s0); if (i === line.length - 2) rib(s1);
        }
        if (ribbed) {
          const ys = vault.spring, yc = vault.crown, yw = vessel.windows ? Math.max(ys, Math.min(vessel.windows.spring, yc - 1)) : ys, color = vault.color ?? G.stone;
          // Round an apse every bay is one web from its wall arch to the keystone over the centre.
          if (e.apse) {
            web(at(s0, w), at(s1, w), s0.A, ys, yc, yw, color, G.phase);
            chain(diagonal(at(s0, w), s0.A, ys, yc), .42, G.phase, {});
            if (i === line.length - 2) chain(diagonal(at(s1, w), s0.A, ys, yc), .42, G.phase, {});
          } else if (line === lines[0]) {
            const u0 = s0.A[0], u1 = s1.A[0], pair = vault.sexpartite && (line.length - 1) % 2 === 0;
            // `vault.sexpartite`: one vault over two bays, its diagonals crossing at the keystone over the middle
            // pier, through which runs an extra transverse rib (six webs).
            if (pair && i % 2 === 0) {
              const u2 = line[i + 2].A[0], C = [u1, 0];
              for (const [A, B, t] of [[[u0, w], [u0, -w], i === 0 ? .5 : 0], [[u0, -w], [u1, -w], .3], [[u1, -w], [u2, -w], .3], [[u2, -w], [u2, w], .5], [[u2, w], [u1, w], .3], [[u1, w], [u0, w], .3]])
                web(A, B, C, ys, yc, A[1] === B[1] ? yw : ys, color, G.phase, {}, t);
              for (const K of [[u0, -w], [u0, w], [u2, -w], [u2, w], [u1, -w], [u1, w]]) chain(diagonal(K, C, ys, yc), .42, G.phase, {});
            } else if (!pair) ribBay([[u0, -w], [u1, -w], [u1, w], [u0, w]], ys, yc, [yw, ys, yw, ys], color, G.phase, {}, [.3, .5, .3, i === 0 ? .5 : 0]);
          }
        }
        if (aisles) {
          // The aisle wall and its roof, replaced when chapels are built out between the buttresses.
          const gone = chapels?.phase ? {until: chapelPhase} : {};
          G.wall(at(s0, aisles.half), at(s1, aisles.half), 0, aisles.wall, 1.1, out, aisles.windows ? [{kind: 'pointed', ...aisles.windows}] : [], G.phase, gone);
          if (G.mesh) G.mesh.string(at(s0, aisles.half), at(s1, aisles.half), aisles.wall - .5, 1.1, out, G.phase, gone);
          G.quad(at(s0, aisles.half + .4), at(s1, aisles.half + .4), aisles.wall + .2, at(s0, vessel.half + .7), at(s1, vessel.half + .7), aisles.top, G.lead, G.phase, gone);
          if (chapels) {
            G.wall(at(s0, chapels.half), at(s1, chapels.half), 0, chapels.wall, 1.1, out, chapels.windows ? [{kind: 'pointed', twin: true, ...chapels.windows}] : [], chapelPhase);
            if (G.mesh) G.mesh.string(at(s0, chapels.half), at(s1, chapels.half), chapels.wall - .5, 1.1, out, chapelPhase);
            G.quad(at(s0, chapels.half + .4), at(s1, chapels.half + .4), chapels.wall + .2, at(s0, vessel.half + .7), at(s1, vessel.half + .7), aisles.top, G.lead, chapelPhase);
            if (chapels.gables) {
              const len = Math.hypot(at(s1, chapels.half)[0] - at(s0, chapels.half)[0], at(s1, chapels.half)[1] - at(s0, chapels.half)[1]), inset = Math.max(.6, (len - chapels.gables.width) / 2), d = chapels.half + .3;
              const a = at(s0, d), b = at(s1, d), f = inset / len;
              G.gable([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], [b[0] + (a[0] - b[0]) * f, b[1] + (a[1] - b[1]) * f], chapels.wall - .4, chapels.wall + chapels.gables.height, .6, out, chapelPhase);
            }
          }
          // `aisles.vault` {spring, crown}: rib vaults over the aisles, two bays across (either side of the middle
          // row of piers), the outer wall arches stilted to the windows; `chapels.vault` likewise over the chapels.
          const aisleVaults = (d0, d1, spec, ph, windows) => {
            const wall = windows ? Math.max(spec.spring, Math.min(windows.spring, spec.crown - .8)) : spec.spring;
            ribBay([at(s0, d0), at(s1, d0), at(s1, d1), at(s0, d1)], spec.spring, spec.crown, [spec.spring, spec.spring, wall, spec.spring], vault?.color ?? G.stone, ph, {}, [.3, .4, .3, i === 0 ? .4 : 0]);
          };
          const dm = (vessel.half + aisles.half) / 2;
          if (aisles.vault) { aisleVaults(vessel.half + .6, dm, aisles.vault, G.phase); aisleVaults(dm, aisles.half - .55, aisles.vault, G.phase, aisles.windows); }
          if (chapels?.vault) aisleVaults(aisles.half, chapels.half - .55, chapels.vault, chapelPhase, chapels.windows);
          // The arcade piers: round columns laid drum by drum (`piers`: diameter), up to the arcade's or the
          // aisle vaults' springing.
          if (e.apse || !crossing(s0.A[0])) for (const d of [vessel.half - .2, dm]) G.column(at(s0, d), 0, d < vessel.half ? (vessel.arcade?.spring ?? base) : (aisles.vault?.spring ?? aisles.wall), e.piers ?? 1.3, G.phase, {}, 'gothic', .9, s0.n);
        }
        // The main roof, eave to ridge (a half cone around a hemicycle), and its crest.
        G.life(roof, (ph, extra) => {
          G.quad(at(s0, eaveOut), at(s1, eaveOut), vessel.eave, s0.A, s1.A, vessel.ridge, roof.color ?? G.lead, ph, extra);
          if (!e.apse && roof.crest !== false) {
            G.beam('lead', [s0.A[0], vessel.ridge + .35, s0.A[1]], [s1.A[0], vessel.ridge + .35, s1.A[1]], .4, G.tint(roof.color ?? G.lead), ph, extra);
            for (let f = .25; f < 1; f += .5) G.box('lead', [s0.A[0] + (s1.A[0] - s0.A[0]) * f, s0.A[1] + (s1.A[1] - s0.A[1]) * f], vessel.ridge + .9, [.3, .8, .3], [1, 0], G.tint(roof.color ?? G.lead), ph, extra);
          }
        });
      }
      // `vault.extend` [before, after]: the vault runs on past the ends of the run (under a tower bay).
      if (!e.apse && vault?.extend) for (const [u0, u1] of [[e.from - (vault.extend[0] ?? 0), e.from], [e.to, e.to + (vault.extend[1] ?? 0)]]) if (u1 - u0 > .05) {
        const side = line[0].n[1], s0 = {A: [u0, 0], n: [0, side]}, s1 = {A: [u1, 0], n: [0, side]};
        if (!ribbed) for (let j = 0; j < 6; j++) G.panel(P3(at(s0, profile[j][0]), profile[j][1]), P3(at(s1, profile[j][0]), profile[j][1]), P3(at(s0, profile[j + 1][0]), profile[j + 1][1]), P3(at(s1, profile[j + 1][0]), profile[j + 1][1]), vault.color ?? G.stone, G.phase, {order: 2e4 + profile[j][1]}, 'stone', 1.4, 0);
        else if (line === lines[0]) ribBay([[u0, -w], [u1, -w], [u1, w], [u0, w]], vault.spring, vault.crown, [], vault.color ?? G.stone, G.phase);
        // Its side walls, open through one tall arch on each side (into a tower's base).
        const low = vessel.arcade?.spring ?? base;
        G.wall(at(s0, vessel.half), at(s1, vessel.half), low, vessel.eave, vessel.thick ?? 1.2, [0, side], [{kind: 'pointed', w: u1 - u0 - 1.2, sill: low, spring: low, glass: false, margin: 0}], G.phase);
      }
      // `roof.extend` [before, after]: the roof runs on past the ends of the run, over a crossing, until it meets
      // the crossing roof in valleys and leaves no open end.
      if (!e.apse && roof.extend) for (const [u0, u1] of [[e.from - (roof.extend[0] ?? 0), e.from], [e.to, e.to + (roof.extend[1] ?? 0)]]) if (u1 - u0 > .05) {
        const side = line[0].n[1], s0 = {A: [u0, 0], n: [0, side]}, s1 = {A: [u1, 0], n: [0, side]};
        G.life(roof, (ph, extra) => G.quad(at(s0, eaveOut), at(s1, eaveOut), vessel.eave, s0.A, s1.A, vessel.ridge, roof.color ?? G.lead, ph, extra));
      }
      // Buttress piers with pinnacles, and the flying buttresses that carry the vaults' thrust over the aisles.
      if (butt) for (const [i, s] of line.entries()) {
        if (butt.ends === false && (i === 0 || i === line.length - 1)) continue;
        const d0 = aisles?.half ?? vessel.half, d1 = butt.half, w = butt.width ?? 1.6, step = butt.step ?? 1.6, low = chapels?.wall ?? aisles?.wall ?? 8;
        if (G.mesh) G.mesh.pier(at, s, d0, d1, w, 0, butt.top, G.phase, {}, {low, step});
        else for (let y = 0; y < butt.top - .05;) {
          const h = Math.min(1.1, butt.top - y), c = d1 - (y + h / 2 > low ? step : 0);
          G.box('stone', at(s, (d0 + c) / 2), y + h / 2, [c - d0, h * .96, w], s.n, G.tint(G.stone), G.phase);
          y += h;
        }
        if (butt.pinnacle) G.pinnacle(at(s, d1 - step - w / 2), butt.top, butt.pinnacle, w * .9, G.phase);
        // A stone gutter out of the upper face of the pier, under the pinnacle, to throw the water of the flyer clear of the aisle roofs.
        if (butt.spouts && G.mesh) G.mesh.gargoyle(at(s, d1 - step - .3), butt.top - (butt.spouts.drop ?? 1.2), Math.atan2(s.n[1], s.n[0]), G.phase, {}, {kind: 'spout', length: butt.spouts.length ?? 1.6});
        if (flyers && aisles) {
          const ph = flyers.phase ? P(flyers.phase) : G.phase, dA = d0 + .5, dB = vessel.half + .6, m = 9, drop = flyers.drop ?? 4.5;
          const top = t => flyers.from + (flyers.to - flyers.from) * t + .4, low2 = t => flyers.from - drop + (flyers.to - 1.8 - flyers.from + drop) * Math.sin(t * Math.PI / 2);
          if (G.mesh) G.mesh.flyer(at, s, dA, dB, top, t => Math.min(low2(t), top(t) - .7), flyers.thick ?? .9, ph);
          else for (let j = 0; j < m; j++) {
            const t = (j + .5) / m, yt = top(t), yb = low2(t);
            G.box('stone', at(s, dA + (dB - dA) * t), (yt + yb) / 2, [Math.abs(dB - dA) / m * 1.04, Math.max(.7, yt - yb), flyers.thick ?? .9], s.n, G.tint(G.stone), ph);
          }
          const pa = at(s, dA), pb = at(s, dB);
          G.beam('stone', [pa[0], top(0) + .3, pa[1]], [pb[0], top(1) + .3, pb[1]], .5, G.tint(G.stone), ph);
        }
      }
    }
  },
  // The harmonic west front of a Gothic church: three portals, a gallery of kings, a rose between two tall
  // windows, an open high gallery, then two square towers with tall louvred openings. It faces -u from the
  // front line (u = 0); `depth` runs into the church. Levels are given as heights; `bands` give their phases.
  twinTowerFront(k, e, P) {
    const G = gothic(k, e, P), hw = e.width / 2, d = e.depth, t = e.thick ?? 2.6, L = e.levels, out = [-1, 0];
    const ph = y => P((e.bands ?? []).find(b => y < b.to)?.phase ?? e.phase);
    const front = (y0, y1, openings) => G.wall([t / 2, -hw], [t / 2, hw], y0, y1, t, out, openings, ph(y0));
    // Portals: deep pointed arches stepping in, a tympanum above the doors.
    front(0, L.kings, e.portals.map(p => ({kind: 'pointed', s: hw + p.v, w: p.w, sill: 0, spring: p.spring, rise: p.rise, glass: false})));
    for (const p of e.portals) {
      // A portal whose carving is a photo relief (`relief: true`, with a recess of the same `depth`): the brick
      // keeps the opening, the back wall with its doors (`inner`: {v, w} of the doorway, `doors`: their height)
      // and the plain splayed socle below the photo's `foot`; the relief carries archivolts, statues and tympanum.
      if (p.relief) {
        const D = p.depth ?? 1.95, foot = p.foot ?? 1.9, inner = p.inner ?? {v: p.v, w: p.w * .45}, left = p.v - p.w / 2;
        const leaves = [-1, 1].map(side => ({kind: 'rect', s: inner.v + side * inner.w / 4 - left, w: inner.w * .35, sill: 0, spring: p.doors ?? p.spring * .85, door: '#4a3b2f', margin: 0}));
        G.wall([D + .35, left], [D + .35, p.v + p.w / 2], 0, p.spring + (p.rise ?? p.w * .866), .6, out, leaves, ph(0));
        for (const side of [-1, 1]) G.wall([.2, p.v + side * (p.w / 2 - .2)], [D, inner.v + side * inner.w / 2], 0, foot, .45, out, [], ph(0));
        continue;
      }
      // Archivolts stepping in through the wall, statues in the splayed jambs, the doors and their trumeau,
      // and a tympanum carved in registers above the lintel.
      const n = e.archivolts ?? 5, lintel = p.spring * .72;
      for (let i = 0; i < n; i++) G.arch((s, y, off) => [i * (t - .5) / n + .25, y, p.v + s], 0, p.w - .2 - i * .5, p.spring, 0, .62, ph(0), {}, 'pointed', 6);
      for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
        const v = p.v + side * (p.w / 2 - .45 - i * .5), u = .45 + i * .6;
        G.column([u, v], 0, p.spring, .34, ph(0));
        G.statue([u - .25, v], .9, 2.9, out, e.sculpture ?? G.stone, ph(0));
      }
      G.wall([t - .3, p.v - p.w / 2], [t - .3, p.v + p.w / 2], 0, p.spring + p.w * .87, .6, out, [{kind: 'rect', s: p.w / 2 - p.w * .21, w: p.w * .3, sill: 0, spring: lintel, door: '#4a3b2f', margin: 0}, {kind: 'rect', s: p.w / 2 + p.w * .21, w: p.w * .3, sill: 0, spring: lintel, door: '#4a3b2f', margin: 0}], ph(0));
      G.box('stone', [t - .75, p.v], lintel / 2, [.5, lintel, .9], [1, 0], G.tint(G.stone), ph(0));
      G.statue([t - 1.15, p.v], 1.2, Math.min(3.2, lintel - 1.6), out, e.sculpture ?? G.stone, ph(0));
      // With `tympanum: false` on a portal, its carving is a photo relief.
      if (p.tympanum !== false) for (const y of [lintel + .25, lintel + 2.3, lintel + 4.3]) {
        const hw2 = G.span({kind: 'pointed', w: p.w - .2 - (n - 1) * .5, sill: 0, spring: p.spring}, y);
        if (hw2 > .5) G.beam('stone', [t - .65, y, p.v - hw2], [t - .65, y, p.v + hw2], .45, G.tint(e.tympanum ?? G.stone), ph(0));
      }
    }
    // The gallery of kings: a ledge, a row of niches and their statues (taken down and remade if asked).
    front(L.kings, L.rose, []);
    if (!e.kings?.relief) G.beam('stone', [-.5, L.kings + .2, -hw], [-.5, L.kings + .2, hw], .8, G.tint(G.stone), ph(L.kings));
    // With `kings.relief`, the gallery is a photo relief (a `relief` element): the band stays flat for it.
    const kings = e.kings ?? {count: 28};
    for (let i = 0; i < (kings.relief ? 0 : kings.count); i++) {
      const v = -hw + 1 + (2 * hw - 2) * (i + .5) / kings.count, y = L.kings + .5;
      G.arch((s, yy, off) => [-.25, yy, v + s], 0, (2 * hw - 2) / kings.count * .9, L.rose - 1.4, 0, .22, ph(L.kings), {}, 'pointed', 2);
      G.life({phase: kings.phase ?? e.bands?.find(b => L.kings < b.to)?.phase ?? e.phase, until: kings.until, rebuild: kings.rebuild}, (p, extra) => G.statue([-.45, v], y, L.rose - L.kings - 1.6, out, kings.color ?? G.stone, p, extra));
    }
    // The rose level: the rose in the middle, a tall twin window in each tower section, the Virgin's balustrade.
    front(L.rose, L.gallery, [{kind: 'circle', s: hw + e.rose.v, y: e.rose.y, r: e.rose.r, colors: e.rose.colors, photo: e.rose.relief}, ...e.towers.map(tw => ({kind: 'pointed', s: hw + tw.v, w: e.windowWidth ?? 5.2, sill: L.rose + 1.6, spring: L.gallery - 5.2, twin: true}))]);
    G.rail([-.6, -hw], [-.6, hw], L.rose, ph(L.rose));
    // The high gallery: slender colonnettes and arches before the towers' walls, open between the towers.
    for (let v = -hw + .6; v <= hw - .5; v += 1.15) G.column([.3, v], L.gallery + .4, 5.8, .3, ph(L.gallery));
    for (let v = -hw + .6; v < hw - 1.6; v += 1.15) G.arch((s, y, off) => [.3, y, v + .575 + s], 0, 1.1, L.gallery + 6.2, 0, .22, ph(L.gallery), {}, 'pointed', 2);
    G.beam('stone', [.3, L.gallery + .3, -hw], [.3, L.gallery + .3, hw], .6, G.tint(G.stone), ph(L.gallery));
    G.beam('stone', [.3, L.gallery + 7.4, -hw], [.3, L.gallery + 7.4, hw], .7, G.tint(G.stone), ph(L.gallery));
    for (const tw of e.towers) G.wall([2.2, tw.v - tw.w / 2], [2.2, tw.v + tw.w / 2], L.gallery, L.top, 1.6, out, [], ph(L.gallery));
    // `terrace`: the lead-covered terrace between the towers, behind the gallery, over the first bay.
    if (e.terrace) {
      const [a0, a1] = [...e.towers].sort((p, q) => p.v - q.v), v0 = a0.v + a0.w / 2, v1 = a1.v - a1.w / 2, y = e.terrace.y ?? L.gallery + .2;
      for (let u = t; u < d - .05; u += 1.25) G.box('lead', [Math.min(d, u + 1.25) / 2 + u / 2, (v0 + v1) / 2], y, [Math.min(1.25, d - u) * 1.02, .3, v1 - v0], [1, 0], G.tint(G.lead), ph(L.gallery));
      // The towers' sides along it, up to their foot.
      for (const [v, o] of [[v0, -1], [v1, 1]]) G.wall([2.2, v], [d, v], L.gallery, L.top, 1, [0, o], [], ph(L.gallery));
    }
    // `back` {gap: [v0, v1], arches: [{v, w, spring}]}: the towers' bases closed behind, either side of the nave
    // (`gap`: its walls), from the ground to the towers' foot, with the arches through which the aisles run on.
    if (e.back) {
      const [g0, g1] = e.back.gap, arches = e.back.arches ?? [];
      for (const [a, b] of [[-hw, g0], [g1, hw]]) {
        G.wall([d, a], [d, b], 0, L.gallery, 1.2, [1, 0], arches.filter(o => o.v > a && o.v < b).map(o => ({kind: 'pointed', s: o.v - a, w: o.w, sill: 0, spring: o.spring, glass: false, margin: 0})), ph(0));
        G.wall([d, a], [d, b], L.gallery, L.top, 1.2, [1, 0], [], ph(L.gallery));
      }
    }
    if (e.gable) G.wall([d, -e.gable.half], [d, e.gable.half], L.gallery, e.gable.eave, 1.2, out, [], ph(L.gallery));
    if (e.gable) G.gable([d, -e.gable.half], [d, e.gable.half], e.gable.eave, e.gable.ridge, 1.1, out, ph(L.gallery));
    G.wall([.4, -hw], [.4, hw], L.top - 1.6, L.top - .6, 1.4, out, [], ph(L.gallery));
    G.rail([-.2, -hw], [-.2, hw], L.top - .6, ph(L.gallery));
    // Sides of the front block, with their buttresses.
    for (const side of [-1, 1]) {
      G.wall([0, side * hw], [d, side * hw], 0, L.top, 1.8, [0, side], (e.sideWindows ?? []).map(w => ({kind: 'pointed', twin: true, ...w})), ph(0));
      for (const u of e.sideButtresses ?? []) for (let y = 0; y < L.top - 3; y += 1.1) {
        const h = Math.min(1.1, L.top - 3 - y), depth = y < L.rose ? 2.4 : 1.4;
        G.box('stone', [u, side * (hw + depth / 2)], y + h / 2, [1.9, h * .96, depth], [1, 0], G.tint(G.stone), ph(y));
      }
    }
    // Front buttresses up to the high gallery, stepping back.
    for (const v of e.buttresses ?? []) for (let y = 0; y < L.top - 1; y += 1.1) {
      const h = Math.min(1.1, L.top - 1 - y), depth = y < L.kings ? 1.5 : y < L.gallery ? 1 : .6;
      if (kings.relief && y + h > L.kings + .3 && y < L.rose - .2) continue;
      G.box('stone', [-depth / 2 + .2, v], y + h / 2, [depth + .4, h * .96, 2.3], [1, 0], G.tint(G.stone), ph(y));
    }
    // The towers: four walls with two tall louvred openings each, corner buttresses, a balustrade and a terrace.
    for (const tw of e.towers) {
      const u0 = .6, u1 = .6 + tw.depth, v0 = tw.v - tw.w / 2, v1 = tw.v + tw.w / 2, y0 = L.top, y1 = e.towerTop - 1.5;
      const holes = len => [len / 2 - len * .22, len / 2 + len * .22].map(s => ({kind: 'pointed', s, w: e.opening?.width ?? 2.6, sill: y0 + (e.opening?.sill ?? 2), spring: y1 - (e.opening?.top ?? 3.2) - (e.opening?.width ?? 2.6) * .87, louvres: '#57534d', margin: 0}));
      for (const [a, b, o] of [[[u0, v0], [u0, v1], [-1, 0]], [[u1, v0], [u1, v1], [1, 0]], [[u0, v0], [u1, v0], [0, -1]], [[u0, v1], [u1, v1], [0, 1]]]) {
        G.wall(a, b, y0, y1, 1.5, o, holes(Math.hypot(b[0] - a[0], b[1] - a[1])), ph(y0));
        G.rail(a, b, y1 + .6, ph(y0));
      }
      G.box('lead', [(u0 + u1) / 2, tw.v], y1 + .4, [tw.depth - 1, .4, tw.w - 1], [1, 0], G.tint(G.lead), ph(y0));
      G.wall([u0 - .2, v0 + .5], [u0 - .2, v1 - .5], y1, y1 + .6, 1.6, [-1, 0], [], ph(y0));
      for (const [cu, cv] of [[u0, v0], [u0, v1], [u1, v0], [u1, v1]]) {
        for (let y = y0; y < y1 - .5; y += 1.1) { const s = y < y0 + 8 ? 2 : y < y0 + 15 ? 1.6 : 1.2; G.box('stone', [cu, cv], y + .55, [s, 1.06, s], [1, 0], G.tint(G.stone), ph(y0)); }
        G.pinnacle([cu, cv], y1 - .5, 3.2, 1.1, ph(y0));
      }
      if (tw.turret) {
        const [cu, cv] = [tw.turret[0] === 'back' ? u1 - 1.4 : u0 + 1.4, tw.turret[1] === 'right' ? v1 - 1.4 : v0 + 1.4];
        for (let y = y1; y < y1 + 4; y += 1) G.box('stone', [cu, cv], y + .5, [2.4, .96, 2.4], [1, 0], G.tint(G.stone), ph(y0));
        G.pinnacle([cu, cv], y1 + 4, 3, 2.2, ph(y0));
      }
    }
  },
  // The end of a Gothic transept (or any gabled front): a portal, a glazed gallery, a great rose, a gable with
  // an oculus, between two slender turrets. It faces -u from the front line (u = 0).
  roseFront(k, e, P) {
    const G = gothic(k, e, P), hw = e.width / 2, t = e.thick ?? 2.2, out = [-1, 0], tw = e.turrets?.width ?? 2.6;
    const gallery = [];
    for (let i = 0; i < (e.gallery?.count ?? 0); i++) gallery.push({kind: 'pointed', s: hw - hw * .8 + (2 * hw * .8) * (i + .5) / e.gallery.count, w: 2 * hw * .8 / e.gallery.count - .5, sill: e.gallery.sill, spring: e.gallery.spring, margin: 0});
    const portal = e.portal ? [{kind: 'pointed', s: hw, w: e.portal.w, sill: 0, spring: e.portal.spring, glass: false}] : [];
    G.wall([t / 2, -hw], [t / 2, hw], 0, e.eave, t, out, [...portal, ...gallery, {kind: 'circle', s: hw, y: e.rose.y, r: e.rose.r, colors: e.rose.colors, spokes: e.rose.spokes ?? 24, photo: e.rose.relief}], G.phase);
    if (e.portal) {
      for (let i = 0; i < 3; i++) G.arch((s, y, off) => [i * .6 + .3, y, s], 0, e.portal.w - i * .5, e.portal.spring, 0, .45, G.phase, {}, 'pointed', 5);
      G.wall([t - .3, -e.portal.w / 2], [t - .3, e.portal.w / 2], 0, e.portal.spring + e.portal.w * .87, .6, out, [{kind: 'rect', w: e.portal.w * .7, sill: 0, spring: e.portal.spring * .7, door: '#4a3b2f', margin: 0}], G.phase);
      G.gable([-.6, -e.portal.w / 2 - .8], [-.6, e.portal.w / 2 + .8], e.portal.spring + e.portal.w * .7, e.portal.spring + e.portal.w * 1.45, .6, out, G.phase);
    }
    G.rail([-.4, -hw], [-.4, hw], e.eave - .2, G.phase);
    G.gable([t / 2, -hw], [t / 2, hw], e.eave, e.apex, t * .8, out, G.phase, {}, e.oculus);
    // The turrets that frame the front, rising above the gable's shoulders.
    for (const side of [-1, 1]) {
      const c = [t / 2, side * (hw + tw / 2 - .2)];
      for (let y = 0; y < e.turrets.top - .05; y += 1.1) { const h = Math.min(1.1, e.turrets.top - y), s = y < e.eave * .5 ? tw : y < e.eave ? tw * .85 : tw * .7; G.box('stone', c, y + h / 2, [s + .6, h * .96, s], [1, 0], G.tint(G.stone), G.phase); }
      G.pinnacle(c, e.turrets.top, e.turrets.pinnacle, tw * .7, G.phase);
    }
  },
  // Furnishings and fittings inside a building, or anything simple built during the works: an altar, a
  // tribune, an organ case's mass behind its photo relief, a pulpit, a bell frame. In a frame (`center`,
  // `rot`), each of `parts` is {at: [u, y, v] (its foot's centre), size: [length along u, height, width],
  // kind (stone, wood, metal…), shape (box by default, or a turned shape), color, turn (degrees)}; the element
  // has a phase, `until` and `rebuild`, and says where it stands and when it was made in its `note`.
  furnishing(k, e, P) {
    const G = gothic(k, e, P);
    const build = (ph, extra) => {
      for (const part of e.parts ?? []) {
        const [u, y, v] = part.at, [l, h, w] = part.size, p = G.V(u, y + h / 2, v), yaw = (e.rot ?? 0) + (part.turn ?? 0) * Math.PI / 180;
        const color = G.tint(part.color ?? e.color ?? '#8a6a4a', .04), order = {...extra, order: part.order ?? y + h};
        if (part.shape && part.shape !== 'box') k.turned(part.shape, part.kind ?? 'stone', [p.x, p.y, p.z], [l, h, w], yaw, color, ph, y, order);
        else k.box(part.kind ?? 'stone', [p.x, p.y, p.z], [l, h, w], yaw, color, ph, y, order);
      }
    };
    build(G.phase, {});
    if (e.rebuild) build(P(e.rebuild), {rebuilt: true});
  },

  // A timber roof frame (charpente), raised on the walls before the roof is covered. One element per run, in
  // the run's own frame (`center`, `rot`, `from`/`to` along u, or `apse` {sides, start, end} as the basilica),
  // from the wall plates at `eave` (`half`: half the span, where the rafters' feet sit) to the `ridge`.
  // `system`, as the frames of the time and the place were made:
  //   chevrons-formant-fermes  Gothic France from about 1220: every pair of rafters is a truss (a fermette:
  //                            collars, struts on sole pieces); every `main` metres a principal truss adds a
  //                            tie beam, a king post and braces; ties along the roof join the king posts.
  //   sans-entrait             the earlier Gothic frame: no tie beams, rafters held by collars and braces.
  //   fermes-pannes-chevrons   19th century and later: king-post trusses every `main` metres carry purlins,
  //                            and common rafters lie on the purlins (also `king-post`).
  // `fermettes`: rafter pairs between two principal trusses; `collars`: their heights, as fractions of the
  // frame's; `color`, and `rebuildColor` for the fresh oak of a frame rebuilt (`rebuild`).
  roofFrame(k, e, P) {
    const G = gothic(k, e, P), {half, eave, ridge} = e, H = ridge - eave, system = e.system ?? 'chevrons-formant-fermes';
    const collars = e.collars ?? [.42, .72], main = e.main ?? 3.5, between = e.fermettes ?? 4, fine = system === 'fermes-pannes-chevrons' || system === 'king-post';
    // The rafter's line: its foot on the wall plate at d = half, its head under the ridge; d at a height y.
    const foot = eave + .25, head = ridge - .35, dAt = y => half * (1 - (y - foot) / (head - foot));
    const build = (ph, extra, color) => {
      const c = () => G.tint(color, .07), order = y => ({...extra, order: eave - .05 + (y - eave) * .002});
      const beam = (a, b, t) => G.beam('wood', a, b, t, c(), ph, order(Math.min(a[1], b[1])));
      // A station along the roof: `at(d, y)` is the point d out from the ridge line on side ±1.
      const truss = (at, principal, sides = [-1, 1]) => {
        const T = principal ? .3 : .2;
        for (const side of sides) beam(at(side * half, foot), at(0, head), T);
        if (system === 'sans-entrait' || system === 'chevrons-formant-fermes' || principal) for (const f of fine && !principal ? [] : collars) { const y = eave + H * f, d = dAt(y); beam(at(-d * (sides.length > 1 ? 1 : 0), y), at(d * sides[sides.length - 1], y), T * .8); }
        if (!fine) for (const side of sides) {
          // Sole piece on the wall and the strut from it to the rafter.
          beam(at(side * (half + .15), eave + .12), at(side * (half - 1), eave + .12), T);
          const d = half - .45, y = foot + (head - foot) * (1 - d / half);
          beam(at(side * d, eave + .2), at(side * d, y), T * .8);
          if (system === 'sans-entrait') { const yc = eave + H * collars[0], dc = dAt(yc); beam(at(side * (half - .6), eave + 1.2), at(side * dc * .55, yc - .05), T * .7); }
        }
        if (principal && system !== 'sans-entrait') {
          beam(at(-(half + .2) * (sides.length > 1 ? 1 : 0), eave + .2), at((half + .2) * sides[sides.length - 1], eave + .2), .34);
          beam(at(0, eave + .2), at(0, head + .1), .3);
          for (const side of sides) { const y = eave + H * (fine ? .5 : .3), d = dAt(y); beam(at(0, eave + H * (fine ? .15 : .12)), at(side * d, y), .2); }
        }
      };
      const ridgeLine = [], lierne = eave + H * ((collars[0] + (collars[1] ?? collars[0])) / 2) - .1;
      if (e.apse) {
        // Round an apse: half trusses radiating from a central king post, joined by rings at the collars.
        const {sides, start = -90, end = 90} = e.apse, rays = [];
        for (let i = 0; i <= sides * (between + 1); i++) rays.push({a: (start + (end - start) * i / (sides * (between + 1))) * Math.PI / 180, principal: i % (between + 1) === 0});
        for (const r of rays) { const ca = Math.cos(r.a), sa = Math.sin(r.a); truss((d, y) => [ca * Math.abs(d), y, sa * Math.abs(d)], r.principal, [1]); }
        for (let i = 0; i < rays.length - 1; i++) for (const f of [...collars, 0]) {
          const y = f ? eave + H * f : eave + .15, d = f ? dAt(y) : half, a0 = rays[i].a, a1 = rays[i + 1].a;
          beam([Math.cos(a0) * d, y, Math.sin(a0) * d], [Math.cos(a1) * d, y, Math.sin(a1) * d], .22);
        }
        beam([0, eave + .2, 0], [0, head + .1, 0], .34);
        return;
      }
      // Stations: every rafter pair (Gothic), every principal truss (later frames, whose rafters lie on purlins).
      const step = fine ? main : main / (between + 1), n = Math.max(1, Math.round((e.to - e.from) / step));
      for (let i = 0; i <= n; i++) {
        const u = e.from + (e.to - e.from) * i / n, principal = fine || i % (between + 1) === 0;
        truss((d, y) => [u, y, d], principal);
        if (principal) ridgeLine.push(u);
      }
      // Along the roof: the ties joining the king posts and their braces (Gothic), or the purlins and the
      // common rafters on them (later frames).
      beam([e.from, head - .5, 0], [e.to, head - .5, 0], .26);
      if (!fine) {
        beam([e.from, lierne, 0], [e.to, lierne, 0], .26);
        for (const u of ridgeLine) for (const du of [-1.4, 1.4]) if (u + du > e.from && u + du < e.to) beam([u, lierne - 1.4, 0], [u + du, lierne, 0], .18);
      } else {
        for (const f of [.3, .62]) { const y = eave + H * f + .25, d = dAt(y) + .15; for (const side of [-1, 1]) beam([e.from, y, side * d], [e.to, y, side * d], .24); }
        for (let u = e.from; u <= e.to + .01; u += .6) for (const side of [-1, 1]) beam([u, foot + .15, side * (half + .1)], [u, head + .2, 0], .14);
      }
    };
    G.life({phase: e.phase, until: e.until}, (ph, extra) => build(ph, extra, e.color ?? '#6b4f35'));
    if (e.rebuild) build(P(e.rebuild), {rebuilt: true}, e.rebuildColor ?? e.color ?? '#a98256');
  },

  // A Gothic crossing spire: an octagonal timber spire covered with lead over an open lantern with gables on
  // every face, crockets along its arrises, a cross and a cock; statues may stand on the roofs at its foot.
  spire(k, e, P) {
    const G = gothic(k, e, P), r = e.radius, y0 = e.base, top = e.top, lan = e.lantern ?? 10, needle = y0 + lan + 2.5;
    const lead = e.lead ?? '#5d636b', C = (i, rr, y) => G.V(Math.cos((i + .5) * Math.PI / 4) * rr, y, Math.sin((i + .5) * Math.PI / 4) * rr);
    const uv = (i, rr) => [Math.cos((i + .5) * Math.PI / 4) * rr, Math.sin((i + .5) * Math.PI / 4) * rr];
    // The collar where the spire meets the roofs.
    for (let i = 0; i < 8; i++) G.panel(C(i, r * 1.05, y0 - 5), C(i + 1, r * 1.05, y0 - 5), C(i, r * 1.05, y0), C(i + 1, r * 1.05, y0), lead, G.phase, {}, 'lead', 1.1, 0);
    // The open lantern: corner posts, a gable over every face, pinnacles at the corners.
    for (let i = 0; i < 8; i++) {
      const [u, v] = uv(i, r);
      for (let y = y0; y < y0 + lan; y += 2) G.box('wood', [u, v], y + 1, [.7, 1.98, .7], [1, 0], G.tint(e.timber ?? '#5b5650'), G.phase);
      const a = uv(i, r * 1.02), b = uv(i + 1, r * 1.02), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      G.beam('lead', [a[0], y0 + lan, a[1]], [m[0] * 1.03, y0 + lan + 4, m[1] * 1.03], .35, G.tint(lead), G.phase);
      G.beam('lead', [b[0], y0 + lan, b[1]], [m[0] * 1.03, y0 + lan + 4, m[1] * 1.03], .35, G.tint(lead), G.phase);
      G.beam('lead', [a[0], y0 + lan, a[1]], [b[0], y0 + lan, b[1]], .4, G.tint(lead), G.phase);
      G.box('lead', [u * 1.1, v * 1.1], y0 + lan + 1.2, [.5, 2.6, .5], [1, 0], G.tint(lead), G.phase);
      G.box('lead', [u * 1.1, v * 1.1], y0 + lan + 3, [.24, 1.2, .24], [1, 0], G.tint(lead), G.phase);
    }
    // The needle: eight lead faces tapering to the top, crockets up its arrises.
    const steps = Math.max(6, Math.round((top - 6 - needle) / 1.6)), rr = y => r * .78 * (1 - (y - needle) / (top - 4 - needle)) + .18;
    for (let j = 0; j < steps; j++) {
      const ya = needle + (top - 6 - needle) * j / steps, yb = needle + (top - 6 - needle) * (j + 1) / steps;
      for (let i = 0; i < 8; i++) {
        G.panel(C(i, rr(ya), ya), C(i + 1, rr(ya), ya), C(i, rr(yb), yb), C(i + 1, rr(yb), yb), lead, G.phase, {}, 'lead', 2, 0);
        if (j % 2 === 1) { const [u, v] = uv(i, rr(ya) + .25); G.box('lead', [u, v], ya, [.35, .5, .35], [1, 0], G.tint(lead), G.phase); }
      }
    }
    G.beam('lead', [0, top - 6.2, 0], [0, top - 1, 0], .3, G.tint(lead), G.phase);
    G.box('metal', [0, 0], top - 2.6, [1.4, .18, .18], [1, 0], G.tint(e.gold ?? '#c8a046'), G.phase);
    G.box('metal', [0, 0], top - .6, [.8, .7, .25], [1, 0], G.tint(e.gold ?? '#c8a046'), G.phase);
    // Statues at the foot of the spire: one group on each of the four roofs, facing out along it, standing one
    // behind another down the slope (`ridge` and `slope`: the roofs' ridge height and fall per metre across).
    if (e.statues) {
      const {count = 16, color = '#6c9b88', ridge = y0, slope = 1.2, step = [2, 1.3]} = e.statues, per = Math.ceil(count / 4);
      for (let g = 0; g < 4; g++) for (let j = 0; j < per && g * per + j < count; j++) {
        const a = g * Math.PI / 2, out = [Math.cos(a), Math.sin(a)], side = [-out[1], out[0]], dist = r + 2 + j * step[0], lat = 1.1 + j * step[1];
        G.life({phase: e.statues.phase ?? e.phase, until: e.statues.until}, (p, extra) => G.statue([out[0] * dist + side[0] * lat, out[1] * dist + side[1] * lat], ridge - lat * slope - .2, 3, out, color, p, extra));
      }
    }
  },

};
// The Renaissance château bricks (kit/renaissance.js) stand on the Gothic toolkit's walls, roofs and string courses.
Object.assign(generators, renaissance(gothic));
// The Japanese castle bricks (kit/japanese.js) are drawn with the engine's pieces alone.
Object.assign(generators, japanese());

// The order of the works. Within each phase, pieces are laid from the bottom up (by `order`, the height by
// default), evenly from 3 % to 89 % of the phase; what a phase takes down goes between 10 % and 60 % of the
// phase that removes it. Kept in one place so that scripts/chronology.mjs holds the film to the rule the
// viewer plays, not to a copy of it.
export const DEATH = {from: .1, span: .5};
export function layPieces(pieces, phases) {
  const byPhase = Array.from({length: phases}, () => []);
  pieces.forEach(piece => byPhase[piece.phase].push(piece));
  byPhase.forEach((list, phase) => {
    list.sort((a, b) => a.order - b.order);
    list.forEach((piece, rank) => { piece.birth = phase + .03 + .86 * rank / Math.max(1, list.length); });
  });
  return byPhase;
}

// ——— Scene ———
// Builds every piece of a monument (with its phase, removal and lean) without any scene, so that scripts
// can measure the model too: scripts/plan.mjs compares its footprint with the measured outline.
export function buildPieces(data) {
  const index = Object.fromEntries(data.phases.map((p, i) => [p.id, i]));
  const P = id => { if (!(id in index)) throw new Error(`Unknown phase: ${id}`); return index[id]; };
  const k = kit(random(data.seed ?? 7));
  k.masonry = data.masonry ?? 'blocks';
  // Chord error of the curves of continuous masonry, in metres: what the monument's visual quality asks of its meshes.
  k.tolerance = {basic: .01, standard: .005, cinematic: .0025}[data.visualStyle?.quality] ?? .005;
  // The photo reliefs that bricks lay themselves (no `at`), by name.
  for (const [index, spec] of data.elements.entries()) if (spec.type === 'relief' && !spec.at && spec.name) k.reliefs.set(spec.name, {spec, index});
  for (const [elementIndex, element] of data.elements.entries()) {
    const before = k.pieces.length, flatsBefore = k.flats.length;
    if(!generators[element.type])throw new Error(`Unknown brick: ${element.type}. Add a generator before loading this monument.`);
    generators[element.type](k, element, P);
    for (const piece of k.pieces.slice(before)) piece.element = elementIndex;
    for (const flat of k.flats.slice(flatsBefore)) flat.element ??= elementIndex;
    if(element.type === "timberFrame")for(const piece of k.pieces.slice(before))piece.structural=true;
    // An element's `until` takes down what it built, but not what it rebuilds afterwards (`rebuild`).
    if(element.until)for(const piece of k.pieces.slice(before))if(!piece.rebuilt)piece.until=P(element.until);
    if(element.lean)for(const piece of k.pieces.slice(before))piece.lean=1;
    if (element.ruin) {
      const fresh = k.pieces.slice(before), cut = (element.y0 ?? 0) + (element.height ?? 0) * (1 - (element.ruin.depth ?? .3));
      for (const piece of fresh) if (piece.phase < P(element.ruin.phase) && (piece.crown || piece.top > cut) && k.rand() < element.ruin.share) {
        piece.until = P(element.ruin.phase);
        if (element.ruin.restore) k.pieces.push({...piece, matrix: piece.matrix.clone(), phase: P(element.ruin.restore), until: undefined});
      }
    }
  }
  if (data.rotate) {
    const turn = new T.Matrix4().makeRotationY(data.rotate * Math.PI / 180);
    for (const piece of k.pieces) piece.matrix.premultiply(turn);
    for (const flat of k.flats) { flat.position.applyMatrix4(turn); flat.yaw += data.rotate * Math.PI / 180; }
  }
  return {pieces: k.pieces, reliefs: k.flats, P, index};
}

export function createStage(host) {
  // No multisampling on the canvas: the scene is drawn into the composer's multisampled target, and the canvas
  // only receives the finished image, one quad that has no edge to smooth.
  const renderer = new T.WebGLRenderer({antialias: false, powerPreference: 'high-performance'});
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
  // The colour pass keeps its depth in a texture, for the ambient occlusion to read.
  const composer = new EffectComposer(renderer, new T.WebGLRenderTarget(1, 1, {type: T.HalfFloatType, samples: 4, depthTexture: new T.DepthTexture(1, 1)}));
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  // Ambient occlusion: deep arcades, galleries and portals darken as they do in daylight. It reads the depth the
  // colour pass leaves and finds the normals in it, so it sees exactly what is drawn (a piece not laid yet casts
  // no occlusion) without drawing the monument a second time, and it is worked out at half the resolution,
  // which an occlusion reaching metres does not show.
  const ao = new GTAOPass(scene, camera, 1, 1);
  ao.enabled = false;
  ao.setGBuffer(composer.renderTarget1.depthTexture);
  const aoSize = ao.setSize.bind(ao);
  ao.setSize = (width, height) => aoSize(Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2)));
  // Section: a vertical plane through the view's target, facing the camera, takes away the half of the
  // monument on the camera's side, so its inside shows (vaults, roof frames, furnishings). Every material
  // of the monument and its worksites shares the plane list.
  const sectionPlanes = [], sectionPlane = new T.Plane();
  let sectioning = false;
  // The section plane stands across the view, through its centre: what lies between the camera and it is cut away.
  const followSection = () => {
    if (!sectioning) return;
    const n = controls.target.clone().sub(camera.position).setY(0);
    if (n.lengthSq() > 1e-6) sectionPlane.setFromNormalAndCoplanarPoint(n.normalize(), controls.target);
  };
  renderer.localClippingEnabled = true;
  composer.addPass(ao);
  const bloom = new UnrealBloomPass(new T.Vector2(1, 1), .55, .5, .82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const uniforms = {uProof: {value: 0}, uTime: {value: 0}, uFly: {value: FLY}, uDrop: {value: 30}, uNight: {value: 0}, uSparkle: {value: 0}, uClock: {value: 0}, uHeight: {value: 100}, uNightColor: {value: new T.Color('#ff9a2e')},
    // One leaning group per monument (a tower sinking on soft ground): pivot, axis and angle over time.
    uLeanPivot: {value: new T.Vector3()}, uLeanAxis: {value: new T.Vector3(1, 0, 0)}, uLeanAngle: {value: 0}};
  // The studio: the monument alone on a seamless paper backdrop, in soft high-key light, with its shadow and the
  // darkening where it meets the floor, as a model photographed in a studio. At night the paper turns blue-black.
  const LIGHT = {sun: '#fff3e2', sunI: 3.1, sky: '#fbf8f2', floor: '#d4cbbb', hemiI: .95, rimI: .1, ambient: .12};
  const hemi = new T.HemisphereLight(LIGHT.sky, LIGHT.floor, LIGHT.hemiI);
  const sun = new T.DirectionalLight(LIGHT.sun, LIGHT.sunI);
  const rim = new T.DirectionalLight('#5c7cff', LIGHT.rimI);
  const ambient = new T.AmbientLight('#dbe6ef', LIGHT.ambient);
  scene.add(hemi, sun, rim, ambient, sun.target);
  renderer.toneMappingExposure = 1.02; renderer.shadowMap.type = T.PCFShadowMap;
  // The linear colour that ACES tone mapping (as three.js applies it, at this exposure) turns into `target`:
  // the backdrop then shows exactly as paper.
  const acesInverse = (target, exposure) => {
    const A = [[.59719, .35458, .04823], [.076, .90834, .01566], [.0284, .13383, .83777]], B = [[1.60475, -.53108, -.07367], [-.10208, 1.10813, -.00605], [-.00327, -.07276, 1.07602]];
    const mul = (M, v) => M.map(row => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]), fit = v => v.map(x => (x * (x + .0245786) - .000090537) / (x * (.983729 * x + .432951) + .238081));
    const forward = v => mul(B, fit(mul(A, v.map(x => x * exposure / .6)))).map(x => Math.min(1, Math.max(0, x)));
    const goal = [target.r, target.g, target.b]; let v = goal.slice();
    for (let i = 0; i < 200; i++) { const out = forward(v); v = v.map((x, j) => Math.max(0, x + (goal[j] - out[j]) * (1 + x))); }
    return new T.Color(...v);
  };
  const NIGHT = new T.Color().setRGB(.03, .042, .085), paper = acesInverse(new T.Color('#f4f1ea'), renderer.toneMappingExposure);
  scene.background = paper.clone();
  // A light haze of the paper's colour softens what lies far behind the monument.
  scene.fog = new T.FogExp2(paper.clone(), .0011);
  const studioFloor = new T.Mesh(new T.CircleGeometry(1, 96), new T.ShadowMaterial({color: '#4a3f30', opacity: .26}));
  studioFloor.rotation.x = -Math.PI / 2; studioFloor.position.y = .01; studioFloor.receiveShadow = true; scene.add(studioFloor);
  let visual = resolveVisualStyle({quality: 'basic'});

  const meshes = [];
  // Human-scale construction tableaux, described and sourced per phase. They are deliberately kept
  // outside buildPieces(): workers, dust and temporary tools must not alter plan or height checks.
  const siteGroups = [], siteActors = [], siteDust = [], siteRigs = [];
  let siteGeneration = 0, lastClock;
  const siteBox = new T.BoxGeometry(1, 1, 1), siteCylinder = new T.CylinderGeometry(1, 1, 1, 8), siteHead = new T.SphereGeometry(1, 12, 8);
  const siteMaterials = new Map();
  const siteMaterial = (color, kind = 'matte') => {
    const key = `${color}:${kind}`;
    if (!siteMaterials.has(key)) siteMaterials.set(key, new T.MeshStandardMaterial({color, emissive: color, emissiveIntensity: .07, roughness: kind === 'metal' ? .42 : .9, metalness: kind === 'metal' ? .55 : 0, clippingPlanes: sectionPlanes}));
    return siteMaterials.get(key);
  };
  const siteMesh = (group, geometry, material, position, scale) => {
    const mesh = new T.Mesh(geometry, material); mesh.position.set(...position); mesh.scale.set(...scale); group.add(mesh); return mesh;
  };
  const siteBeam = (group, a, b, radius, material) => {
    const A = new T.Vector3(...a), B = new T.Vector3(...b), direction = B.clone().sub(A), mesh = siteMesh(group, siteCylinder, material, A.add(B).multiplyScalar(.5).toArray(), [radius, direction.length(), radius]);
    mesh.quaternion.setFromUnitVectors(UP, direction.normalize()); return mesh;
  };

  // ——— Figures ———
  // Workers are animated characters (kit/assets/characters, CC0 by Quaternius; credits in sources.json there): a
  // craftsman in shirt and trousers before the industrial age, a builder in helmet and vest after it. Each is
  // dressed in the scene's palette, holds a mallet or shoulders a load, and plays its own animation (working,
  // striking, walking to and fro). Until a model has loaded, or where it cannot load, a simple stand-in shows.
  const CHARACTERS = {traditional: 'worker-traditional.glb', modern: 'worker-modern.glb'}, characterAssets = {};
  let charactersPending = 0;
  const loadCharacter = era => characterAssets[era] ??= new Promise(resolve => {
    charactersPending++;
    new GLTFLoader().load(new URL(`./assets/characters/${CHARACTERS[era] ?? CHARACTERS.traditional}`, import.meta.url).href,
      gltf => { charactersPending--; resolve(gltf); }, undefined, () => { charactersPending--; resolve(null); });
  });
  const ROLE_CLIP = {mason: 'Interact', lift: 'Sword_Slash', carry: 'Walk', idle: 'Idle'};
  function standIn(actor, palette, role, offset) {
    const cloth = siteMaterial(palette[Math.floor(offset) % palette.length]), skin = siteMaterial('#9a6949'), dark = siteMaterial('#3c342d'), stone = siteMaterial('#a89a83');
    const body = new T.Group(); actor.add(body);
    siteMesh(body, siteCylinder, cloth, [0, 1.14, 0], [.19, .58, .19]);
    siteMesh(body, siteHead, skin, [0, 1.59, 0], [.14, .16, .14]);
    siteMesh(body, siteBox, dark, [0, 1.72, 0], [.22, .07, .2]);
    siteBeam(body, [-.1, .84, 0], [-.11, .1, .02], .065, dark);
    siteBeam(body, [.1, .84, 0], [.13, .1, -.02], .065, dark);
    const arms = [];
    for (const side of [-1, 1]) {
      const pivot = new T.Group(); pivot.position.set(side * .2, 1.38, 0); body.add(pivot);
      siteMesh(pivot, siteCylinder, skin, [0, -.24, 0], [.055, .48, .055]);
      pivot.rotation.z = side * (role === 'lift' ? 2.45 : role === 'carry' ? 1.3 : .45); arms.push(pivot);
    }
    if (role === 'carry') siteMesh(body, siteBox, stone, [0, 1.03, .28], [.5, .2, .28]);
    if (role === 'mason') { body.scale.y = .82; siteMesh(body, siteBox, stone, [0, .35, .45], [.32, .2, .34]); }
    return {body, arms};
  }
  function makeWorker(parent, x, z, turn, palette, role, offset, era = 'traditional') {
    const actor = new T.Group(); actor.position.set(x, 0, z); actor.rotation.y = turn; parent.add(actor);
    const {body, arms} = standIn(actor, palette, role, offset);
    actor.userData = {baseY: 0, baseTurn: turn, offset, arms, role, base: [x, z]}; siteActors.push(actor);
    const generation = siteGeneration;
    loadCharacter(era).then(gltf => {
      if (!gltf || generation !== siteGeneration) return;
      const figure = cloneSkinned(gltf.scene), shirt = new T.Color(palette[Math.floor(offset) % palette.length]), trousers = new T.Color(palette[(Math.floor(offset) + 2) % palette.length]).multiplyScalar(.7);
      figure.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = o.receiveShadow = true; o.frustumCulled = false;
        const dress = m => {
          const c = m.clone(); c.roughness = .9; c.metalness = 0; c.clippingPlanes = sectionPlanes;
          if (['Beige', 'Worker_Vest'].includes(m.name)) c.color.copy(shirt);
          if (['LightBlue', 'Brown2'].includes(m.name)) c.color.copy(trousers);
          return c;
        };
        o.material = Array.isArray(o.material) ? o.material.map(dress) : dress(o.material);
      });
      // A figure stands 1.7 m tall, whatever the model's own units.
      figure.updateMatrixWorld(true);
      const head = new T.Vector3(); figure.getObjectByName('Head')?.getWorldPosition(head);
      figure.scale.multiplyScalar(head.y > 0 ? 1.55 / head.y : 1);
      const mixer = new T.AnimationMixer(figure), clip = gltf.animations.find(a => a.name.endsWith(`|${ROLE_CLIP[role] ?? 'Idle'}`)) ?? gltf.animations[0];
      if (clip) { const action = mixer.clipAction(clip); action.time = (offset * 1.37) % clip.duration; action.timeScale = .8 + (offset % 1) * .3; action.play(); }
      // The tool in the right hand: a mallet to strike or work, a load on the shoulder to carry.
      const hand = figure.getObjectByName('Wrist.R');
      if (hand) {
        figure.updateMatrixWorld(true);
        const tool = new T.Group(), k = 1 / hand.getWorldScale(new T.Vector3()).x, wood = siteMaterial('#6b4a2e');
        if (role === 'carry') siteMesh(tool, siteBox, siteMaterial('#a08060'), [0, .12, 0], [.22, .22, 1.6]);
        else { siteMesh(tool, siteCylinder, wood, [0, -.12, .05], [.022, .38, .022]); siteMesh(tool, siteBox, wood, [0, -.3, .05], [.1, .1, .2]); }
        tool.scale.setScalar(k); hand.add(tool);
      }
      body.removeFromParent(); actor.add(figure);
      actor.userData.arms = null; actor.userData.mixer = mixer; actor.userData.walker = role === 'carry';
    });
  }

  // ——— Scaffolds fitted to the work ———
  // A scaffold stands where the masonry of its phase rises. Its line follows the outermost face of the pieces
  // laid during the phase (or, if the phase lays none there, of those standing) at a constant gap: around the
  // monument's centre for a facade (`facade`, over `width` metres of wall centred on the scene), around the
  // scene's centre for a ring, an apse, a tower or a spire (`ring`, `tower`; from `base` metres up, `arc` and
  // `start` in degrees). It is raised lift by lift: each lift appears when the masonry beside it reaches its
  // foot, and it comes down when the phase ends. Timber poles with putlogs into the wall before the industrial
  // age (`material: "timber"`), steel tubes on two rows of standards with guard rails after (`"steel"`).
  const ZERO = new T.Matrix4().makeScale(0, 0, 0);
  // A worksite's figures: `figures` ("traditional" or "modern"), or modern where the scaffold is of steel tubes.
  const eraOf = spec => spec.figures ?? (typeof spec.scaffold === 'object' && spec.scaffold.material === 'steel' ? 'modern' : 'traditional');
  function fitScaffold(group, site, spec, phase) {
    const cfg = typeof spec.scaffold === 'object' ? spec.scaffold : {}, kind = cfg.kind ?? 'facade', steel = cfg.material === 'steel';
    const lift = cfg.levelHeight ?? 2, gap = cfg.gap ?? .45, depth = cfg.depth ?? (steel ? 1.1 : 1.3), base = cfg.base ?? 0, ceiling = cfg.height !== undefined ? base + cfg.height : Infinity;
    const o = group.position, c = Math.cos(turnY), s = Math.sin(turnY);
    const local = (x, z) => { const dx = x - o.x, dz = z - o.z; return [dx * c - dz * s, dx * s + dz * c]; };
    const pc = kind === 'facade' ? local(monument.view.target[0], monument.view.target[2]) : (cfg.offset ?? [0, 0]);
    let mid, half;
    if (kind === 'facade') { mid = Math.atan2(-pc[1], -pc[0]); half = Math.min(Math.PI * .9, (cfg.width ?? (spec.radius ?? 14) * 1.45) / 2 / Math.max(4, Math.hypot(...pc))); }
    else if (cfg.arc && cfg.arc < 360) { const a0 = (cfg.start ?? -90) * Math.PI / 180, a1 = a0 + cfg.arc * Math.PI / 180; mid = (a0 + a1) / 2; half = (a1 - a0) / 2; }
    else { mid = 0; half = Math.PI; }
    const full = half >= Math.PI - 1e-6;
    const reach = cfg.reach ?? (kind === 'facade' ? (cfg.width ?? 20) / 2 + 8 : (cfg.radius ?? (cfg.width ?? spec.radius ?? 14) / 2) + 8);
    const angleOf = (x, z) => Math.atan2(Math.sin(Math.atan2(z - pc[1], x - pc[0]) - mid), Math.cos(Math.atan2(z - pc[1], x - pc[0]) - mid));
    const corners = [];
    for (const x of [-.5, .5]) for (const y of [-.5, .5]) for (const z of [-.5, .5]) corners.push(new T.Vector3(x, y, z));
    const gather = test => {
      const out = [], v = new T.Vector3();
      for (const piece of builtPieces) {
        if (!test(piece)) continue;
        const pts = corners.map(corner => { v.copy(corner).applyMatrix4(piece.matrix); const [x, z] = local(v.x, v.z); return [x, v.y, z]; });
        const topY = Math.max(...pts.map(p => p[1]));
        if (topY < base + .3 || Math.min(...pts.map(p => p[1])) > ceiling) continue;
        const near = pts.filter(([x, , z]) => Math.hypot(x, z) <= reach && Math.abs(angleOf(x, z)) <= half);
        if (near.length) out.push({birth: piece.birth, top: Math.min(topY, ceiling), pts: near});
      }
      return out;
    };
    let found = gather(p => p.phase === phase);
    if (found.length < 8) found = gather(p => p.birth < phase + 1 && p.death > phase);
    if (!found.length) return;
    // Angular bins about one bay (2.2 m) long on the face; the outermost face and the masonry's rise in each.
    const radii = found.flatMap(f => f.pts.map(([x, , z]) => Math.hypot(x - pc[0], z - pc[1]))).sort((a, b) => a - b), rRef = radii[Math.floor(radii.length * .9)];
    const bays = Math.max(full ? 8 : 3, Math.round(2 * half * rRef / 2.2)), width = 2 * half / bays;
    const bins = Array.from({length: bays}, () => ({r: 0, events: []})), binOf = (x, z) => Math.min(bays - 1, Math.max(0, Math.floor((angleOf(x, z) + half) / width)));
    for (const f of found) for (const [x, , z] of f.pts) { const i = binOf(x, z); bins[i].r = Math.max(bins[i].r, Math.hypot(x - pc[0], z - pc[1])); }
    // Only the outer face counts for the scaffold's rise: pieces within `zone` metres of it (3 by default).
    const zone = cfg.zone ?? 3;
    for (const f of found) {
      const hit = new Set();
      for (const [x, , z] of f.pts) { const i = binOf(x, z); if (Math.hypot(x - pc[0], z - pc[1]) >= bins[i].r - zone) hit.add(i); }
      for (const i of hit) bins[i].events.push(f);
    }
    for (const bin of bins) {
      bin.events.sort((a, b) => a.birth - b.birth);
      let rise = -Infinity; bin.rise = bin.events.map(e => (rise = Math.max(rise, e.top), [e.birth - phase, rise]));
      bin.top = bin.events.length ? Math.min(ceiling, bin.rise.at(-1)[1]) : 0;
    }
    // When the masonry of bin i first reaches height y (phase progress 0..1), or null if it never does. A
    // scaffold put up before the work (`rise: "first"`, for a restoration or a spire built inside its cage)
    // goes up lift by lift in the first tenth of the phase instead.
    const finalTop = Math.max(...bins.map(b => b.top));
    const reaches = cfg.rise === 'first'
      ? (i, y) => y <= bins[i].top ? .01 + .1 * (y - base) / Math.max(1, finalTop - base) : null
      : (i, y) => { for (const [t, h] of bins[i].rise) if (h >= y) return Math.max(.02, Math.min(.97, t)); return null; };
    const ring = i => full ? (i + bays) % bays : i, edge = j => { const a = [bins[ring(j - 1)], bins[ring(j)]].filter(b => b?.events.length); return a.length ? Math.max(...a.map(b => b.r)) : 0; };
    const P = (j, r, y) => { const a = mid - half + j * width; return new T.Vector3(pc[0] + Math.cos(a) * r, y, pc[1] + Math.sin(a) * r); };
    // Parts are instanced by material and shown when their lift is raised.
    const kinds = steel ? {tube: siteMaterial('#a3abb2', 'metal'), board: siteMaterial('#a5814f'), toe: siteMaterial('#b8955f')} : {tube: siteMaterial('#8a7254'), board: siteMaterial('#9d8263'), toe: siteMaterial('#6f5a43')};
    const parts = {tube: [], board: [], toe: []}, m = new T.Matrix4(), q = new T.Quaternion();
    const pole = (a, b, r, reveal, mat = 'tube') => { const d = b.clone().sub(a), len = d.length(); if (len < .05) return; q.setFromUnitVectors(UP, d.normalize()); parts[mat].push({matrix: m.compose(a.clone().add(b).multiplyScalar(.5), q, new T.Vector3(r, len, r)).clone(), reveal}); };
    const slab = (a, b, w, h, y, reveal, mat = 'board') => { const d = b.clone().sub(a); d.y = 0; const len = d.length(); if (len < .05) return; q.setFromAxisAngle(UP, Math.atan2(-d.z, d.x)); parts[mat].push({matrix: m.compose(a.clone().add(b).multiplyScalar(.5).setY(y), q, new T.Vector3(len, h, w)).clone(), reveal}); };
    const raised = (i, y) => bins[i]?.events.length ? reaches(i, y) : null;
    const span = bays, decks = [];
    for (let i = 0; i < span; i++) {
      if (!bins[i].events.length) continue;
      const j0 = i, j1 = i + 1, r0 = edge(j0), r1 = edge(j1), top = Math.max(bins[i].top, bins[ring(i - 1)]?.top ?? 0, bins[ring(i + 1)]?.top ?? 0);
      const rows = steel ? [gap, gap + depth] : [gap + depth];
      for (let y0 = base, level = 0; y0 < top - .2; y0 += lift, level++) {
        const reveal = raised(i, y0 + .3);
        if (reveal === null) break;
        const y1 = y0 + lift;
        // Standards at both ends of the bay (the next bay shares the far one), ledgers along it.
        for (const off of rows) {
          pole(P(j0, r0 + off, y0), P(j0, r0 + off, y1), steel ? .045 : .085, reveal);
          if ((!full && i === span - 1) || !bins[ring(i + 1)]?.events.length) pole(P(j1, r1 + off, y0), P(j1, r1 + off, y1), steel ? .045 : .085, reveal);
          pole(P(j0, r0 + off, y1 - .05), P(j1, r1 + off, y1 - .05), steel ? .04 : .065, reveal);
        }
        // Putlogs set into the wall (timber) or transoms between the two rows (steel), then the deck.
        if (steel) pole(P(j0, r0 + gap, y1 - .02), P(j0, r0 + gap + depth, y1 - .02), .035, reveal);
        else pole(P(j0, r0 - .3, y1 + .02), P(j0, r0 + gap + depth + .18, y1 + .02), .06, reveal);
        const boards = steel ? 4 : 3, bw = depth / boards;
        for (let b = 0; b < boards; b++) { const r = gap + bw * (b + .5); slab(P(j0, r0 + r, 0), P(j1, r1 + r, 0), bw * .92, .05, y1 + .08, reveal); }
        decks.push({i, y: y1, reveal});
        // Bracing on the outer face, one bay in two, and a ladder every sixth bay.
        const out = gap + depth;
        if ((i + level) % 2 === 0) pole(P(j0, r0 + out, (i % 4 < 2) ? y0 : y1), P(j1, r1 + out, (i % 4 < 2) ? y1 : y0), steel ? .03 : .05, reveal);
        if (steel) {
          for (const h of [.5, 1]) pole(P(j0, r0 + out, y1 + h), P(j1, r1 + out, y1 + h), .03, reveal);
          slab(P(j0, r0 + out - .02, 0), P(j1, r1 + out - .02, 0), .03, .15, y1 + .15, reveal, 'toe');
        }
        if (i % 6 === 3) {
          const lr = r0 + (steel ? gap + depth / 2 : out + .3);
          for (const side of [-.25, .25]) { const a = P(j0, lr, y0), b = P(j0, lr, y1 + .9), t = P(j1, lr, 0).sub(P(j0, lr, 0)).setY(0).normalize().multiplyScalar(side + .6); pole(a.clone().add(t), b.clone().add(t), .03, reveal, 'toe'); }
          for (let y = y0 + .3; y < y1 + .8; y += .32) { const a = P(j0, lr, y), t = P(j1, lr, 0).sub(P(j0, lr, 0)).setY(0).normalize(); slab(a.clone().add(t.clone().multiplyScalar(.35)), a.clone().add(t.clone().multiplyScalar(.85)), .05, .04, y, reveal, 'toe'); }
        }
      }
    }
    for (const [name, list] of Object.entries(parts)) {
      if (!list.length) continue;
      const mesh = new T.InstancedMesh(name === 'tube' ? siteCylinder : siteBox, kinds[name], list.length);
      list.forEach((part, i) => mesh.setMatrixAt(i, ZERO));
      mesh.frustumCulled = false; mesh.castShadow = mesh.receiveShadow = Boolean(visual.quality.shadows);
      group.add(mesh); site.scaffoldSets.push({mesh, list, shown: new Uint8Array(list.length)});
    }
    // Where a hoist can stand: just outside the scaffold, in its middle bay, facing the wall.
    const centreBay = Math.floor(bays / 2), outside = P(centreBay + .5, edge(centreBay) + gap + depth + 2.5, 0);
    site.hoistAt = [outside.x, outside.z]; site.hoistTurn = -(mid - half + (centreBay + .5) * width);
    // Masons on the top deck of a few bays, moving up as the scaffold rises.
    const palette = spec.clothes ?? ['#9a5b38', '#5c6f7b', '#7c6943', '#6d4c45'];
    for (const [n, deck] of decks.entries()) {
      if (deck.i % 5 !== 2) continue;
      const next = decks.find(d => d.i === deck.i && d.y > deck.y), pos = P(deck.i + .5, edge(deck.i) + gap + depth * .45, deck.y + .1);
      const before = siteActors.length;
      makeWorker(group, pos.x, pos.z, -(mid - half + (deck.i + .5) * width) + Math.PI / 2, palette, n % 2 ? 'mason' : 'lift', n * 1.3, eraOf(spec));
      const actor = siteActors[before];
      if (actor) { actor.userData.baseY = deck.y + .1; actor.userData.siteReveal = deck.reveal; actor.userData.siteHide = next?.reveal ?? 1.01; site.scaffoldParts.push(actor); }
    }
  }

  function makeWorksite(spec, phase, seed) {
    const group = new T.Group(), rand = random(seed), [cx, cz] = spec.at ?? [0, 0], radius = Math.max(4, spec.radius ?? 14), height = Math.max(3, spec.height ?? 9);
    const site = {group, phase, spec, scaffoldParts: [], scaffoldSets: [], progress: 0};
    // Worksites are written in the monument's own frame: they turn with it ("rotate").
    group.position.copy(toWorld([cx, 0, cz])); group.rotation.y = turnY; group.visible = false; scene.add(group); siteGroups.push(site);
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

    if (spec.scaffold) fitScaffold(group, site, spec, phase);

    if (spec.hoist) {
      // Without an offset, a hoist stands just outside the scaffold, its boom over the wall.
      const cfg = typeof spec.hoist === 'object' ? spec.hoist : {kind: 'gin-pole'}, kind = cfg.kind ?? 'gin-pole', [hx, hz] = cfg.offset ?? site.hoistAt ?? [radius * .35, -radius * .08];
      const rig = new T.Group(); rig.position.set(hx, 0, hz); if (!cfg.offset && site.hoistTurn !== undefined) rig.rotation.y = site.hoistTurn + Math.PI / 2; group.add(rig);
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
      makeWorker(group, Math.cos(angle) * distance, Math.sin(angle) * distance, -angle + Math.PI / 2 + (rand() - .5) * .5, palette, ['mason', 'carry', 'lift'][i % 3], i * 1.7 + rand(), eraOf(spec));
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

  let monument = null, total = 1, heightTrack = [], tagTrack = {}, leaning = null, turnY = 0, outlineGroup = null, builtPieces = [];
  // A point of the monument file ([x, y, z] or [x, z]) in the scene, after the monument's "rotate".
  const toWorld = p => {
    if (!p) return p;
    const [x, y, z] = p.length === 2 ? [p[0], 0, p[1]] : p, c = Math.cos(turnY), s = Math.sin(turnY);
    return new T.Vector3(x * c + z * s, y, -x * s + z * c);
  };

  // Pieces grow into place, drop from above, are taken down and lean, in the colour pass and in the shadow
  // pass alike: a piece that is not built yet casts no shadow.
  function growVertex(shader, pbr) {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aLife; attribute float aSeed; attribute float aLean; attribute vec3 aCenter;
        uniform float uTime,uFly,uDrop,uLeanAngle; uniform vec3 uLeanPivot,uLeanAxis;
        varying float vGlow; varying float vWorldY; varying float vSeed;
        ${pbr ? 'varying vec3 vPbrPosition; varying vec3 vPbrNormal;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        bool piece=aLife.y>0.;
        float kIn=piece?clamp((uTime-aLife.x)/uFly,0.,1.):1.;
        float kOut=piece?clamp((uTime-aLife.y)/uFly,0.,1.):0.;
        float eIn=1.-pow(1.-kIn,3.);
        float alive=piece?step(aLife.x,uTime)*(1.-kOut):1.;
        // A piece grows about its own centre: the origin of an instance, the middle of a patch of surface.
        transformed=aCenter+(transformed-aCenter)*(alive*mix(.55,1.,eIn));
        vGlow=piece?step(aLife.x,uTime)*(1.-smoothstep(0.,1.,(uTime-aLife.x)/(uFly*2.))):0.;
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

  // `merged`: the material of a mesh of patches (kit/masonry.js), which carries its colour per vertex and, for stone,
  // draws its own joints from `aMason` (s along the wall, height, course): a continuous wall still reads as coursed
  // ashlar, with its joints the width they are in the photographs, fading out where a pixel is wider than a joint.
  function material(kind, merged = false) {
    const {pbr, ...surface} = pbrOptions(kind, visual, renderer), mat = new T.MeshStandardMaterial({color: '#ffffff', ...KINDS[kind], ...surface, vertexColors: merged, clippingPlanes: sectionPlanes});
    const joints = merged && kind === 'stone', leaded = merged && kind === 'glass', slated = merged && kind === 'slate', patterned = joints || leaded || slated;
    // Gold leaf reflects the studio round it: without it a metal looks dark and olive.
    if (kind === 'gilt') { mat.userData.gilt = true; mat.envMapIntensity = .85; }
    // Every kind compiles its own program: three.js would otherwise reuse a textured (PBR) program for a
    // plain material with the same parameters, which then samples a stray texture.
    mat.customProgramCacheKey = () => `piece:${kind}:${merged ? 'patch' : 'instance'}:${pbr ? ['albedo', 'normal', 'roughness', 'ao'].map(key => pbr[key] ? key[0] : '-').join('') : 'plain'}`;
    mat.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms);
      shader.uniforms.uGlow = {value: new T.Color(kind === 'metal' ? '#ffb15c' : kind === 'wood' ? '#ffcf8a' : '#ffd9a8')};
      shader.uniforms.uKind = {value: kind === 'metal' ? 1 : kind === 'stone' ? 0 : -1};
      if (pbr) Object.assign(shader.uniforms, {
        uPbrAlbedo: {value: pbr.albedo}, uPbrNormal: {value: pbr.normal ?? pbr.albedo}, uPbrRoughness: {value: pbr.roughness ?? pbr.albedo}, uPbrAo: {value: pbr.ao ?? pbr.albedo},
        uPbrScale: {value: pbr.scale}, uPbrNormalScale: {value: pbr.normal ? pbr.normalScale : 0},
      });
      growVertex(shader, pbr);
      // Evidence mode: each piece takes the colour of its provenance (measured, documented, interpreted).
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aProof; varying float vProof;${patterned ? 'attribute vec3 aMason; varying vec3 vMason;' : ''}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vProof=aProof;${patterned ? 'vMason=aMason;' : ''}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uProof; varying float vProof;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          ${joints ? MASON_COLOR : leaded ? GLASS_COLOR : slated ? SLATE_COLOR : ''}
          if(uProof>0.){vec3 proof=vProof<.5?vec3(.2,.78,.62):vProof<1.5?vec3(.38,.53,1.):vProof<2.5?vec3(1.,.66,.25):vec3(.5,.5,.52);
            diffuseColor.rgb=mix(diffuseColor.rgb,proof*.9,.72*uProof);}`);
      if (patterned) shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
          ${MASON_PARS}`);
      // Shelter: a piece deep in the shade of a gallery or a portal (piece.shelter, 0 to 1) takes that share less
      // of the direct lights that no shadow map stops (the cool rim light; the sun too when shadows are off), so
      // that it neither glows blue nor mirrors that light at a grazing angle, where the photos show deep shade.
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aShelter; varying float vShelter;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vShelter=aShelter;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying float vShelter;`)
        .replace('#include <lights_fragment_begin>', T.ShaderChunk.lights_fragment_begin.replace(/(getDirectionalLightInfo\( directionalLight, directLight \);[\s\S]*?)(RE_Direct\()/, `$1#if !defined( USE_SHADOWMAP ) || ( UNROLLED_LOOP_INDEX >= NUM_DIR_LIGHT_SHADOWS )
		directLight.color *= 1. - vShelter;
		#endif
		$2`));
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
          vec3 pbrMapped=normalize(nx*pbrWn.x+ny*pbrWn.y+nz*pbrWn.z);normal=normalize(mix(normal,normalize(mat3(viewMatrix)*pbrMapped),min(.5,uPbrNormalScale*.45)));${joints ? MASON_NORMAL : ''}` : `#include <normal_fragment_maps>${joints ? MASON_NORMAL : ''}`)
        .replace('#include <aomap_fragment>', pbr?.ao ? `#include <aomap_fragment>
          reflectedLight.indirectDiffuse*=mix(1.,pbrSample(uPbrAo,pbrWeights()).r,.65);` : '#include <aomap_fragment>')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance+=uGlow*vGlow*.25;
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
    const mat = new T.MeshDepthMaterial({depthPacking: T.RGBADepthPacking, clippingPlanes: sectionPlanes});
    mat.customProgramCacheKey = () => 'piece:shadow';
    mat.onBeforeCompile = shader => { Object.assign(shader.uniforms, uniforms); growVertex(shader, null); };
    return mat;
  }

  // ——— Photo reliefs ———
  // A carved panel from a photograph: one quad, rectified by a homography from the four corners the panel
  // has in the photo, cut to its outline, its light and shade read as height (parallax and normals), toned so
  // that its mean colour is the stone's around it. It grows, falls and is rebuilt like the pieces.
  const reliefLoader = new T.TextureLoader();
  let reliefsPending = 0, reliefGeneration = 0;
  // One texture a photo, however many panels are cut from it (a dormer's front repeated along a roof).
  const photos = new Map();
  const loadPhoto = url => {
    if (!photos.has(url)) photos.set(url, new Promise((done, fail) => reliefLoader.load(url, texture => {
      texture.colorSpace = T.SRGBColorSpace; texture.anisotropy = renderer.capabilities.getMaxAnisotropy(); done(texture);
    }, undefined, fail)));
    return photos.get(url);
  };
  // Is the photo's pixel (x, y) inside the relief's `outline` (a polygon in image pixels)?
  const insidePolygon = (points, x, y) => { let c = false; for (let i = 0, j = points.length - 1; i < points.length; j = i++) { const [xi, yi] = points[i], [xj, yj] = points[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  // The outline as a mask over the photo, white inside: the panel shows the photo only where the mask is.
  function outlineMask(points, width, height) {
    const k = 512 / Math.max(width, height), canvas = document.createElement('canvas'); canvas.width = Math.max(2, Math.round(width * k)); canvas.height = Math.max(2, Math.round(height * k));
    const c = canvas.getContext('2d'); c.fillStyle = '#000'; c.fillRect(0, 0, canvas.width, canvas.height); c.fillStyle = '#fff';
    c.beginPath(); points.forEach(([x, y], i) => c[i ? 'lineTo' : 'moveTo'](x * k, y * k)); c.closePath(); c.fill();
    return new T.CanvasTexture(canvas);
  }
  const noMask = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); noMask.needsUpdate = true;
  // Unit square (u right, v up) to the photo's texture coordinates, through its four corners (Heckbert).
  function homography(corners, width, height) {
    const [tl, tr, br, bl] = corners.map(([x, y]) => [x / width, 1 - y / height]), [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = [bl, br, tr, tl];
    const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3, dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, den = dx1 * dy2 - dx2 * dy1;
    const g = Math.abs(sx) + Math.abs(sy) < 1e-12 ? 0 : (sx * dy2 - dx2 * sy) / den, h = Math.abs(sx) + Math.abs(sy) < 1e-12 ? 0 : (dx1 * sy - sx * dy1) / den;
    return new T.Matrix3().set(x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1);
  }
  // The photo's colour over the panel, in linear light, for toning it to the stone: the mean of its lit
  // faces (the brighter 60 to 97% of it), so that the carving's shadows and dark doorways stay darker than
  // the wall, as they are, instead of brightening the whole relief.
  function meanColour(image, H, inside = () => true) {
    const canvas = document.createElement('canvas'), size = 96; canvas.width = canvas.height = size;
    const context = canvas.getContext('2d', {willReadFrequently: true}); context.drawImage(image, 0, 0, size, size);
    const pixels = context.getImageData(0, 0, size, size).data, linear = c => (c /= 255) <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4, samples = [];
    for (let i = 0; i < 48; i++) for (let j = 0; j < 48; j++) {
      if (!inside((i + .5) / 48, (j + .5) / 48)) continue;
      const q = new T.Vector3((i + .5) / 48, (j + .5) / 48, 1).applyMatrix3(H), x = Math.floor(q.x / q.z * size), y = Math.floor((1 - q.y / q.z) * size);
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const k = (y * size + x) * 4, rgb = [0, 1, 2].map(c => linear(pixels[k + c]));
      samples.push([.2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2], ...rgb]);
    }
    if (!samples.length) return new T.Color(1, 1, 1);
    samples.sort((a, b) => a[0] - b[0]);
    const kept = samples.slice(Math.floor(samples.length * .6), Math.max(Math.floor(samples.length * .6) + 1, Math.floor(samples.length * .97)));
    const sum = kept.reduce((m, s2) => [m[0] + s2[1], m[1] + s2[2], m[2] + s2[3]], [0, 0, 0]);
    return new T.Color(sum[0] / kept.length, sum[1] / kept.length, sum[2] / kept.length);
  }
  // The stone around a relief is its colour times the stone's albedo map (mixed at 70%, as the pieces'
  // shader does): the relief is toned to that, so it is neither brighter nor duller than its wall.
  const albedoGain = async () => {
    const texture = pbrOptions('stone', visual, renderer).pbr?.albedo;
    if (!texture) return new T.Color(1, 1, 1);
    for (let i = 0; i < 200 && !texture.image?.width; i++) await new Promise(done => setTimeout(done, 50));
    if (!texture.image?.width) return new T.Color(1, 1, 1);
    const mean = meanColour(texture.image, new T.Matrix3());
    return new T.Color(.3 + .7 * mean.r, .3 + .7 * mean.g, .3 + .7 * mean.b);
  };
  // The panel's outline in metres (x from its centre, y from its foot): rect, round, pointed (with `rise`) or circle.
  const SHAPES2D = {rect: 0, round: 1, pointed: 2, circle: 3};
  function insideOutline(o, x, y) {
    const {kind = 'rect', w, h, spring = 0, rise, cx = 0} = o; x -= cx;
    if (Math.abs(x) > w / 2 || y < 0 || y > h) return false;
    if (kind === 'circle') return (x / (w / 2)) ** 2 + ((y - h / 2) / (h / 2)) ** 2 <= 1;
    if (kind === 'rect' || y <= spring) return true;
    if (kind === 'round') return x * x + (y - spring) ** 2 <= w * w / 4;
    const a = rise || h - spring, r = (w * w / 4 + a * a) / w, d = Math.abs(x) + r - w / 2;
    return d * d + (y - spring) ** 2 <= r * r;
  }
  function makeRelief(flat, birth, death, base) {
    const spec = flat.spec, [w, h] = spec.size, recess = spec.recess, outline = {kind: 'rect', ...spec.shape, w, h};
    // A recessed panel (a portal's splay) is a funnel: each point goes back by how far it lies between the
    // outline (on the wall face) and the inner outline (`recess`: width, spring, rise, offset, at `depth`).
    const geometry = new T.PlaneGeometry(w, h, recess ? 80 : 1, recess ? Math.round(80 * h / w) : 1), count = geometry.attributes.position.count;
    if (recess) {
      const inner = {kind: outline.kind, w: recess.width, h, spring: recess.spring ?? outline.spring, rise: recess.rise, cx: recess.offset ?? 0};
      const at = f => ({kind: outline.kind, h, w: w + (inner.w - w) * f, spring: (outline.spring ?? 0) + ((inner.spring ?? 0) - (outline.spring ?? 0)) * f, rise: (outline.rise || h - (outline.spring ?? 0)) + ((inner.rise || h - inner.spring) - (outline.rise || h - (outline.spring ?? 0))) * f, cx: inner.cx * f});
      const position = geometry.attributes.position;
      for (let i = 0; i < count; i++) {
        const x = Math.max(-w / 2 + 1e-4, Math.min(w / 2 - 1e-4, position.getX(i))), y = Math.max(1e-4, Math.min(h - 1e-4, position.getY(i) + h / 2));
        let f = 0;
        if (insideOutline(at(1), x, y)) f = 1;
        else if (insideOutline(at(0), x, y)) { let lo = 0, hi = 1; for (let k2 = 0; k2 < 14; k2++) { const mid = (lo + hi) / 2; if (insideOutline(at(mid), x, y)) lo = mid; else hi = mid; } f = lo; }
        position.setZ(i, -recess.depth * f);
      }
      geometry.computeVertexNormals();
    }
    const life = new Float32Array(count * 2); for (let i = 0; i < count; i++) { life[i * 2] = birth; life[i * 2 + 1] = death; }
    geometry.setAttribute('aLife', new T.BufferAttribute(life, 2));
    geometry.setAttribute('aSeed', new T.BufferAttribute(new Float32Array(count), 1));
    geometry.setAttribute('aLean', new T.BufferAttribute(new Float32Array(count), 1));
    geometry.setAttribute('aCenter', new T.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aProof', new T.BufferAttribute(new Float32Array(count).fill(provenanceOf(spec)), 1));
    geometry.setAttribute('aReliefUv', geometry.attributes.uv.clone());
    const local = {uPhoto: {value: null}, uHomography: {value: new T.Matrix3()}, uSize: {value: new T.Vector2(w, h)}, uPixels: {value: new T.Vector2(512, 512)},
      uShape: {value: new T.Vector3(SHAPES2D[outline.kind] ?? 0, outline.spring ?? 0, outline.rise ?? 0)}, uTone: {value: new T.Color(1, 1, 1)}, uDepth: {value: spec.depth ?? (recess ? .12 : .25)},
      uMask: {value: noMask}};
    const material = new T.MeshStandardMaterial({color: '#ffffff', roughness: .92, metalness: 0, clippingPlanes: sectionPlanes});
    material.customProgramCacheKey = () => 'relief';
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms, local);
      growVertex(shader, null);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec2 aReliefUv; attribute float aProof; varying vec2 vReliefUv; varying vec3 vReliefView,vReliefT,vReliefB; varying float vProof;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vReliefUv=aReliefUv; vProof=aProof;
          vec3 reliefTo=cameraPosition-(modelMatrix*vec4(position,1.)).xyz;
          vReliefView=vec3(dot(reliefTo,normalize(modelMatrix[0].xyz)),dot(reliefTo,normalize(modelMatrix[1].xyz)),dot(reliefTo,normalize(modelMatrix[2].xyz)));
          vReliefT=normalize((modelViewMatrix*vec4(1.,0.,0.,0.)).xyz); vReliefB=normalize((modelViewMatrix*vec4(0.,1.,0.,0.)).xyz);`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D uPhoto,uMask; uniform mat3 uHomography; uniform vec2 uSize,uPixels; uniform vec3 uShape,uTone; uniform float uDepth,uProof;
          varying vec2 vReliefUv; varying vec3 vReliefView,vReliefT,vReliefB; varying float vProof;
          vec2 photoAt(vec2 p){vec3 q=uHomography*vec3(p,1.);return q.xy/q.z;}
          float heightAt(vec2 p){return dot(texture2D(uPhoto,photoAt(p)).rgb,vec3(.2126,.7152,.0722));}
          bool insidePanel(vec2 p){
            if(p.x<0.||p.x>1.||p.y<0.||p.y>1.)return false;
            float x=(p.x-.5)*uSize.x,y=p.y*uSize.y-uShape.y;
            if(uShape.x>2.5){float ey=(p.y-.5)*2.;return 4.*x*x/(uSize.x*uSize.x)+ey*ey<=1.;}
            if(uShape.x<.5||y<=0.)return true;
            if(uShape.x<1.5)return x*x+y*y<=uSize.x*uSize.x*.25;
            float a=uShape.z>0.?uShape.z:uSize.y-uShape.y,r=(uSize.x*uSize.x*.25+a*a)/uSize.x,d=abs(x)+r-uSize.x*.5;return d*d+y*y<=r*r;}`)
        .replace('#include <map_fragment>', `vec3 reliefView=normalize(vReliefView);
          vec2 rp=vReliefUv;
          rp+=reliefView.xy/max(reliefView.z,.35)*(heightAt(rp)-.5)*uDepth/uSize;
          if(!insidePanel(rp)||texture2D(uMask,photoAt(rp)).r<.5)discard;
          diffuseColor.rgb*=texture2D(uPhoto,photoAt(rp)).rgb*uTone;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          if(uProof>0.){vec3 proof=vProof<.5?vec3(.2,.78,.62):vProof<1.5?vec3(.38,.53,1.):vProof<2.5?vec3(1.,.66,.25):vec3(.5,.5,.52);
            diffuseColor.rgb=mix(diffuseColor.rgb,proof*.9,.72*uProof);}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {vec2 e=1.5/uPixels;float hx=heightAt(rp+vec2(e.x,0.))-heightAt(rp-vec2(e.x,0.)),hy=heightAt(rp+vec2(0.,e.y))-heightAt(rp-vec2(0.,e.y));
           vec3 slope=vec3(-hx*uDepth/(2.*e.x*uSize.x),-hy*uDepth/(2.*e.y*uSize.y),1.);
           normal=normalize(vReliefT*clamp(slope.x,-2.,2.)+vReliefB*clamp(slope.y,-2.,2.)+normal);}`);
    };
    const mesh = new T.Mesh(geometry, material);
    mesh.position.copy(flat.position); mesh.rotation.y = flat.yaw; mesh.visible = false; mesh.frustumCulled = false;
    mesh.receiveShadow = Boolean(visual.quality.shadows);
    mesh.userData.relief = {element: flat.element, phase: flat.phase, birth, death}; mesh.userData.spec = spec; mesh.userData.url = new URL(spec.image, base).href;
    reliefsPending++;
    const generation = reliefGeneration;
    loadPhoto(new URL(spec.image, base).href).then(async texture => {
      if (generation !== reliefGeneration) return texture.dispose();
      const {width, height} = texture.image, H = homography(spec.corners, width, height), [tl, tr, br, bl] = spec.corners;
      local.uPhoto.value = texture; local.uHomography.value = H;
      local.uPixels.value.set(Math.max(64, (Math.hypot(tr[0] - tl[0], tr[1] - tl[1]) + Math.hypot(br[0] - bl[0], br[1] - bl[1])) / 2), Math.max(64, (Math.hypot(bl[0] - tl[0], bl[1] - tl[1]) + Math.hypot(br[0] - tr[0], br[1] - tr[1])) / 2));
      material.userData.photo = texture;
      const cut = spec.outline?.length >= 3 ? spec.outline : null;
      if (cut) local.uMask.value = material.userData.mask = outlineMask(cut, width, height);
      // The tone is read on what the panel shows: inside its shape and inside its outline.
      const pixel = (u, v) => { const q = new T.Vector3(u, v, 1).applyMatrix3(H); return [q.x / q.z * width, (1 - q.y / q.z) * height]; };
      const mean = meanColour(texture.image, H, (u, v) => insideOutline(outline, (u - .5) * w, v * h) && (!cut || insidePolygon(cut, ...pixel(u, v)))), tone = new T.Color(spec.tone ?? spec.color ?? '#cfc3a6').multiply(await albedoGain());
      if (generation !== reliefGeneration) return;
      local.uTone.value.setRGB(tone.r / Math.max(.02, mean.r), tone.g / Math.max(.02, mean.g), tone.b / Math.max(.02, mean.b));
      mesh.visible = true; reliefsPending--;
    }, () => { if (generation !== reliefGeneration) return; console.warn(`Relief image not found: ${spec.image}`); reliefsPending--; });
    scene.add(mesh); meshes.push(mesh);
  }

  // ——— The captured layer ———
  // A monument may carry `scan`: the building as photographed or surveyed, as gaussian splats (a 3D reconstruction of
  // real photographs). Spark (MIT, kit/vendor/spark, imported only here) draws them in a scene of their own, through the
  // same camera, backdrop and output pass as the built model, so the one gives way to the other without a jump.
  const captureScene = new T.Scene();
  let scanSpec = null, capture = null, capturing = false;
  async function ensureCapture() {
    if (!scanSpec) throw new Error('This monument has no scan.');
    capture ??= (async () => {
      const {SparkRenderer, SplatMesh} = await import('./vendor/spark/spark.module.js');
      const spark = new SparkRenderer({renderer}), group = new T.Group(), splat = new SplatMesh({url: scanSpec.url});
      // The matrix places the scan in the monument's own frame, which the monument's `rotate` then turns like everything else.
      group.rotation.y = turnY; splat.matrixAutoUpdate = false; splat.matrix.fromArray(scanSpec.matrix); group.add(splat);
      captureScene.add(spark, group); captureScene.background = scene.background; captureScene.fog = scene.fog;
      await splat.initialized;
      return {spark, group, splat};
    })();
    try { return await capture; } catch (error) { capture = null; throw error; }
  }
  function disposeCapture() {
    capturing = false; renderPass.scene = scene; ao.enabled = Boolean(visual?.quality.ao);
    capture?.then(({spark, group, splat}) => { captureScene.remove(spark, group); splat.dispose(); spark.dispose?.(); }, () => {});
    capture = null; scanSpec = null;
  }

  function clear() {
    for (const mesh of meshes) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); mesh.customDepthMaterial?.dispose(); mesh.material.userData?.photo?.dispose(); mesh.material.userData?.mask?.dispose(); }
    meshes.length = 0; reliefsPending = 0; reliefGeneration++; photos.clear(); disposeCapture();
    if (outlineGroup) { scene.remove(outlineGroup); outlineGroup.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); outlineGroup = null; }
    for (const {group, scaffoldSets} of siteGroups) { scene.remove(group); for (const set of scaffoldSets) set.mesh.dispose(); }
    siteGroups.length = 0; siteActors.length = 0; siteDust.length = 0; siteRigs.length = 0; siteGeneration++;
  }

  // What gold leaf mirrors: the studio round it, its paper walls, a brighter ceiling and the paper floor.
  let studioEnvironmentMap = null;
  function studioEnvironment() {
    if (studioEnvironmentMap) return studioEnvironmentMap;
    const envScene = new T.Scene(), sphere = new T.Mesh(new T.SphereGeometry(10, 32, 16), new T.ShaderMaterial({side: T.BackSide, uniforms: {h: {value: paper.clone()}, z: {value: new T.Color(LIGHT.sky)}, g: {value: new T.Color(LIGHT.floor)}},
      vertexShader: 'varying vec3 d;void main(){d=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'uniform vec3 h,z,g;varying vec3 d;void main(){gl_FragColor=vec4(d.y>0.?mix(h,z,smoothstep(0.,.6,d.y)):mix(h,g,smoothstep(0.,.25,-d.y)),1.);}'}));
    envScene.add(sphere);
    const pmrem = new T.PMREMGenerator(renderer);
    studioEnvironmentMap = pmrem.fromScene(envScene, .02).texture;
    pmrem.dispose(); sphere.geometry.dispose(); sphere.material.dispose();
    return studioEnvironmentMap;
  }

  // `base`: the monument file's URL, against which its photo reliefs are found.
  function load(data, {base = location.href} = {}) {
    clear();
    monument = data; moved = false; turnY = (data.rotate ?? 0) * Math.PI / 180;
    scanSpec = data.scan?.file && data.scan.matrix?.length === 16 ? {url: new URL(data.scan.file, base).href, matrix: data.scan.matrix} : null;
    visual = resolveVisualStyle(data.visualStyle ?? {quality: 'basic'});
    // The composer, which does all the drawing, keeps the ratio it was made with unless it is given the new one.
    const ratio = Math.min(PIXEL_RATIO, visual.quality.pixelRatio);
    renderer.setPixelRatio(ratio); composer.setPixelRatio(ratio);
    renderer.shadowMap.enabled = Boolean(visual.quality.shadows); renderer.shadowMap.needsUpdate = true;
    ao.enabled = Boolean(visual.quality.ao);
    if (ao.enabled) {
      const reach = Math.max(1.5, Math.min(5, (data.view.radius ?? 60) * .025));
      ao.updateGtaoMaterial({radius: reach, thickness: reach, distanceExponent: 1.3, scale: 1.15, samples: 16});
      ao.updatePdMaterial({radius: 5, rings: 2, samples: 16});
      ao.blendIntensity = .95;
    }
    // Soft studio shadows, 2048 px at least.
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    sun.castShadow = Boolean(visual.quality.shadows); sun.shadow.mapSize.setScalar(Math.max(2048, visual.quality.shadows || 512));
    // An element with `lean` tilts with all its pieces: angle (degrees) over time from `track`, towards `toward`.
    leaning = data.elements.find(element => element.lean)?.lean ?? null;
    uniforms.uLeanAngle.value = 0;
    if (leaning) {
      uniforms.uLeanPivot.value.set(...(leaning.pivot ?? [0, 0, 0]));
      uniforms.uLeanAxis.value.crossVectors(UP, new T.Vector3(...(leaning.toward ?? [0, 0, 1])).normalize()).normalize();
    }
    const {pieces: built, reliefs, P} = buildPieces(data), k = {pieces: built, rand: random((data.seed ?? 7) + 1)};
    builtPieces = built;
    total = data.phases.length;
    const byPhase = layPieces(k.pieces, data.phases.length);
    const death = phase => phase + DEATH.from + DEATH.span * k.rand();
    const groups = new Map(), patches = new Map();
    // One instanced mesh per material, architectural shape and adaptive LOD. Pieces with the same profile
    // still share one geometry; only the tessellation required by their real diameter separates them.
    for (const piece of k.pieces) {
      if (piece.mesh) { if (!patches.has(piece.kind)) patches.set(piece.kind, []); patches.get(piece.kind).push(piece); continue; }
      const shape = piece.shape ?? 'box', shapeFactory = SHAPES[shape];
      if (!shapeFactory) throw new Error(`Unknown geometry shape "${shape}"; refusing to replace it with a square box.`);
      const variant = shapeFactory.adaptive ? adaptiveContext(piece, shapeFactory, visual.qualityName) : {context: {}, key: 'fixed'};
      const key = `${piece.kind}|${shape}|${variant.key}`;
      if (!groups.has(key)) groups.set(key, {kind: piece.kind, shape, shapeFactory, context: variant.context, list: []});
      groups.get(key).list.push(piece);
    }
    // A piece's death and seed are drawn in the order the pieces were made, so that the film stays the same; each
    // mesh then holds its pieces in the order they are laid, and setTime draws only those laid by then: a piece
    // still to come is folded to a point, but it would cost its vertices in every pass all the same.
    const seeds = new Map();
    const inLayingOrder = list => {
      for (const piece of list) { piece.death = piece.until === undefined ? 1e6 : death(piece.until); seeds.set(piece, k.rand() * 100); }
      list.sort((a, b) => a.birth - b.birth);
    };
    for (const {kind, shapeFactory, context, list} of groups.values()) {
      inLayingOrder(list);
      const geometry = shapeFactory(context), life = new Float32Array(list.length * 2), seed = new Float32Array(list.length), lean = new Float32Array(list.length), proof = new Float32Array(list.length), shelter = new Float32Array(list.length);
      const mesh = new T.InstancedMesh(geometry, material(kind), list.length);
      list.forEach((piece, i) => {
        mesh.setMatrixAt(i, piece.matrix); mesh.setColorAt(i, piece.color);
        life[i * 2] = piece.birth; life[i * 2 + 1] = piece.death; seed[i] = seeds.get(piece); lean[i] = piece.lean ?? 0; shelter[i] = piece.shelter ?? 0;
        proof[i] = provenanceOf(data.elements[piece.element]);
      });
      geometry.setAttribute('aProof', new T.InstancedBufferAttribute(proof, 1));
      mesh.userData.pieces = list; mesh.userData.births = Float32Array.from(list, piece => piece.birth);
      geometry.setAttribute('aLife', new T.InstancedBufferAttribute(life, 2));
      geometry.setAttribute('aSeed', new T.InstancedBufferAttribute(seed, 1));
      geometry.setAttribute('aLean', new T.InstancedBufferAttribute(lean, 1));
      geometry.setAttribute('aCenter', new T.InstancedBufferAttribute(new Float32Array(list.length * 3), 3));
      geometry.setAttribute('aShelter', new T.InstancedBufferAttribute(shelter, 1));
      mesh.frustumCulled = false;
      mesh.castShadow = mesh.receiveShadow = Boolean(visual.quality.shadows);
      mesh.customDepthMaterial = shadowMaterial();
      scene.add(mesh); meshes.push(mesh);
    }
    // Patches of real surface (kit/masonry.js): one mesh per material, every piece's triangles baked into the scene
    // and carrying its own birth, death and centre, so that it grows like a block does.
    for (const [kind, list] of patches) {
      inLayingOrder(list);
      let vertices = 0, indices = 0;
      for (const piece of list) { vertices += piece.mesh.position.length / 3; indices += piece.mesh.index.length; }
      // What a vertex carries, in as few bytes as it can: normals in 16 bits, colours and flags in 8.
      const attr = n => new Float32Array(vertices * n), position = attr(3), mason = attr(3), center = attr(3), life = attr(2), seed = attr(1);
      const normal = new Int16Array(vertices * 3), color = new Uint8Array(vertices * 3), lean = new Uint8Array(vertices), proof = new Uint8Array(vertices), shelter = new Uint8Array(vertices);
      const byte = x => Math.max(0, Math.min(255, Math.round(x * 255)));
      const index = new Uint32Array(indices), starts = new Int32Array(list.length + 1), nm = new T.Matrix3(), v = new T.Vector3(), c = new T.Vector3();
      let vo = 0, io = 0;
      list.forEach((piece, n) => {
        const {mesh} = piece, count = mesh.position.length / 3, died = piece.death, sd = seeds.get(piece), pv = provenanceOf(data.elements[piece.element]);
        starts[n] = io / 3;
        nm.getNormalMatrix(piece.matrix); c.setFromMatrixPosition(piece.matrix);
        for (let i = 0; i < count; i++) {
          const o = vo + i;
          v.fromArray(mesh.position, i * 3).applyMatrix4(piece.matrix).toArray(position, o * 3);
          v.fromArray(mesh.normal, i * 3).applyMatrix3(nm).normalize();
          normal[o * 3] = Math.round(v.x * 32767); normal[o * 3 + 1] = Math.round(v.y * 32767); normal[o * 3 + 2] = Math.round(v.z * 32767);
          mason[o * 3] = mesh.mason[i * 3]; mason[o * 3 + 1] = mesh.mason[i * 3 + 1]; mason[o * 3 + 2] = mesh.mason[i * 3 + 2];
          color[o * 3] = byte(piece.color.r); color[o * 3 + 1] = byte(piece.color.g); color[o * 3 + 2] = byte(piece.color.b);
          c.toArray(center, o * 3);
          life[o * 2] = piece.birth; life[o * 2 + 1] = died; seed[o] = sd; lean[o] = piece.lean ?? 0; proof[o] = pv; shelter[o] = byte(piece.shelter ?? 0);
        }
        for (let i = 0; i < mesh.index.length; i++) index[io + i] = mesh.index[i] + vo;
        vo += count; io += mesh.index.length;
      });
      starts[list.length] = io / 3;
      const geometry = new T.BufferGeometry();
      for (const [name, array, size, normalized] of [['position', position, 3], ['normal', normal, 3, true], ['color', color, 3, true], ['aMason', mason, 3], ['aCenter', center, 3], ['aLife', life, 2], ['aSeed', seed, 1], ['aLean', lean, 1], ['aProof', proof, 1], ['aShelter', shelter, 1, true]]) geometry.setAttribute(name, new T.BufferAttribute(array, size, Boolean(normalized)));
      geometry.setIndex(new T.BufferAttribute(index, 1));
      const mesh = new T.Mesh(geometry, material(kind, true));
      mesh.userData.pieces = list; mesh.userData.starts = starts; mesh.userData.births = Float32Array.from(list, piece => piece.birth);
      mesh.frustumCulled = false;
      mesh.castShadow = mesh.receiveShadow = Boolean(visual.quality.shadows);
      mesh.customDepthMaterial = shadowMaterial();
      scene.add(mesh); meshes.push(mesh);
    }
    // A relief is set in place once the masonry of its phase has risen to its middle.
    for (const flat of reliefs) {
      const below = byPhase[flat.phase].filter(piece => piece.matrix.elements[13] <= flat.position.y), birth = below.reduce((m, piece) => Math.max(m, piece.birth), flat.phase + .3);
      makeRelief(flat, Math.min(flat.phase + .95, birth + .01), flat.until === undefined ? 1e6 : death(flat.until), base);
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
    rim.position.set(radius, radius * .4, -radius);
    if (visual.quality.shadows) {
      const shadow = sun.shadow.camera; shadow.left = shadow.bottom = -radius * 1.45; shadow.right = shadow.top = radius * 1.45; shadow.near = 1; shadow.far = radius * 5; shadow.updateProjectionMatrix(); sun.shadow.bias = -.00015;
    }
    // The occlusion is worked out round the monument only: read from the depth, the paper floor seen edge-on far off
    // would otherwise grey itself. The margin keeps a leaning tower's top inside.
    const extent = new T.Box3();
    for (const mesh of meshes) if (mesh.userData.pieces) extent.expandByObject(mesh);
    ao.setSceneClipBox(extent.isEmpty() ? null : extent.expandByScalar(extent.getSize(new T.Vector3()).length() * .1));
    // Gold leaf mirrors the studio.
    for (const mesh of meshes) if (mesh.material?.userData?.gilt) { mesh.material.envMap = studioEnvironment(); mesh.material.needsUpdate = true; }
    studioFloor.scale.setScalar(radius * 30);
    home();
    if (data.view.start) {
      const dir = camera.position.clone().sub(controls.target).normalize();
      controls.target.set(...data.view.start.target);
      camera.position.copy(controls.target).addScaledVector(dir, data.view.start.distance);
    }
    invalidate();
    return {pieces: k.pieces.length};
  }

  // Screen area left free by the panels: the monument is centred and framed in it.
  let insets = {left: 0, right: 0, top: 0, bottom: 0};
  const free = () => {
    const w = host.clientWidth, h = host.clientHeight;
    return {w, h, fw: Math.max(1, w - insets.left - insets.right), fh: Math.max(1, h - insets.top - insets.bottom)};
  };
  // Distance needed to see the monument's full width; fog follows the distance.
  const fit = () => {
    const {distance, width = distance} = monument.view, {w, h, fw, fh} = free();
    const half = Math.atan(Math.tan(T.MathUtils.degToRad(camera.fov / 2)) * fw / fh);
    // Narrow viewports need extra breathing room: the declared width is measured on plan, while an oblique
    // camera also projects part of the monument's depth onto the horizontal axis. Without this allowance a
    // long building can be mathematically centred yet still lose its far end just outside a phone screen.
    const constrained = insets.left + insets.right > w * .25 || insets.top + insets.bottom > h * .25;
    const framing = fw < 700 ? 1.24 : constrained ? 1.12 : .9;
    return Math.max(distance, width / 2 / Math.tan(half) * framing) * Math.max(1, h / fh * .9);
  };
  function home() {
    const dir = new T.Vector3(...(monument.view.direction ?? [.55, .32, .78])).normalize(), d = fit();
    camera.position.copy(controls.target).addScaledVector(dir, d);
    controls.minDistance = d * .35; controls.maxDistance = d * 2.2;
    scene.fog.density = .12 / d;
    controls.update();
  }

  // A reference photo's lens shift: its horizon lies that many image heights below the middle.
  let lensShift = 0;
  const resize = () => {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h); composer.setSize(w, h);
    // Shift the image centre to the middle of the free area, and by the lens shift. setViewOffset also sets
    // the aspect, from its full width and height.
    camera.setViewOffset(w, h, (insets.right - insets.left) / 2, (insets.bottom - insets.top) / 2 - lensShift * h, w, h);
    camera.updateProjectionMatrix();
    if (monument && !moved) home();
  };
  new ResizeObserver(resize).observe(host);
  resize();

  // A picture is drawn only when it would differ from the one on screen: when the camera, the size, the time or
  // a setting changes, while a worksite or a night's sparkle moves on its own, and when something arrives that
  // the scene was waiting for (a photo relief, a figure, a texture). An idle viewer costs the GPU nothing.
  let version = 0, shown = [];
  const invalidate = () => { version++; };
  const arrived = T.DefaultLoadingManager.onProgress;
  T.DefaultLoadingManager.onProgress = (...args) => { invalidate(); arrived?.(...args); };
  renderer.domElement.addEventListener('webglcontextrestored', invalidate);
  function unchanged() {
    // Something moving on its own is drawn every frame, and the first still frame after it is drawn too.
    if (capturing || uniforms.uSparkle.value > 0 || siteGroups.some(site => site.group.visible)) { shown = []; return false; }
    const now = [version, reliefsPending, charactersPending, renderer.domElement.width, renderer.domElement.height, uniforms.uTime.value, uniforms.uProof.value,
      sectioning, outlineGroup ? outlineGroup.visible : -1, ...camera.position.toArray(), ...camera.quaternion.toArray(), ...controls.target.toArray(), ...camera.projectionMatrix.elements];
    // Measured against the picture last drawn, so that a camera easing into place by less than a millionth (a
    // thousandth of a pixel) a frame is still, without ever drifting further than that from what is shown.
    if (now.length === shown.length && now.every((value, i) => Math.abs(value - shown[i]) <= 1e-6 * Math.max(1, Math.abs(value)))) return true;
    shown = now;
    return false;
  }

  const at = (track, t) => { let lo = 0, hi = track.length - 1, best = 0; while (lo <= hi) { const mid = (lo + hi) >> 1; if (track[mid][0] <= t) { best = track[mid][1]; lo = mid + 1; } else hi = mid - 1; } return best; };

  return {
    load,
    home,
    setInsets(next) {
      const complete = {left: 0, right: 0, top: 0, bottom: 0, ...next};
      if (complete.left === insets.left && complete.right === insets.right && complete.top === insets.top && complete.bottom === insets.bottom) return;
      insets = complete; resize();
    },
    // Camera plan: close to the foundations at first, then pulling back to the overall view.
    // With an active moment, the camera eases towards the piece concerned; with `look` [azimuth, elevation]
    // (degrees, as a reference photo's), it also swings round to see it from that side.
    cinematic(t, focus, closeDistance, look) {
      const start = monument.view.start ?? {target: monument.view.target, distance: fit()}, end = new T.Vector3(...monument.view.target);
      const f = Math.min(1, t / Math.max(1, total - 1)), s = f * f * (3 - 2 * f);
      const target = new T.Vector3(...start.target).lerp(end, s);
      let distance = start.distance + (fit() - start.distance) * s;
      const constrained = insets.left + insets.right > host.clientWidth * .25 || insets.top + insets.bottom > host.clientHeight * .25;
      if (focus) {
        // A phone or tablet cannot both crop tightly around a detail and keep a long monument readable. Keep
        // the overall framing there; on a constrained desktop rail, only a subtle focus shift is retained.
        const focusMix = host.clientWidth <= 1100 || constrained ? 0 : Number.isFinite(closeDistance) ? .82 : .45;
        target.lerp(toWorld(focus), focusMix);
        distance = Number.isFinite(closeDistance) ? closeDistance : distance * .72;
      }
      // When interface rails leave a narrow scene, the whole monument stays in that free area instead of a
      // close-up spilling back underneath the cards. Explicit reference-photo viewpoints remain untouched.
      if (!look && (host.clientWidth <= 1100 || constrained)) distance = Math.max(distance, fit());
      const dir = camera.position.clone().sub(controls.target).normalize(), now = camera.position.distanceTo(controls.target);
      if (look) {
        const az = look[0] * Math.PI / 180, el = (look[1] ?? 10) * Math.PI / 180;
        dir.lerp(new T.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)), .06).normalize();
      }
      controls.target.lerp(target, .06);
      camera.position.copy(controls.target).addScaledVector(dir, now + (distance - now) * .06);
    },
    // Screen position of a scene point (to pin a moment).
    project(point) {
      const v = toWorld(point);
      // Pins on a leaning building lean with it.
      if (leaning && Math.hypot(v.x - uniforms.uLeanPivot.value.x, v.z - uniforms.uLeanPivot.value.z) < (leaning.radius ?? 30))
        v.sub(uniforms.uLeanPivot.value).applyAxisAngle(uniforms.uLeanAxis.value, uniforms.uLeanAngle.value).add(uniforms.uLeanPivot.value);
      v.project(camera);
      return {x: (v.x * .5 + .5) * host.clientWidth, y: (-v.y * .5 + .5) * host.clientHeight, visible: v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1};
    },
    // Whether the monument carries a scan, whether it shows, and the switch (it loads the scan the first time).
    get hasCapture() { return Boolean(scanSpec); },
    get capturing() { return capturing; },
    async capture(on) {
      if (on) await ensureCapture();
      capturing = Boolean(on); renderPass.scene = capturing ? captureScene : scene; ao.enabled = !capturing && Boolean(visual.quality.ao);
      return capturing;
    },
    get duration() { return total; },
    get insets() { return {...insets}; },
    // Where the camera stands and looks: [x, y, z, target x, y, z].
    get eye() { return [...camera.position.toArray(), ...controls.target.toArray()]; },
    // The section view on or off.
    section(on) { sectioning = Boolean(on); sectionPlanes.length = 0; if (sectioning) sectionPlanes.push(sectionPlane); return sectioning; },
    get sectioning() { return sectioning; },
    // True once every photo relief has its image (or has given up on it).
    get ready() { return reliefsPending === 0 && charactersPending === 0; },
    // Every photo relief as laid, for the tests that look at them (scripts/relief.test.mjs): its element, image, corners
    // and outline, the middle of the panel in the scene, its outward normal, its size and its life in phases.
    get reliefs() {
      return meshes.filter(m => m.userData.relief).map(m => {
        const {element, birth, death} = m.userData.relief, spec = m.userData.spec, normal = new T.Vector3(0, 0, 1).applyEuler(m.rotation);
        return {element, image: spec.image, url: m.userData.url, corners: spec.corners, outline: spec.outline ?? null, size: spec.size, shape: spec.shape ?? null, middle: m.position.toArray(), normal: [normal.x, normal.z], birth, death, shown: m.visible};
      });
    },
    setTime(t) {
      uniforms.uTime.value = t;
      // Only the pieces laid by t are drawn, as the shader counts them: uTime and the births are 32-bit floats.
      const now = Math.fround(t);
      for (const mesh of meshes) {
        const births = mesh.userData.births;
        if (!births) continue;
        let laid = 0, hi = births.length;
        while (laid < hi) { const mid = (laid + hi) >> 1; if (births[mid] <= now) laid = mid + 1; else hi = mid; }
        if (mesh.isInstancedMesh) mesh.count = laid; else mesh.geometry.setDrawRange(0, mesh.userData.starts[laid] * 3);
      }
      if (leaning) uniforms.uLeanAngle.value = lerp(leaning.track, t) * Math.PI / 180;
      const phase = monument.phases[Math.min(total - 1, Math.floor(t))];
      const night = phase?.mood === 'night' ? Math.min(1, (t - Math.floor(t)) * 3 + (t >= total ? 1 : 0)) : 0;
      uniforms.uNight.value = night;
      uniforms.uSparkle.value = phase?.sparkle ? night : 0;
      sun.intensity = LIGHT.sunI * (1 - night * .92); hemi.intensity = LIGHT.hemiI * (1 - night * .75); ambient.intensity = LIGHT.ambient * (1 - night * .7); rim.intensity = LIGHT.rimI - night * .3;
      // Bloom only for the night lighting; the paper darkens to night blue.
      bloom.strength = night * .35; bloom.enabled = night > 0;
      scene.background.copy(paper).lerp(NIGHT, night * .9); scene.fog.color.copy(scene.background);
      const phaseIndex = Math.min(total - 1, Math.floor(t));
      for (const site of siteGroups) {
        // A worksite shows during its phase only: the finished building stands clear of it.
        site.group.visible = site.phase === phaseIndex && t < total;
        site.progress = Math.max(0, Math.min(1, t - site.phase));
        if (t >= total && site.phase === total - 1) site.progress = 1;
        for (const part of site.scaffoldParts) part.visible = part.userData.siteReveal <= site.progress && site.progress < (part.userData.siteHide ?? Infinity);
        for (const set of site.scaffoldSets) {
          let dirty = false;
          set.list.forEach((part, i) => { const on = site.group.visible && part.reveal <= site.progress ? 1 : 0; if (on !== set.shown[i]) { set.mesh.setMatrixAt(i, on ? part.matrix : ZERO); set.shown[i] = on; dirty = true; } });
          if (dirty) set.mesh.instanceMatrix.needsUpdate = true;
        }
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
      // The haze follows the distance: a long lens far away sees the monument as clearly as the overall view.
      scene.fog.density = .12 / Math.max(fit(), distance);
      controls.update();
    },
    // Vertical field of view of a reference photo's lens, in degrees (38 by default).
    fov(degrees = 38) { camera.fov = degrees; camera.updateProjectionMatrix(); },
    // A photo whose verticals were straightened (a shift lens, or perspective correction afterwards) was taken
    // looking level with its centre moved: the horizon lies `shift` photo heights below the middle.
    shift(amount = 0) { lensShift = amount; resize(); },
    // Evidence mode: tint the pieces by provenance; the measured outline drawn on the ground.
    proof(on) { uniforms.uProof.value = on ? 1 : 0; },
    outline(shapes) {
      if (outlineGroup) { scene.remove(outlineGroup); outlineGroup.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); outlineGroup = null; }
      if (!shapes) return;
      outlineGroup = new T.Group();
      const material = new T.LineBasicMaterial({color: '#f1b867', transparent: true, opacity: .95, depthTest: false, depthWrite: false});
      for (const [points, closed] of shapes) {
        const geometry = new T.BufferGeometry().setFromPoints(points.map(([x, z]) => new T.Vector3(x, .25, z)));
        outlineGroup.add(closed ? new T.LineLoop(geometry, material) : new T.Line(geometry, material));
      }
      outlineGroup.renderOrder = 5; scene.add(outlineGroup);
    },
    showOutline(on) { if (outlineGroup) outlineGroup.visible = on; },
    // The piece under a screen point, standing at the current time: its element and phase.
    pick(x, y, t) {
      const rect = renderer.domElement.getBoundingClientRect(), ray = new T.Raycaster();
      ray.setFromCamera(new T.Vector2((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1), camera);
      const hits = ray.intersectObjects(meshes.filter(m => m.userData.pieces || m.userData.relief && m.visible), false).sort((a, b) => a.distance - b.distance);
      for (const hit of hits) {
        const relief = hit.object.userData.relief;
        if (relief) { if (relief.birth <= t && relief.death > t) return {element: relief.element, phase: relief.phase, kind: 'relief', point: hit.point.toArray()}; continue; }
        const {pieces: list, starts} = hit.object.userData;
        let piece = list[hit.instanceId];
        if (hit.instanceId === undefined && starts) {
          // A mesh of patches: the piece whose triangles hold the face that was hit.
          let lo = 0, hi = list.length - 1;
          while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= hit.faceIndex) lo = mid; else hi = mid - 1; }
          piece = list[lo];
        }
        if (piece && piece.birth <= t && piece.death > t) return {element: piece.element, phase: piece.phase, kind: piece.kind, point: hit.point.toArray()};
      }
      return null;
    },
    // The outline of what stands, for holding the model against a photograph (scripts/silhouette.mjs): 1 where the
    // monument covers a pixel of the drawing buffer, rows from the top. The floor, the worksites and the haze go, and
    // the scene is drawn on white and then on black: what is the same on both is the monument, an edge counting
    // where it covers half the pixel or more. Nothing is recompiled, and the next frame is drawn as before.
    // One picture of the model as it stands, on a plain `backdrop` (no haze, no floor, no ambient occlusion or bloom), the
    // section plane following the camera: what a test looks at when it must know the backdrop to the pixel; `reliefs: false`
    // leaves the photo reliefs out of it. One frame is drawn and left on the canvas; the scene is set back as it was.
    photograph(backdrop = '#000000', {reliefs = true} = {}) {
      const hide = [studioFloor, outlineGroup, ...siteGroups.map(site => site.group), ...(reliefs ? [] : meshes.filter(m => m.userData.relief))].filter(o => o?.visible), density = scene.fog.density, paper = scene.background.clone(), effects = [ao.enabled, bloom.enabled];
      for (const o of hide) o.visible = false;
      scene.fog.density = 0; ao.enabled = bloom.enabled = false; scene.background.set(backdrop);
      controls.update(); followSection();
      ao.gtaoMaterial.uniforms.tDepth.value = ao.pdMaterial.uniforms.tDepth.value = composer.readBuffer.depthTexture;
      composer.render();
      for (const o of hide) o.visible = true;
      scene.fog.density = density; scene.background.copy(paper); [ao.enabled, bloom.enabled] = effects; shown = [];
    },
    silhouette() {
      const hide = [studioFloor, outlineGroup, ...siteGroups.map(site => site.group)].filter(o => o?.visible), density = scene.fog.density, paper = scene.background.clone(), effects = [ao.enabled, bloom.enabled];
      for (const o of hide) o.visible = false;
      scene.fog.density = 0; ao.enabled = bloom.enabled = false;
      const gl = renderer.getContext(), {x: width, y: height} = renderer.getDrawingBufferSize(new T.Vector2()), shots = [];
      for (const color of ['#ffffff', '#000000']) {
        scene.background.set(color);
        ao.gtaoMaterial.uniforms.tDepth.value = ao.pdMaterial.uniforms.tDepth.value = composer.readBuffer.depthTexture;
        composer.render();
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        shots.push(pixels);
      }
      for (const o of hide) o.visible = true;
      scene.fog.density = density; scene.background.copy(paper); [ao.enabled, bloom.enabled] = effects; shown = [];
      const [light, dark] = shots, data = new Uint8Array(width * height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = ((height - 1 - y) * width + x) * 4;
        data[y * width + x] = Math.max(Math.abs(light[i] - dark[i]), Math.abs(light[i + 1] - dark[i + 1]), Math.abs(light[i + 2] - dark[i + 2])) < 96 ? 1 : 0;
      }
      return {width, height, data};
    },
    // Share of the standing pieces by provenance at the end of the timeline.
    provenance() {
      const counts = [0, 0, 0, 0];
      for (const mesh of meshes) for (const piece of mesh.userData.pieces ?? []) if (piece.death > total) counts[provenanceOf(monument.elements[piece.element])]++;
      return counts;
    },
    autoRotate(on) { controls.autoRotate = on; },
    render(clock) {
      if (lastClock === undefined) lastClock = clock;
      uniforms.uClock.value = clock;
      controls.update();
      followSection();
      // The key light turns with the camera: always from the front left, high, as a photographer would
      // set it, so every view shows the forms modelled by light and shade.
      if (monument) {
        const d = camera.position.clone().sub(controls.target), az = Math.atan2(d.x, d.z) - .85, el = .82, R = monument.view.radius * 2.5;
        sun.target.position.copy(controls.target).setY(0);
        sun.position.set(controls.target.x + Math.sin(az) * Math.cos(el) * R, Math.sin(el) * R, controls.target.z + Math.cos(az) * Math.cos(el) * R);
      }
      const dt = Math.min(.1, Math.max(0, clock - lastClock)); lastClock = clock;
      for (const actor of siteActors) if (actor.parent?.visible) {
        const u = actor.userData;
        if (u.hoist) actor.position.y = u.baseY + Math.sin(clock * .65 + u.offset) * .35;
        else if (u.mixer) {
          u.mixer.update(dt);
          // A carrier walks 3 m out along its heading and back, turning at each end.
          if (u.walker) { const w = (clock * .22 + u.offset) % 2, out = w < 1 ? w : 2 - w, dir = u.baseTurn; actor.position.set(u.base[0] + Math.sin(dir) * out * 3, u.baseY, u.base[1] + Math.cos(dir) * out * 3); actor.rotation.y = w < 1 ? dir : dir + Math.PI; }
        } else {
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
      if (unchanged()) return;
      // The depth the colour pass is about to draw into: whichever of the composer's two targets is first.
      ao.gtaoMaterial.uniforms.tDepth.value = ao.pdMaterial.uniforms.tDepth.value = composer.readBuffer.depthTexture;
      composer.render();
    },
    onInteract(callback) { controls.addEventListener('start', callback); },
  };
}
