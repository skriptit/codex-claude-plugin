# Decision coordination

The current Codex model is the lead. This workflow is independent of other installed decision skills and repository-specific frameworks.

1. Investigate the actual subject. Write a temporary JSON brief with `question`, `proposal`, `reason`, `cost`, `falsifier`, and arrays `alternatives`, `constraints`, `evidence`. The proposal is the exact recommendation under discussion. `cost` describes the proposal's accepted engineering or operational tradeoff. State your real lean and give Claude concrete evidence assignments. Optional `responseToCounsel` records your rebuttal in later rounds.
2. Run `node <launcher> decide <question> --cwd <workspace> --brief-file <brief.json> --receipt-only` through one native forwarding subagent using [relay.md](relay.md). Include requested backend/model/effort/spec/standards overrides on the first run. Retrieve the exact saved result directly in main as required by the relay contract; do not assess a receipt or retyped subagent payload.
3. On each completed reply, show the actual `display.verdict` and the complete `display.answer` in the MAIN conversation in this order: **Claude counsel · Round N**, **Verdict: value**, then the full answer as portable Markdown. Preserve Claude's wording. Use all ordered answer segments if necessary; retrieve missing segments from the saved run and concatenate them exactly before assessment. Transport segment boundaries are not Markdown boundaries: reconstruct code fences, tables and Unicode before posting. A summary or file link alone is not a substitute. Then show a separate **Codex assessment**.
4. Check every material objection yourself. Save an assessment JSON with `requestId`, `proposalHash` from `run.lastRequest`, `agree` (boolean), `answer`, `reason`, `cost`, `falsifier`. Record it with `node <launcher> assess <run-id> --assessment-file <json> --expected-revision <run.revision>`. The engine accepts agreement only when Claude endorsed this exact proposal. The lead remains responsible for semantic judgement.
5. If the returned state is `ready`, write the next full brief with your concrete rebuttal and current proposal. Run another child using `decide --run <run-id> --brief-file <json> --expected-revision <revision> --receipt-only`. Do not re-run an old round or change run settings. A changed proposal requires new counsel scrutiny.
6. At `awaiting_user`, show the current recommendation, agreements, disagreements and missing evidence. Omit provider dollar costs, token usage and remaining budget from this three-round summary and its menu; keep recorded usage and budget safeguards intact. Follow [native user selections](selection.md) with `{"questions":[{"title":"Continue the decision debate?","options":["Continue (Recommended)","Stop debate"]}]}`. Continue addresses the unresolved issues; stop presents the current provisional decision. With no answer, stay paused. Only after an actual answer call `checkpoint <run-id> --checkpoint-id <id> --answer continue|stop --expected-revision <revision>`. Each answer applies to that checkpoint only. This is a trusted host-model handoff, not machine proof of user consent.
7. On agreement or stop, present the decision, rationale, strongest alternative, pros/cons, accepted engineering or operational tradeoff, falsifier, evidence gaps and any dissent. Complete the appropriate final selection below before finishing. A stopped debate without agreement is a provisional recommendation, not a locked decision; do not imply Claude endorsed it.

For a locked decision (the engine reports `agreed` for the exact proposal), first present its exact proposal, material scope and accepted tradeoff in the main conversation. Then follow [native user selections](selection.md) to call `request_user_input_async` in the main task with this compact payload when that tool is permitted:

```json
{"questions":[{"title":"Approve this decision?","options":["Approve (Recommended)","Reject"]}]}
```

For a stopped debate without agreement, clearly identify the presented proposal as provisional and explain the remaining disagreement in the session. Stopping the debate alone does not accept that proposal. Show the final selection using:

```json
{"questions":[{"title":"Accept this provisional decision?","options":["Accept (Recommended)","Reject"]}]}
```

Approval or acceptance accepts the presented decision; implementation remains a separate request unless already explicitly authorized for this exact scope. Rejection does not automatically start another debate. A revised proposal requires fresh counsel scrutiny before it can be described as locked. Acknowledge the user's actual choice in the main conversation; preserve the engine's `agreed` or stopped state and never use the unrelated continue/stop checkpoint command to record final acceptance. Agent agreement and user approval are separate facts.

Apply the matching selection to resumed agreed or stopped decisions as well, preserving an explicit choice already given for the same proposal. If a configured budget blocks progress, explain the blocking condition and wait for the user's explicit budget decision; hiding routine usage totals never permits bypassing a budget check.

Every three valid completed counsel replies requires a user checkpoint unless agreement ends the debate first. Failed attempts do not count. There is no default total round/time limit. Do not automatically retry interrupted, unknown or mismatched responses. Show their evidence and obtain an explicit retry/resume decision. Use the same run/session; never most-recent continuation. `runs <id>` is a pure read.

Requested effort and effective effort are different fields. If the latter is null, say unknown; do not claim the server applied it. Full raw outputs, objections and metadata remain available through runs inspection, without requiring extra main-conversation fields beyond verdict and full answer.
