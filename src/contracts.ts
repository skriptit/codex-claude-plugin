import { z } from 'zod';

export const VERSION = '0.1.0';
export const Backend = z.enum(['cli', 'sdk']);
export const Effort = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
export const Defaults = z.object({ backend: Backend, model: z.string().min(1), effort: Effort, budgetUsd: z.number().positive().optional() });
export type Settings = z.infer<typeof Defaults>;
export type Workflow = 'decide' | 'review';
export const Verdict = z.enum(['endorse', 'modify', 'new-option', 'reject-all']);
export const DecisionReply = z.object({
  verdict: Verdict, answer: z.string().min(1), objections: z.array(z.string()),
  evidence: z.array(z.string()), cost: z.string(), falsifier: z.string(),
});
export const Finding = z.object({
  severity: z.enum(['critical', 'high', 'medium', 'low']), location: z.string(),
  title: z.string(), evidence: z.string(), impact: z.string(), correction: z.string(),
  lenses: z.array(z.enum(['adversarial', 'specification', 'standards'])).min(1),
});
export const ReviewReply = z.object({ answer: z.string().min(1), findings: z.array(Finding), coverageGaps: z.array(z.string()), checks: z.array(z.object({ name: z.string(), status: z.enum(['passed', 'failed', 'denied', 'skipped']), evidence: z.string() })) });
export type Decision = z.infer<typeof DecisionReply>;
export type Review = z.infer<typeof ReviewReply>;
export type Reply = Decision | Review;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Activity = { type: 'text' | 'tool_start' | 'tool_end' | 'permission_denied' | 'retry' | 'status' | 'usage'; text: string; id?: string; detail?: unknown };
export type TurnResult = {
  status: 'completed' | 'failed' | 'interrupted' | 'outcome_unknown';
  code: string | null; message: string | null; sessionId: string | null;
  requestedModel: string; requestedEffort: Settings['effort'];
  observedModels: string[]; effectiveEffort: Settings['effort'] | null;
  rawOutput: { structuredOutput: unknown; assistantText: string; terminal: unknown };
  reply: Reply | null; costUsd: number | null; usage: unknown;
};
export const schemaFor = (workflow: Workflow) => z.toJSONSchema(workflow === 'decide' ? DecisionReply : ReviewReply, { target: 'draft-7' });
export class PluginError extends Error {
  constructor(public readonly code: string, message: string, public readonly detail?: unknown) { super(message); this.name = 'PluginError'; }
}
export const errorInfo = (error: unknown) => error instanceof PluginError ? { code: error.code, message: error.message, detail: error.detail } : { code: 'internal_error', message: error instanceof Error ? error.message : String(error) };
