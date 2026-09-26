import { mkdir, readdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { CcaError } from '../contracts.js';
import { alive, identity, type Identity } from './identity.js';
import { readJson, writeJson } from './files.js';

type Ticket = { owner: Identity; number: number; choosing: boolean };
// Lamport bakery mutex on the local filesystem. Publish complete records with
// atomic rename; never delete another contender's record. Dead owners are ignored,
// including a writer interrupted while choosing. There is no stale-lock stealing.
export async function exclusive<T>(directory: string, action: () => Promise<T>): Promise<T> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const owner = identity(); if (!owner) throw new CcaError('identity_unavailable', 'Cannot establish lock ownership.');
  const name = `${randomUUID()}.ticket.json`; const path = join(directory, name);
  const mine: Ticket = { owner, number: 0, choosing: true };
  const tickets = async () => {
    const found: { name: string; ticket: Ticket }[] = [];
    for (const file of await readdir(directory)) if (file.endsWith('.ticket.json') && file !== name) {
      try {
        const ticket = await readJson<Ticket>(join(directory, file));
        if (!ticket.owner || !Number.isSafeInteger(ticket.number) || ticket.number < 0 || typeof ticket.choosing !== 'boolean') throw new CcaError('lock_corrupt', 'Invalid lock ticket.');
        if (alive(ticket.owner)) found.push({ name: file, ticket });
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return found;
  };
  await writeJson(path, mine);
  try {
    mine.number = Math.max(0, ...(await tickets()).map(t => t.ticket.number)) + 1;
    mine.choosing = false; await writeJson(path, mine);
    const deadline = performance.now() + 10_000;
    for (;;) {
      const others = await tickets();
      if (!others.some(t => t.ticket.choosing || t.ticket.number < mine.number || (t.ticket.number === mine.number && t.name < name))) break;
      if (performance.now() >= deadline) throw new CcaError('run_busy', 'Another process is committing state.');
      await new Promise(r => setTimeout(r, 30));
    }
    return await action();
  } finally { await rm(path, { force: true }); }
}
