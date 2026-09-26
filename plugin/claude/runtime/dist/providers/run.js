import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { appendFile } from 'node:fs/promises';
import { PluginError } from '../contracts.js';
import { writeJson } from '../runtime/files.js';
import { contained } from '../runtime/containment.js';
import { preflight } from './options.js';
import { StreamNormalizer } from './stream.js';
export async function runProvider(options, onActivity, signal) {
    preflight(options.settings);
    await writeJson(join(options.directory, 'turn.json'), options);
    const parser = new StreamNormalizer(options.settings, options.workflow, options.sessionId, onActivity);
    let diagnostics = '';
    let writes = Promise.resolve();
    const exitCode = await contained({
        command: process.execPath, args: [fileURLToPath(new URL('./worker.js', import.meta.url)), join(options.directory, 'turn.json')],
        cwd: options.cwd, directory: join(options.directory, 'processes'), signal,
        onStdout: data => parser.push(data),
        onStderr: data => { diagnostics = (diagnostics + data).slice(-16_384); writes = writes.then(() => appendFile(join(options.directory, 'stderr.log'), data)); },
    });
    await writes;
    const result = parser.finish(exitCode, signal?.aborted);
    await writeJson(join(options.directory, 'result.json'), result);
    if (!parser.tools.includes('Read') || !parser.tools.includes('Grep') || !parser.tools.includes('Glob') || !parser.tools.includes('mcp__codex_claude__ping')) {
        if (result.status === 'completed') {
            result.status = 'failed';
            result.code = 'tool_capability_missing';
            result.message = 'Provider did not expose the required read/search/MCP tools.';
            result.reply = null;
        }
    }
    if (result.status === 'outcome_unknown' && diagnostics)
        result.message = `${result.message}\n${diagnostics}`;
    await writeJson(join(options.directory, 'result.json'), result);
    if (result.code === 'tool_capability_missing')
        onActivity({ type: 'status', text: result.message });
    return result;
}
export function requireCompleted(result) { if (result.status !== 'completed')
    throw new PluginError(result.code || result.status, result.message || 'Provider did not complete.', result); return result; }
//# sourceMappingURL=run.js.map