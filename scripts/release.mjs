import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, parse, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_NAME = 'codex-claude-plugin';
const PLUGIN_NAME = 'claude';
const SOURCE_ROOT_FILES = [
  '.gitattributes', '.gitignore', 'LICENSE', 'README.md',
  'THIRD_PARTY_NOTICES.md', 'package.json', 'package-lock.json', 'tsconfig.json',
  '.github/workflows/test.yml',
];
const PUBLIC_DOCS = ['architecture.md', 'troubleshooting.md'];
const PUBLIC_SCRIPTS = [
  'copy-assets.mjs', 'package.mjs', 'register-personal.py',
  'release.mjs', 'smoke.mjs',
];
const PUBLIC_REFERENCES = ['decide.md', 'relay.md', 'selection.md'];
const PUBLIC_SKILLS = ['cancel', 'decide', 'resume', 'review', 'runs', 'setup'];
const GENERATED_PLUGIN_FILES = ['LICENSE', 'THIRD_PARTY_NOTICES.md'];
const PUBLIC_SOURCE = [
  'cli.ts', 'contracts.ts', 'inputs/bundle.ts', 'inputs/git.ts',
  'policy/checks.ts', 'policy/server.ts', 'presentation/render.ts',
  'providers/options.ts', 'providers/run.ts', 'providers/stream.ts', 'providers/worker.ts',
  'runtime/command-worker.ts', 'runtime/config.ts', 'runtime/containment.ps1',
  'runtime/containment.ts', 'runtime/files.ts', 'runtime/identity.ts',
  'runtime/journal.ts', 'runtime/mutex.ts', 'runtime/watchdog.ts',
  'workflows/engine.ts', 'workflows/state.ts',
];
const PUBLIC_TESTS = [
  'adapter.test.mjs', 'bootstrap.test.mjs', 'core.test.mjs',
  'fixture-driver.mjs', 'fixture-process.mjs', 'fixture-writer.mjs',
  'lifecycle.test.mjs', 'packaging.test.mjs', 'recovery.test.mjs',
  'release.test.mjs', 'sdk-transport.test.mjs',
];

function assertSafeName(name) {
  if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe archive path: ${name}`);
  }
  if (name.split('/').some((part) => /^(?:\.env(?:\.|$)|\.git$|node_modules$|artifacts$|sessions?$)/i.test(part))) {
    throw new Error(`Private or generated archive path: ${name}`);
  }
}

async function assertNoSymlinks(root, relative) {
  const absolute = resolve(root);
  const rootPart = parse(absolute).root;
  let current = rootPart;
  for (const part of absolute.slice(rootPart.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    const entry = await lstat(current);
    if (entry.isSymbolicLink()) throw new Error(`Symlink in release root: ${current}`);
  }
  const rootInfo = await lstat(absolute);
  if (!rootInfo.isDirectory()) throw new Error(`Release root must be a real directory: ${root}`);
  for (const part of relative.split('/')) {
    current = join(current, part);
    const entry = await lstat(current);
    if (entry.isSymbolicLink()) throw new Error(`Symlink in release tree: ${relative}`);
  }
}

async function fileAt(root, relative) {
  assertSafeName(relative);
  const full = join(root, ...relative.split('/'));
  const parent = resolve(root) + sep;
  if (!resolve(full).startsWith(parent)) throw new Error(`Path escapes release root: ${relative}`);
  await assertNoSymlinks(root, relative);
  const entries = await readFile(full);
  return { path: relative, data: entries };
}

async function treeFiles(root, relative) {
  await assertNoSymlinks(root, relative);
  const directory = join(root, ...relative.split('/'));
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = `${relative}/${entry.name}`;
    assertSafeName(child);
    if (entry.isSymbolicLink()) throw new Error(`Symlink in release tree: ${child}`);
    if (entry.isDirectory()) files.push(...await treeFiles(root, child));
    else if (entry.isFile()) files.push(child);
    else throw new Error(`Unsupported release entry: ${child}`);
  }
  return files.sort();
}

function verifyTree(paths, allowed, label) {
  const unexpected = paths.filter((path) => !allowed(path));
  if (unexpected.length) throw new Error(`Unexpected ${label} file(s): ${unexpected.join(', ')}`);
}

function staticPluginPaths() {
  return [
    'plugin/claude/.codex-plugin/plugin.json',
    'plugin/claude/assets/logo.png',
    ...PUBLIC_REFERENCES.map((name) => `plugin/claude/references/${name}`),
    'plugin/claude/scripts/codex-claude.mjs',
    ...PUBLIC_SKILLS.map((name) => `plugin/claude/skills/${name}/SKILL.md`),
  ];
}

async function getStaticPluginPaths(root) {
  const staticPaths = staticPluginPaths();
  for (const dir of ['.codex-plugin', 'assets', 'references', 'scripts', 'skills']) {
    const actual = await treeFiles(root, `plugin/claude/${dir}`);
    verifyTree(actual, (path) => staticPaths.includes(path), 'plugin source');
  }
  const pluginRoot = await readdir(join(root, 'plugin', 'claude'), { withFileTypes: true });
  const rootNames = new Set(['.codex-plugin', 'assets', 'references', 'runtime', 'scripts', 'skills', ...GENERATED_PLUGIN_FILES]);
  for (const entry of pluginRoot) {
    if (!rootNames.has(entry.name)) throw new Error(`Unexpected plugin root entry: ${entry.name}`);
    if (entry.isSymbolicLink()) throw new Error(`Symlink in plugin root: ${entry.name}`);
  }
  return staticPaths;
}

export async function sourceFiles(root) {
  const paths = [...SOURCE_ROOT_FILES];
  const workflows = await treeFiles(root, '.github/workflows');
  verifyTree(workflows, (path) => path === '.github/workflows/test.yml', 'workflow');
  const docs = (await treeFiles(root, 'docs'));
  verifyTree(docs, (path) => PUBLIC_DOCS.includes(path.slice('docs/'.length)), 'documentation');
  paths.push(...PUBLIC_DOCS.map((name) => `docs/${name}`));
  const scripts = await treeFiles(root, 'scripts');
  paths.push(...scripts.filter((path) => PUBLIC_SCRIPTS.includes(path.slice('scripts/'.length))));
  for (const name of PUBLIC_SCRIPTS) {
    if (!paths.includes(`scripts/${name}`)) throw new Error(`Missing required release script: ${name}`);
  }
  const source = await treeFiles(root, 'src');
  verifyTree(source, (path) => PUBLIC_SOURCE.includes(path.slice('src/'.length)), 'source');
  paths.push(...PUBLIC_SOURCE.map((name) => `src/${name}`));
  const tests = await treeFiles(root, 'tests');
  verifyTree(tests, (path) => PUBLIC_TESTS.includes(path.slice('tests/'.length)), 'test');
  paths.push(...PUBLIC_TESTS.map((name) => `tests/${name}`));
  paths.push(...await getStaticPluginPaths(root));
  const unique = [...new Set(paths)].sort();
  if (unique.length !== paths.length) throw new Error('Duplicate source archive path');
  return Promise.all(unique.map((path) => fileAt(root, path)));
}

export async function pluginFiles(root) {
  const paths = [
    ...(await getStaticPluginPaths(root)),
    ...GENERATED_PLUGIN_FILES.map((name) => `plugin/claude/${name}`),
    'plugin/claude/runtime/package.json',
    'plugin/claude/runtime/package-lock.json',
    'plugin/claude/runtime/bundle.json',
    'plugin/claude/runtime/LICENSE',
    'plugin/claude/runtime/THIRD_PARTY_NOTICES.md',
  ];
  const expectedDist = PUBLIC_SOURCE.map((name) =>
    `plugin/claude/runtime/dist/${name.endsWith('.ts') ? name.slice(0, -3) + '.js' : name}`);
  paths.push(...expectedDist);
  const runtime = await treeFiles(root, 'plugin/claude/runtime');
  const expected = new Set(paths.filter((path) => path.startsWith('plugin/claude/runtime/')));
  verifyTree(runtime, (path) => expected.has(path), 'plugin runtime');
  const unique = [...new Set(paths)].sort();
  if (unique.length !== paths.length) throw new Error('Duplicate plugin archive path');
  return Promise.all(unique.map((path) => fileAt(root, path)));
}

export function scanReleaseFiles(files) {
  const findings = [];
  const patterns = [
    /[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s'"`<>]+[\\/]/i,
    /\/(?:Users|home)\/[^/\s'"`<>]+\//,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\b(?:sk-ant-|sk-proj-|ghp_|gho_|github_pat_|npm_)[A-Za-z0-9_-]{12,}/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bAIza[0-9A-Za-z_-]{30,}\b/,
    /\b(?:ANTHROPIC_API_KEY|OPENAI_API_KEY|GITHUB_TOKEN|GH_TOKEN|NPM_TOKEN|CLOUDFLARE_API_TOKEN)\s*[:=]\s*['"]?[A-Za-z0-9_./+\-=]{24,}/i,
  ];
  for (const file of files) {
    assertSafeName(file.path);
    if (file.path.endsWith('/assets/logo.png')) {
      assertLogoPng(file.data, file.path);
      continue;
    }
    const content = file.data.toString('utf8');
    if (patterns.some((pattern) => pattern.test(content))) findings.push(file.path);
  }
  if (findings.length) throw new Error(`Private content found in release files: ${findings.join(', ')}`);
}

function assertLogoPng(data, path) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (data.length < 33 || data.length > 5 * 1024 * 1024 ||
      !data.subarray(0, 8).equals(signature) ||
      data.readUInt32BE(8) !== 13 || data.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error(`Invalid PNG logo: ${path}`);
  }
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width !== height || width < 48 || width > 4096) {
    throw new Error(`Logo must be square and 48-4096 pixels: ${path}`);
  }
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  return value >>> 0;
});

function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

export function makeZip(files, prefix) {
  if (prefix) assertSafeName(prefix);
  const ordered = [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (ordered.length > 65535) throw new Error('ZIP file count exceeds classic ZIP limit');
  const local = [];
  const central = [];
  let offset = 0;
  let previous = '';
  for (const file of ordered) {
    assertSafeName(file.path);
    if (file.path === previous) throw new Error(`Duplicate ZIP path: ${file.path}`);
    previous = file.path;
    const name = Buffer.from(prefix ? `${prefix}/${file.path}` : file.path, 'utf8');
    const data = Buffer.from(file.data);
    if (name.length > 65535 || data.length > 0xffffffff || offset > 0xffffffff) throw new Error('ZIP entry exceeds classic ZIP limit');
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(0x0021, 12); // 1980-01-01
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x0800, 8);
    directory.writeUInt16LE(0x0021, 14);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += header.length + name.length + data.length;
  }
  const centralLength = central.reduce((size, part) => size + part.length, 0);
  if (offset + centralLength > 0xffffffff) throw new Error('ZIP archive exceeds classic ZIP limit');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(ordered.length, 8);
  end.writeUInt16LE(ordered.length, 10);
  end.writeUInt32LE(centralLength, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

export async function buildArchives(root, output = join(root, 'release')) {
  const source = await sourceFiles(root);
  const plugin = await pluginFiles(root);
  const installReadme = Buffer.from('# Claude plugin\n\nRequires Python 3.9+, Node.js 24, and a Codex host with local plugin support. From this extracted directory, run:\n\n```sh\npython register-personal.py --source claude\n```\n\nInstall `claude@personal` in Codex, start a new task, and run `$claude:setup`. Use an authenticated Claude Code CLI or set `ANTHROPIC_API_KEY` in the host environment for the SDK backend. The registrar validates the plugin and adds it to your personal marketplace. Setup stores configuration outside the plugin.\n\nReleased under the [MIT License](claude/LICENSE). Dependency terms are in [THIRD_PARTY_NOTICES.md](claude/THIRD_PARTY_NOTICES.md).\n', 'utf8');
  const pluginZipFiles = [
    ...plugin.map(({ path, data }) => ({ path: path.slice('plugin/'.length), data })),
    { path: 'README.md', data: installReadme },
    { path: 'register-personal.py', data: await readFile(join(root, 'scripts', 'register-personal.py')) },
  ];
  scanReleaseFiles(source);
  scanReleaseFiles(pluginZipFiles);
  const sourceZip = makeZip(source, SOURCE_NAME);
  const pluginZip = makeZip(pluginZipFiles, '');
  const marketplaceZip = makeZip(pluginZipFiles.filter(({ path }) => path.startsWith('claude/')), '');
  await mkdir(output, { recursive: true });
  const artifacts = [
    { name: `${SOURCE_NAME}-source.zip`, bytes: sourceZip, count: source.length },
    { name: `${PLUGIN_NAME}-plugin.zip`, bytes: pluginZip, count: pluginZipFiles.length },
    { name: `${PLUGIN_NAME}-marketplace.zip`, bytes: marketplaceZip, count: plugin.length },
  ];
  for (const artifact of artifacts) {
    await writeFile(join(output, artifact.name), artifact.bytes);
  }
  return artifacts.map(({ name, bytes, count }) => ({
    path: join(output, name),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    files: count,
    bytes: bytes.length,
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve('.');
  const built = await buildArchives(root);
  for (const artifact of built) {
    console.log(`${basename(artifact.path)}  ${artifact.sha256}  ${artifact.files} files  ${artifact.bytes} bytes`);
  }
}
