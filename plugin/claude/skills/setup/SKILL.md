---
name: setup
description: Configure Claude runtime, backend, model and effort defaults, inspect compatibility, or approve named project validation commands.
---

# Configure Claude

Resolve the plugin root two directories above this skill folder and use `scripts/codex-claude.mjs`. First run `node <launcher> setup --check --cwd <workspace>` to inspect current defaults and prerequisites. This read does not install a missing runtime or modify settings.

Apply choices already given by the user or stored in `configuration.defaults` / `resolved`. A missing runtime is not a missing backend choice: install the required runtime while preserving saved defaults. Do not ask the user to reconfirm CLI/Fable 5.1/high when those choices are already recorded. Otherwise ask only for the consequential missing choice, showing the current default or suggesting CLI/Fable 5.1/high on a first setup. CLI uses installed Claude authentication; SDK requires ANTHROPIC_API_KEY outside the repository. Never request a key in chat or copy subscription tokens into SDK configuration.

If the host's question widget cannot be answered, accept the user's ordinary chat reply (for example `CLI`) as the answer. Do not require Alt+Up, a particular widget, or another confirmation after an unambiguous text answer. Do not call prerequisites ready if the check says `setup_required` or reports a provider error.

Run `setup --backend cli|sdk --model ID --effort LEVEL` to install the versioned runtime and save user defaults. `--project --cwd PATH` writes project defaults; optional `--workflow decide|review` narrows them to a workflow. Do not modify global Codex permission profiles, install services or configure fallback models.

For project checks, use the candidate list from `setup --check`. Show each exact executable, argument array, directory, script definition and purpose. Only approve checks actually selected/authorized by the user, using `setup --project --approve-check NAME` (repeatable). For an explicitly requested custom command, write its reviewed definition to a temporary JSON array and pass `--checks-file`; definitions follow the runtime's Check schema. Approvals are stored outside the repository. Changed definitions need renewed approval. Do not approve an entire candidate list just because it was discovered.

Checks execute project code and can produce artifacts. Use current host permissions; report blocked prerequisites instead of applying blanket escalation. A setup check does not establish authenticated backend or native host behavior. If SDK credentials are unavailable, report that SDK operation remains unverified in the current environment.
