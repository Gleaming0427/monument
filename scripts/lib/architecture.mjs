// Architectural validation: measure the building that was actually built, and hold it against the figure the
// source gives. A golden snapshot answers "did this change?"; this answers "is this right?".
//
// A brick tags the members it builds (`part`, `member`, `faces`, `role`), a probe turns those pieces into named
// quantities, and evidence.measurements says what the sources say. The checker diffs the two. Nothing here
// re-reads the spec that asked for the geometry: a model that quietly stops matching its evidence fails.

const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const spread = values => (values.length ? Math.max(...values) - Math.min(...values) : 0);
const round = (value, digits = 4) => (Number.isFinite(value) ? +value.toFixed(digits) : value);

// Scale and position of a placed piece, read back from the matrix the engine composed.
function frame(piece) {
  const m = piece.matrix.elements;
  return {
    x: m[12], y: m[13], z: m[14],
    sx: Math.hypot(m[0], m[1], m[2]), sy: Math.hypot(m[4], m[5], m[6]), sz: Math.hypot(m[8], m[9], m[10]),
    // The piece's own up axis, which is what carries the inward lean of a shaft laid on a slope.
    ux: m[4], uy: m[5], uz: m[6],
  };
}

// One member = one column, gathered across every element and phase that built it.
function members(pieces, part) {
  const found = new Map();
  for (const piece of pieces.filter(piece => piece.part === part)) {
    if (!found.has(piece.member)) found.set(piece.member, {name: piece.member, faces: piece.faces ?? [], pieces: []});
    found.get(piece.member).pieces.push({...frame(piece), ...piece});
  }
  return [...found.values()];
}

// Shaft and capital of one member. The completed column is the phase that stands it as one piece; the drums
// are the campaigns that laid or replaced it, and their set is what carries the taper.
function standing(member) {
  const phases = new Map();
  for (const piece of member.pieces) {
    if (!phases.has(piece.phase)) phases.set(piece.phase, []);
    phases.get(piece.phase).push(piece);
  }
  const sets = [...phases.values()].map(group => ({group, shaft: group.filter(piece => piece.role !== 'capital')}));
  if (!sets.length) return {shaft: [], capital: [], drums: 0};
  const whole = sets.find(set => set.shaft.length === 1) ?? sets.reduce((a, b) => (b.shaft.length > a.shaft.length ? b : a));
  return {
    shaft: whole.shaft,
    capital: whole.group.filter(piece => piece.role === 'capital'),
    drums: Math.max(...sets.map(set => set.shaft.length)),
  };
}

// The foot of a leaning shaft, read back from its matrix: the matrix column is the axis times the shaft's own
// length, so half of it is exactly how far the piece's centre sits above the bed it stands on.
const foot = piece => ({x: piece.x - .5 * piece.ux, y: piece.y - .5 * piece.uy, z: piece.z - .5 * piece.uz});

const PROBES = {
  // The peristyle of a Doric temple: how many columns stand on each face, how far apart, how thick, how tall,
  // how many drums, and whether they lean the way the sources say they lean.
  'doric-peristyle'({pieces}) {
    const columns = members(pieces, 'peristyle').map(member => ({...member, ...standing(member)}));
    if (!columns.length) throw new Error('no peristyle column is tagged: the brick must tag its members with `part`');
    const base = column => round(Math.max(...column.shaft.map(piece => piece.sx)));
    const crown = column => Math.max(...[...column.shaft, ...column.capital].map(piece => piece.y + piece.sy / 2));
    const bed = column => Math.min(...column.shaft.map(piece => piece.y - piece.sy / 2));
    const axis = column => {
      const [piece] = column.shaft, len = Math.hypot(piece.ux, piece.uy, piece.uz) || 1;
      return {x: piece.ux / len, y: piece.uy / len, z: piece.uz / len};
    };
    const height = column => crown(column) - bed(column);
    // The sourced lean is the horizontal step at the top of the whole column, not of the shaft alone.
    const lean = column => {
      const {x, y, z} = axis(column);
      return round((Math.hypot(x, z) / Math.abs(y || 1)) * height(column), 4);
    };
    const feet = column => foot(column.shaft[0]);
    // A bay is the distance between two consecutive column feet on one face; the corner bay is the closed one.
    // It is measured in the ground plane and in the temple's own frame: a monument is placed rotated on its
    // real plan, and reading the gap off a world axis would shorten every bay by the cosine of that rotation.
    const bays = list => {
      const line = list.map(feet).sort((a, b) => a.x - b.x);
      return line.slice(1).map((value, index) => {
        const previous = line[index];
        return round(Math.hypot(value.x - previous.x, value.z - previous.z));
      });
    };
    const corners = columns.filter(column => column.faces.length > 1);
    const flanks = columns.filter(column => column.faces.length === 1);
    // The Parthenon stands on no straight line: the stylobate rises along the long sides and along the short
    // ones. That rise is the alignment the sources give, and it is read off the beds the columns actually
    // stand on — not from the curvature the spec asked for.
    const bedRise = list => {
      const beds = list.map(column => bed(column));
      return round(Math.max(...beds) - Math.min(...beds));
    };

    const measured = {};
    const put = (quantity, value, unit) => { measured[quantity] = {value: round(value), unit: unit ?? null}; };
    put('columnCount.total', columns.length);
    for (const face of ['n', 's', 'e', 'w']) put(`columnCount.face.${face}`, columns.filter(column => column.faces.includes(face)).length);
    put('columnCount.corner', corners.length, 'shared by two faces');
    put('column.diameter.flank', median(flanks.map(base)), 'm');
    put('column.diameter.corner', median(corners.map(base)), 'm');
    put('column.cornerRefinement', median(corners.map(base)) - median(flanks.map(base)), 'm');
    put('column.diameterSpread', spread(flanks.map(base)), 'm');
    put('column.height', median(flanks.map(height)), 'm');
    put('column.flutes', Math.max(...columns.flatMap(column => column.shaft.map(piece => piece.geometry?.flutes ?? 0))));
    put('column.drumCount', Math.max(...columns.map(column => column.drums)));
    // Only a column laid as one piece shows its lean in its own matrix; a stack of drums is a stack of short
    // upright pieces. The share that could be measured is reported, so a low number is never read as a flat one.
    const tilted = flanks.filter(column => column.shaft.length === 1);
    put('column.lean', median(tilted.map(lean)), 'm at the top');
    put('column.leanCorner', median(corners.filter(c => c.shaft.length === 1).map(lean)), 'm, diagonal');
    put('column.leanSpread', spread(tilted.map(lean)), 'm');
    put('column.leanMeasured', round(tilted.length / Math.max(1, flanks.length), 3), 'fraction of flank columns');
    put('column.bedRise.flank', bedRise(columns.filter(column => column.faces.includes('n'))), 'm, long sides');
    put('column.bedRise.front', bedRise(columns.filter(column => column.faces.includes('e'))), 'm, short sides');
    put('column.bedSpread.flank', spread(columns.filter(column => column.faces.includes('n')).map(bed)), 'm');
    for (const face of ['n', 'e']) {
      const gaps = bays(columns.filter(column => column.faces.includes(face)));
      if (!gaps.length) continue;
      const label = face === 'n' ? 'flank' : 'front';
      put(`spacing.${label}`, median(gaps), 'm centre to centre');
      put(`spacing.${label}CornerBay`, Math.min(...gaps), 'm');
    }
    return measured;
  },
};

export const probeNames = () => Object.keys(PROBES);

export function measure(name, pieces, at = 'monument') {
  const probe = PROBES[name];
  if (!probe) throw new Error(`${at}: no probe called "${name}" (known: ${Object.keys(PROBES).join(', ')})`);
  return probe({pieces});
}

// One declared measurement against one measured value. `tolerance` is a fraction of the expected figure
// unless it is given in the entry's own unit.
export function compare(measurement, observed) {
  const {quantity, expect, tolerance = 0, unit} = measurement;
  if (!(quantity in observed)) return {quantity, expect, measured: null, ok: false, reason: `no probe measured "${quantity}"`};
  const measured = observed[quantity].value;
  // A source that gives a range ("10 to 12 drums") is written as one: the model may sit anywhere inside it.
  const [low, high] = Array.isArray(expect) ? expect : [expect - Math.abs(expect * tolerance), expect + Math.abs(expect * tolerance)];
  const ok = measured >= low - 1e-9 && measured <= high + 1e-9;
  return {quantity, expect, low: round(low, 6), high: round(high, 6), measured, unit: unit ?? observed[quantity].unit, ok};
}

export {PROBES};
// Every declared measurement of a monument, checked against what the probes measured.
export function audit(measurements, pieces, at = 'monument') {
  const probes = new Map();
  return measurements.map((entry, index) => {
    const where = `${at}: measurements[${index}] (${entry.quantity})`;
    if (!entry.probe) throw new Error(`${where} needs a "probe"`);
    if (!probes.has(entry.probe)) probes.set(entry.probe, measure(entry.probe, pieces, at));
    if (!entry.source) throw new Error(`${where} needs the "source" its expected value was read from`);
    if (entry.expect === undefined) throw new Error(`${where} needs the "expect"ed value`);
    return {...compare(entry, probes.get(entry.probe)), source: entry.source, note: entry.note, probe: entry.probe};
  });
}
