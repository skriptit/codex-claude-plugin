---
name: agent
description: Run a user-defined Claude agent from a personal or project Markdown file inside Codex, with live subagent activity and a saved answer.
---

# Custom Claude agent

Resolve this plugin's root two directories above this skill folder. Read [the forwarding contract](../../references/relay.md). Use its `scripts/codex-claude.ts agent NAME TASK --cwd WORKSPACE --receipt-only` launcher through one native forwarding subagent. Keep the task in the main conversation and pass its text as a correctly quoted argument. The runtime resolves `NAME.md` from the project's `.codex/claude-agents/` first, then the personal Codex home's `claude-agents/` directory. It freezes the selected instructions in the saved run before calling Claude.

If no name or task was supplied, ask for the missing detail. The run can accept repeatable `--document`, `--spec` and `--standards` inputs, plus `--backend`, `--model`, `--effort` and `--budget-usd` overrides. It performs read-only analysis with read/search/web tools; custom instructions cannot grant editing, shell, delegation or project-check execution. The selected instructions define the agent's focus and answer style within those limits.

After the child finishes, retrieve and validate the exact saved answer as required by the forwarding contract. Present Claude's complete answer and Codex's own assessment separately. If the run fails or is interrupted, show its status and saved evidence; do not silently retry or present a partial answer as complete.
