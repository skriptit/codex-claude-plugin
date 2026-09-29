# Troubleshooting

| Observation | Meaning and next action |
|---|---|
| `setup_required` | Run `$claude:setup` to install the verified versioned runtime. A read command never installs it. |
| `cli_unavailable` | [Install and sign in to Claude Code](https://code.claude.com/docs/en/quickstart), or set `CODEX_CLAUDE_PATH` to its executable. |
| `unsupported_cli` | The CLI lacks a required isolation or protocol flag. Upgrade the selected CLI; do not remove the restriction. |
| `sdk_auth_missing` | Provide `ANTHROPIC_API_KEY` in the host environment outside the project. |
| `invalid_model` | Choose a full [Claude model ID](https://platform.claude.com/docs/en/models/overview); short and `-latest` aliases are rejected before a model call. |
| Codex tool execution denied | The host blocked the launch/check. Its execution permission applies; the plugin cannot grant itself permission. |
| Claude `permission_denied` / `--restricted` | Claude's own tool or directory policy denied the operation. Inspect the requested path/tool and project-approved checks. Do not reroute through another tool. |
| `check_not_approved` | Run `$claude:setup --project` to review and approve the exact named command. |
| `check_definition_changed` | A relevant script definition changed. Run `$claude:setup --project` to review and renew approval. |
| `check_outcome_unknown` | A previous attempt has no confirmed outcome. Inspect its process/output evidence. It is never replayed automatically. |
| `run_active` | Inspect the original task or `$claude:runs <run-id>`. Cancel that run if needed; do not start a second copy. |
| `retry_required` | Inspect `$claude:runs <run-id>`, then explicitly request `$claude:resume <run-id> --retry` if another model call is intended. |
| `session_unavailable` | No exact provider session was saved. Start a linked run; the plugin will not quietly create a replacement session in this run. |
| `awaiting_user` | A saved three-round checkpoint needs the user's actual continue/stop answer. Silence preserves it. |
| `settings_frozen` / `scope_frozen` | Start a new linked run to change backend/model/effort or captured inputs. |
| `model_mismatch` | The response did not identify the exact requested model. Inspect the saved run and check that your provider account supports that model. No completed reply is counted. |
| `result_integrity` | The saved result differs from its committed journal payload. Preserve both and investigate; do not render a guessed replacement. |
| `effort_mismatch` | The provider reported a different effort. Unreported effective effort is displayed as unknown instead. |
| `invalid_structured_output` / schema retry failure | Keep the partial evidence and exact provider failure. Assistant prose alone is not a valid completed result. |
| `budget_unsupported` / `budget_exhausted` | No supported enforcement, exhausted provider estimate or unknown prior usage. Raising a known exhausted budget requires an explicit larger resume override. Unknown usage stays unknown. |
| `run_busy` | A short state transaction is contended. Retry the state command after inspecting activity; no model/check is automatically repeated. |
| `journal_corrupt` | An interior record is invalid. Preserve artifacts; do not guess or discard history. A torn final write is repaired only on a later explicit write. |
| PowerShell policy/Add-Type denied | Windows containment cannot be established under host policy. No execution-policy bypass is used. This environment needs a compatible authorized runtime/policy before launching. |

`$claude:runs <run-id>` reads the saved status and answer without starting another Claude call. If an answer is truncated in the conversation, ask Codex to retrieve the complete saved answer for that run. Do not retry a model call just to recover display output.

After a host interruption, inspect `$claude:runs <run-id>` before requesting a retry. `$claude:cancel <run-id>` stops that run's owned processes while preserving available evidence.

State and transcripts can include the source content reviewed. Keep the local data directory private using normal OS permissions. Project checks execute already-approved project code with the host user's authority; their receipts do not claim sandboxing or production/deployment validation.
