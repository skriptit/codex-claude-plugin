import test from 'node:test';
import assert from 'node:assert/strict';
import { cliArguments, sdkOptions, validateCliHelp, providerEnvironment, BUILTINS, MCP_TOOLS } from '../dist/providers/options.js';
import { StreamNormalizer } from '../dist/providers/stream.js';
const settings = { backend: 'cli', model: 'claude-fable-5-1', effort: 'high' };
const options = { cwd: process.cwd(), directory: process.cwd(), prompt: 'test', settings, workflow: 'decide', sessionId: 'exact-session' };
const reply = { verdict: 'endorse', answer: 'Verified', objections: [], evidence: [], cost: 'Work', falsifier: 'Failure' };
test('SDK and CLI enforce the same restrictions and exact continuation without fallbacks or limits', () => {
  const cli = cliArguments(options); const sdk = sdkOptions(options, () => { throw new Error('not launched'); });
  for (const flag of ['--restricted', '--strict-mcp-config', '--disallowedTools', '--json-schema']) assert.ok(cli.includes(flag));
  assert.equal(cli[cli.indexOf('--resume') + 1], 'exact-session'); assert.equal(sdk.resume, 'exact-session');
  assert.deepEqual(sdk.tools, BUILTINS); assert.deepEqual(sdk.allowedTools, [...BUILTINS, ...MCP_TOOLS]);
  assert.deepEqual(sdk.settingSources, []); assert.equal(sdk.permissionMode, 'dontAsk'); assert.equal(sdk.permissionPrompts, 'none'); assert.equal(sdk.strictMcpConfig, true);
  assert.equal(sdk.extraArgs.restricted, null); assert.equal(JSON.parse(sdk.extraArgs.settings).disableAllHooks, true);
  assert.equal(sdk.model, settings.model); assert.equal(sdk.effort, 'high');
  for (const key of ['fallbackModel', 'maxTurns', 'maxBudgetUsd', 'forkSession', 'continue']) assert.equal(sdk[key], undefined);
  assert.ok(!cli.includes('--max-budget-usd')); assert.equal(sdk.outputFormat.schema.$schema, 'http://json-schema.org/draft-07/schema#');
});
test('both budget adapters use explicit provider estimates; unsupported CLI fails preflight', () => {
  const settingsWithBudget = { ...settings, budgetUsd: 1.25 }; const input = { ...options, settings: settingsWithBudget };
  assert.equal(sdkOptions(input, () => {}).maxBudgetUsd, 1.25);
  const cli = cliArguments(input); assert.equal(cli[cli.indexOf('--max-budget-usd') + 1], '1.25');
  const help = '--restricted --permission-prompts --strict-mcp-config --json-schema --tools --allowedTools --disallowedTools --setting-sources --effort --resume';
  assert.throws(() => validateCliHelp(help, settingsWithBudget), e => e.code === 'budget_unsupported');
  validateCliHelp(help, settings); validateCliHelp(help + ' --max-budget-usd', settingsWithBudget);
});
test('inherited routing cannot silently change authentication backend', () => {
  process.env.ANTHROPIC_API_KEY = 'fixture-not-a-key'; process.env.CLAUDE_CODE_OAUTH_TOKEN = 'fixture-not-a-token'; process.env.CLAUDE_CODE_USE_BEDROCK = '1';
  try { const cli = providerEnvironment('cli'); const sdk = providerEnvironment('sdk'); assert.equal(cli.ANTHROPIC_API_KEY, undefined); assert.equal(sdk.CLAUDE_CODE_OAUTH_TOKEN, undefined); assert.equal(sdk.CLAUDE_CODE_USE_BEDROCK, undefined); assert.equal(sdk.ANTHROPIC_API_KEY, 'fixture-not-a-key'); }
  finally { delete process.env.ANTHROPIC_API_KEY; delete process.env.CLAUDE_CODE_OAUTH_TOKEN; delete process.env.CLAUDE_CODE_USE_BEDROCK; }
});
test('init identity alone cannot claim an observed response model', () => {
  const p = new StreamNormalizer(settings, 'decide', undefined, () => {});
  p.accept({ type: 'system', subtype: 'init', session_id: 's', model: settings.model });
  p.accept({ type: 'result', subtype: 'success', session_id: 's', structured_output: reply });
  assert.equal(p.finish(0).code, 'model_mismatch');
});
test('duplicate transport events, tool starts and denials do not duplicate activity', () => {
  const events = []; const p = new StreamNormalizer(settings, 'decide', undefined, e => events.push(e));
  const start = { type: 'stream_event', uuid: 'u', event: { type: 'content_block_start', content_block: { type: 'tool_use', id: 't', name: 'Read' } } };
  p.accept(start); p.accept(start);
  p.accept({ type: 'assistant', message: { id: 'm', model: settings.model, content: [{ type: 'tool_use', id: 't', name: 'Read' }] } });
  p.accept({ type: 'system', subtype: 'permission_denied', tool_name: 'Read', tool_use_id: 't' });
  p.accept({ type: 'result', subtype: 'success', session_id: 's', structured_output: reply, permission_denials: [{ tool_name: 'Read', tool_use_id: 't' }] });
  assert.equal(events.filter(e => e.type === 'tool_start').length, 1); assert.equal(events.filter(e => e.type === 'permission_denied').length, 1);
});
