---
name: decide
description: Debate a concrete decision with Claude counsel from Codex, with live subagent activity and complete attributed answers. Use when the user asks for Claude counsel or a Codex-Claude decision debate.
---

# Claude counsel

Resolve this plugin's root two directories above this skill folder. Use `scripts/cca.mjs` there; do not invoke another installed plugin or repository decision skill.

Read [decision coordination](../../references/decide.md) and [the forwarding contract](../../references/relay.md). Keep investigation, reasoning, answer presentation and user checkpoints in the main task. Delegate each Claude call to one forwarding subagent only.

Support `--backend`, `--model`, `--effort`, `--budget-usd`, repeatable `--spec` and `--standards`. Saved setup defaults apply when omitted. There is one foreground flow and no wait/background mode.

After every completed counsel round, return and display Claude's exact verdict and complete Markdown answer in the main conversation before Codex's separately labeled assessment. Preserve the full `rawOutput`. Pause after each three unresolved rounds for the real user's continue/stop decision, without displaying provider costs or token usage in that checkpoint.

When the exact proposal reaches agreement, present the locked decision and complete the **Approve / Reject** native selection described in [decision coordination](../../references/decide.md). A stopped debate without agreement uses the **Accept / Reject** selection for the clearly labeled provisional decision. Resolve the permitted selection tool and wait for the user's actual choice before finishing; counsel agreement alone is not user approval.
