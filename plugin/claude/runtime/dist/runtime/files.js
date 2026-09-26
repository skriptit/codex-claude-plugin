import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { PluginError } from '../contracts.js';
export const hash = (value) => createHash('sha256').update(value).digest('hex');
// MSIX desktop processes and unpackaged terminal processes can see different
// physical LOCALAPPDATA directories. The profile directory is shared by both.
export const dataRoot = () => resolve(process.env.CODEX_CLAUDE_DATA_HOME || join(process.platform === 'win32' ? join(homedir(), '.local', 'share') : process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'codex-claude-plugin'));
export async function atomicWrite(path, data) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${randomUUID()}.tmp`;
    const file = await open(temp, 'wx', 0o600);
    try {
        await file.writeFile(data);
        await file.sync();
    }
    finally {
        await file.close();
    }
    try {
        for (let attempt = 0;; attempt++) {
            try {
                await rename(temp, path);
                break;
            }
            catch (error) {
                // Windows readers can briefly hold a delete-sharing-incompatible handle.
                // Retain the old file throughout retries; never unlink it to force replacement.
                if (process.platform !== 'win32' || attempt >= 50 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code || ''))
                    throw error;
                await new Promise(r => setTimeout(r, 20));
            }
        }
    }
    catch (error) {
        await rm(temp, { force: true });
        throw error;
    }
}
export const writeJson = (path, value) => atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
export async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }
export const within = (root, path) => { const rel = relative(root, path); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)); };
export async function approvedPath(roots, path) {
    const actual = await realpath(path);
    for (const root of roots)
        if (within(await realpath(root), actual))
            return actual;
    throw new PluginError('path_denied', `Path is outside the approved roots: ${path}`);
}
export const validRunId = (id) => { if (!/^run-[a-f0-9-]{36}$/.test(id))
    throw new PluginError('invalid_run_id', 'Expected a complete plugin run ID.'); return id; };
export const runPath = (id) => join(dataRoot(), 'runs', validRunId(id));
//# sourceMappingURL=files.js.map