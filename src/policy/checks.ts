import { readFile, realpath, access, readdir } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { CcaError } from '../contracts.js';
import { dataRoot, hash, readJson, writeJson } from '../runtime/files.js';
import { projectKey } from '../runtime/config.js';
import { checkoutFingerprint } from '../inputs/bundle.js';
import { contained } from '../runtime/containment.js';
import { exclusive } from '../runtime/mutex.js';
import { randomUUID } from 'node:crypto';

export const Check = z.object({ id: z.string().regex(/^[a-zA-Z0-9:_-]+$/), executable: z.string(), args: z.array(z.string()), cwd: z.string(), purpose: z.string(), definitionFile: z.string().nullable(), definitionKey: z.string().nullable(), definitionHash: z.string().nullable() });
export type CheckDefinition = z.infer<typeof Check>;
export async function approvedChecks(cwd: string): Promise<CheckDefinition[]> { try { return z.array(Check).parse(await readJson(join(dataRoot(), 'projects', await projectKey(cwd), 'checks.json'))); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; } }
export async function discoverChecks(cwd: string): Promise<CheckDefinition[]> {
  let npmPath = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (process.env.npm_execpath) npmPath = process.env.npm_execpath;
  try { await access(npmPath); } catch { return []; }
  try {
    const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
    return Object.entries(pkg.scripts || {}).filter(([id]) => /^(test|check|typecheck|lint|build)(:|$)/.test(id)).map(([id, command]) => ({ id, executable: process.execPath, args: [npmPath, 'run', id], cwd, purpose: command, definitionFile: join(cwd, 'package.json'), definitionKey: id, definitionHash: hash(JSON.stringify(pkg.scripts)) }));
  } catch { return []; }
}
export async function validateChecks(cwd: string, definitions: CheckDefinition[]) {
  const parsed = z.array(Check).parse(definitions); const actual = await realpath(cwd);
  for (const c of parsed) if (await realpath(c.cwd) !== actual || !isAbsolute(c.executable)) throw new CcaError('invalid_check', 'Checks need an absolute executable and the selected project directory.');
  if (new Set(parsed.map(c => c.id)).size !== parsed.length) throw new CcaError('invalid_check', 'Check names must be unique.');
  for (const c of parsed) await verifyCheck(c);
  return parsed;
}
export async function approveChecks(cwd: string, definitions: CheckDefinition[]) {
  const parsed = await validateChecks(cwd, definitions);
  await writeJson(join(dataRoot(), 'projects', await projectKey(cwd), 'checks.json'), parsed); return parsed;
}
export async function verifyCheck(check: CheckDefinition) {
  if (/\.(cmd|bat|ps1)$/i.test(check.executable)) throw new CcaError('unsupported_check_executable', 'Use the actual executable with an argument array, not a shell wrapper.');
  if (check.definitionFile) {
    const contents = await readFile(check.definitionFile, 'utf8');
    const definition = check.definitionKey ? JSON.stringify((JSON.parse(contents) as { scripts?: Record<string, string> }).scripts) : contents;
    if (typeof definition !== 'string' || hash(definition) !== check.definitionHash) throw new CcaError('check_definition_changed', `Check ${check.id} changed and requires renewed approval.`);
  }
}
export async function runCheck(cwd: string, id: string, directory: string, bundleFingerprint: string | null, snapshotCheckout: string | null = null, snapshotSelector: string | null = null) {
  const check = (await approvedChecks(cwd)).find(c => c.id === id);
  if (!check) throw new CcaError('check_not_approved', `No approved check named ${id}.`);
  await verifyCheck(check);
  const before = await checkoutFingerprint(cwd); const operation = `${id.replaceAll(':', '-')}-${randomUUID()}`;
  await exclusive(join(directory, '.locks'), async () => {
  for (const file of await readdir(directory)) if (file.endsWith('.json') && !file.startsWith('process-')) {
    const prior = await readJson<{ id?: string; status?: string }>(join(directory, file));
    if (prior.id === id && prior.status === 'outcome_unknown') throw new CcaError('check_outcome_unknown', `Check ${id} has an unresolved prior attempt. Inspect it before explicitly resolving its outcome; it will not be replayed.`);
  }
  await writeJson(join(directory, `${operation}.json`), { id, status: 'outcome_unknown', bundleFingerprint, checkoutBefore: before, startedAt: new Date().toISOString() });
  });
  const chunks: Buffer[] = []; let bytes = 0; let omitted = false;
  const collect = (text: string) => { const data = Buffer.from(text); bytes += data.length; if (bytes <= 2 * 1024 * 1024) chunks.push(data); else omitted = true; };
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(ANTHROPIC_|CLAUDE_CODE_OAUTH_TOKEN$|CCA_START_GATE$)/i.test(key)) delete env[key];
  const code = await contained({ command: check.executable, args: check.args, cwd: check.cwd, env, directory: join(directory, `${operation}.processes`), onStdout: collect, onStderr: collect });
  const after = await checkoutFingerprint(cwd);
  const result = { id, status: code === 0 ? 'passed' : 'failed', exitCode: code, output: Buffer.concat(chunks).toString('utf8'), outputOmitted: omitted, bundleFingerprint, snapshotCheckout, snapshotSelector, checkoutChangedSinceCapture: snapshotCheckout === null || before === null ? null : snapshotCheckout !== before, checkoutBefore: before, checkoutAfter: after, sourceChanged: before !== after, scope: 'Checks ran against the working checkout and its dependencies. Staged or document inputs are not necessarily represented by these checks.' };
  await writeJson(join(directory, `${operation}.json`), result); return result;
}
