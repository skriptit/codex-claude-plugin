import { AgentReply, DecisionReply, Effort, ReviewReply } from '../contracts.js';
const object = (value) => value !== null && typeof value === 'object' ? value : {};
const string = (value) => typeof value === 'string' ? value : '';
const array = (value) => Array.isArray(value) ? value : [];
export class StreamNormalizer {
    settings;
    workflow;
    expectedSession;
    activity;
    buffer = '';
    terminal = null;
    session = null;
    models = new Set();
    text = new Map();
    complete = new Set();
    messageId = 'stream';
    effort = null;
    invalid = false;
    identityProblem = false;
    initModel = null;
    effortProblem = false;
    seen = new Map();
    startedTools = new Set();
    endedTools = new Set();
    denials = new Set();
    tools = [];
    constructor(settings, workflow, expectedSession, activity) {
        this.settings = settings;
        this.workflow = workflow;
        this.expectedSession = expectedSession;
        this.activity = activity;
    }
    push(chunk) {
        this.buffer += chunk;
        for (;;) {
            const i = this.buffer.indexOf('\n');
            if (i < 0)
                break;
            const line = this.buffer.slice(0, i);
            this.buffer = this.buffer.slice(i + 1);
            if (!line.trim())
                continue;
            try {
                this.accept(JSON.parse(line));
            }
            catch {
                this.invalid = true;
            }
        }
    }
    accept(value) {
        const event = object(value);
        const type = string(event.type);
        if (event.uuid) {
            const key = `${type}:${string(event.uuid)}`;
            const encoded = JSON.stringify(event);
            const previous = this.seen.get(key);
            if (previous) {
                if (previous !== encoded)
                    this.invalid = true;
                return;
            }
            this.seen.set(key, encoded);
        }
        const session = string(event.session_id);
        if (session) {
            if (this.session && session !== this.session)
                this.identityProblem = true;
            this.session = session;
        }
        if (type === 'system') {
            const subtype = string(event.subtype);
            if (subtype === 'init') {
                if (typeof event.model === 'string')
                    this.initModel = event.model;
                this.tools = array(event.tools).filter((x) => typeof x === 'string');
                if (event.effort !== undefined && event.effort !== null) {
                    const e = Effort.safeParse(event.effort);
                    if (e.success)
                        this.effort = e.data;
                    else
                        this.effortProblem = true;
                }
                this.activity({ type: 'status', text: `Session ${session}; model ${string(event.model)}; effective effort ${this.effort ?? 'unknown'}.`, detail: { source: 'provider_init', sessionId: session, model: event.model, effectiveEffort: this.effort } });
            }
            else if (subtype === 'permission_denied')
                this.denied(event);
            else if (subtype.includes('retry'))
                this.activity({ type: 'retry', text: 'Claude is retrying a provider request.', detail: event });
            else if (subtype === 'status')
                this.activity({ type: 'status', text: string(event.status) || 'Claude activity received.' });
        }
        else if (type === 'stream_event') {
            const e = object(event.event);
            const kind = string(e.type);
            if (kind === 'message_start') {
                const m = object(e.message);
                this.messageId = string(m.id) || this.messageId;
                if (typeof m.model === 'string')
                    this.models.add(m.model);
            }
            if (kind === 'content_block_delta') {
                const delta = object(e.delta);
                if (delta.type === 'text_delta' && typeof delta.text === 'string') {
                    this.text.set(this.messageId, (this.text.get(this.messageId) || '') + delta.text);
                    this.activity({ type: 'text', text: delta.text, id: this.messageId });
                }
            }
            if (kind === 'content_block_start') {
                const block = object(e.content_block);
                if (block.type === 'tool_use')
                    this.toolStart(block);
            }
        }
        else if (type === 'assistant') {
            const message = object(event.message);
            const id = string(message.id) || string(event.uuid) || `message-${this.text.size}`;
            if (typeof message.model === 'string')
                this.models.add(message.model);
            const content = array(message.content).map(object);
            const full = content.filter(b => b.type === 'text').map(b => string(b.text)).join('');
            if (!this.complete.has(id)) {
                const previous = this.text.get(id) || '';
                if (previous && !full.startsWith(previous))
                    this.invalid = true;
                this.text.set(id, full);
                this.complete.add(id);
                if (full.length > previous.length)
                    this.activity({ type: 'text', text: full.slice(previous.length), id });
                for (const block of content)
                    if (block.type === 'tool_use')
                        this.toolStart(block);
            }
        }
        else if (type === 'user') {
            for (const block of array(object(event.message).content).map(object))
                if (block.type === 'tool_result' && !this.endedTools.has(string(block.tool_use_id))) {
                    this.endedTools.add(string(block.tool_use_id));
                    this.activity({ type: 'tool_end', id: string(block.tool_use_id), text: block.is_error ? 'Tool returned an error.' : 'Tool completed.', detail: block.content });
                }
        }
        else if (type === 'result') {
            if (this.terminal && JSON.stringify(this.terminal) !== JSON.stringify(event))
                this.invalid = true;
            this.terminal = event;
            for (const denial of array(event.permission_denials))
                this.denied(object(denial));
            this.activity({ type: 'usage', text: 'Provider turn ended.', detail: { costUsd: event.total_cost_usd ?? null, usage: event.usage ?? null } });
        }
    }
    toolStart(block) {
        const id = string(block.id);
        if (id && this.startedTools.has(id))
            return;
        if (id)
            this.startedTools.add(id);
        this.activity({ type: 'tool_start', text: string(block.name), id, detail: block.input });
    }
    denied(event) {
        const key = string(event.tool_use_id) || JSON.stringify({ name: event.tool_name, input: event.tool_input });
        if (this.denials.has(key))
            return;
        this.denials.add(key);
        this.activity({ type: 'permission_denied', text: `Claude denied ${string(event.tool_name) || 'a tool request'}.`, detail: event });
    }
    finish(exitCode, cancelled = false) {
        if (this.buffer.trim()) {
            try {
                this.accept(JSON.parse(this.buffer));
            }
            catch {
                this.invalid = true;
            }
            this.buffer = '';
        }
        const terminal = this.terminal;
        const result = {
            status: 'outcome_unknown', code: 'missing_terminal', message: 'No authoritative terminal result was received.',
            sessionId: this.session, requestedModel: this.settings.model, requestedEffort: this.settings.effort,
            observedModels: [...this.models], effectiveEffort: this.effort,
            rawOutput: { structuredOutput: terminal?.structured_output ?? null, assistantText: [...this.text.values()].join('\n\n'), terminal },
            reply: null, costUsd: typeof terminal?.total_cost_usd === 'number' ? terminal.total_cost_usd : null, usage: terminal?.usage ?? null,
        };
        const fail = (code, message, status = 'failed') => Object.assign(result, { status, code, message });
        if (cancelled)
            return fail('cancelled', 'Owned execution was cancelled.', 'interrupted');
        if (!terminal)
            return result;
        if (this.invalid)
            return fail('inconsistent_stream', 'Malformed or conflicting provider output was preserved.', 'outcome_unknown');
        if (!this.session || this.identityProblem || (this.expectedSession && this.session !== this.expectedSession))
            return fail('session_mismatch', 'Provider session identity is missing or changed.');
        if (!this.models.size || (this.initModel && this.initModel !== this.settings.model) || [...this.models].some(m => m !== this.settings.model))
            return fail('model_mismatch', 'Provider response model is missing or differs from the requested model.');
        if (this.effortProblem || (this.effort && this.effort !== this.settings.effort))
            return fail('effort_mismatch', 'Provider reported a different or unrecognized effective effort.');
        if (terminal.subtype !== 'success' || terminal.is_error === true)
            return fail(string(terminal.subtype) || 'provider_failed', array(terminal.errors).map(String).join('\n') || string(terminal.result) || 'Provider returned a failure.');
        if (exitCode !== 0)
            return fail('transport_failed', `Provider process exited with code ${exitCode}.`);
        const parsed = (this.workflow === 'decide' ? DecisionReply : this.workflow === 'review' ? ReviewReply : AgentReply).safeParse(terminal.structured_output);
        if (!parsed.success)
            return fail('invalid_structured_output', 'Terminal success did not contain a valid structured reply.');
        return Object.assign(result, { status: 'completed', code: null, message: null, reply: parsed.data });
    }
}
