# Codex Claude Plugin

<img src="plugin/claude/assets/logo.png" alt="Codex Claude Plugin logo" width="96">

A Codex plugin for running Claude agents inside Codex. It includes `decide` for challenging proposals and `review` for code or document review. You can also create your own read-only Claude agents. Codex leads the conversation and starts a native subagent for each Claude call. Maintained by Skript It Oy, this is an independent project and is not affiliated with OpenAI or Anthropic.

## Install

You need Node.js 24 with npm, Git, and a Codex host that supports local plugins and native subagents. For the CLI backend, install and authenticate a compatible Claude Code CLI. The SDK backend requires `ANTHROPIC_API_KEY` in the host environment; keep credentials outside this repository and out of chat.

Add the Git marketplace, then install the plugin:

```sh
codex plugin marketplace add skriptit/codex-claude-plugin
codex plugin add claude@skriptit-marketplace
```

Start a new Codex task so it loads the skills, then run `$claude:setup`.

Setup installs the packaged runtime into a versioned per-user directory and stores configuration outside the repository. Run `$claude:setup --check` for a read-only prerequisite and configuration check; it does not install a missing runtime or test a live Claude call.

## Use

```text
$claude:setup
$claude:setup --check
$claude:setup --project

$claude:decide Should this feature use an append-only journal?
$claude:review
$claude:review --staged --spec docs/requirements.md
$claude:review --base main --path src
$claude:review --document docs/design.md --spec docs/requirements.md
$claude:agent risk-audit Check the authentication changes.

$claude:runs
$claude:runs <run-id>
$claude:resume <run-id>
$claude:cancel <run-id>
```

`decide` debates one saved proposal at a time. Codex shows Claude's complete answer, makes its own assessment, and asks the user whether to continue after each three unresolved rounds. A final decision needs the user's explicit approval; agreement between agents alone is not approval. `review` combines adversarial, specification, and standards scrutiny in one report. Codex assesses findings before offering to fix agreed ones. Neither workflow commits or publishes work on its own.

Code review defaults to staged, unstaged, and non-ignored untracked UTF-8 text changes against HEAD. `--staged` uses the index; `--base REF` selects a merge base; repeatable `--path` narrows Git scope. Repeatable `--document` selects document review instead. Both workflows accept repeatable `--spec` and `--standards`, plus per-run `--backend`, `--model`, `--effort`, and `--budget-usd` overrides. Unsupported model or effort choices fail rather than silently falling back.

Each round is foreground work. The subagent transcript shows relayed Claude activity; completed answers and raw results are saved for exact retrieval with `$claude:runs`. If a provider attempt is interrupted or its outcome is unknown, inspect the saved evidence before explicitly retrying. An unknown project-check outcome is never replayed automatically.

## Create your own Claude agent

Put a plain Markdown file named `<name>.md` in your project's `.codex/claude-agents/` directory, or in `~/.codex/claude-agents/` for use across projects (`%USERPROFILE%\.codex\claude-agents\` on Windows). If `CODEX_HOME` is set, use its `claude-agents/` directory for personal agents. A project file with the same name takes precedence, so review its instructions before running it. Names use lowercase letters, digits, hyphens or underscores and must begin with a letter; `decide` and `review` are reserved.

For example, create `.codex/claude-agents/risk-audit.md`:

```md
Examine the requested change for security risks. Focus on concrete data flows,
trust boundaries and exploitable behavior. Cite file locations and explain
uncertainty. Return a concise Markdown report.
```

Then ask Codex to run `$claude:agent risk-audit Check the authentication changes.` You can attach files with repeatable `--document`, `--spec` or `--standards` options. The agent file supplies instructions; the task comes from your request. The plugin saves the exact instructions used for each run, so later edits do not change its saved result. Custom agents can read and search the project and web; they cannot edit files, run shell commands, delegate, or run project checks through Claude. [Codex's own custom subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents) use separate `.toml` files under `.codex/agents/` or `~/.codex/agents/`.

## Data and permissions

Selected project inputs and conversation context are sent to Claude for model processing. With an Anthropic-backed CLI or SDK account, that data is sent to Anthropic; its handling depends on your account and settings. Read [Anthropic's Claude Code data-usage terms](https://code.claude.com/docs/en/data-usage) before using private material.

Run state, reviewed inputs, Claude answers, and check output can contain private project content. Protect the per-user data directory with normal operating-system permissions:

| Host | Default data directory |
|---|---|
| Windows | `%USERPROFILE%\.local\share\codex-claude-plugin` |
| macOS/Linux | `$XDG_DATA_HOME/codex-claude-plugin`, otherwise `~/.local/share/codex-claude-plugin` |

`CODEX_CLAUDE_DATA_HOME` selects another local filesystem directory. The plugin does not automatically migrate data between roots. `CODEX_CLAUDE_PATH` selects an installed Claude executable. Local filesystems with atomic rename semantics are required; network shares are unsupported.

Claude receives scoped read and web tools plus the plugin's evidence and approved-check tools. Project checks execute real project code with the host user's authority and may create artifacts; they are not an operating-system sandbox. `$claude:setup --project` presents exact check definitions for approval. Changed definitions require renewed approval. Codex and Claude host permissions and managed restrictions still apply.

See [architecture](docs/architecture.md) and [troubleshooting](docs/troubleshooting.md). Report problems through [GitHub Issues](https://github.com/skriptit/codex-claude-plugin/issues). Released under the [MIT License](LICENSE); dependency notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
