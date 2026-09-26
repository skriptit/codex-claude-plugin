import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve('.');
const plugin = join(root, 'plugin', 'claude');
const python = process.platform === 'win32' ? 'python' : 'python3';

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
  const run = () => JSON.parse(execFileSync(process.execPath, ['scripts/package.mjs'], { cwd: root, encoding: 'utf8' }));
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
  assert.throws(() => execFileSync(process.execPath, [join(root, 'scripts', 'package.mjs')], { cwd: temp, stdio: 'pipe' }), /stale: private.js/);
  await assert.rejects(readFile(join(temp, 'plugin', 'claude', 'runtime', 'bundle.json')), { code: 'ENOENT' });
});

test('registration works from a clean source and preserves other marketplace entries', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'claude-register-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const marketplace = join(temp, '.agents', 'plugins', 'marketplace.json');
  const source = join(temp, 'extracted', 'plugin', 'claude');
  await cp(plugin, source, { recursive: true });
  const previous = {
    name: 'personal', interface: { displayName: 'My plugins' },
    plugins: [{ name: 'another', source: { source: 'local', path: './plugins/another' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }],
  };
  await mkdir(join(temp, '.agents', 'plugins'), { recursive: true });
  await writeFile(marketplace, JSON.stringify(previous));
  const register = () => execFileSync(python, ['scripts/register-personal.py', '--source', source, '--marketplace-path', marketplace], { cwd: root, encoding: 'utf8' });
  register();
  const payload = JSON.parse(await readFile(marketplace, 'utf8'));
  assert.deepEqual(payload.plugins[0], previous.plugins[0]);
  assert.deepEqual(payload.plugins[1].source, { source: 'local', path: './plugins/claude' });
  assert.deepEqual(await files(join(temp, 'plugins', 'claude')), await files(source));
  assert.deepEqual(await readFile(join(temp, 'plugins', 'claude', 'assets', 'logo.png')), await readFile(join(source, 'assets', 'logo.png')));
  assert.equal((await readdir(join(temp, '.agents', 'plugins'))).filter(name => name.startsWith('marketplace.before-claude-')).length, 1);
  const before = await readFile(marketplace);
  register();
  assert.deepEqual(await readFile(marketplace), before);
  assert.equal((await readdir(join(temp, '.agents', 'plugins'))).filter(name => name.startsWith('marketplace.before-claude-')).length, 1);
});

test('registration rejects an altered runtime and extra source files', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'claude-register-invalid-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const source = join(temp, 'claude');
  const marketplace = join(temp, '.agents', 'plugins', 'marketplace.json');
  await cp(plugin, source, { recursive: true });
  const args = ['scripts/register-personal.py', '--source', source, '--marketplace-path', marketplace];
  await writeFile(join(source, 'private.txt'), 'must not be copied');
  assert.throws(() => execFileSync(python, args, { cwd: root, stdio: 'pipe' }), /Unexpected plugin source file/);
  await rm(join(source, 'private.txt'));
  const logoPath = join(source, 'assets', 'logo.png');
  const logo = await readFile(logoPath);
  await writeFile(logoPath, Buffer.from('not a png'));
  assert.throws(() => execFileSync(python, args, { cwd: root, stdio: 'pipe' }), /Invalid PNG logo/);
  await writeFile(logoPath, logo);
  await writeFile(join(source, 'runtime', 'dist', 'cli.js'), 'tampered');
  assert.throws(() => execFileSync(python, args, { cwd: root, stdio: 'pipe' }), /Runtime bundle hash mismatch/);
  await assert.rejects(readFile(marketplace), { code: 'ENOENT' });
});

test('registration requires explicit replacement and retains a backup of the old plugin', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'claude-register-update-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const source = join(temp, 'source', 'claude');
  const marketplace = join(temp, '.agents', 'plugins', 'marketplace.json');
  const destination = join(temp, 'plugins', 'claude');
  await cp(plugin, source, { recursive: true });
  const args = ['scripts/register-personal.py', '--source', source, '--marketplace-path', marketplace];
  execFileSync(python, args, { cwd: root, stdio: 'pipe' });
  const oldLauncher = await readFile(join(destination, 'scripts', 'codex-claude.mjs'));
  await writeFile(join(destination, 'scripts', 'codex-claude.mjs'), 'locally changed');
  assert.throws(() => execFileSync(python, args, { cwd: root, stdio: 'pipe' }), /use --replace/);
  execFileSync(python, [...args, '--replace'], { cwd: root, stdio: 'pipe' });
  assert.deepEqual(await readFile(join(destination, 'scripts', 'codex-claude.mjs')), oldLauncher);
  const backups = (await readdir(join(temp, 'plugins'))).filter(name => name.startsWith('claude.before-'));
  assert.equal(backups.length, 1);
  assert.equal(await readFile(join(temp, 'plugins', backups[0], 'scripts', 'codex-claude.mjs'), 'utf8'), 'locally changed');
});

test('registration rejects marketplace ancestor links', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'claude-register-link-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const target = join(temp, 'outside');
  await mkdir(join(target, 'plugins'), { recursive: true });
  try {
    await symlink(target, join(temp, '.agents'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code === 'EPERM') return t.skip('This host cannot create directory links');
    throw error;
  }
  const marketplace = join(temp, '.agents', 'plugins', 'marketplace.json');
  assert.throws(() => execFileSync(python, ['scripts/register-personal.py', '--source', plugin, '--marketplace-path', marketplace], { cwd: root, stdio: 'pipe' }), /marketplace path cannot contain a link or junction/);
  await assert.rejects(readFile(marketplace), { code: 'ENOENT' });
});
