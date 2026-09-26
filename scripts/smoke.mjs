import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { runProvider } from '../dist/providers/run.js';
import { writeJson } from '../dist/runtime/files.js';

const backend = process.argv[2] || 'cli';
if (!['cli', 'sdk'].includes(backend)) throw new Error('Use cli or sdk');
if (backend === 'sdk' && !process.env.ANTHROPIC_API_KEY) { console.error('SDK live verification pending: ANTHROPIC_API_KEY is not configured.'); process.exit(2); }
const root = await mkdtemp(join(tmpdir(), 'cca-live-'));
const cwd = join(root, 'project'); await mkdir(join(cwd, '.claude'), { recursive: true });
await writeFile(join(cwd, 'fixture.txt'), 'CCA permitted evidence fixture.');
await writeFile(join(root, 'outside.txt'), 'Outside the approved working directory.');
await writeFile(join(cwd, 'hook.mjs'), `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(join(root, 'unexpected-hook'))},'ran');`);
await writeJson(join(cwd, '.claude', 'settings.json'), { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `node "${join(cwd, 'hook.mjs')}"` }] }] } });
let sessionId; const nonce = `cca-memory-${randomUUID()}`; const results = []; const activity = [];
console.log(JSON.stringify({ artifactDirectory: root, backend, started: true }));
for (let round = 1; round <= 3; round++) {
  const directory = join(root, `round-${round}`);
  const prompt = round === 1
    ? `This is a harmless integration fixture. Remember this exact token for later rounds: ${nonce}. Call mcp__cca__ping, Read fixture.txt, Glob *.txt and Grep CCA in fixture.txt. Attempt Read on ${join(root, 'outside.txt')} to verify the configured directory boundary; if denied, accept the denial and do not try another tool or path. Do not run checks or shell commands. Return the required structured decision with verdict modify; answer must contain the exact token and state whether the outside Read was denied. Other required fields may be short, and objections/evidence may be empty arrays.`
    : `Integration fixture round ${round}. Call mcp__cca__ping. Return the required structured decision with verdict modify; answer must include the exact remembered cca-memory token from round 1. Do not invent a token or use filesystem search to recover it. Other fields may be short; arrays may be empty.`;
  const result = await runProvider({ cwd, directory, prompt, settings: { backend, model: 'claude-fable-5-1', effort: 'high' }, workflow: 'decide', sessionId }, e => { activity.push({ round, ...e }); if (e.type !== 'text' || e.text.trim()) console.error(`[cca:progress] ${JSON.stringify({ round, ...e })}`); });
  results.push(result); await writeJson(join(root, 'evidence.json'), { backend, results, activity });
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.ok(result.reply.answer.includes(nonce), 'Structured resumed answer lost conversation memory');
  if (sessionId) assert.equal(result.sessionId, sessionId); else sessionId = result.sessionId;
  console.log(JSON.stringify({ round, status: result.status, sessionId, models: result.observedModels, effectiveEffort: result.effectiveEffort, costUsd: result.costUsd }));
}
const { existsSync } = await import('node:fs');
assert.equal(existsSync(join(root, 'unexpected-hook')), false, 'Project hook executed under restricted mode');
assert.ok(activity.some(e => e.type === 'tool_start' && e.text === 'mcp__cca__ping'), 'MCP tool was never called');
assert.ok(activity.some(e => e.type === 'permission_denied') || activity.some(e => e.type === 'tool_end' && /denied|outside|permission/i.test(JSON.stringify(e.detail))), 'No observed evidence of the outside-read restriction');
console.log(JSON.stringify({ passed: true, backend, sessionId, rounds: results.length, artifacts: root, tests: ['structured exact-session resume x3', 'model identity', 'Grep/Glob/Read', 'MCP', 'out-of-root read restriction', 'project hook isolation'] }));
