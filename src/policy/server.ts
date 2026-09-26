import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CcaError, VERSION, errorInfo } from '../contracts.js';
import { approvedPath, hash, readJson, runPath, writeJson } from '../runtime/files.js';
import { identity } from '../runtime/identity.js';
import { git } from '../inputs/git.js';
import type { Bundle } from '../inputs/bundle.js';
import type { TurnOptions } from '../providers/options.js';
import { approvedChecks, runCheck } from './checks.js';

const directory = process.argv[2]!;
const turn = await readJson<TurnOptions>(join(directory, 'turn.json'));
const owner = identity(); if (!owner) throw new Error('Cannot register evidence server');
await writeJson(join(directory, `process-${process.pid}.json`), { ...owner, role: 'evidence-server' });
const manifest = async () => turn.bundleDirectory ? readJson<Bundle>(join(turn.bundleDirectory, 'manifest.json')) : null;
const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
const guarded = async (fn: () => Promise<unknown>) => { try { return result(await fn()); } catch (error) { return { ...result(errorInfo(error)), isError: true }; } };
serveStdio(() => {
  const server = new McpServer({ name: 'cca-evidence', version: VERSION });
  server.registerTool('ping', { description: 'Check CCA evidence tool connectivity.', inputSchema: z.object({}) }, () => result({ ok: true, runId: turn.runId ?? null }));
  server.registerTool('inputs_list', { description: 'List immutable selected inputs and coverage omissions.', inputSchema: z.object({}) }, () => guarded(manifest));
  server.registerTool('inputs_read', { description: 'Read an immutable input by its exact manifest source; return continuation offset for long inputs.', inputSchema: z.object({ source: z.string(), offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(100_000).default(50_000) }) }, ({ source, offset, limit }) => guarded(async () => {
    const bundle = await manifest(); const entry = bundle?.entries.find(e => e.source === source);
    if (!entry || !turn.bundleDirectory) throw new CcaError('input_not_found', 'Choose an exact manifest source.');
    const bytes = await readFile(await approvedPath([turn.bundleDirectory], join(turn.bundleDirectory, entry.artifact)));
    if (hash(bytes) !== entry.hash) throw new CcaError('input_changed', 'Captured input failed its content hash.');
    const content = bytes.toString('utf8'); return { source, text: content.slice(offset, offset + limit), nextOffset: offset + limit < content.length ? offset + limit : null, hash: entry.hash };
  }));
  server.registerTool('git_status', { description: 'Read current checkout status; it may differ from captured inputs.', inputSchema: z.object({}) }, () => guarded(async () => (await git(turn.cwd, ['status', '--short'])).toString()));
  server.registerTool('git_log', { description: 'Read recent commit context without running shell commands.', inputSchema: z.object({ count: z.number().int().min(1).max(20).default(5) }) }, ({ count }) => guarded(async () => (await git(turn.cwd, ['log', `-${count}`, '--format=%h %s'])).toString()));
  server.registerTool('checks_list', { description: 'List the project checks already approved by the user.', inputSchema: z.object({}) }, () => guarded(() => approvedChecks(turn.cwd)));
  server.registerTool('checks_run', { description: 'Run one approved check against the live checkout; may create build artifacts.', inputSchema: z.object({ id: z.string() }) }, ({ id }) => guarded(async () => { const snapshot = await manifest(); return runCheck(turn.cwd, id, join(turn.runId ? runPath(turn.runId) : directory, 'checks'), snapshot?.fingerprint ?? null, snapshot?.checkoutAtCapture ?? null, snapshot?.selector ?? null); }));
  return server;
});
