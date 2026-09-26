import { readFile, realpath, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { PluginError } from '../contracts.js';
import { isUtf8 } from 'node:buffer';
import { approvedPath, hash, within, writeJson } from '../runtime/files.js';
import { git } from './git.js';

export type Selection = { base?: string; staged?: boolean; paths?: string[]; documents?: string[]; specs?: string[]; standards?: string[] };
export type Entry = { source: string; kind: string; artifact: string; hash: string; bytes: number };
export type Bundle = { version: 1; cwd: string; selector: string; base: string | null; entries: Entry[]; omissions: { source: string; reason: string }[]; fingerprint: string; checkoutAtCapture: string | null; nothingToReview: boolean };
export async function checkoutFingerprint(cwd: string) {
  try {
    const head = (await git(cwd, ['rev-parse', '--verify', 'HEAD'])).toString().trim();
    const diff = await git(cwd, ['diff', '--binary', '--no-ext-diff', '--no-textconv', 'HEAD', '--']);
    const index = await git(cwd, ['diff', '--cached', '--binary', '--no-ext-diff', '--no-textconv', 'HEAD', '--']);
    const paths = (await git(cwd, ['ls-files', '--others', '--exclude-standard', '-z'])).toString().split('\0').filter(Boolean).sort();
    const untracked: [string, string][] = [];
    for (const path of paths) { try { untracked.push([path, hash(await readFile(await approvedPath([cwd], resolve(cwd, path))))]); } catch { untracked.push([path, 'unreadable']); } }
    return hash(JSON.stringify({ head, diff: hash(diff), index: hash(index), untracked }));
  } catch { return null; }
}
export async function capture(cwdInput: string, directory: string, selection: Selection, workflow: 'decide' | 'review'): Promise<Bundle> {
  const cwd = await realpath(cwdInput);
  if ((selection.base && selection.staged) || (selection.documents?.length && (selection.base || selection.staged || selection.paths?.length))) throw new PluginError('invalid_scope', 'Choose one of base, staged or document review. Paths filter Git review only.');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const bundle: Bundle = { version: 1, cwd, selector: selection.documents?.length ? 'documents' : selection.staged ? 'staged' : selection.base ? 'base' : 'working-tree', base: null, entries: [], omissions: [], fingerprint: '', checkoutAtCapture: await checkoutFingerprint(cwd), nothingToReview: false };
  let total = 0; let selected = 0;
  async function add(source: string, kind: string, data: Buffer) {
    if (data.includes(0) || !isUtf8(data) || data.length > 2 * 1024 * 1024 || total + data.length > 16 * 1024 * 1024) { bundle.omissions.push({ source, reason: data.includes(0) || !isUtf8(data) ? 'Binary or non-UTF-8 content' : 'Input size limit; coverage is incomplete' }); return; }
    total += data.length; const digest = hash(data); const artifact = `${bundle.entries.length}-${digest}.txt`;
    await writeFile(join(directory, artifact), data, { mode: 0o400 }); bundle.entries.push({ source, kind, artifact, hash: digest, bytes: data.length });
  }
  async function addFile(source: string, kind: string, explicit = false) {
    try {
      const file = explicit ? await realpath(resolve(cwd, source)) : await approvedPath([cwd], resolve(cwd, source));
      await add(source, kind, await readFile(file));
    } catch (error) { bundle.omissions.push({ source, reason: error instanceof Error ? error.message : String(error) }); }
  }
  if (selection.documents?.length) {
    for (const path of selection.documents) { await addFile(path, 'document', true); selected++; }
  } else if (workflow === 'review') {
    const head = (await git(cwd, ['rev-parse', '--verify', 'HEAD'])).toString().trim();
    const selectedBase = selection.base ? (await git(cwd, ['rev-parse', '--verify', '--end-of-options', `${selection.base}^{commit}`])).toString().trim() : null;
    bundle.base = selectedBase ? (await git(cwd, ['merge-base', 'HEAD', selectedBase])).toString().trim() : head;
    const filters = (selection.paths || []).map(p => { const abs = resolve(cwd, p); if (!within(cwd, abs)) throw new PluginError('path_denied', 'Review path is outside the repository.'); return `:(literal)${relative(cwd, abs).replaceAll('\\', '/')}`; });
    const diffArgs = ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', ...(selection.staged ? ['--cached'] : []), bundle.base, '--', ...filters];
    const names = (await git(cwd, [...diffArgs.slice(0, -filters.length - 1), '--name-only', '-z', '--', ...filters])).toString().split('\0').filter(Boolean);
    const diff = await git(cwd, diffArgs); if (diff.length) await add('selected.diff', 'diff', diff);
    for (const path of names) {
      selected++;
      try { await add(`${bundle.base}:${path}`, 'base', await git(cwd, ['show', `${bundle.base}:${path}`])); } catch { /* New path has no base blob. */ }
      try {
        const data = selection.staged ? await git(cwd, ['show', `:${path}`]) : await readFile(await approvedPath([cwd], resolve(cwd, path)));
        await add(path, 'target', data);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !selection.staged) bundle.omissions.push({ source: path, reason: String(error) }); }
    }
    if (!selection.staged) for (const path of (await git(cwd, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...filters])).toString().split('\0').filter(Boolean)) { selected++; await addFile(path, 'untracked'); }
    bundle.nothingToReview = selected === 0;
  }
  for (const [kind, sources] of [['spec', selection.specs || []], ['standard', selection.standards || []]] as const) {
    for (const source of sources) {
      if (/^https?:\/\//.test(source)) {
        try { const response = await fetch(source, { signal: AbortSignal.timeout(30_000), redirect: 'error' }); if (!response.ok) throw new Error(`HTTP ${response.status}`); const length = Number(response.headers.get('content-length')); if (length > 2 * 1024 * 1024) throw new Error('Source exceeds input limit'); const reader = response.body?.getReader(); const chunks: Buffer[] = []; let bytes = 0; if (reader) { for (;;) { const item = await reader.read(); if (item.done) break; bytes += item.value.length; if (bytes > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('Source exceeds input limit'); } chunks.push(Buffer.from(item.value)); } } await add(source, kind, Buffer.concat(chunks)); }
        catch (error) { bundle.omissions.push({ source, reason: String(error) }); }
      } else await addFile(source, kind, true);
    }
  }
  const guidance = new Set(['AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'README.md']);
  for (const entry of bundle.entries) if (['target', 'untracked', 'document'].includes(entry.kind)) {
    let directory = dirname(resolve(cwd, entry.source));
    while (within(cwd, directory) && directory !== cwd) {
      for (const name of ['AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md']) guidance.add(relative(cwd, join(directory, name)));
      directory = dirname(directory);
    }
  }
  for (const path of guidance) {
    try { await add(path, 'guidance', await readFile(await approvedPath([cwd], join(cwd, path)))); } catch { /* Optional guidance. */ }
  }
  const after = await checkoutFingerprint(cwd);
  if (bundle.checkoutAtCapture !== after) bundle.omissions.push({ source: 'working checkout', reason: 'Checkout changed during capture. Captured bytes remain immutable, but this snapshot may combine different moments.' });
  bundle.fingerprint = hash(JSON.stringify({ selector: bundle.selector, base: bundle.base, entries: bundle.entries, omissions: bundle.omissions }));
  await writeJson(join(directory, 'manifest.json'), bundle); return bundle;
}
