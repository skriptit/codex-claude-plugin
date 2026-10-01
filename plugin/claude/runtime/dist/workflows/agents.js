import { isUtf8 } from 'node:buffer';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { PluginError } from '../contracts.js';
import { hash } from '../runtime/files.js';
export async function loadAgent(cwd, name) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(name) || name === 'decide' || name === 'review') {
        throw new PluginError('invalid_agent_name', 'Use a lowercase agent name beginning with a letter; decide and review are reserved.');
    }
    const project = join(await realpath(cwd), '.codex', 'claude-agents', `${name}.md`);
    const personal = join(resolve(process.env.CODEX_HOME || join(homedir(), '.codex')), 'claude-agents', `${name}.md`);
    for (const [source, path] of [['project', project], ['personal', personal]]) {
        let info;
        try {
            info = await lstat(path);
        }
        catch (error) {
            if (error.code === 'ENOENT')
                continue;
            throw error;
        }
        if (!info.isFile() || info.isSymbolicLink() || info.size > 32 * 1024)
            throw new PluginError('invalid_agent_file', `Agent ${name} must be a regular Markdown file of at most 32 KiB.`);
        if ((await lstat(dirname(path))).isSymbolicLink() || (source === 'project' && (await lstat(join(await realpath(cwd), '.codex'))).isSymbolicLink())) {
            throw new PluginError('invalid_agent_file', `Agent ${name} cannot be loaded through a linked directory.`);
        }
        const content = await readFile(path);
        if (!isUtf8(content) || content.includes(0))
            throw new PluginError('invalid_agent_file', `Agent ${name} must contain UTF-8 text.`);
        const instructions = content.toString('utf8').trim();
        if (!instructions)
            throw new PluginError('invalid_agent_file', `Agent ${name} has no instructions.`);
        return { name, source, instructions, hash: hash(content) };
    }
    throw new PluginError('agent_not_found', `No ${name}.md agent found in this project's .codex/claude-agents or personal Codex home/claude-agents.`);
}
