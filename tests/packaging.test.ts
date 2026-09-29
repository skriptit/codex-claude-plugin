import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve('.');
const plugin = join(root, 'plugin', 'claude');

async function files(dir, prefix = '') {
  const output = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) output.push(...await files(join(dir, entry.name), `${name}/`));
    else output.push(name);
  }
  return output.sort();
}

test('runtime package is deterministic and contains only production files', async () => {
  const run = () => JSON.parse(execFileSync(process.execPath, ['scripts/package.ts'], { cwd: root, encoding: 'utf8' }));
  const first = run();
  const runtime = join(plugin, 'runtime');
  const bundle = JSON.parse(await readFile(join(runtime, 'bundle.json'), 'utf8'));
  const packageJson = JSON.parse(await readFile(join(runtime, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(join(runtime, 'package-lock.json'), 'utf8'));
  assert.equal(packageJson.license, 'MIT');
  assert.equal(packageJson.devDependencies, undefined);
  assert.equal(packageJson.scripts, undefined);
  assert.equal(lock.packages[''].devDependencies, undefined);
  assert.ok(Object.values(lock.packages).every(value => !value.dev));
  assert.deepEqual((await files(runtime)).filter(name => name !== 'bundle.json'), Object.keys(bundle.files));
  assert.ok(Object.keys(bundle.files).every(name =>
    ['package.json', 'package-lock.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md'].includes(name) ||
    name.endsWith('.js') || name === 'dist/runtime/containment.ps1'));
  const digest = createHash('sha256').update(JSON.stringify(bundle.files)).digest('hex');
  assert.equal(digest, bundle.digest);
  const second = run();
  assert.equal(second.runtimeDigest, first.runtimeDigest);
  assert.equal((await readFile(join(runtime, 'bundle.json'), 'utf8')), `${JSON.stringify(bundle, null, 2)}\n`);
});

test('runtime packaging refuses a stale compiled module', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'claude-stale-dist-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  for (const name of ['src', 'dist']) await cp(join(root, name), join(temp, name), { recursive: true });
  for (const name of ['package.json', 'package-lock.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    await cp(join(root, name), join(temp, name));
  }
  await mkdir(join(temp, 'plugin', 'claude', '.codex-plugin'), { recursive: true });
  await cp(join(plugin, '.codex-plugin', 'plugin.json'), join(temp, 'plugin', 'claude', '.codex-plugin', 'plugin.json'));
  await writeFile(join(temp, 'dist', 'private.js'), 'export const stale = true;\n');
  assert.throws(() => execFileSync(process.execPath, [join(root, 'scripts', 'package.ts')], { cwd: temp, stdio: 'pipe' }), /stale: private.js/);
  await assert.rejects(readFile(join(temp, 'plugin', 'claude', 'runtime', 'bundle.json')), { code: 'ENOENT' });
});
