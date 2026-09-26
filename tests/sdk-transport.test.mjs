import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { sdkOptions } from '../dist/providers/options.js';
import { StreamNormalizer } from '../dist/providers/stream.js';

test('official SDK query traverses its control transport through the owned spawn hook', { timeout: 10_000 }, async () => {
  const settings = { backend: 'sdk', model: 'claude-fable-5-1', effort: 'high' };
  const reply = { verdict: 'endorse', answer: 'Exact answer λ😀\n\n```ts\n42\n```', objections: [], evidence: [], cost: 'Fixture', falsifier: 'A regression' };
  let launched; const controls = [];
  const proc = new EventEmitter(); Object.assign(proc, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), killed: false, exitCode: null, pid: 12345, kill() { this.killed = true; this.exitCode = 0; this.stdout.end(); this.stderr.end(); this.emit('exit', 0, null); return true; } });
  const send = value => proc.stdout.write(JSON.stringify(value) + '\n'); let buffer = '';
  proc.stdin.on('data', bytes => {
    buffer += bytes;
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'); const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.type === 'control_request') {
        controls.push(message.request);
        send({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response: { commands: [], agents: [], output_style: 'default', available_output_styles: ['default'], models: [], account: {} } } });
      }
      if (message.type === 'user') {
        send({ type: 'system', subtype: 'init', uuid: 'init', session_id: 'exact-sdk-session', model: settings.model, tools: ['Read', 'Glob', 'Grep', 'mcp__cca__ping'] });
        send({ type: 'assistant', uuid: 'assistant', session_id: 'exact-sdk-session', message: { id: 'm', type: 'message', role: 'assistant', model: settings.model, content: [{ type: 'text', text: 'Fixture response' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }, parent_tool_use_id: null });
        send({ type: 'result', subtype: 'success', uuid: 'result', session_id: 'exact-sdk-session', is_error: false, result: 'Fixture response', structured_output: reply, total_cost_usd: 0, duration_ms: 1, duration_api_ms: 1, num_turns: 1, usage: {}, modelUsage: {}, permission_denials: [] });
      }
    }
  });
  proc.stdin.on('finish', () => setImmediate(() => proc.kill()));
  const options = sdkOptions({ cwd: process.cwd(), directory: process.cwd(), prompt: 'fixture', settings, workflow: 'decide', sessionId: 'exact-sdk-session' }, launch => { launched = launch; return proc; });
  // The only child is an in-memory fixture: no real credentials or network calls.
  options.env = { PATH: process.env.PATH, ANTHROPIC_API_KEY: 'fixture-not-a-key' };
  const stream = query({ prompt: 'fixture', options }); const events = [];
  try { for await (const event of stream) events.push(event); }
  finally { stream.close(); proc.kill(); }
  assert.ok(controls.some(c => c.subtype === 'initialize')); assert.ok(launched.args.includes('--restricted'));
  assert.ok(launched.args.includes('--strict-mcp-config'));
  assert.ok(JSON.stringify({ controls, args: launched.args }).includes('exact-sdk-session'), JSON.stringify({ controls, args: launched.args }));
  const normalized = new StreamNormalizer(settings, 'decide', 'exact-sdk-session', () => {}); events.forEach(e => normalized.accept(e));
  const result = normalized.finish(0); assert.equal(result.status, 'completed'); assert.deepEqual(result.rawOutput.structuredOutput, reply); assert.equal(result.effectiveEffort, null);
});
