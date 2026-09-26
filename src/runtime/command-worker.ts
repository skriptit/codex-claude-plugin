import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readJson } from './files.js';
import type { Launch } from './containment.js';
// Keep the registered process-group leader alive until the command exits, even
// when the actual executable is too short-lived for a separate identity query.
while (process.env.CCA_START_GATE && !existsSync(process.env.CCA_START_GATE)) await new Promise(r => setTimeout(r, 20));
const spec = await readJson<Launch>(process.argv[2]!);
const child = spawn(spec.command, spec.args, { cwd: spec.cwd, stdio: ['ignore', 'inherit', 'inherit'] });
child.on('error', error => { process.stderr.write(String(error)); process.exit(70); });
child.on('close', code => process.exit(code ?? 130));
