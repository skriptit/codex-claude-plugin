import { Journal } from '../dist/runtime/journal.js';
import { exclusive } from '../dist/runtime/mutex.js';
import { writeFile } from 'node:fs/promises';
const [mode, directory, value] = process.argv.slice(2);
if (mode === 'journal') await new Journal(directory).transaction(async (_e, append) => { await new Promise(r => setTimeout(r, 50)); append('writer', value); });
else await exclusive(directory, async () => { await writeFile(value, String(process.pid)); await new Promise(r => setInterval(r, 1000)); });
