import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { appendFile } from 'node:fs/promises';
import { CcaError, type Activity } from '../contracts.js';
import { writeJson } from '../runtime/files.js';
import { contained } from '../runtime/containment.js';
import { preflight, type TurnOptions } from './options.js';
import { StreamNormalizer } from './stream.js';

export async function runProvider(options: TurnOptions, onActivity: (activity: Activity) => void, signal?: AbortSignal) {
  preflight(options.settings);
  await writeJson(join(options.directory, 'turn.json'), options);
  const parser = new StreamNormalizer(options.settings, options.workflow, options.sessionId, onActivity);
  let diagnostics = ''; let writes = Promise.resolve();
  const exitCode = await contained({
    command: process.execPath, args: [fileURLToPath(new URL('./worker.js', import.meta.url)), join(options.directory, 'turn.json')],
    cwd: options.cwd, directory: join(options.directory, 'processes'), signal,
    onStdout: data => parser.push(data),
    onStderr: data => { diagnostics = (diagnostics + data).slice(-16_384); writes = writes.then(() => appendFile(join(options.directory, 'stderr.log'), data)); },
  });
  await writes;
  const result = parser.finish(exitCode, signal?.aborted);
  await writeJson(join(options.directory, 'result.json'), result);
  if (!parser.tools.includes('Read') || !parser.tools.includes('Grep') || !parser.tools.includes('Glob') || !parser.tools.includes('mcp__cca__ping')) {
    if (result.status === 'completed') { result.status = 'failed'; result.code = 'tool_capability_missing'; result.message = 'Provider did not expose the required read/search/MCP tools.'; result.reply = null; }
  }
  if (result.status === 'outcome_unknown' && diagnostics) result.message = `${result.message}\n${diagnostics}`;
  await writeJson(join(options.directory, 'result.json'), result);
  if (result.code === 'tool_capability_missing') onActivity({ type: 'status', text: result.message! });
  return result;
}
export function requireCompleted(result: Awaited<ReturnType<typeof runProvider>>) { if (result.status !== 'completed') throw new CcaError(result.code || result.status, result.message || 'Provider did not complete.', result); return result; }
