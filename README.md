# Codex Claude Plugin

<img src="plugin/claude/assets/logo.png" alt="Codex Claude Plugin logo" width="96">

Claude counsel and combined code or document reviews inside Codex. Codex leads the conversation while one native forwarding subagent runs a foreground Claude call and relays its activity. Maintained by Skript It Oy, this is an independent project and is not affiliated with OpenAI or Anthropic.

## Install

You need Node.js 24 with npm, Python 3.9 or newer, and a Codex host that supports local plugins and native subagents. Code review also needs Git. For the CLI backend, install and authenticate a compatible Claude Code CLI. The SDK backend requires `ANTHROPIC_API_KEY` in the host environment; keep credentials outside this repository and out of chat.

Clone [the source repository](https://github.com/skriptit/codex-claude-plugin) or extract `codex-claude-agents-source.zip` to a `codex-claude-agents/` directory. From that directory, build and register the plugin:

```sh
npm ci --ignore-scripts
npm run package:plugin
python scripts/register-personal.py --source plugin/claude
```

The ready-built archive (`claude-plugin.zip`) contains a `claude/` directory, a short install README, and the registration helper. From the extracted ZIP root, register it without building:

```sh
python register-personal.py --source claude
```

After either route, install `claude@personal` in Codex, start a new task so Codex loads its skills, then run `$claude:setup`. Registration changes your local personal marketplace. To update an existing plugin directory, rerun registration with `--replace`; the helper backs up that directory first. Setup installs the packaged runtime into a versioned per-user directory and stores configuration outside the repository. Run `$claude:setup --check` for a read-only prerequisite and configuration check; it does not install a missing runtime or test a live Claude call.

The public command prefix is `claude:`. Internal launcher, environment, and saved-run identifiers still use `cca` for compatibility.

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

$claude:runs
$claude:runs <run-id>
$claude:resume <run-id>
$claude:cancel <run-id>
```

`decide` debates one saved proposal at a time. Codex shows Claude's complete answer, makes its own assessment, and asks the user whether to continue after each three unresolved rounds. A final decision needs the user's explicit approval; agreement between agents alone is not approval. `review` combines adversarial, specification, and standards scrutiny in one report. Codex assesses findings before offering to fix agreed ones. Neither workflow commits or publishes work on its own.

Code review defaults to staged, unstaged, and non-ignored untracked UTF-8 text changes against HEAD. `--staged` uses the index; `--base REF` selects a merge base; repeatable `--path` narrows Git scope. Repeatable `--document` selects document review instead. Both workflows accept repeatable `--spec` and `--standards`, plus per-run `--backend`, `--model`, `--effort`, and `--budget-usd` overrides. Unsupported model or effort choices fail rather than silently falling back.

Each round is foreground work. The subagent transcript shows relayed Claude activity; completed answers and raw results are saved for exact retrieval with `$claude:runs`. If a provider attempt is interrupted or its outcome is unknown, inspect the saved evidence before explicitly retrying. An unknown project-check outcome is never replayed automatically.

## Data and permissions

Selected project inputs and conversation context are sent to Claude for model processing. With an Anthropic-backed CLI or SDK account, that data is sent to Anthropic; its handling depends on your account and settings. Read [Anthropic's Claude Code data-usage terms](https://code.claude.com/docs/en/data-usage) before using private material.

Run state, reviewed inputs, Claude answers, and check output can contain private project content. Protect the per-user data directory with normal operating-system permissions:

| Host | Default data directory |
|---|---|
| Windows | `%USERPROFILE%\.local\share\codex-claude-agents` |
| macOS/Linux | `$XDG_DATA_HOME/codex-claude-agents`, otherwise `~/.local/share/codex-claude-agents` |

`CCA_DATA_HOME` selects another local filesystem directory. The plugin does not automatically migrate data between roots. `CCA_CLAUDE_PATH` selects an installed Claude executable. Local filesystems with atomic rename semantics are required; network shares are unsupported.

Claude receives scoped read and web tools plus the plugin's evidence and approved-check tools. Project checks execute real project code with the host user's authority and may create artifacts; they are not an operating-system sandbox. `$claude:setup --project` presents exact check definitions for approval. Changed definitions require renewed approval. Codex and Claude host permissions and managed restrictions still apply.

## Development and verification

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run release
```

`npm run release` builds three archives in `release/`: `codex-claude-agents-source.zip` contains buildable source; `claude-plugin.zip` contains the ready-built plugin, install README, and registration helper; `claude-marketplace.zip` contains only the ready-built plugin under one top-level `claude/` directory for marketplace ZIP import. Type checking and tests are deterministic and do not establish authenticated provider or native host behavior. `npm run smoke -- cli` and `npm run smoke -- sdk` make real provider calls; run them only with the corresponding credentials and environment. Authenticated SDK operation, macOS/Linux process lifecycle, and native host interface behavior require validation in those environments before making platform-wide claims.

See [architecture](docs/architecture.md) and [troubleshooting](docs/troubleshooting.md). Report problems through [GitHub Issues](https://github.com/skriptit/codex-claude-plugin/issues). Released under the [MIT License](LICENSE); dependency notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
