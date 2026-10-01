import { open, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { PluginError } from '../contracts.js';
import { atomicWrite, dataRoot, runPath, writeJson } from './files.js';
import { exclusive } from './mutex.js';

export type Event = { seq: number; at: string; type: string; data: unknown };
export class Journal {
  readonly path: string;
  constructor(readonly id: string, readonly snapshot?: (events: Event[]) => unknown) { this.path = runPath(id); }
  async read(): Promise<{ events: Event[]; tornTail: boolean }> {
    const raw = await readFile(join(this.path, 'events.jsonl'), 'utf8');
    const lines = raw.split('\n');
    const events: Event[] = [];
    let tornTail = !raw.endsWith('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i] && i === lines.length - 1) continue;
      try {
        const event = JSON.parse(lines[i]!) as Event;
        if (event.seq !== events.length + 1 || typeof event.type !== 'string') throw new Error('sequence');
        events.push(event);
      } catch {
        if (i !== lines.length - 1) throw new PluginError('journal_corrupt', `Invalid event ${i + 1}`);
        tornTail = true;
      }
    }
    return { events, tornTail };
  }
  async transaction<T>(fn: (events: Event[], append: (type: string, data: unknown) => void) => T | Promise<T>): Promise<T> {
    return exclusive(join(this.path, '.locks'), async () => {
      let loaded: { events: Event[]; tornTail: boolean };
      try { loaded = await this.read(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; loaded = { events: [], tornTail: false }; }
      const pending: Event[] = [];
      const append = (type: string, data: unknown) => pending.push({ seq: loaded.events.length + pending.length + 1, at: new Date().toISOString(), type, data });
      const result = await fn(loaded.events, append);
      if (loaded.tornTail) {
        await atomicWrite(join(this.path, 'events.jsonl'), loaded.events.map(e => JSON.stringify(e) + '\n').join(''));
        append('journal_repair', { recoveredEvents: loaded.events.length });
      }
      if (pending.length) {
        const handle = await open(join(this.path, 'events.jsonl'), 'a', 0o600);
        try { await handle.writeFile(pending.map(e => JSON.stringify(e) + '\n').join('')); await handle.sync(); } finally { await handle.close(); }
        await writeJson(join(this.path, 'snapshot.json'), { lastSeq: loaded.events.length + pending.length, state: this.snapshot ? this.snapshot([...loaded.events, ...pending]) : null, lastEvent: pending.at(-1) });
      }
      return result;
    });
  }
}
export async function listRuns() {
  try { return (await readdir(join(dataRoot(), 'runs'))).filter(x => /^run-[a-f0-9-]{36}$/.test(x)).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}
export async function exists(path: string) { try { await stat(path); return true; } catch { return false; } }
