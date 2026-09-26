# Troubleshooting

| Observation | Meaning and next action |
|---|---|
| `setup_required` | Run `$claude:setup` to install the verified versioned runtime. A read command never installs it. |
| `cli_unavailable` | Install/authenticate Claude Code, or set `CODEX_CLAUDE_PATH` to its real executable. Windows npm shims are resolved to the packaged native binary. |
| `unsupported_cli` | The CLI lacks a required isolation or protocol flag. Upgrade the selected CLI; do not remove the restriction. |
| `sdk_auth_missing` | Provide `ANTHROPIC_API_KEY` in the host environment outside the project. |
| Codex tool execution denied | The host blocked the launch/check. Its execution permission applies; the plugin cannot grant itself permission. |
| Claude `permission_denied` / `--restricted` | Claude's own tool or directory policy denied the operation. Inspect the requested path/tool and project-approved checks. Do not reroute through another tool. |
| `check_not_approved` | Use project setup to review and approve the exact named command. |
| `check_definition_changed` | A relevant script definition changed. Project setup must show and renew approval. |
| `check_outcome_unknown` | A previous attempt has no confirmed outcome. Inspect its process/output evidence. It is never replayed automatically. |
| `run_active` | Poll the original foreground session, inspect saved activity, or cancel it. Do not resume it into a second process. |
| `retry_required` | Inspect the interrupted attempt, then explicitly use `resume <id> --retry` if another model call is intended. |
| `session_unavailable` | No exact provider session was saved. Start a linked run; the plugin will not quietly create a replacement session in this run. |
| `awaiting_user` | A saved three-round checkpoint needs the user's actual continue/stop answer. Silence preserves it. |
| `settings_frozen` / `scope_frozen` | Start a new linked run to change backend/model/effort or captured inputs. |
| `model_mismatch` | Missing/substituted response identity failed validation; no completed reply is counted. |
| `result_integrity` | The saved result differs from its committed journal payload. Preserve both and investigate; do not render a guessed replacement. |
| `effort_mismatch` | The provider reported a different effort. Unreported effective effort is displayed as unknown instead. |
| `invalid_structured_output` / schema retry failure | Keep the partial evidence and exact provider failure. Assistant prose alone is not a valid completed result. |
| `budget_unsupported` / `budget_exhausted` | No supported enforcement, exhausted provider estimate or unknown prior usage. Raising a known exhausted budget requires an explicit larger resume override. Unknown usage stays unknown. |
| `run_busy` | A short state transaction is contended. Retry the state command after inspecting activity; no model/check is automatically repeated. |
| `journal_corrupt` | An interior record is invalid. Preserve artifacts; do not guess or discard history. A torn final write is repaired only on a later explicit write. |
| PowerShell policy/Add-Type denied | Windows containment cannot be established under host policy. No execution-policy bypass is used. This environment needs a compatible authorized runtime/policy before launching. |

`runs <id>` is read-only and includes full saved results. For truncated transport, retrieve `--round N --segment 1`, then all remaining ordered answer segments; use `--raw-segment N` for the complete rawOutput JSON. Reconstruct by exact concatenation and compare hashes before the lead assessment. Do not ask Claude to regenerate missing output. Keep Markdown intact; recover complete code fences before posting rather than displaying broken transport fragments.

Process identities use PID and start identity. Cancel files are scoped to the recorded owned execution; the plugin never calls a global `taskkill` or `pkill`. Closing a GUI window does not prove its workflow driver died. Normal closed stdin does not cancel a run. On host interruption, inspect the run before requesting a retry.

State and transcripts can include the source content reviewed. Keep the local data directory private using normal OS permissions. Project checks execute already-approved project code with the host user's authority; their receipts do not claim sandboxing or production/deployment validation.
