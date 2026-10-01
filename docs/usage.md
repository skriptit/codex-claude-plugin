# Usage guide

For installation and basic skills, start with the [README](../README.md).

## Configuration

The CLI backend uses your installed, authenticated [Claude Code](https://code.claude.com/docs/en/quickstart). The SDK backend requires `ANTHROPIC_API_KEY` in the host environment. Keep credentials outside the repository and out of chat. Usage counts against your Claude account limits or API billing.

`$claude:setup` installs the packaged runtime into a versioned per-user directory and saves configuration outside the repository. `$claude:setup --check` inspects prerequisites and resolved settings without installing a missing runtime or making a live model call.

Set a default model and effort:

```text
$claude:setup --model claude-fable-5-1 --effort high
```

Use a [full model ID](https://platform.claude.com/docs/en/models/overview) available to your backend and account. Short and `-latest` aliases are rejected because the plugin verifies the exact response model. Effort can be `low`, `medium`, `high`, `xhigh`, or `max`; unsupported choices fail without falling back.

Add `--project` for workspace defaults or `--workflow decide|review|agent` for a specific workflow. Inspect that workflow with `$claude:setup --check --workflow review`, replacing `review` as needed. New runs can override `--backend`, `--model`, `--effort`, and `--budget-usd`. Existing runs retain their original settings.

## Decisions and reviews

`$claude:decide` uses the pending decision and conversation as its starting point. Codex presents Claude's complete answer and its own assessment. After three unresolved rounds, it asks whether to continue. Approving the final plan, or accepting a provisional one, starts its implementation or execution in the same task. Explicit limits you set still apply; adoption, deployment, or publication must be within the approved scope. Agreement between agents alone is not approval.

`$claude:review` combines adversarial, specification, and standards scrutiny. Codex assesses the findings before offering to fix agreed ones. The default scope is staged, unstaged, and non-ignored untracked UTF-8 text changes against HEAD.

Optional scope selectors:

```text
$claude:review --staged --spec docs/requirements.md
$claude:review --base main --path src
$claude:review --document docs/design.md --spec docs/requirements.md
```

`--staged` uses the index; `--base REF` selects a merge base. These two options are mutually exclusive. Repeatable `--path` narrows Git scope, while `--document` selects document review. Decision, review, and custom-agent workflows accept repeatable `--spec` and `--standards` inputs.

Each round runs in the foreground, with Claude activity shown in a native Codex subagent. Use `$claude:runs` to inspect saved runs, answers, and raw results. If an attempt is interrupted or its outcome is unknown, inspect it before requesting a retry. An unknown project-check outcome is never replayed automatically. See [troubleshooting](troubleshooting.md) for recovery steps.

## Custom agent files

Create `<name>.md` in `.codex/claude-agents/` for a project or `~/.codex/claude-agents/` for personal use. On Windows the personal directory is `%USERPROFILE%\.codex\claude-agents\`. If `CODEX_HOME` is set, use its `claude-agents/` directory instead.

A project file takes precedence over a personal file with the same name. Review its instructions before running it. Names must start with a lowercase letter and contain only lowercase letters, digits, hyphens, or underscores; `decide` and `review` are reserved. Files must be regular UTF-8 files of at most 32 KiB.

The file defines the agent's instructions; your request supplies its task. For example:

```text
$claude:agent risk-audit Check the authentication changes.
```

Mention documents, specifications, or standards in your request, or use repeatable `--document`, `--spec`, or `--standards` options. The plugin freezes the instructions with each run, so later edits do not change saved results. Custom agents can read and search the project and web; they cannot edit files, run shell commands, delegate, or execute project checks through Claude.

[Codex's built-in custom subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents) use separate `.toml` files under `.codex/agents/` or `~/.codex/agents/`.

## Update or uninstall

To update:

```sh
codex plugin marketplace upgrade skriptit-marketplace
codex plugin remove claude@skriptit-marketplace
codex plugin add claude@skriptit-marketplace
```

Start a new Codex task after reinstalling. To uninstall, remove the plugin; optionally remove its marketplace with `codex plugin marketplace remove skriptit-marketplace`. Saved data stays on disk until you remove it separately.

## Data and permissions

Selected inputs and conversation context are sent to the configured Claude backend. With an Anthropic-backed CLI or SDK account, handling follows your account settings and [Anthropic's data-usage terms](https://code.claude.com/docs/en/data-usage).

Run state, reviewed inputs, answers, and check output may contain private project content. Protect the data directory with normal operating-system permissions:

| Host | Default data directory |
|---|---|
| Windows | `%USERPROFILE%\.local\share\codex-claude-plugin` |
| macOS/Linux | `$XDG_DATA_HOME/codex-claude-plugin`, otherwise `~/.local/share/codex-claude-plugin` |

`CODEX_CLAUDE_DATA_HOME` selects another local directory without migrating existing data. `CODEX_CLAUDE_PATH` selects an installed Claude executable. Local filesystems with atomic rename semantics are required; network shares are unsupported.

Claude receives scoped read and web tools plus evidence and approved-check tools. Project checks execute real project code with the host user's authority and may create artifacts; they are not an operating-system sandbox. `$claude:setup --project` presents exact check definitions for approval, and changed definitions need renewed approval. Codex and Claude host permissions and managed restrictions still apply. Custom agents cannot execute project checks.

See [architecture](architecture.md) for runtime design and [SECURITY.md](../SECURITY.md) for vulnerability reporting.
