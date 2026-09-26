import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readJson, writeJson } from '../runtime/files.js';
import { identity } from '../runtime/identity.js';
import { cliArguments, cliExecutable, providerEnvironment, sdkOptions, type TurnOptions } from './options.js';

while (process.env.CCA_START_GATE && !existsSync(process.env.CCA_START_GATE)) await new Promise(r => setTimeout(r, 25));
const options = await readJson<TurnOptions>(process.argv[2]!);
const register = (pid: number, role: string) => { const id = identity(pid); if (!id) throw new Error(`Cannot register ${role}`); return writeJson(join(options.directory, `process-${pid}.json`), { ...id, role }); };
await register(process.pid, 'provider-worker');
if (options.settings.backend === 'cli') {
  const child = spawn(cliExecutable(), cliArguments(options), { cwd: options.cwd, env: providerEnvironment('cli'), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  if (!child.pid) throw new Error('Claude failed to launch');
  await register(child.pid, 'claude');
  child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
  child.stdin.end(options.prompt);
  child.on('error', e => { process.stderr.write(String(e)); process.exitCode = 70; });
  child.on('close', code => { process.exitCode = code ?? 130; });
} else {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const stream = query({ prompt: options.prompt, options: sdkOptions(options, launch => {
      const child = spawn(launch.command, launch.args, { cwd: launch.cwd, env: launch.env, signal: launch.signal, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      if (child.pid) void register(child.pid, 'sdk-claude').catch(() => child.kill());
      child.stderr.on('data', data => process.stderr.write(data)); return child;
    }) });
  try { for await (const message of stream) process.stdout.write(JSON.stringify(message) + '\n'); }
  catch (error) { await appendFile(join(options.directory, 'worker-error.log'), String(error)); process.stderr.write(String(error)); process.exitCode = 1; }
}
