---
name: cancel
description: Stop a selected Claude run's owned Claude and validation processes while preserving its saved results and partial evidence.
---

# Cancel owned Claude work

Resolve the plugin root two directories above this skill folder. Run `node <launcher> cancel <exact-run-id>` using its `scripts/codex-claude.mjs`. The user's cancellation request authorizes this action; no extra confirmation is needed when the target is clear.

Inspect the result until owned execution has stopped, using bounded waits and pure `runs` reads. Report pending cancellation honestly if cleanup has not finished. Never kill processes by name or affect unrelated Claude sessions. Cancellation preserves partial evidence and does not claim a successful review or decision.
