import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readJson, writeJson } from './files.js';
import { alive, identity } from './identity.js';
import { fileURLToPath } from 'node:url';
const spec = await readJson(process.argv[2]);
if (!alive(spec.owner) || existsSync(spec.cancel))
    process.exit(130);
// The worker belongs to its own group. The watchdog stays outside so it can
// terminate the whole group after the worker or an intermediate parent exits.
const child = spawn(process.execPath, [fileURLToPath(new URL('./command-worker.js', import.meta.url)), process.argv[2]], { cwd: spec.cwd, detached: true, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, CODEX_CLAUDE_START_GATE: `${spec.registry}.go` } });
const worker = child.pid ? identity(child.pid) : null;
if (!worker) {
    child.kill('SIGKILL');
    throw new Error('Cannot establish worker identity');
}
await writeJson(spec.registry, { ...worker, role: 'worker' });
if (alive(spec.owner) && !existsSync(spec.cancel))
    await writeJson(`${spec.registry}.go`, { start: worker.start });
const terminate = () => { try {
    process.kill(-worker.pid, 'SIGKILL');
}
catch { /* Already exited. */ } };
const timer = setInterval(() => { if (!alive(spec.owner) || existsSync(spec.cancel))
    terminate(); }, 200);
process.on('SIGTERM', terminate);
process.on('SIGINT', terminate);
child.on('error', error => { clearInterval(timer); terminate(); process.stderr.write(String(error)); process.exit(70); });
child.on('close', code => { clearInterval(timer); terminate(); process.exit(code ?? 130); });
