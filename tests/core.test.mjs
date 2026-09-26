import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, appendFile, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { StreamNormalizer } from '../dist/providers/stream.js';
import { answerSegments, renderRound, Progress } from '../dist/presentation/render.js';
import { Journal } from '../dist/runtime/journal.js';
import { dataRoot, hash, runPath, writeJson } from '../dist/runtime/files.js';
import { configure, resolveSettings } from '../dist/runtime/config.js';
import { capture, checkoutFingerprint } from '../dist/inputs/bundle.js';
import { approveChecks, verifyCheck, runCheck } from '../dist/policy/checks.js';
import { assess, answerCheckpoint, createRun, inspect, runTurn, savedReply, raiseBudget, receipt } from '../dist/workflows/engine.js';

process.env.CCA_DATA_HOME = await mkdtemp(join(tmpdir(), 'cca-tests-data-'));
const settings = { backend: 'cli', model: 'claude-fable-5-1', effort: 'high' };
const reply = { verdict: 'modify', answer: 'Complete answer.\n\nCOST: is an example label.\n```ts\nconst x = "λ😀";\n```', objections: ['Missing evidence'], evidence: [], cost: 'More tests', falsifier: 'A measured failure' };
function result(overrides = {}) { return { status: 'completed', code: null, message: null, sessionId: 'session-one', requestedModel: settings.model, requestedEffort: settings.effort, observedModels: [settings.model], effectiveEffort: null, rawOutput: { structuredOutput: reply, assistantText: '', terminal: {} }, reply, costUsd: 0.1, usage: {}, ...overrides }; }
function parser(events = []) { return new StreamNormalizer(settings, 'decide', undefined, event => events.push(event)); }
function init(p, extra = {}) { p.accept({ type: 'system', subtype: 'init', model: settings.model, session_id: 'session-one', tools: ['Read', 'Grep', 'Glob', 'mcp__cca__ping'], ...extra }); p.accept({ type: 'stream_event', event: { type: 'message_start', message: { id: 'initial', model: settings.model } } }); }
function terminal(p, extra = {}) { p.accept({ type: 'result', subtype: 'success', session_id: 'session-one', structured_output: reply, total_cost_usd: 0.1, ...extra }); }
test('fragmented streams preserve Unicode and deduplicate complete assistant text', () => {
  const events = []; const p = parser(events); init(p);
  const messages = [{ type: 'stream_event', event: { type: 'message_start', message: { id: 'm', model: settings.model } } }, { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello λ😀' } } }, { type: 'assistant', message: { id: 'm', model: settings.model, content: [{ type: 'text', text: 'hello λ😀' }, { type: 'thinking', thinking: 'PRIVATE' }] } }];
  const wire = messages.map(m => JSON.stringify(m) + '\n').join(''); for (let i = 0; i < wire.length; i += 3) p.push(wire.slice(i, i + 3)); terminal(p);
  const output = p.finish(0); assert.equal(output.status, 'completed'); assert.equal(output.rawOutput.assistantText, 'hello λ😀'); assert.equal(events.filter(e => e.type === 'text').map(e => e.text).join(''), 'hello λ😀'); assert.ok(!JSON.stringify(output).includes('PRIVATE'));
});
for (const [name, modify, expected] of [
  ['missing payload', p => terminal(p, { structured_output: undefined }), 'invalid_structured_output'],
  ['wrong model', p => { p.accept({ type: 'assistant', message: { id: 'wrong', model: 'other', content: [] } }); terminal(p); }, 'model_mismatch'],
  ['effort mismatch', p => { init(p, { effort: 'low' }); terminal(p); }, 'effort_mismatch'],
  ['schema retries exhausted', p => terminal(p, { subtype: 'error_max_structured_output_retries', is_error: true }), 'error_max_structured_output_retries'],
  ['session changed', p => terminal(p, { session_id: 'different' }), 'session_mismatch'],
  ['no terminal', () => {}, 'missing_terminal'],
  ['malformed final line', p => { terminal(p); p.push('{broken'); }, 'inconsistent_stream'],
]) test(name, () => { const p = parser(); init(p); modify(p); assert.equal(p.finish(name === 'schema retries exhausted' ? 1 : 0).code, expected); });
test('permission denials and retries are visible while effective effort remains unknown', () => { const events = []; const p = parser(events); init(p); p.accept({ type: 'system', subtype: 'permission_denied', tool_name: 'Read' }); p.accept({ type: 'system', subtype: 'api_retry' }); terminal(p); assert.equal(p.finish(0).effectiveEffort, null); assert.ok(events.some(e => e.type === 'permission_denied')); assert.ok(events.some(e => e.type === 'retry')); });
test('long answers reconstruct exactly, including surrogate pairs and Markdown labels', () => { const answer = reply.answer.repeat(2000); const segments = answerSegments(answer, 137); assert.equal(segments.join(''), answer); assert.ok(segments.every(s => !/[\uD800-\uDBFF]$/.test(s))); const display = renderRound(6, 'sdk', result({ reply: { ...reply, answer } })); assert.equal(display.answerSegments.join(''), answer); assert.ok(display.markdown.includes(answer)); assert.ok(display.label.includes('6')); });
test('progress coalesces fragments and groups a tool id', () => { const lines = []; const p = new Progress(s => lines.push(s)); p.accept({ type: 'text', text: 'Read ' }); p.accept({ type: 'text', text: 'the file.' }); p.accept({ type: 'tool_start', text: 'Read', id: 'one' }); p.accept({ type: 'tool_start', text: 'Read', id: 'one', detail: {} }); p.flush(); assert.equal(lines.length, 2); assert.ok(lines[0].includes('Read the file.')); });
test('journal read is pure and repairs a torn tail only on write', async () => { const j = new Journal(`run-${randomUUID()}`); await j.transaction((_e, append) => append('first', { x: 1 })); const file = join(j.path, 'events.jsonl'); await appendFile(file, '{broken'); const before = await readFile(file); assert.equal((await j.read()).tornTail, true); assert.deepEqual(await readFile(file), before); await j.transaction((_e, append) => append('next', {})); const repaired = await j.read(); assert.equal(repaired.tornTail, false); assert.equal(repaired.events.at(-1).type, 'journal_repair'); });
test('concurrent journal writers serialize without lost events', async () => { const j = new Journal(`run-${randomUUID()}`); await Promise.all(Array.from({ length: 8 }, (_, i) => j.transaction((_e, append) => append('value', i)))); const loaded = await j.read(); assert.equal(loaded.events.length, 8); assert.equal(new Set(loaded.events.map(e => e.data)).size, 8); });
test('configuration resolves project workflow and run overrides', async () => { const cwd = await mkdtemp(join(tmpdir(), 'cca-config-')); await configure({ model: 'user' }); await configure({ model: 'workflow' }, undefined, 'review'); await configure({ model: 'project' }, cwd); await configure({ model: 'project-review', effort: 'medium' }, cwd, 'review'); assert.equal((await resolveSettings(cwd, 'review')).model, 'project-review'); assert.equal((await resolveSettings(cwd, 'review', { model: 'run' })).model, 'run'); assert.equal((await resolveSettings(cwd, 'decide')).model, 'project'); await configure(settings); });
async function fixtureRepo() { const cwd = await mkdtemp(join(tmpdir(), 'cca-git-')); const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }); git('init', '-q'); git('config', 'user.name', 'CCA fixture'); git('config', 'user.email', 'fixture@example.invalid'); await writeFile(join(cwd, 'file.txt'), 'base\n'); git('add', 'file.txt'); git('commit', '-qm', 'Fixture'); return { cwd, git }; }
test('staged review captures index bytes and default review captures working bytes', async () => { const { cwd, git } = await fixtureRepo(); await writeFile(join(cwd, 'file.txt'), 'staged\n'); git('add', 'file.txt'); await writeFile(join(cwd, 'file.txt'), 'working\n'); const root = await mkdtemp(join(tmpdir(), 'cca-bundles-')); const staged = await capture(cwd, join(root, 'staged'), { staged: true }, 'review'); const working = await capture(cwd, join(root, 'working'), {}, 'review'); const a = staged.entries.find(e => e.kind === 'target'); const b = working.entries.find(e => e.kind === 'target'); assert.equal(await readFile(join(root, 'staged', a.artifact), 'utf8'), 'staged\n'); assert.equal(await readFile(join(root, 'working', b.artifact), 'utf8'), 'working\n'); assert.notEqual(staged.fingerprint, working.fingerprint); });
test('untracked content changes fingerprint even with same filename', async () => { const { cwd } = await fixtureRepo(); await writeFile(join(cwd, 'new.txt'), 'one'); const before = await checkoutFingerprint(cwd); await writeFile(join(cwd, 'new.txt'), 'two'); assert.notEqual(await checkoutFingerprint(cwd), before); });
test('clean repository and incompatible selectors', async () => { const { cwd } = await fixtureRepo(); const root = await mkdtemp(join(tmpdir(), 'cca-clean-')); assert.equal((await capture(cwd, join(root, 'a'), {}, 'review')).nothingToReview, true); await assert.rejects(capture(cwd, join(root, 'b'), { staged: true, base: 'HEAD' }, 'review'), e => e.code === 'invalid_scope'); });
test('document inputs are captured and missing specs become omissions', async () => { const cwd = await mkdtemp(join(tmpdir(), 'cca-docs-')); await writeFile(join(cwd, 'plan.md'), '# Plan\n'); const root = await mkdtemp(join(tmpdir(), 'cca-doc-bundle-')); const bundle = await capture(cwd, root, { documents: ['plan.md'], specs: ['missing.md'] }, 'review'); assert.equal(bundle.entries[0].kind, 'document'); assert.equal(bundle.omissions.length, 1); });
test('path escapes cannot enter a Git selection', async () => { const { cwd } = await fixtureRepo(); const root = await mkdtemp(join(tmpdir(), 'cca-escape-')); await assert.rejects(capture(cwd, root, { paths: ['../outside'] }, 'review'), e => e.code === 'path_denied'); });
test('approved checks run, changed definitions fail, unknown attempts never replay', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'cca-check-')); const definitionFile = join(cwd, 'check.mjs'); await writeFile(definitionFile, 'console.log("check passed");');
  const check = { id: 'fixture', executable: process.execPath, args: [definitionFile], cwd, purpose: 'fixture check', definitionFile, definitionKey: null, definitionHash: hash(await readFile(definitionFile)) };
  await approveChecks(cwd, [check]); const dir = join(cwd, 'receipts'); assert.equal((await runCheck(cwd, 'fixture', dir, 'bundle')).status, 'passed'); await assert.rejects(runCheck(cwd, 'missing', dir, null), e => e.code === 'check_not_approved');
  await writeFile(definitionFile, 'console.log("changed");'); await assert.rejects(verifyCheck(check), e => e.code === 'check_definition_changed'); await writeFile(definitionFile, 'console.log("check passed");');
  await writeJson(join(dir, 'unknown.json'), { id: 'fixture', status: 'outcome_unknown' }); await assert.rejects(runCheck(cwd, 'fixture', dir, null), e => e.code === 'check_outcome_unknown');
});
const brief = { question: 'Choose a representation', proposal: 'Use a journal', reason: 'Ordered evidence', cost: 'Disk writes', falsifier: 'Cannot recover', alternatives: ['Database'], constraints: [], evidence: [] };
test('decide enforces checkpoints at 3 and 6 without resetting on resume', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'cca-decide-')); const run = await createRun({ workflow: 'decide', cwd, question: brief.question, settings }); let state = run;
  for (let n = 1; n <= 6; n++) {
    const output = await runTurn(run.id, brief, {}, async () => result()); state = output.run;
    await assert.rejects(runTurn(run.id, brief, {}, async () => result()), e => e.code === 'invalid_transition');
    state = await assess(run.id, { requestId: output.requestId, proposalHash: hash(brief.proposal), agree: false, answer: 'Need more evidence', reason: 'Unresolved test', cost: 'More work', falsifier: 'Measurement settles it' }, state.revision);
    if (n % 3 === 0) {
      assert.equal(state.status, 'awaiting_user'); assert.equal(state.checkpoint.afterRound, n);
      assert.doesNotMatch(state.checkpoint.question, /\$|\b(?:usd|spent|spend|cost|tokens?|usage)\b/i);
      assert.ok(Math.abs(state.spentUsd - n * 0.1) < 0.00001); assert.equal(state.costUnknown, false);
      await assert.rejects(runTurn(run.id, brief, {}, async () => result()), e => e.code === 'invalid_transition');
      state = await answerCheckpoint(run.id, state.checkpoint.id, n === 6 ? 'stop' : 'continue', state.revision);
    }
  }
  assert.equal(state.completedRounds, 6); assert.equal(state.status, 'stopped'); const shown = await savedReply(run.id, 3); assert.equal(shown.display.answer, reply.answer);
});
test('agreement requires the current endorsed request and independent assessment', async () => { const cwd = await mkdtemp(join(tmpdir(), 'cca-agree-')); const run = await createRun({ workflow: 'decide', cwd, question: brief.question, settings }); const output = await runTurn(run.id, brief, {}, async () => result({ reply: { ...reply, verdict: 'endorse' } })); const a = { requestId: output.requestId, proposalHash: hash(brief.proposal), agree: true, answer: 'Accept', reason: 'Evidence holds', cost: 'Disk writes', falsifier: 'Recovery fails' }; await assert.rejects(assess(run.id, { ...a, proposalHash: hash('different') }), e => e.code === 'assessment_mismatch'); assert.equal((await assess(run.id, a)).status, 'agreed'); });
test('failed attempts do not count and need explicit retry', async () => { const cwd = await mkdtemp(join(tmpdir(), 'cca-retry-')); const run = await createRun({ workflow: 'decide', cwd, question: brief.question, settings }); await runTurn(run.id, brief, {}, async () => result({ status: 'outcome_unknown', reply: null })); assert.equal((await inspect(run.id)).completedRounds, 0); await assert.rejects(runTurn(run.id, brief, {}, async () => result()), e => e.code === 'retry_required'); const retried = await runTurn(run.id, brief, { retry: true }, async o => { assert.equal(o.sessionId, 'session-one'); return result(); }); assert.equal(retried.run.completedRounds, 1); assert.equal(retried.run.attempts, 2); });
test('pure run inspection does not write journal or snapshots', async () => { const cwd = await mkdtemp(join(tmpdir(), 'cca-pure-')); const run = await createRun({ workflow: 'decide', cwd, question: brief.question, settings }); const file = join(runPath(run.id), 'events.jsonl'); const before = await stat(file); await inspect(run.id); await savedReply(run.id); assert.equal((await stat(file)).mtimeMs, before.mtimeMs); assert.equal(dataRoot(), process.env.CCA_DATA_HOME); });
test('symlink escape is a coverage omission', async t => { const { cwd } = await fixtureRepo(); const outside = await mkdtemp(join(tmpdir(), 'cca-outside-')); await writeFile(join(outside, 'data.txt'), 'outside'); try { await symlink(join(outside, 'data.txt'), join(cwd, 'link.txt')); } catch (e) { if (e.code === 'EPERM') { t.skip('Host cannot create file symlinks'); return; } throw e; } const dir = await mkdtemp(join(tmpdir(), 'cca-symlink-bundle-')); const bundle = await capture(cwd, dir, {}, 'review'); assert.ok(bundle.omissions.some(o => o.source === 'link.txt')); });
test('directory junction cannot escape captured evidence roots', async () => {
  const { cwd } = await fixtureRepo(); const outside = await mkdtemp(join(tmpdir(), 'cca-junction-')); await writeFile(join(outside, 'data.txt'), 'outside');
  await symlink(outside, join(cwd, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const { approvedPath } = await import('../dist/runtime/files.js');
  await assert.rejects(approvedPath([cwd], join(cwd, 'linked', 'data.txt')), e => e.code === 'path_denied');
});
test('base review resolves merge base, retains untracked inputs and discovers nested guidance', async () => {
  const { cwd, git } = await fixtureRepo(); git('branch', 'base');
  await mkdir(join(cwd, 'src')); await writeFile(join(cwd, 'src', 'AGENTS.md'), 'Use exact arithmetic.'); await writeFile(join(cwd, 'src', 'new.ts'), 'export const n = 42;');
  git('add', 'src'); git('commit', '-qm', 'second'); await writeFile(join(cwd, 'extra.txt'), 'extra');
  const root = await mkdtemp(join(tmpdir(), 'cca-base-')); const bundle = await capture(cwd, root, { base: 'base' }, 'review');
  assert.equal(bundle.base, git('rev-parse', 'base').toString().trim()); assert.ok(bundle.entries.some(e => e.source === 'src/new.ts' && e.kind === 'target')); assert.ok(bundle.entries.some(e => e.source === 'extra.txt'));
  assert.ok(bundle.entries.some(e => e.kind === 'guidance' && /src[/\\]AGENTS.md/.test(e.source)));
});
test('oversized and non-UTF-8 inputs are explicit omissions', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'cca-omissions-')); await writeFile(join(cwd, 'large.md'), Buffer.alloc(2 * 1024 * 1024 + 1, 65)); await writeFile(join(cwd, 'invalid.txt'), Buffer.from([255, 254, 255]));
  const bundle = await capture(cwd, join(cwd, 'bundle'), { documents: ['large.md', 'invalid.txt'] }, 'review'); assert.equal(bundle.entries.length, 0); assert.equal(bundle.omissions.length, 2); assert.equal(bundle.nothingToReview, false);
});
test('budget exhaustion requires an explicit increase; snapshots contain engine state', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'cca-budget-')); const run = await createRun({ workflow: 'decide', cwd, question: brief.question, settings: { ...settings, budgetUsd: 0.1 } });
  const output = await runTurn(run.id, brief, {}, async o => { assert.equal(o.settings.budgetUsd, 0.1); return result(); });
  await assess(run.id, { requestId: output.requestId, proposalHash: hash(brief.proposal), agree: false, answer: 'Continue', reason: 'Evidence', cost: 'work', falsifier: 'Failure' });
  await assert.rejects(runTurn(run.id, brief, {}, async () => result()), e => e.code === 'budget_exhausted');
  await raiseBudget(run.id, 0.3); await runTurn(run.id, brief, {}, async o => { assert.ok(Math.abs(o.settings.budgetUsd - 0.2) < 0.00001); return result(); });
  const snapshot = JSON.parse(await readFile(join(runPath(run.id), 'snapshot.json'), 'utf8')); assert.equal(snapshot.state.completedRounds, 2); assert.equal(snapshot.state.status, 'awaiting_lead');
});
test('a second model command cannot relaunch an active round', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'cca-active-')); const run = await createRun({ workflow: 'decide', cwd, question: brief.question, settings });
  let release; let entered; const started = new Promise(r => entered = r); const gate = new Promise(r => release = r);
  const first = runTurn(run.id, brief, {}, async () => { entered(); await gate; return result(); }); await started;
  await assert.rejects(runTurn(run.id, brief, {}, async () => result()), e => e.code === 'run_active'); release(); await first;
});
test('interrupted session identity comes only from saved provider events', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'cca-init-session-')); const run = await createRun({ workflow: 'decide', cwd, question: brief.question, settings });
  await runTurn(run.id, brief, {}, async (_o, emit) => { emit({ type: 'status', text: 'provider initialized', detail: { source: 'provider_init', sessionId: 'saved-init-session', model: settings.model } }); return result({ status: 'interrupted', sessionId: null, reply: null }); });
  assert.equal((await inspect(run.id)).sessionId, 'saved-init-session');
  await runTurn(run.id, brief, { retry: true }, async o => { assert.equal(o.sessionId, 'saved-init-session'); return result({ sessionId: 'saved-init-session' }); });
  const unknown = await createRun({ workflow: 'decide', cwd, question: brief.question, settings });
  await runTurn(unknown.id, brief, {}, async () => result({ status: 'interrupted', sessionId: null, reply: null }));
  await assert.rejects(runTurn(unknown.id, brief, { retry: true }, async () => result()), e => e.code === 'session_unavailable');
});
test('receipt transport recovers complete long raw outputs and detects modified artifacts', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'cca-receipt-')); const run = await createRun({ workflow: 'decide', cwd, question: brief.question, settings });
  const longReply = { ...reply, answer: reply.answer.repeat(600) }; const rawOutput = { structuredOutput: longReply, assistantText: 'Original assistant text', terminal: { structured_output: longReply } };
  const output = await runTurn(run.id, brief, {}, async () => result({ reply: longReply, rawOutput })); const proof = receipt(output);
  assert.ok(JSON.stringify(proof).length < 2400); assert.equal(output.run.lastResult, undefined); assert.deepEqual(output.rawOutput, rawOutput);
  let raw = ''; for (let n = 1; n <= proof.integrity.rawSegmentCount; n++) raw += (await savedReply(run.id, 1, undefined, n)).text;
  assert.equal(hash(raw), proof.integrity.rawOutputHash); assert.deepEqual(JSON.parse(raw), rawOutput);
  let answer = ''; for (let n = 1; n <= proof.answerSegmentCount; n++) answer += (await savedReply(run.id, 1, n)).text;
  assert.equal(answer, longReply.answer); assert.equal(hash(answer), proof.integrity.answerHash);
  const path = join(runPath(run.id), 'attempts', '1', 'result.json'); const original = await readFile(path, 'utf8'); await writeFile(path, original.replace('Original assistant text', 'Modified assistant text'));
  await assert.rejects(savedReply(run.id, 1), e => e.code === 'result_integrity');
});
