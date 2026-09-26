import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alive, identity } from '../dist/runtime/identity.js';
import { contained } from '../dist/runtime/containment.js';

async function waitFor(fn, timeout = 5000) { const start = performance.now(); while (performance.now() - start < timeout) { const value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 60)); } throw new Error(`Condition not reached within ${timeout} ms`); }
async function processFrom(path) { try { const p = JSON.parse(await readFile(path, 'utf8')); return identity(p.pid); } catch { return null; } }
test('abrupt driver death kills owned descendants while unrelated process stays alive', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-claude-crash-'));
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
  const unrelatedId = identity(unrelated.pid);
  const driver = spawn(process.execPath, [fileURLToPath(new URL('./fixture-driver.mjs', import.meta.url)), directory, 'tree'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let diagnostics = ''; driver.stderr.on('data', b => diagnostics += b);
  try {
    const leaf = await waitFor(() => processFrom(join(directory, 'leaf.json')));
    const driverId = identity(driver.pid); assert.ok(driverId); assert.ok(alive(driverId));
    driver.kill('SIGKILL'); const start = performance.now();
    await waitFor(() => !alive(leaf), 3000); assert.ok(performance.now() - start < 3000, diagnostics);
    assert.ok(alive(unrelatedId));
  } finally { driver.kill('SIGKILL'); if (unrelatedId && alive(unrelatedId)) unrelated.kill('SIGKILL'); }
});
test('normal completion cleans up a grandchild after its parent exits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-claude-reparent-')); let output = '';
  const code = await contained({ command: process.execPath, args: [fileURLToPath(new URL('./fixture-process.mjs', import.meta.url)), directory, 'parent-exits'], cwd: directory, directory: join(directory, 'processes'), onStdout: s => output += s, onStderr: s => output += s });
  assert.equal(code, 0, output); const leaf = JSON.parse(await readFile(join(directory, 'leaf.json'), 'utf8')); assert.equal(identity(leaf.pid), null);
});
test('closed stdin does not cancel a foreground process', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-claude-stdin-')); let output = '';
  const code = await contained({ command: process.execPath, args: ['-e', 'setTimeout(() => console.log("still alive"), 1200)'], cwd: directory, directory: join(directory, 'processes'), onStdout: s => output += s, onStderr: s => output += s });
  assert.equal(code, 0, output); assert.match(output, /still alive/);
});
test('cancellation reaches a running contained command', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-claude-cancel-')); const abort = new AbortController();
  const run = contained({ command: process.execPath, args: [fileURLToPath(new URL('./fixture-process.mjs', import.meta.url)), directory, 'tree'], cwd: directory, directory: join(directory, 'processes'), onStdout: () => {}, onStderr: () => {}, signal: abort.signal });
  const leaf = await waitFor(() => processFrom(join(directory, 'leaf.json'))); abort.abort(); assert.equal(await run, 130); assert.equal(alive(leaf), false);
});
test('driver death during startup never leaves a registered helper or worker alive', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-claude-startup-')); const driver = spawn(process.execPath, [fileURLToPath(new URL('./fixture-driver.mjs', import.meta.url)), directory, 'tree'], { stdio: 'ignore', windowsHide: true });
  const processes = join(directory, 'processes');
  await waitFor(async () => { try { return (await readdir(processes)).some(f => f.endsWith('.launch.json')); } catch { return false; } });
  driver.kill('SIGKILL');
  // Include a full scheduling interval so a not-yet-started helper cannot make
  // an empty registry look like successful cleanup.
  await new Promise(r => setTimeout(r, 1000));
  await waitFor(async () => {
    for (const file of await readdir(processes)) if (file.endsWith('.helper.json') || file.endsWith('.worker.json')) {
      const record = JSON.parse(await readFile(join(processes, file), 'utf8')); if (alive(record)) return false;
    }
    return true;
  }, 2000);
});
