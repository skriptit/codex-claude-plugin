import { z } from 'zod';
export const Brief = z.object({ question: z.string().min(1), proposal: z.string().min(1), reason: z.string().min(1), cost: z.string().min(1), falsifier: z.string().min(1), alternatives: z.array(z.string()).default([]), constraints: z.array(z.string()).default([]), evidence: z.array(z.string()).default([]), responseToCounsel: z.string().optional() });
export function reduce(events) {
    if (events[0]?.type !== 'created')
        throw new Error('Run has no creation record');
    const created = events[0].data;
    const state = { ...created, revision: 0, status: created.bundle.nothingToReview ? 'completed' : 'ready', completedRounds: 0, attempts: 0, active: null, lastRequest: null, lastResult: null, sessionId: null, checkpoint: null, spentUsd: 0, costUnknown: false };
    for (const event of events) {
        state.revision = event.seq;
        if (event.type === 'requested') {
            state.active = event.data;
            state.lastRequest = state.active;
            state.attempts++;
            state.status = 'running';
        }
        if (event.type === 'activity' && state.active) {
            const data = event.data;
            if (data.requestId === state.active.id)
                for (const item of data.events) {
                    const init = item.detail;
                    if (init?.source === 'provider_init' && init.model === state.settings.model && init.sessionId && !state.sessionId)
                        state.sessionId = init.sessionId;
                }
        }
        if (event.type === 'result') {
            const data = event.data;
            if (!state.active || state.active.id !== data.requestId)
                throw new Error('Result does not match the active request');
            state.lastResult = data.result;
            state.active = null;
            if (data.result.sessionId && data.result.code !== 'session_mismatch' && data.result.code !== 'model_mismatch')
                state.sessionId = data.result.sessionId;
            if (data.result.costUsd === null)
                state.costUnknown = true;
            else
                state.spentUsd += data.result.costUsd;
            if (data.result.status === 'completed') {
                state.completedRounds++;
                state.status = state.workflow === 'decide' ? 'awaiting_lead' : 'completed';
            }
            else
                state.status = data.result.status;
        }
        if (event.type === 'assessment') {
            const data = event.data;
            state.status = data.agree ? 'agreed' : 'ready';
        }
        if (event.type === 'checkpoint') {
            state.checkpoint = event.data;
            state.status = 'awaiting_user';
        }
        if (event.type === 'checkpoint_answer') {
            const data = event.data;
            state.status = data.answer === 'continue' ? 'ready' : 'stopped';
            state.checkpoint = null;
        }
        if (event.type === 'interrupted') {
            state.active = null;
            state.status = 'interrupted';
        }
        if (event.type === 'budget_raised')
            state.settings = { ...state.settings, budgetUsd: event.data.budgetUsd };
    }
    return state;
}
