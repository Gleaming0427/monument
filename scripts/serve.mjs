#!/usr/bin/env node
// Local viewer for monuments: node scripts/serve.mjs [monuments folder] [--port 4173]
// Serves the viewer and kit from this skill, and monuments/<id>.json from the given folder
// (default: ./monuments in the current directory), falling back to the collection in examples/.
import {createServer} from 'node:http';
import {readFile, readdir} from 'node:fs/promises';
import {resolve, join, normalize, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const skill = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
let port = portArg >= 0 ? Number(args[portArg + 1]) : 4173;
const folder = resolve(args.find((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--port') ?? 'monuments');
const types = {html: 'text/html; charset=utf-8', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json; charset=utf-8', woff2: 'font/woff2', png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml'};

// A request path maps to one file inside a root, never outside it.
const inside = (root, rest) => { const file = normalize(join(root, rest)); return file.startsWith(root + sep) ? file : null; };
const candidates = path => {
  if (path === '/' || path === '/index.html') return [join(skill, 'kit', 'viewer.html')];
  if (path.startsWith('/kit/')) return [inside(join(skill, 'kit'), path.slice(5))];
  if (path.startsWith('/monuments/')) return [inside(folder, path.slice(11)), inside(join(skill, 'examples'), path.slice(11))];
  return [];
};

const server = createServer(async (req, res) => {
  let path;
  try { path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); return res.end(); }
  for (const file of candidates(path).filter(Boolean)) {
    try {
      const body = await readFile(file);
      res.writeHead(200, {'Content-Type': types[file.split('.').pop()] ?? 'application/octet-stream', 'Cache-Control': 'no-store'});
      return res.end(body);
    } catch {}
  }
  res.writeHead(404); res.end('Not found');
});

const list = async dir => (await readdir(dir).catch(() => [])).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5));
server.on('error', error => {
  if (error.code !== 'EADDRINUSE' || port > 4190) throw error;
  server.listen(++port, '127.0.0.1');
});
server.on('listening', async () => {
  const own = await list(folder), examples = await list(join(skill, 'examples'));
  console.log(`Monument viewer: http://127.0.0.1:${port}/`);
  for (const id of own) console.log(`  http://127.0.0.1:${port}/#${id}`);
  if (examples.length) console.log(`Collection: ${examples.map(id => `#${id}`).join(' ')}`);
});
server.listen(port, '127.0.0.1');
