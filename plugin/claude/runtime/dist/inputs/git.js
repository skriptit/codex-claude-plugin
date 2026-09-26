import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export async function git(cwd, args) {
    const result = await exec('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'diff.external=', '--no-pager', ...args], { cwd, encoding: 'buffer', maxBuffer: 32 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_EXTERNAL_DIFF: '' } });
    return result.stdout;
}
//# sourceMappingURL=git.js.map