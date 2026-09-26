---
name: resume
description: Continue an exact saved Claude decision or review run while preserving its Claude session, settings, evidence and pending user checkpoints.
---

# Resume a saved run

Resolve this plugin's root two directories above this skill folder. Inspect `scripts/codex-claude.ts runs <run-id>` first. Use the exact run ID, never the latest workspace session.

If still running, inspect or cancel it; do not branch/relaunch it. If awaiting the lead, retrieve the full last reply and continue [decision coordination](../../references/decide.md). If awaiting the user, re-present that checkpoint and wait for the actual answer; a resume request does not silently answer a checkpoint.

For interrupted, failed or unknown attempts, show the saved evidence. An explicit user request to retry authorizes another model call; use `resume <run-id> --retry` through a new forwarding subagent under [relay.md](../../references/relay.md). Do not automatically replay unresolved check operations. A ready decision may need a new `--brief-file` containing the lead's current proposal and rebuttal.

Backend/model/effort are frozen. If the user explicitly changes them, start a new run with `--linked-from <id>`, carrying disclosed context rather than pretending provider-session continuity. An exhausted budget can be explicitly raised with `resume <id> --budget-usd AMOUNT`; preserve unknown usage as unknown.

After a completed counsel round, show its exact verdict and full Markdown answer in the main conversation before the separate Codex assessment. Continue the existing three-round checkpoint count and its usage-free checkpoint presentation from [decision coordination](../../references/decide.md).

For an agreed or stopped decision, follow the matching locked or provisional decision selection in [decision coordination](../../references/decide.md). Preserve any explicit approval or rejection already given for the same proposal; resuming alone is not approval.

For a completed review, follow the assessment and post-review selection in [review](../review/SKILL.md). Preserve any explicit fix/reject decision already given for those findings; do not ask again or treat a resume request as approval to fix them.
