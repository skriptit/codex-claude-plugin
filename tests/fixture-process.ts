import { spawn } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const [directory, mode] = process.argv.slice(2);
writeFileSync(join(directory, `${mode === 'leaf' ? 'leaf' : 'parent'}.json`), JSON.stringify({ pid: process.pid }));
if (mode === 'leaf') setInterval(() => {}, 1000);
else {
  spawn(process.execPath, [fileURLToPath(import.meta.url), directory, 'leaf'], { stdio: 'ignore' }).unref();
  if (mode === 'parent-exits') { const timer = setInterval(() => { if (existsSync(join(directory, 'leaf.json'))) { clearInterval(timer); process.exit(0); } }, 20); }
  else setInterval(() => {}, 1000);
}
