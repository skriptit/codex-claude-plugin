import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PluginError } from '../contracts.js';
import { identity, type Identity } from './identity.js';
import { writeJson } from './files.js';

export type Launch = { command: string; args: string[]; cwd: string; owner: Identity; cancel: string; registry: string };
export async function contained(options: { command: string; args: string[]; cwd: string; directory: string; env?: NodeJS.ProcessEnv; onStdout: (data: string) => void; onStderr: (data: string) => void; signal?: AbortSignal }) {
  const owner = identity(); if (!owner) throw new PluginError('identity_unavailable', 'Cannot establish process ownership.');
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  const token = randomUUID(); const cancel = join(options.directory, `${token}.cancel`);
  const launch: Launch = { command: options.command, args: options.args, cwd: options.cwd, owner, cancel, registry: join(options.directory, `${token}.worker.json`) };
  const spec = join(options.directory, `${token}.launch.json`); await writeJson(spec, launch);
  const here = dirname(fileURLToPath(import.meta.url));
  const child = process.platform === 'win32'
    ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', join(here, 'containment.ps1'), '-Spec', spec], { cwd: options.cwd, env: options.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn(process.execPath, [join(here, 'watchdog.js'), spec], { cwd: options.cwd, env: options.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const helper = child.pid ? identity(child.pid) : null;
  if (helper) await writeJson(join(options.directory, `${token}.helper.json`), { ...helper, role: 'containment', cancel });
  const stop = () => { void writeFile(cancel, 'cancel', { mode: 0o600 }); };
  options.signal?.addEventListener('abort', stop, { once: true });
  if (options.signal?.aborted) stop();
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', options.onStdout); child.stderr.on('data', options.onStderr);
  try { return await new Promise<number>((resolve, reject) => { child.on('error', reject); child.on('close', (code) => resolve(code ?? 130)); }); }
  finally { options.signal?.removeEventListener('abort', stop); }
}
