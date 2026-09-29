import { z } from 'zod';
export const VERSION = '0.1.0';
export const Backend = z.enum(['cli', 'sdk']);
export const Effort = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
export const Model = z.string().regex(/^claude-(?!.*-latest$)[a-z0-9][a-z0-9._-]*$/i);
export const Defaults = z.object({ backend: Backend, model: z.string().min(1), effort: Effort, budgetUsd: z.number().positive().optional() });
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
export const AgentReply = z.object({ answer: z.string().min(1) });
export const schemaFor = (workflow) => z.toJSONSchema(workflow === 'decide' ? DecisionReply : workflow === 'review' ? ReviewReply : AgentReply, { target: 'draft-7' });
export class PluginError extends Error {
    code;
    detail;
    constructor(code, message, detail) {
        super(message);
        this.code = code;
        this.detail = detail;
        this.name = 'PluginError';
    }
}
export const errorInfo = (error) => error instanceof PluginError ? { code: error.code, message: error.message, detail: error.detail } : { code: 'internal_error', message: error instanceof Error ? error.message : String(error) };
