#!/usr/bin/env node
// Sends a monument to the community gallery as a pull request.
//   node scripts/publish.mjs monuments/<id>.json --author <github name> --model "<model>" --prompt "<the request>" [--title "<title>"] [--yes]
// Without --yes it only prints what would be sent. With --yes it forks the gallery repository with the
// GitHub CLI (gh), adds community/<id>/ on a branch and opens the pull request.
import {readFile, writeFile, mkdir, mkdtemp, copyFile, rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join, dirname, basename, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const REPO = 'Gleaming0427/monument';
const skill = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2), flag = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find(arg => arg.endsWith('.json'));
if (!file) { console.error('Usage: node scripts/publish.mjs monuments/<id>.json --author <github name> --model "<model>" --prompt "<request>" [--title "<title>"] [--yes]'); process.exit(1); }

const monument = JSON.parse(await readFile(file, 'utf8')), id = basename(file, '.json');
const author = flag('author'), model = flag('model') ?? 'Model not given', prompt = flag('prompt');
if (!author || !prompt) { console.error('--author (GitHub name) and --prompt (the request that made it) are required.'); process.exit(1); }
const run = (cmd, list, options = {}) => execFileSync(cmd, list, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options}).trim();
const taken = await readFile(join(skill, 'examples', `${id}.json`)).then(() => true, () => false);
if (taken) { console.error(`“${id}” is already in the collection. Rename the file (and its "id") to send your own version, e.g. ${id}-${author}.json.`); process.exit(1); }

// The monument must pass the same checks as the gallery's CI before it leaves.
try { run('node', [join(skill, 'scripts', 'validate.mjs'), resolve(file)]); }
catch (error) { console.error(error.stdout + error.stderr); console.error('Fix these problems before publishing.'); process.exit(1); }

const meta = {title: flag('title') ?? monument.name, id, author, model, prompt, date: new Date().toISOString().slice(0, 10)};
const files = [['monument.json', resolve(file)]];
if (monument.bricks) files.push([monument.bricks, resolve(dirname(file), monument.bricks)]);
console.log(`Monument: ${monument.name} (${monument.place})`);
console.log(`Gallery entry: community/${id}/ in ${REPO}`);
for (const [name] of files) console.log(`  ${name}`);
console.log(`  meta.json ${JSON.stringify(meta)}`);
if (monument.bricks) console.log('This monument brings its own bricks (code): a maintainer reviews them before they go live.');
if (!args.includes('--yes')) { console.log('\nNothing sent. Run again with --yes to open the pull request.'); process.exit(0); }

try { run('gh', ['auth', 'status']); } catch { console.error('The GitHub CLI is not signed in. Run `gh auth login`, or use the "Submit a monument" form on the repository.'); process.exit(1); }
const login = run('gh', ['api', 'user', '-q', '.login']), owner = REPO.split('/')[0];
let origin = REPO;
if (login.toLowerCase() !== owner.toLowerCase()) {
  try { run('gh', ['repo', 'fork', REPO, '--clone=false']); } catch {}
  origin = `${login}/${REPO.split('/')[1]}`;
  try { run('gh', ['repo', 'sync', origin, '--source', REPO]); } catch {}
}
const work = await mkdtemp(join(tmpdir(), 'monument-'));
try {
  run('gh', ['repo', 'clone', origin, work, '--', '--depth', '1']);
  const branch = `community/${id}`;
  run('git', ['checkout', '-b', branch], {cwd: work});
  const target = join(work, 'community', id);
  await mkdir(target, {recursive: true});
  for (const [name, source] of files) await copyFile(source, join(target, name));
  await writeFile(join(target, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  run('git', ['add', '.'], {cwd: work});
  run('git', ['commit', '-m', `Community: ${meta.title}`], {cwd: work});
  run('git', ['push', '-u', 'origin', branch], {cwd: work});
  const body = `**${meta.title}** · ${monument.place}\n\nPrompt: ${prompt}\n\nModel: ${model}\n\nSent with \`scripts/publish.mjs\`.`;
  const url = run('gh', ['pr', 'create', '--repo', REPO, '--head', `${login}:${branch}`, '--title', `Community: ${meta.title}`, '--body', body], {cwd: work});
  console.log(`Pull request opened: ${url}`);
} finally {
  await rm(work, {recursive: true, force: true});
}
