---
name: review
description: Run one Claude reviewer combining adversarial, specification and standards scrutiny of code or documents, with live native Codex subagent activity.
---

# Combined Claude review

Resolve this plugin's root two directories above this skill folder. Read [the forwarding contract](../../references/relay.md). Launch its `scripts/cca.mjs review` through one native forwarding subagent with the absolute workspace and user-selected inputs.

Default scope is staged, unstaged and non-ignored untracked text changes against HEAD. `--base REF` and `--staged` are mutually exclusive; repeatable `--path` filters Git scope. Repeatable `--document` selects document review instead. Accept repeatable `--spec`/`--standards` and run overrides `--backend`, `--model`, `--effort`, `--budget-usd`.

One reviewer always applies all three lenses and returns one deduplicated report. Missing sources and omitted content are coverage gaps. Check receipts identify live-checkout validation separately from captured review inputs. Do not claim a staged snapshot passed a working-tree check.

Wait for the child and validate its completed result. Read Claude's original report, independently assess actionable findings, and present the findings with evidence and check status. Preserve the original report and full raw result in the saved run. A denied, failed or interrupted check is never a pass. The review does not authorize implementation, publication or commits.

After a completed review with actionable findings that Codex agrees should be fixed, present the complete agreed findings and concrete proposed fixes in the main conversation, using finding IDs or short descriptions; explain any findings Codex rejects or defers. Then follow [native user selections](../../references/selection.md) to call `request_user_input_async` in the main task with this compact payload when that tool is permitted. Keep the full recommendation in the session, outside the menu title and option labels.

```json
{"questions":[{"title":"Fix agreed findings?","options":["Fix agreed findings (Recommended)","Reject"]}]}
```

Wait for the actual answer as required by the selection contract. Selecting the first option authorizes only the stated implementation and validation without another confirmation, but does not authorize commits, pushes or publication. Complete this choice before finishing a review with accepted actionable findings; do not start fixes while the choice is pending.

If no actionable findings are accepted by Codex, explain why and finish without offering an empty fix action. Failed or incomplete reviews must be reported as such, rather than presented as a completed fix decision. Apply this same post-review choice when completing a resumed review.
