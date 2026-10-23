#!/usr/bin/env node
// Local viewer for monuments: node scripts/serve.mjs [monuments folder] [--port 4173]
// Serves the viewer and kit from this skill, and monuments/<id>.json from the given folder
// (default: ./monuments in the current directory), falling back to the collection in examples/ and then
// to the gallery in community/. A monument that is packed is expanded on the way out, so what a reader
// builds locally is the same object the published site carries.
import {createServer} from 'node:http';
import {readFile, readdir} from 'node:fs/promises';
import {resolve, join, normalize, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {expand} from './lib/compact.mjs';

const skill = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
let port = portArg >= 0 ? Number(args[portArg + 1]) : 4173;
const folder = resolve(args.find((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--port') ?? 'monuments');
const types = {html: 'text/html; charset=utf-8', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json; charset=utf-8', woff2: 'font/woff2', png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml'};

// A request path maps to one file inside a root, never outside it.
const inside = (root, rest) => { const file = normalize(join(root, rest)); return file.startsWith(root + sep) ? file : null; };
// A community monument lives in its own folder under community/: <id>/monument.json, the bricks it brings with
// it, and the evidence it was checked against. The viewer asks for /monuments/<id>.json, so the folder's one
// differently-named file is what stands in for it — without this the gallery's monuments read as unbuilt.
const community = rest => {
  // The id is the folder: `cathedrale-de-coutances.json`, `cathedrale-de-coutances.bricks.js` and
  // `cathedrale-de-coutances.evidence/outline.json` are all the same monument, so the name is everything up
  // to the first dot of the first segment.
  const id = rest.split('/')[0].split('.')[0];
  if (!/^[a-z0-9-]+$/.test(id)) return [];
  const dir = join(skill, 'community', id);
  return rest === `${id}.json` ? [inside(dir, 'monument.json')] : [inside(dir, rest)];
};
// A monument file may be packed: an element can inherit from a prototype through `use` and carry no type of
// its own until the pack is expanded. The published site expands at build time; a local viewer reads the
// file as it sits in the folder, so it expands here — otherwise a packed monument reaches the kit with
// elements whose type is undefined and the scene stops with "Unknown brick". One file, one id, one answer.
const expanded = new Map();
const unpacked = async (file, id) => {
  if (!expanded.has(file)) expanded.set(file, JSON.stringify(expand(JSON.parse(await readFile(file, 'utf8')), id)));
  return expanded.get(file);
};
const candidates = path => {
  if (path === '/' || path === '/index.html') return [{file: join(skill, 'kit', 'viewer.html')}];
  if (path.startsWith('/kit/')) return [{file: inside(join(skill, 'kit'), path.slice(5))}];
  // The reader's own monuments come first, then the collection, then the gallery: a name the reader gave
  // always wins over one this skill published.
  if (path.startsWith('/monuments/')) {
    const rest = path.slice(11), id = rest.split('/')[0].split('.')[0], isMonument = rest === `${id}.json`;
    return [inside(folder, rest), inside(join(skill, 'examples'), rest), ...community(rest)]
      .map(file => ({file, unpack: isMonument ? id : null}));
  }
  return [];
};

const server = createServer(async (req, res) => {
  let path;
  try { path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); return res.end(); }
  for (const {file, unpack} of candidates(path).filter(candidate => candidate.file)) {
    try {
      const body = unpack ? await unpacked(file, unpack) : await readFile(file);
      res.writeHead(200, {'Content-Type': types[file.split('.').pop()] ?? 'application/octet-stream', 'Cache-Control': 'no-store'});
      return res.end(body);
    } catch {}
  }
  res.writeHead(404); res.end('Not found');
});

const list = async dir => (await readdir(dir).catch(() => [])).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5));
// A gallery monument is a folder holding a monument.json — it has no <id>.json of its own to list.
const gallery = async () => {
  const found = [];
  for (const id of await readdir(join(skill, 'community')).catch(() => [])) {
    if (!/^[a-z0-9-]+$/.test(id)) continue;
    if (await readFile(join(skill, 'community', id, 'monument.json'), 'utf8').catch(() => null)) found.push(id);
  }
  return found;
};
server.on('error', error => {
  if (error.code !== 'EADDRINUSE' || port > 4190) throw error;
  server.listen(++port, '127.0.0.1');
});
server.on('listening', async () => {
  const own = await list(folder), examples = await list(join(skill, 'examples')), published = await gallery();
  console.log(`Monument viewer: http://127.0.0.1:${port}/`);
  for (const id of own) console.log(`  http://127.0.0.1:${port}/#${id}`);
  if (examples.length) console.log(`Collection: ${examples.map(id => `#${id}`).join(' ')}`);
  if (published.length) console.log(`Gallery: ${published.map(id => `#${id}`).join(' ')}`);
});
server.listen(port, '127.0.0.1');
