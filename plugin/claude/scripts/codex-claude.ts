#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, rename, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const plugin = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = join(plugin, 'runtime');
// Keep packaged desktop and unpackaged CLI processes on the same physical root.
const root = resolve(process.env.CODEX_CLAUDE_DATA_HOME || join(process.platform === 'win32' ? join(homedir(), '.local', 'share') : process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'codex-claude-plugin'));
try {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Codex Claude Plugin requires Node.js 24 LTS.');
  const manifest = JSON.parse(await readFile(join(bundle, 'bundle.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Invalid runtime version');
  const actualDigest = createHash('sha256').update(JSON.stringify(manifest.files)).digest('hex');
  if (actualDigest !== manifest.digest || !/^[a-f0-9]{64}$/.test(actualDigest)) throw new Error('Invalid runtime bundle manifest');
  const runtime = join(root, 'runtimes', `${manifest.version}-${manifest.digest.slice(0, 16)}`);
  if (!existsSync(join(runtime, 'ready.json'))) {
    const args = process.argv.slice(2);
    if (args[0] !== 'setup' || args.includes('--check')) {
      let configuration = null;
      try { configuration = JSON.parse(await readFile(join(root, 'config.json'), 'utf8')); }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
      process.stdout.write(JSON.stringify({ status: 'setup_required', dataRoot: root, configuration, changed: false, message: 'Run $claude:setup to install this runtime. Preserve any saved choices. No settings or state were changed.' }) + '\n'); process.exitCode = args.includes('--check') ? 0 : 1;
    } else {
      const staging = `${runtime}.install-${randomUUID()}`; await mkdir(staging, { recursive: true, mode: 0o700 });
      for (const [file, expected] of Object.entries(manifest.files)) {
        const from = resolve(bundle, file); const to = resolve(staging, file);
        if (!from.startsWith(bundle + '/') && !from.startsWith(bundle + '\\')) throw new Error('Invalid bundle path');
        if (!to.startsWith(staging + '/') && !to.startsWith(staging + '\\')) throw new Error('Invalid install path');
        const data = await readFile(from); if (createHash('sha256').update(data).digest('hex') !== expected) throw new Error(`Bundle integrity failure: ${file}`);
        await mkdir(dirname(to), { recursive: true }); await cp(from, to);
      }
      const candidates = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')].filter(Boolean);
      let npm: string | undefined; for (const candidate of candidates) { if (!candidate) continue; try { await access(candidate); npm = candidate; break; } catch {} }
      if (!npm) throw new Error('npm CLI not found beside Node. Install Node.js 24 LTS with npm.');
      process.stderr.write('[claude:progress] {"type":"status","text":"Installing the versioned plugin runtime with locked dependencies."}\n');
      const child = spawn(process.execPath, [npm, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: staging, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.pipe(process.stderr); child.stderr.pipe(process.stderr);
      const exit = await new Promise((done, fail) => { child.on('error', fail); child.on('close', done); });
      if (exit !== 0) throw new Error(`Runtime installation exited ${exit}; no runtime was activated. Staging: ${staging}`);
      const { writeFile } = await import('node:fs/promises'); await writeFile(join(staging, 'ready.json'), JSON.stringify({ digest: manifest.digest, installedAt: new Date().toISOString() }));
      try { await rename(staging, runtime); } catch (error) { if (!existsSync(join(runtime, 'ready.json'))) throw error; }
    }
  }
  if (existsSync(join(runtime, 'ready.json'))) {
    const ready = JSON.parse(await readFile(join(runtime, 'ready.json'), 'utf8'));
    if (ready.digest !== manifest.digest) throw new Error('Installed runtime identity mismatch; rerun setup after inspecting the installation.');
    for (const [file, expected] of Object.entries(manifest.files)) {
      const path = resolve(runtime, file);
      if (!path.startsWith(runtime + '/') && !path.startsWith(runtime + '\\')) throw new Error('Invalid installed runtime path');
      if (createHash('sha256').update(await readFile(path)).digest('hex') !== expected) throw new Error(`Installed runtime was modified: ${file}`);
    }
    const entry = join(runtime, 'dist', 'cli.js'); process.argv = [process.execPath, entry, ...process.argv.slice(2)];
    await import(pathToFileURL(entry).href);
  }
} catch (error) { process.stdout.write(JSON.stringify({ status: 'failed', code: 'runtime_setup_failed', message: String(error) }) + '\n'); process.exitCode = 1; }
