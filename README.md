# Codex Claude Plugin

<img src="plugin/claude/assets/logo.png" alt="Codex Claude Plugin logo" width="96">

Run Claude agents inside Codex for decisions, reviews, and custom tasks.

## Install

Requires Node.js 24 with npm, Git, and a local Codex host with plugins and subagents. Sign in to [Claude Code](https://code.claude.com/docs/en/quickstart) or [configure the SDK backend](docs/usage.md#configuration).

```sh
codex plugin marketplace add skriptit/codex-claude-plugin
codex plugin add claude@skriptit-marketplace
```

Start a new Codex task and run `$claude:setup`.

## Use

When Codex asks you to choose between options or needs a decision to proceed, type:

```text
$claude:decide
```

The skill picks up the current question, options, and conversation automatically. No extra prompt or parameters are needed. Codex and Claude debate the choice; approving the resulting plan authorizes Codex to carry it out within the agreed scope.

| Skill | Purpose |
|---|---|
| `$claude:review` | Review the current changes. |
| `$claude:agent` | Run a custom Claude agent. |
| `$claude:runs` | Inspect saved runs and answers. |
| `$claude:resume` | Continue a saved run. |
| `$claude:cancel` | Stop a run. |

## Custom agents

Save instructions in `.codex/claude-agents/<name>.md` for one project, or `~/.codex/claude-agents/<name>.md` for personal use. For example, `risk-audit.md`:

```md
Review the requested changes for security risks.
Cite concrete findings and file locations.
```

Then ask Codex: “Run my risk-audit Claude agent on these changes.”

Custom agents are read-only. See the [agent file rules](docs/usage.md#custom-agent-files) for details.

## Data and permissions

Selected content is sent to Claude, and run history is saved locally. Usage follows your Claude account limits or API billing. Approved project checks run with your host permissions. See [storage and permissions](docs/usage.md#data-and-permissions).

[Usage guide](docs/usage.md) · [Troubleshooting](docs/troubleshooting.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

By Skript It Oy. [MIT License](LICENSE) · [Dependency notices](THIRD_PARTY_NOTICES.md). Independent of OpenAI and Anthropic.
