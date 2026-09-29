import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildArchives, makeZip, scanReleaseFiles, sourceFiles } from '../scripts/release.ts';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'claude-release-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const publicFiles = await sourceFiles(project);
  for (const file of publicFiles) {
    const target = join(root, ...file.path.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.data);
  }
  for (const file of publicFiles.filter(({ path }) => path.startsWith('src/') && path.endsWith('.ts'))) {
    const relative = `plugin/claude/runtime/dist/${file.path.slice('src/'.length, -3)}.js`;
    const target = join(root, ...relative.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `compiled fixture: ${relative}\n`);
  }
  for (const path of [
    'plugin/claude/LICENSE', 'plugin/claude/THIRD_PARTY_NOTICES.md',
    'plugin/claude/runtime/LICENSE', 'plugin/claude/runtime/THIRD_PARTY_NOTICES.md',
    'plugin/claude/runtime/package.json', 'plugin/claude/runtime/package-lock.json',
    'plugin/claude/runtime/bundle.json',
    'plugin/claude/runtime/dist/runtime/containment.ps1',
  ]) {
    const target = join(root, ...path.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `public fixture: ${path}\n`);
  }
  return root;
}

function zipNames(data) {
  const names = [];
  let offset = 0;
  while (data.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(data.readUInt16LE(offset + 6), 0x0800);
    assert.equal(data.readUInt16LE(offset + 10), 0);
    assert.equal(data.readUInt16LE(offset + 12), 0x0021);
    const length = data.readUInt32LE(offset + 18);
    const nameLength = data.readUInt16LE(offset + 26);
    const extraLength = data.readUInt16LE(offset + 28);
    names.push(data.subarray(offset + 30, offset + 30 + nameLength).toString('utf8'));
    offset += 30 + nameLength + extraLength + length;
  }
  assert.equal(data.readUInt32LE(offset), 0x02014b50);
  const end = data.length - 22;
  assert.equal(data.readUInt32LE(end), 0x06054b50);
  assert.equal(data.readUInt16LE(end + 10), names.length);
  assert.equal(data.readUInt32LE(end + 16), offset);
  return names;
}

test('release archives are deterministic and contain only intended source and plugin files', async (t) => {
  const root = await fixture(t);
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await writeFile(join(root, 'artifacts', 'private.json'), '{"local": true}\n');
  const first = await buildArchives(root, join(root, 'out-one'));
  const second = await buildArchives(root, join(root, 'out-two'));
  assert.equal(first.length, 2);
  assert.deepEqual(first.map(({ sha256 }) => sha256), second.map(({ sha256 }) => sha256));
  const source = zipNames(await readFile(first[0].path));
  const plugin = zipNames(await readFile(first[1].path));
  assert.equal(first[0].path.endsWith('codex-claude-plugin-source.zip'), true);
  assert.equal(first[1].path.endsWith('claude-plugin.zip'), true);
  assert(source.includes('codex-claude-plugin/.agents/plugins/marketplace.json'));
  assert(source.includes('codex-claude-plugin/.github/dependabot.yml'));
  assert(source.includes('codex-claude-plugin/.github/ISSUE_TEMPLATE/bug_report.yml'));
  assert(source.includes('codex-claude-plugin/.github/ISSUE_TEMPLATE/config.yml'));
  assert(source.includes('codex-claude-plugin/.github/pull_request_template.md'));
  assert(source.includes('codex-claude-plugin/CONTRIBUTING.md'));
  assert(source.includes('codex-claude-plugin/SECURITY.md'));
  assert(source.includes('codex-claude-plugin/tsconfig.tools.json'));
  assert(source.includes('codex-claude-plugin/src/cli.ts'));
  assert(source.includes('codex-claude-plugin/scripts/release.ts'));
  assert(source.includes('codex-claude-plugin/plugin/claude/assets/logo.png'));
  assert(!source.some((name) => name.endsWith('.mjs')));
  assert(!source.some((name) => name.includes('private.json') || name.includes('/runtime/dist/')));
  assert(plugin.includes('claude/runtime/dist/cli.js'));
  assert(plugin.includes('claude/scripts/codex-claude.ts'));
  assert(plugin.includes('claude/LICENSE'));
  assert(plugin.includes('claude/assets/logo.png'));
  assert(plugin.every((name) => name.startsWith('claude/')));
  assert(!plugin.some((name) => name.includes('/src/') || name.includes('private.json') || name.includes('register-personal.py')));
});

test('new source, script, test, or plugin files require an explicit release list change', async (t) => {
  const root = await fixture(t);
  const scriptNote = join(root, 'scripts', 'local-note.ts');
  await writeFile(scriptNote, 'private notes\n');
  await assert.rejects(sourceFiles(root), /Unexpected script file/);
  await rm(scriptNote);
  const sourceNote = join(root, 'src', 'local-note.ts');
  await writeFile(sourceNote, 'private notes\n');
  await assert.rejects(sourceFiles(root), /Unexpected source file/);
  await rm(sourceNote);
  const testNote = join(root, 'tests', 'local-note.ts');
  await writeFile(testNote, 'private notes\n');
  await assert.rejects(sourceFiles(root), /Unexpected test file/);
  await rm(testNote);
  const pluginNote = join(root, 'plugin', 'claude', 'references', 'local-note.md');
  await writeFile(pluginNote, 'private notes\n');
  await assert.rejects(sourceFiles(root), /Unexpected plugin source file/);
  await rm(pluginNote);
  const logoNote = join(root, 'plugin', 'claude', 'assets', 'local-note.png');
  await writeFile(logoNote, 'private notes\n');
  await assert.rejects(sourceFiles(root), /Unexpected plugin source file/);
});

test('stale runtime modules cannot enter the plugin archive', async (t) => {
  const root = await fixture(t);
  const stale = join(root, 'plugin', 'claude', 'runtime', 'dist', 'old-private-module.js');
  await writeFile(stale, 'stale build output\n');
  await assert.rejects(buildArchives(root, join(root, 'release')), /Unexpected plugin runtime file/);
});

test('release scanner rejects personal paths and credential shaped values', () => {
  const path = 'C:' + '\\' + ['Users', 'someone', 'secrets.json'].join('\\');
  const token = 'ghp_' + 'a'.repeat(24);
  for (const value of [path, token]) {
    assert.throws(() => scanReleaseFiles([{ path: 'README.md', data: Buffer.from(value) }]), /Private content/);
  }
  assert.doesNotThrow(() => scanReleaseFiles([{ path: 'README.md', data: Buffer.from('Use $claude:setup') }]));
});

test('release scanner validates the binary logo dimensions and signature', async () => {
  const logo = await readFile(join(project, 'plugin', 'claude', 'assets', 'logo.png'));
  assert.doesNotThrow(() => scanReleaseFiles([{ path: 'claude/assets/logo.png', data: logo }]));
  const wrongDimensions = Buffer.from(logo);
  wrongDimensions.writeUInt32BE(wrongDimensions.readUInt32BE(16) - 1, 16);
  assert.throws(() => scanReleaseFiles([{ path: 'claude/assets/logo.png', data: wrongDimensions }]), /Logo must be square/);
  const wrongSignature = Buffer.from(logo);
  wrongSignature[0] = 0;
  assert.throws(() => scanReleaseFiles([{ path: 'claude/assets/logo.png', data: wrongSignature }]), /Invalid PNG logo/);
  assert.throws(() => scanReleaseFiles([{ path: 'claude/assets/logo.png', data: Buffer.alloc(5 * 1024 * 1024 + 1) }]), /Invalid PNG logo/);
});

test('a tracked file outside the release allowlist blocks archive creation', async (t) => {
  const root = await fixture(t);
  execFileSync('git', ['-C', root, 'init', '-q'], { stdio: 'pipe' });
  const note = join(root, 'private-note.md');
  await writeFile(note, 'local notes\n');
  execFileSync('git', ['-C', root, 'add', 'private-note.md'], { stdio: 'pipe' });
  await assert.rejects(buildArchives(root, join(root, 'out')), /Unexpected tracked file\(s\): private-note\.md/);
});

test('release rejects a symlinked root and a symlinked required tree', async (t) => {
  const root = await fixture(t);
  const alias = `${root}-alias`;
  try {
    await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      t.skip('Host does not permit creating symlinks or junctions');
      return;
    }
    throw error;
  }
  t.after(() => rm(alias, { recursive: true, force: true }));
  await assert.rejects(sourceFiles(alias), /Symlink in release root/);
  const target = join(root, 'references-target');
  await mkdir(target);
  await rm(join(root, 'plugin', 'claude', 'references'), { recursive: true });
  await symlink(target, join(root, 'plugin', 'claude', 'references'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(sourceFiles(root), /Symlink in release tree/);
});

test('ZIP writer produces stable bytes regardless of input order', () => {
  const files = [
    { path: 'b.txt', data: Buffer.from('beta') },
    { path: 'a.txt', data: Buffer.from('alpha') },
  ];
  const first = makeZip(files, 'root');
  const second = makeZip(files.reverse(), 'root');
  assert.equal(createHash('sha256').update(first).digest('hex'), createHash('sha256').update(second).digest('hex'));
  assert.deepEqual(zipNames(first), ['root/a.txt', 'root/b.txt']);
});
