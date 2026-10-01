import { contained } from '../dist/runtime/containment.js';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const [directory, mode] = process.argv.slice(2);
const code = await contained({ command: process.execPath, args: [fileURLToPath(new URL('./fixture-process.ts', import.meta.url)), directory, mode], cwd: directory, directory: join(directory, 'processes'), onStdout: text => process.stdout.write(text), onStderr: text => process.stderr.write(text) });
process.exitCode = code;
