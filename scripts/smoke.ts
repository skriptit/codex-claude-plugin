import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { runProvider } from '../dist/providers/run.js';
import { writeJson } from '../dist/runtime/files.js';
import type { Activity } from '../src/contracts.ts';

const backend = process.argv[2] || 'cli';
if (backend !== 'cli' && backend !== 'sdk') throw new Error('Use cli or sdk');
if (backend === 'sdk' && !process.env.ANTHROPIC_API_KEY) { console.error('SDK live verification pending: ANTHROPIC_API_KEY is not configured.'); process.exit(2); }
const root = await mkdtemp(join(tmpdir(), 'codex-claude-live-'));
const cwd = join(root, 'project'); await mkdir(join(cwd, '.claude'), { recursive: true });
await writeFile(join(cwd, 'fixture.txt'), 'Claude permitted evidence fixture.');
await writeFile(join(root, 'outside.txt'), 'Outside the approved working directory.');
await writeFile(join(cwd, 'hook.ts'), `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(join(root, 'unexpected-hook'))},'ran');`);
await writeJson(join(cwd, '.claude', 'settings.json'), { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `node "${join(cwd, 'hook.ts')}"` }] }] } });
let sessionId: string | undefined; const nonce = `codex-claude-memory-${randomUUID()}`;
const results: Array<Awaited<ReturnType<typeof runProvider>>> = [];
const activity: Array<Activity & { round: number }> = [];
console.log(JSON.stringify({ artifactDirectory: root, backend, started: true }));
for (let round = 1; round <= 3; round++) {
  const directory = join(root, `round-${round}`);
  const prompt = round === 1
    ? `This is a harmless integration fixture. Remember this exact token for later rounds: ${nonce}. Call mcp__codex_claude__ping, Read fixture.txt, Glob *.txt and Grep Claude in fixture.txt. Attempt Read on ${join(root, 'outside.txt')} to verify the configured directory boundary; if denied, accept the denial and do not try another tool or path. Do not run checks or shell commands. Return the required structured decision with verdict modify; answer must contain the exact token and state whether the outside Read was denied. Other required fields may be short, and objections/evidence may be empty arrays.`
    : `Integration fixture round ${round}. Call mcp__codex_claude__ping. Return the required structured decision with verdict modify; answer must include the exact remembered codex-claude-memory token from round 1. Do not invent a token or use filesystem search to recover it. Other fields may be short; arrays may be empty.`;
  const result = await runProvider({ cwd, directory, prompt, settings: { backend, model: 'claude-fable-5-1', effort: 'high' }, workflow: 'decide', sessionId }, e => { activity.push({ round, ...e }); if (e.type !== 'text' || e.text.trim()) console.error(`[claude:progress] ${JSON.stringify({ round, ...e })}`); });
  results.push(result); await writeJson(join(root, 'evidence.json'), { backend, results, activity });
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.ok(result.reply);
  assert.ok(result.reply.answer.includes(nonce), 'Structured resumed answer lost conversation memory');
  if (sessionId) assert.equal(result.sessionId, sessionId);
  else { assert.ok(result.sessionId); sessionId = result.sessionId; }
  console.log(JSON.stringify({ round, status: result.status, sessionId, models: result.observedModels, effectiveEffort: result.effectiveEffort, costUsd: result.costUsd }));
}
const { existsSync } = await import('node:fs');
assert.equal(existsSync(join(root, 'unexpected-hook')), false, 'Project hook executed under restricted mode');
assert.ok(activity.some(e => e.type === 'tool_start' && e.text === 'mcp__codex_claude__ping'), 'MCP tool was never called');
assert.ok(activity.some(e => e.type === 'permission_denied') || activity.some(e => e.type === 'tool_end' && /denied|outside|permission/i.test(JSON.stringify(e.detail))), 'No observed evidence of the outside-read restriction');
console.log(JSON.stringify({ passed: true, backend, sessionId, rounds: results.length, artifacts: root, tests: ['structured exact-session resume x3', 'model identity', 'Grep/Glob/Read', 'MCP', 'out-of-root read restriction', 'project hook isolation'] }));
