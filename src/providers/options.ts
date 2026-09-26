import { execFileSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PluginError, schemaFor, type Settings, type Workflow } from '../contracts.js';
import type { Options } from '@anthropic-ai/claude-agent-sdk';

export const BUILTINS = ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'];
export const MCP_TOOLS = ['ping', 'inputs_list', 'inputs_read', 'git_status', 'git_log', 'checks_list', 'checks_run'].map(x => `mcp__codex_claude__${x}`);
export const DENIED = ['Bash', 'PowerShell', 'REPL', 'Write', 'Edit', 'NotebookEdit', 'Agent', 'Task', 'Skill'];
export type TurnOptions = { cwd: string; directory: string; prompt: string; settings: Settings; workflow: Workflow; sessionId?: string; bundleDirectory?: string; runId?: string; checkPolicyFile?: string; };
export function cliExecutable() {
  const names = process.platform === 'win32' ? ['claude.exe'] : ['claude'];
  const paths = (process.env.PATH || '').split(delimiter);
  if (process.env.CODEX_CLAUDE_PATH) { accessSync(process.env.CODEX_CLAUDE_PATH, constants.X_OK); return process.env.CODEX_CLAUDE_PATH; }
  for (const path of paths) for (const name of names) { const candidate = join(path, name); try { accessSync(candidate, constants.X_OK); return candidate; } catch { /* Keep searching. */ } }
  if (process.platform === 'win32') for (const path of paths) { const candidate = join(path, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'); try { accessSync(candidate, constants.X_OK); return candidate; } catch { /* npm installs expose a shim on PATH and the native binary here. */ } }
  throw new PluginError('cli_unavailable', 'Claude executable not found. Install Claude Code and authenticate it first.');
}
export function preflight(settings: Settings) {
  if (settings.backend === 'sdk' && !process.env.ANTHROPIC_API_KEY) throw new PluginError('sdk_auth_missing', 'Set ANTHROPIC_API_KEY outside the repository for SDK execution. CLI subscription credentials are not reused.');
  if (settings.backend === 'cli') {
    const path = cliExecutable(); const help = execFileSync(path, ['--help'], { encoding: 'utf8', windowsHide: true });
    validateCliHelp(help, settings);
    return { backend: 'cli', path, version: execFileSync(path, ['--version'], { encoding: 'utf8', windowsHide: true }).trim() };
  }
  return { backend: 'sdk', version: '0.3.268', liveVerification: 'required' };
}
export function validateCliHelp(help: string, settings: Settings) {
  for (const flag of ['--restricted', '--permission-prompts', '--strict-mcp-config', '--json-schema', '--tools', '--allowedTools', '--disallowedTools', '--setting-sources', '--effort', '--resume']) if (!help.includes(flag)) throw new PluginError('unsupported_cli', `Installed Claude lacks required ${flag}.`);
  if (settings.budgetUsd !== undefined && !help.includes('--max-budget-usd')) throw new PluginError('budget_unsupported', 'Installed Claude cannot enforce a provider cost-estimate budget. No model call was made.');
}
export function providerEnvironment(backend: Settings['backend']): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // Pin authentication mode. Inherited provider routing cannot select another
  // backend or turn CLI subscription calls into API-key calls.
  for (const key of ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL']) delete env[key];
  if (backend === 'cli') delete env.ANTHROPIC_API_KEY;
  else delete env.CLAUDE_CODE_OAUTH_TOKEN;
  return env;
}
export function mcpConfig(options: TurnOptions) {
  return { codex_claude: { type: 'stdio' as const, command: process.execPath, args: [fileURLToPath(new URL('../policy/server.js', import.meta.url)), options.directory], env: { CODEX_CLAUDE_DATA_HOME: process.env.CODEX_CLAUDE_DATA_HOME || '' } } };
}
export function cliArguments(options: TurnOptions) {
  const { settings } = options;
  const args = ['--print', '--verbose', '--output-format', 'stream-json', '--include-partial-messages', '--model', settings.model, '--effort', settings.effort, '--restricted', '--setting-sources', '', '--settings', JSON.stringify({ disableAllHooks: true }), '--tools', BUILTINS.join(','), '--allowedTools', [...BUILTINS, ...MCP_TOOLS].join(','), '--disallowedTools', DENIED.join(','), '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--strict-mcp-config', '--mcp-config', JSON.stringify({ mcpServers: mcpConfig(options) }), '--disable-slash-commands', '--no-chrome', '--json-schema', JSON.stringify(schemaFor(options.workflow))];
  if (options.bundleDirectory) args.push('--add-dir', options.bundleDirectory);
  if (options.sessionId) args.push('--resume', options.sessionId);
  if (settings.budgetUsd !== undefined) args.push('--max-budget-usd', String(settings.budgetUsd));
  return args;
}
export function sdkOptions(options: TurnOptions, launch: NonNullable<Options['spawnClaudeCodeProcess']>): Options {
  return {
    cwd: options.cwd, model: options.settings.model, effort: options.settings.effort,
    env: providerEnvironment('sdk'),
    tools: BUILTINS, allowedTools: [...BUILTINS, ...MCP_TOOLS], disallowedTools: DENIED,
    settingSources: [], strictMcpConfig: true, mcpServers: mcpConfig(options),
    permissionMode: 'dontAsk', permissionPrompts: 'none', includePartialMessages: true,
    extraArgs: { restricted: null, settings: JSON.stringify({ disableAllHooks: true }), 'disable-slash-commands': null, 'no-chrome': null },
    outputFormat: { type: 'json_schema', schema: schemaFor(options.workflow) },
    ...(options.bundleDirectory ? { additionalDirectories: [options.bundleDirectory] } : {}),
    ...(options.sessionId ? { resume: options.sessionId } : {}),
    ...(options.settings.budgetUsd === undefined ? {} : { maxBudgetUsd: options.settings.budgetUsd }),
    spawnClaudeCodeProcess: launch,
  };
}
