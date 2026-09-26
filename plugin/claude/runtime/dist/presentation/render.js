export function answerSegments(answer, limit = 12_000) {
    if (limit < 128)
        throw new Error('Segment limit must be at least 128 characters');
    const segments = [];
    let start = 0;
    while (start < answer.length) {
        let end = Math.min(start + limit, answer.length);
        if (end < answer.length) {
            const paragraph = answer.lastIndexOf('\n\n', end);
            const line = answer.lastIndexOf('\n', end);
            if (paragraph > start + limit / 2)
                end = paragraph + 2;
            else if (line > start + limit / 2)
                end = line + 1;
            else if (answer.charCodeAt(end - 1) >= 0xd800 && answer.charCodeAt(end - 1) <= 0xdbff)
                end--;
        }
        segments.push(answer.slice(start, end));
        start = end;
    }
    if (segments.join('') !== answer)
        throw new Error('Answer segmentation lost content');
    return segments;
}
export function renderRound(round, backend, result, agentName) {
    if (result.status !== 'completed' || !result.reply)
        return { label: `Claude · Attempt for round ${round} · ${result.status}`, verdict: null, answer: null, answerSegments: [], markdown: `**Claude · ${result.status}**\n\n${result.message || result.code}\n` };
    const verdict = 'verdict' in result.reply ? result.reply.verdict : null;
    const label = `Claude ${agentName ? `agent ${agentName}` : verdict ? 'counsel' : 'review'} · Round ${round}`;
    const meta = `${backend} · ${result.requestedModel} · session ${result.sessionId}`;
    const answer = result.reply.answer;
    return { label, verdict, answer, answerSegments: answerSegments(answer), markdown: `**${label}**\n${verdict ? `**Verdict: \`${verdict}\`**\n` : ''}\n${meta}\n\n${answer}\n` };
}
export class Progress {
    output;
    fragments = '';
    timer = null;
    seenTools = new Set();
    constructor(output) {
        this.output = output;
    }
    accept(activity) {
        if (activity.type === 'text') {
            this.fragments += activity.text;
            this.timer ??= setTimeout(() => this.flush(), 400);
            return;
        }
        this.flush();
        if (activity.type === 'tool_start' && activity.id) {
            if (this.seenTools.has(activity.id))
                return;
            this.seenTools.add(activity.id);
        }
        const preview = activity.detail === undefined || activity.type === 'usage' ? '' : JSON.stringify(activity.detail).slice(0, 700);
        this.output(`[claude:progress] ${JSON.stringify({ type: activity.type, text: activity.text, ...(activity.id ? { id: activity.id } : {}), ...(preview ? { preview } : {}) })}\n`);
    }
    flush() { if (this.timer)
        clearTimeout(this.timer); this.timer = null; if (this.fragments) {
        this.output(`[claude:progress] ${JSON.stringify({ type: 'text', text: this.fragments })}\n`);
        this.fragments = '';
    } }
}
//# sourceMappingURL=render.js.map