#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Backend, PluginError, Effort, errorInfo, type Settings } from './contracts.js';
import { configure, loadConfig, resolveSettings } from './runtime/config.js';
import { dataRoot, readJson } from './runtime/files.js';
import { listRuns } from './runtime/journal.js';
import { preflight } from './providers/options.js';
import { approvedChecks, approveChecks, Check, discoverChecks, validateChecks, type CheckDefinition } from './policy/checks.js';
import { answerCheckpoint, assess, cancel, createRun, inspect, raiseBudget, readBrief, receipt, runTurn, savedReply } from './workflows/engine.js';
import { Progress } from './presentation/render.js';

const help = {
  name: 'codex-claude-plugin', namespace: 'claude',
  commands: ['setup [--project] [--check]', 'decide <question> --brief-file <json>', 'review [focus]', 'runs [run-id] [--round N] [--segment N]', 'resume <run-id> [--retry] [--brief-file <json>]', 'cancel <run-id>'],
  runOptions: ['--backend cli|sdk', '--model ID', '--effort low|medium|high|xhigh|max', '--budget-usd AMOUNT', '--spec PATH_OR_URL', '--standards PATH_OR_URL'],
  reviewOptions: ['--base REF', '--staged', '--path PATH', '--document PATH'],
  coordination: ['assess RUN --assessment-file JSON --expected-revision N', 'checkpoint RUN --checkpoint-id ID --answer continue|stop --expected-revision N'],
  notes: ['One foreground flow; no wait/background flags.', 'Brief: question, proposal, reason, cost, falsifier, alternatives[], constraints[], evidence[], optional responseToCounsel.', 'Effective effort can be unknown. No silent model or backend fallback.'],
};
const spec = {
  cwd: { type: 'string' }, backend: { type: 'string' }, model: { type: 'string' }, effort: { type: 'string' }, 'budget-usd': { type: 'string' },
  base: { type: 'string' }, staged: { type: 'boolean' }, path: { type: 'string', multiple: true }, document: { type: 'string', multiple: true }, spec: { type: 'string', multiple: true }, standards: { type: 'string', multiple: true },
  project: { type: 'boolean' }, check: { type: 'boolean' }, workflow: { type: 'string' }, 'approve-check': { type: 'string', multiple: true }, 'checks-file': { type: 'string' },
  'brief-file': { type: 'string' }, run: { type: 'string' }, 'assessment-file': { type: 'string' }, 'expected-revision': { type: 'string' },
  'checkpoint-id': { type: 'string' }, answer: { type: 'string' }, round: { type: 'string' }, segment: { type: 'string' }, retry: { type: 'boolean' },
  'linked-from': { type: 'string' }, 'receipt-only': { type: 'boolean' }, 'raw-segment': { type: 'string' }, help: { type: 'boolean', short: 'h' }, json: { type: 'boolean' },
} as const;
const number = (value: string | undefined) => { if (value === undefined) return undefined; const n = Number(value); if (!Number.isFinite(n) || n <= 0) throw new PluginError('invalid_number', `Expected a positive number: ${value}`); return n; };
const integer = (value: string | undefined) => { const n = number(value); if (n !== undefined && !Number.isSafeInteger(n)) throw new PluginError('invalid_number', 'Expected a positive integer.'); return n; };
async function main() {
  const parsed = parseArgs({ options: spec, allowPositionals: true, strict: true }); const v = parsed.values; const [command, ...args] = parsed.positionals;
  if (!command || v.help) return help;
  const cwd = resolve(v.cwd || process.cwd()); const overrides: Partial<Settings> = {};
  const runtime = { entrypoint: fileURLToPath(import.meta.url), node: process.versions.node };
  if (v.backend) overrides.backend = Backend.parse(v.backend); if (v.model) overrides.model = v.model;
  if (v.effort) overrides.effort = Effort.parse(v.effort); if (v['budget-usd']) overrides.budgetUsd = number(v['budget-usd']);
  const id = v.run || args[0]; const expectedRevision = integer(v['expected-revision']);
  const progress = new Progress(line => process.stderr.write(line));
  const abort = new AbortController(); const stop = () => abort.abort(); process.on('SIGINT', stop); process.on('SIGTERM', stop);
  const turn = async (runId: string, retry = false) => { try { const output = await runTurn(runId, v['brief-file'] ? await readBrief(v['brief-file']) : null, { expectedRevision, retry, onActivity: e => progress.accept(e), signal: abort.signal }); return v['receipt-only'] ? receipt(output) : output; } finally { progress.flush(); } };
  try {
    if (command === 'setup') {
      if (v.check) {
        const settings = await resolveSettings(cwd, v.workflow === 'review' ? 'review' : 'decide', overrides);
        let provider; try { provider = preflight(settings); } catch (error) { provider = errorInfo(error); }
        return { dataRoot: dataRoot(), runtime, configuration: await loadConfig(), resolved: settings, provider, approvedChecks: await approvedChecks(cwd), candidateChecks: await discoverChecks(cwd), changed: false };
      }
      const workflow = v.workflow ? z.enum(['decide', 'review']).parse(v.workflow) : undefined;
      const settings = overrides;
      if ((v['approve-check']?.length || v['checks-file']) && !v.project) throw new PluginError('project_required', 'Check approvals require setup --project.');
      if (v['approve-check']?.length && v['checks-file']) throw new PluginError('invalid_setup', 'Use discovered check names or a checks file, not both.');
      let approved: CheckDefinition[] | undefined;
      if (v['approve-check']?.length) {
        const candidates = await discoverChecks(cwd); const requested = v['approve-check'];
        if (requested.some(name => !candidates.some(c => c.id === name))) throw new PluginError('unknown_check', 'An approval names a check that was not discovered.');
        const previous = await approvedChecks(cwd); approved = [...previous.filter(c => !requested.includes(c.id)), ...candidates.filter(c => requested.includes(c.id))];
      }
      if (v['checks-file']) approved = z.array(Check).parse(await readJson(v['checks-file']));
      if (approved) await validateChecks(cwd, approved);
      await configure(settings, v.project ? cwd : undefined, workflow);
      if (approved) await approveChecks(cwd, approved);
      return { configured: true, dataRoot: dataRoot(), runtime, configuration: await loadConfig(), resolved: await resolveSettings(cwd, workflow || 'decide'), approvedChecks: await approvedChecks(cwd) };
    }
    if (command === 'runs') return id ? savedReply(id, integer(v.round), integer(v.segment), integer(v['raw-segment'])) : Promise.all((await listRuns()).map(async runId => {
      try { const state = await inspect(runId); return { id: runId, workflow: state.workflow, question: state.question, status: state.effectiveStatus, rounds: state.completedRounds, revision: state.revision }; }
      catch (error) { return { id: runId, status: 'unreadable', ...errorInfo(error) }; }
    }));
    if (command === 'review' || command === 'decide') {
      if (command === 'decide' && !v['brief-file']) throw new PluginError('brief_required', 'Codex must supply its independent decision brief with --brief-file.');
      if (id && v.run) {
        if (Object.keys(overrides).length) throw new PluginError('settings_frozen', 'Run settings are frozen; use resume to raise a budget or start a linked run.');
        if (v.base || v.staged || v.path || v.document || v.spec || v.standards || args.length) throw new PluginError('scope_frozen', 'Existing runs use their immutable saved inputs. Start a linked run to change scope.');
        return await turn(id);
      }
      const brief = command === 'decide' ? await readBrief(v['brief-file']!) : null;
      const question = args.join(' ') || brief?.question || 'Review selected changes through adversarial, specification and standards lenses.';
      const state = await createRun({ workflow: command, cwd, question, settings: overrides, selection: { base: v.base, staged: v.staged, paths: v.path, documents: v.document, specs: v.spec, standards: v.standards }, linkedFrom: v['linked-from'] });
      process.stderr.write(`[claude:progress] ${JSON.stringify({ type: 'status', text: `Started ${state.id}: ${state.settings.backend}, ${state.settings.model}, requested effort ${state.settings.effort}.`, runId: state.id })}\n`);
      if (state.bundle.nothingToReview) return { run: state, message: 'Nothing to review.' };
      return await turn(state.id);
    }
    if (!id) throw new PluginError('run_required', 'Supply an exact run ID.');
    if (command === 'resume') {
      if (overrides.backend || overrides.model || overrides.effort) throw new PluginError('settings_frozen', 'Use a new linked run to change backend, model or effort.');
      if (overrides.budgetUsd !== undefined) await raiseBudget(id, overrides.budgetUsd);
      const state = await inspect(id);
      if (state.effectiveStatus === 'running') return { run: state, message: 'Run is active; inspect its saved activity or cancel it. No new execution started.' };
      if (['awaiting_lead', 'awaiting_user', 'completed', 'agreed', 'stopped'].includes(state.status)) return savedReply(id);
      return await turn(id, v.retry === true);
    }
    if (command === 'cancel') return cancel(id);
    if (command === 'assess') {
      if (!v['assessment-file']) throw new PluginError('assessment_required', 'Supply --assessment-file.');
      const schema = z.object({ requestId: z.string().uuid(), agree: z.boolean(), proposalHash: z.string().length(64), answer: z.string().min(1), reason: z.string().min(1), cost: z.string().min(1), falsifier: z.string().min(1) });
      return assess(id, schema.parse(JSON.parse(await readFile(v['assessment-file'], 'utf8'))), expectedRevision);
    }
    if (command === 'checkpoint') {
      if (!v['checkpoint-id']) throw new PluginError('checkpoint_required', 'Supply the exact pending checkpoint ID.');
      return answerCheckpoint(id, v['checkpoint-id'], z.enum(['continue', 'stop']).parse(v.answer), expectedRevision);
    }
    throw new PluginError('unknown_command', `Unknown command ${command}`);
  } finally { progress.flush(); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
try { const output = await main(); process.stdout.write(JSON.stringify(output) + '\n'); if (output && typeof output === 'object' && 'status' in output && ['failed', 'interrupted', 'outcome_unknown'].includes(String(output.status))) process.exitCode = 1; }
catch (error) { process.stdout.write(JSON.stringify({ status: 'failed', ...errorInfo(error) }) + '\n'); process.exitCode = 1; }
