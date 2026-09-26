import { z } from 'zod';
import type { Settings, TurnResult, Workflow } from '../contracts.js';
import type { Bundle, Selection } from '../inputs/bundle.js';
import type { Identity } from '../runtime/identity.js';
import type { Event } from '../runtime/journal.js';

export const Brief = z.object({ question: z.string().min(1), proposal: z.string().min(1), reason: z.string().min(1), cost: z.string().min(1), falsifier: z.string().min(1), alternatives: z.array(z.string()).default([]), constraints: z.array(z.string()).default([]), evidence: z.array(z.string()).default([]), responseToCounsel: z.string().optional() });
export type CounselBrief = z.infer<typeof Brief>;
export type RunCreated = { id: string; workflow: Workflow; cwd: string; settings: Settings; question: string; selection: Selection; bundle: Bundle; hostTaskId: string | null; linkedFrom: string | null; runtimeEntrypoint: string };
export type Request = { id: string; round: number; attempt: number; brief: CounselBrief | null; proposalHash: string | null; owner: Identity; directory: string };
export type Assessment = { requestId: string; agree: boolean; proposalHash: string; answer: string; reason: string; cost: string; falsifier: string };
export type RunState = RunCreated & { revision: number; status: 'ready' | 'running' | 'awaiting_lead' | 'awaiting_user' | 'agreed' | 'stopped' | 'completed' | 'interrupted' | 'failed' | 'outcome_unknown'; completedRounds: number; attempts: number; active: Request | null; lastRequest: Request | null; lastResult: TurnResult | null; sessionId: string | null; checkpoint: { id: string; question: string; afterRound: number } | null; spentUsd: number; costUnknown: boolean };
export function reduce(events: Event[]): RunState {
  if (events[0]?.type !== 'created') throw new Error('Run has no creation record');
  const created = events[0].data as RunCreated;
  const state: RunState = { ...created, revision: 0, status: created.bundle.nothingToReview ? 'completed' : 'ready', completedRounds: 0, attempts: 0, active: null, lastRequest: null, lastResult: null, sessionId: null, checkpoint: null, spentUsd: 0, costUnknown: false };
  for (const event of events) {
    state.revision = event.seq;
    if (event.type === 'requested') { state.active = event.data as Request; state.lastRequest = state.active; state.attempts++; state.status = 'running'; }
    if (event.type === 'activity' && state.active) {
      const data = event.data as { requestId: string; events: { detail?: { source?: string; sessionId?: string; model?: string } }[] };
      if (data.requestId === state.active.id) for (const item of data.events) {
        const init = item.detail;
        if (init?.source === 'provider_init' && init.model === state.settings.model && init.sessionId && !state.sessionId) state.sessionId = init.sessionId;
      }
    }
    if (event.type === 'result') {
      const data = event.data as { requestId: string; result: TurnResult };
      if (!state.active || state.active.id !== data.requestId) throw new Error('Result does not match the active request');
      state.lastResult = data.result; state.active = null;
      if (data.result.sessionId && data.result.code !== 'session_mismatch' && data.result.code !== 'model_mismatch') state.sessionId = data.result.sessionId;
      if (data.result.costUsd === null) state.costUnknown = true; else state.spentUsd += data.result.costUsd;
      if (data.result.status === 'completed') { state.completedRounds++; state.status = state.workflow === 'decide' ? 'awaiting_lead' : 'completed'; }
      else state.status = data.result.status;
    }
    if (event.type === 'assessment') { const data = event.data as Assessment; state.status = data.agree ? 'agreed' : 'ready'; }
    if (event.type === 'checkpoint') { state.checkpoint = event.data as RunState['checkpoint']; state.status = 'awaiting_user'; }
    if (event.type === 'checkpoint_answer') { const data = event.data as { answer: string }; state.status = data.answer === 'continue' ? 'ready' : 'stopped'; state.checkpoint = null; }
    if (event.type === 'interrupted') { state.active = null; state.status = 'interrupted'; }
    if (event.type === 'budget_raised') state.settings = { ...state.settings, budgetUsd: (event.data as { budgetUsd: number }).budgetUsd };
  }
  return state;
}
