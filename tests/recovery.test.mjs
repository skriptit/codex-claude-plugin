import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Journal } from '../dist/runtime/journal.js';
import { exclusive } from '../dist/runtime/mutex.js';
import { approveChecks, runCheck, discoverChecks, verifyCheck } from '../dist/policy/checks.js';
import { hash } from '../dist/runtime/files.js';
const root = await mkdtemp(join(tmpdir(), 'cca-recovery-')); process.env.CCA_DATA_HOME = join(root, 'data');
const fixture = fileURLToPath(new URL('./fixture-writer.mjs', import.meta.url));
const child = (...args) => { const p = spawn(process.execPath, [fixture, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let err = ''; p.stderr.on('data', b => err += b); return { p, done: new Promise((resolve, reject) => { p.on('error', reject); p.on('close', code => code === 0 ? resolve() : reject(new Error(err || `exit ${code}`))); }) }; };
async function until(fn) { const end = performance.now() + 5000; while (performance.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 40)); } throw new Error('Timed out'); }
test('separate processes serialize journal commits', async () => {
  const id = `run-${randomUUID()}`; const jobs = Array.from({ length: 3 }, (_, n) => child('journal', id, String(n)));
  await Promise.all(jobs.map(j => j.done)); const { events } = await new Journal(id).read(); assert.equal(events.length, 3); assert.equal(new Set(events.map(e => e.data)).size, 3);
});
test('dead mutex owners recover without deleting any other contender', async () => {
  const directory = join(root, 'mutex'); const marker = join(root, 'entered'); const job = child('hold', directory, marker); job.done.catch(() => {});
  await until(async () => { try { await readFile(marker); return true; } catch { return false; } });
  job.p.kill('SIGKILL'); await job.done.catch(() => {});
  let entered = false; await exclusive(directory, async () => { entered = true; }); assert.equal(entered, true);
  assert.equal((await readdir(directory)).filter(n => n.endsWith('.ticket.json')).length, 1, 'dead owner evidence is preserved');
});
test('concurrent identical checks launch only once and do not inherit provider secrets', async () => {
  const cwd = await mkdtemp(join(root, 'checks-')); const definitionFile = join(cwd, 'check.mjs');
  await writeFile(definitionFile, 'if (process.env.ANTHROPIC_API_KEY) process.exit(9); setTimeout(() => console.log("ok"), 500);');
  await approveChecks(cwd, [{ id: 'test', executable: process.execPath, args: [definitionFile], cwd, purpose: 'fixture', definitionFile, definitionKey: null, definitionHash: hash(await readFile(definitionFile)) }]);
  process.env.ANTHROPIC_API_KEY = 'fixture-not-a-key';
  try {
    const results = await Promise.allSettled([runCheck(cwd, 'test', join(cwd, 'receipts'), 'snapshot'), runCheck(cwd, 'test', join(cwd, 'receipts'), 'snapshot')]);
    assert.equal(results.filter(r => r.status === 'fulfilled' && r.value.status === 'passed').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.code, 'check_outcome_unknown');
  } finally { delete process.env.ANTHROPIC_API_KEY; }
});
test('npm lifecycle or nested script changes invalidate approval', async () => {
  const cwd = await mkdtemp(join(root, 'scripts-')); const file = join(cwd, 'package.json');
  await writeFile(file, JSON.stringify({ scripts: { test: 'node test.mjs', pretest: 'node prepare.mjs' } }));
  const checks = await discoverChecks(cwd); assert.ok(checks.length); await verifyCheck(checks[0]);
  await writeFile(file, JSON.stringify({ scripts: { test: 'node test.mjs', pretest: 'node changed.mjs' } }));
  await assert.rejects(verifyCheck(checks[0]), e => e.code === 'check_definition_changed');
});
test('setup preserves choices and rejects invalid approvals before writing config', async () => {
  const cwd = await mkdtemp(join(root, 'setup-')); const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const run = (...args) => JSON.parse(execFileSync(process.execPath, [cli, 'setup', '--cwd', cwd, ...args], { encoding: 'utf8' }));
  run('--model', 'custom-choice', '--effort', 'medium'); assert.equal(run().resolved.model, 'custom-choice');
  const before = await readFile(join(process.env.CCA_DATA_HOME, 'config.json'), 'utf8');
  assert.throws(() => run('--model', 'bad-write', '--approve-check', 'missing'));
  assert.equal(await readFile(join(process.env.CCA_DATA_HOME, 'config.json'), 'utf8'), before);
});
