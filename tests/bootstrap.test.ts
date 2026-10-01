import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

async function launcherFixture() {
  const root = await mkdtemp(join(tmpdir(), 'codex-claude-bootstrap-'));
  await mkdir(join(root, 'scripts')); await mkdir(join(root, 'runtime'));
  await copyFile('plugin/claude/scripts/codex-claude.ts', join(root, 'scripts', 'codex-claude.ts'));
  const files = {};
  await writeFile(join(root, 'runtime', 'bundle.json'), JSON.stringify({ version: '0.0.0', files, digest: createHash('sha256').update(JSON.stringify(files)).digest('hex') }));
  return join(root, 'scripts', 'codex-claude.ts');
}

test('bootstrap preserves saved choices when an updated runtime needs installation, without writes', async () => {
  const launcher = await launcherFixture(); const root = await mkdtemp(join(tmpdir(), 'codex-claude-bootstrap-data-'));
  const config = { version: 1, defaults: { backend: 'sdk', model: 'claude-user-model', effort: 'medium' }, workflows: {}, projects: {} };
  const text = JSON.stringify(config); await writeFile(join(root, 'config.json'), text);
  const output = JSON.parse(execFileSync(process.execPath, [launcher, 'setup', '--check'], { env: { ...process.env, CODEX_CLAUDE_DATA_HOME: root }, encoding: 'utf8' }));
  assert.equal(output.status, 'setup_required'); assert.equal(output.changed, false); assert.deepEqual(output.configuration, config);
  assert.deepEqual(await readdir(root), ['config.json']); assert.equal(await readFile(join(root, 'config.json'), 'utf8'), text);
});

test('Windows bootstrap and engine use a shared profile root rather than redirected AppData', { skip: process.platform !== 'win32' }, async () => {
  const launcher = await launcherFixture(); const env = { ...process.env, LOCALAPPDATA: join(tmpdir(), 'different-packaged-appdata') };
  delete env.CODEX_CLAUDE_DATA_HOME;
  const expected = join(homedir(), '.local', 'share', 'codex-claude-plugin');
  const output = JSON.parse(execFileSync(process.execPath, [launcher, 'setup', '--check'], { env, encoding: 'utf8' }));
  const engine = execFileSync(process.execPath, ['--input-type=module', '-e', "import {dataRoot} from './dist/runtime/files.js'; process.stdout.write(dataRoot())"], { env, encoding: 'utf8' });
  assert.equal(output.dataRoot, expected); assert.equal(engine, expected);
});
