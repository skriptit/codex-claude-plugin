import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const source = resolve('.');
const plugin = join(source, 'plugin', 'claude');
const runtime = join(plugin, 'runtime');
const dist = join(source, 'dist');
const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(join(source, 'package-lock.json'), 'utf8'));
const pluginManifest = JSON.parse(await readFile(join(plugin, '.codex-plugin', 'plugin.json'), 'utf8'));

if (pluginManifest.name !== 'claude' || pluginManifest.version !== pkg.version) {
  throw new Error('Plugin name or version differs from package.json');
}
if (lock.lockfileVersion !== 3 || lock.packages?.['']?.version !== pkg.version ||
    JSON.stringify(lock.packages[''].dependencies) !== JSON.stringify(pkg.dependencies)) {
  throw new Error('package-lock.json does not match production dependencies');
}

async function files(dir: string, prefix = ''): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const name = `${prefix}${entry.name}`;
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error(`Symlink is not allowed in package input: ${path}`);
    if (stat.isDirectory()) paths.push(...await files(path, `${name}/`));
    else if (stat.isFile()) paths.push(name);
    else throw new Error(`Unsupported package input: ${path}`);
  }
  return paths.sort();
}

const expectedModules = (await files(join(source, 'src')))
  .filter(file => file.endsWith('.ts') && !file.endsWith('.d.ts'))
  .map(file => `${file.slice(0, -3)}.js`)
  .sort();
const distFiles = await files(dist);
const actualModules = distFiles.filter(file => file.endsWith('.js'));
const missing = expectedModules.filter(file => !actualModules.includes(file));
const stale = actualModules.filter(file => !expectedModules.includes(file));
if (!expectedModules.includes('cli.js') || missing.length || stale.length ||
    !distFiles.includes('runtime/containment.ps1')) {
  throw new Error(`Compiled runtime differs from src; run npm run build and remove stale modules (missing: ${missing.join(', ') || 'none'}; stale: ${stale.join(', ') || 'none'})`);
}
const compiledFiles = [...expectedModules, 'runtime/containment.ps1'];

const productionPackage = {
  name: pkg.name,
  version: pkg.version,
  private: true,
  description: pkg.description,
  type: pkg.type,
  license: pkg.license,
  engines: pkg.engines,
  bin: pkg.bin,
  dependencies: pkg.dependencies,
};
const productionPackages: Record<string, unknown> = {
  '': {
    name: pkg.name,
    version: pkg.version,
    license: pkg.license,
    dependencies: pkg.dependencies,
    bin: pkg.bin,
    engines: pkg.engines,
  },
};
const productionLock = {
  name: lock.name,
  version: lock.version,
  lockfileVersion: lock.lockfileVersion,
  requires: lock.requires,
  packages: productionPackages,
};
for (const [name, record] of Object.entries(lock.packages)) {
  if (name && typeof record === 'object' && record !== null && !('dev' in record && record.dev)) productionLock.packages[name] = record;
}

// The generated subtree is replaced as a unit. No user data lives here.
if (relative(plugin, runtime) !== 'runtime') throw new Error('Invalid bundle target');
await rm(runtime, { recursive: true, force: true });
await mkdir(join(runtime, 'dist'), { recursive: true });
for (const file of compiledFiles) {
  const target = join(runtime, 'dist', file);
  await mkdir(resolve(target, '..'), { recursive: true });
  await cp(join(dist, file), target);
}
await writeFile(join(runtime, 'package.json'), `${JSON.stringify(productionPackage, null, 2)}\n`);
await writeFile(join(runtime, 'package-lock.json'), `${JSON.stringify(productionLock, null, 2)}\n`);
for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  const content = (await readFile(join(source, name), 'utf8')).replace(/\r\n/g, '\n');
  await writeFile(join(plugin, name), content);
  await writeFile(join(runtime, name), content);
}

const manifest: Record<string, string> = {};
for (const file of await files(runtime)) {
  manifest[file] = createHash('sha256').update(await readFile(join(runtime, file))).digest('hex');
}
const digest = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
await writeFile(join(runtime, 'bundle.json'), `${JSON.stringify({ version: pkg.version, digest, files: manifest }, null, 2)}\n`);
console.log(JSON.stringify({ plugin, runtimeDigest: digest, files: Object.keys(manifest).length }));
