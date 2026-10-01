# Contributing

Use [GitHub Issues](https://github.com/skriptit/codex-claude-plugin/issues) for reproducible bugs and feature proposals. For security problems, follow [SECURITY.md](SECURITY.md). Keep reports and pull requests focused, respectful, and free of credentials, private project files, or saved Claude transcripts.

## Development

Use Node.js 24 with npm and Git. Install the locked dependencies, then run the local checks:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test
npm run release
```

The automated tests use local fixtures and mocked provider responses; they do not require Claude credentials or make paid model calls. Some hosts cannot create file symlinks, so those tests report a skip. `npm run smoke -- cli` and `npm run smoke -- sdk` are optional live tests that use your own authenticated Claude access and may incur charges. Keep their output private.

Edit the TypeScript source in `src/`, scripts in `scripts/`, or plugin skills and metadata in `plugin/claude/`. Source and release scripts are checked with strict TypeScript; tests run directly as TypeScript under Node. Use syntax supported by Node's type stripping in scripts, tests, and the plugin launcher.

`npm run release` regenerates the committed `plugin/claude/runtime/` bundle and license copies. Include those generated changes with source or dependency changes; CI checks that they match a fresh build. Do not edit generated runtime files by hand. Dependabot updates the root dependency files; rebuild the bundle before merging those updates.

The command produces two ignored artifacts under `release/`:

- `codex-claude-plugin-source.zip`: source and public development documentation; build it before using its runtime.
- `claude-plugin.zip`: the plugin payload, with its manifest, skills, assets, launcher, and compiled runtime under `claude/`.

Users install through the Git marketplace documented in the [README](README.md). A plugin payload ZIP is not a marketplace repository. Files included in releases are explicitly listed in `scripts/release.ts`; update that list when adding or removing a public file.

## Pull requests

Describe the problem, resulting behavior, and checks you ran. Update user-facing documentation when behavior changes, and add regression coverage for bugs or new behavior. Keep automated tests independent of credentials and network services. A local test result does not establish live CLI/SDK authentication, native Codex interface behavior, or success on another operating system.

Publishing a version requires successful checks on Windows, macOS, and Linux, verification of the downloadable artifacts, and a version bump in the package and plugin metadata. Updating this Git marketplace does not submit the plugin to OpenAI's public Plugins Directory.
