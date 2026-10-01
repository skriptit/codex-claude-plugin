import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { Defaults, Model, PluginError } from '../contracts.js';
import { dataRoot, hash, readJson, writeJson } from './files.js';
import { exclusive } from './mutex.js';
const Layer = z.object({ defaults: Defaults.partial().default({}), workflows: z.object({ decide: Defaults.partial().optional(), review: Defaults.partial().optional(), agent: Defaults.partial().optional() }).default({}) });
const Config = Layer.extend({ version: z.literal(1), projects: z.record(z.string(), Layer).default({}) });
export async function loadConfig() {
    try {
        return Config.parse(await readJson(join(dataRoot(), 'config.json')));
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return Config.parse({ version: 1 });
        throw error;
    }
}
export async function projectKey(cwd) { const actual = await realpath(cwd); return hash(process.platform === 'win32' ? actual.toLowerCase() : actual); }
export async function resolveSettings(cwd, workflow, overrides = {}) {
    const config = await loadConfig();
    const project = config.projects[await projectKey(cwd)];
    const settings = Defaults.parse({ backend: 'cli', model: 'claude-fable-5-1', effort: 'high', ...config.defaults, ...config.workflows[workflow], ...project?.defaults, ...project?.workflows[workflow], ...overrides });
    if (!Model.safeParse(settings.model).success)
        throw new PluginError('invalid_model', 'The saved model must match the exact Claude model ID reported by the provider. Run setup with a full model ID to replace a short or -latest alias.');
    return settings;
}
export async function configure(values, cwd, workflow) {
    if (values.model !== undefined && !Model.safeParse(values.model).success)
        throw new PluginError('invalid_model', 'Use the exact Claude model ID reported by the provider. Short and -latest aliases cannot be verified against the response.');
    return exclusive(join(dataRoot(), '.config-locks'), async () => {
        const config = await loadConfig();
        const layer = cwd ? (config.projects[await projectKey(cwd)] ??= Layer.parse({})) : config;
        if (workflow)
            layer.workflows[workflow] = { ...layer.workflows[workflow], ...Defaults.partial().parse(values) };
        else
            layer.defaults = { ...layer.defaults, ...Defaults.partial().parse(values) };
        await writeJson(join(dataRoot(), 'config.json'), config);
        return config;
    });
}
