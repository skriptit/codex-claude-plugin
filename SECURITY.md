# Security policy

## Reporting a vulnerability

Use [GitHub's private vulnerability reporting](https://github.com/skriptit/codex-claude-plugin/security/advisories/new) when it is available. If GitHub does not offer that form, open an issue asking the maintainers for a private reporting channel, without including vulnerability details, credentials, or private project content.

Include the affected version, operating system, backend, impact, and a minimal reproduction with synthetic data. Do not attach raw saved runs or transcripts; they may contain source code, prompts, tokens, and command output.

## Supported versions and boundaries

Security fixes target the latest release and the current `main` branch. This is an early project; older versions are not maintained separately.

The plugin sends selected content and tool results to the configured Claude backend and saves run data locally. Claude's allowed tools can read project content and access the web. Approved project checks execute real project code with the host user's authority; process cleanup is not an operating-system sandbox. Install plugins and approve checks only from sources you trust.

The runtime's hashes detect accidental or local modifications; they are not a signature proving publisher identity. See the [README's data and permissions section](README.md#data-and-permissions) for storage and permission details. Removing the plugin leaves saved run data on disk.
