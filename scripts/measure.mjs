#!/usr/bin/env node
// Records comparable wall-clock and token usage for any Monument command without invoking a shell.
// Token fields are explicit because agents expose usage differently; absent values stay null, never guessed.
import {appendFile, mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {execFileSync} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {cpus, platform, release} from 'node:os';

const args = process.argv.slice(2), split = args.indexOf('--'), options = split < 0 ? args : args.slice(0, split), command = split < 0 ? [] : args.slice(split + 1);
const value = name => { const i = options.indexOf(`--${name}`); return i < 0 ? undefined : options[i + 1]; };
const number = name => { const raw = value(name); if (raw === undefined) return null; const n = Number(raw); if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} must be a positive number`); return n; };
if (!value('label') || !command.length) {
  console.error('Usage: node scripts/measure.mjs --label <name> [--model <id>] [--input-tokens N] [--cached-input-tokens N] [--output-tokens N] [--reasoning-tokens N] [--out file] -- <command> [args...]');
  process.exit(2);
}
const usage = {input: number('input-tokens'), cachedInput: number('cached-input-tokens'), output: number('output-tokens'), reasoning: number('reasoning-tokens')};
const startedAt = new Date(), started = performance.now(), before = process.resourceUsage();
const child = spawn(command[0], command.slice(1), {stdio: 'inherit'}), exitCode = await new Promise((done, fail) => { child.once('error', fail); child.once('exit', code => done(code ?? 1)); });
const after = process.resourceUsage(), known = Object.values(usage).filter(Number.isFinite);
const git = part => { try { return execFileSync('git', part, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim(); } catch { return null; } };
const record = {
  schemaVersion: 1,
  label: value('label'),
  model: value('model') ?? null,
  startedAt: startedAt.toISOString(),
  durationMs: Math.round(performance.now() - started),
  exitCode,
  command,
  tokens: {...usage, totalKnown: known.length ? known.reduce((sum, n) => sum + n, 0) : null},
  cpuMs: {user: Math.round((after.userCPUTime - before.userCPUTime) / 1000), system: Math.round((after.systemCPUTime - before.systemCPUTime) / 1000)},
  machine: {platform: platform(), release: release(), cpu: cpus()[0]?.model ?? null, node: process.version},
  git: {commit: git(['rev-parse', 'HEAD']), dirty: Boolean(git(['status', '--porcelain']))},
};
const out = resolve(value('out') ?? '.artifacts/metrics.jsonl');
await mkdir(dirname(out), {recursive: true}); await appendFile(out, `${JSON.stringify(record)}\n`);
console.log(`metric: ${record.label} · ${(record.durationMs / 1000).toFixed(2)} s · ${record.tokens.totalKnown ?? 'tokens not supplied'} → ${out}`);
process.exit(exitCode);
