---
name: runs
description: Inspect saved Claude runs, live status, exact Claude replies and complete Markdown answer segments without changing run state.
---

# Inspect CCA runs

Use this plugin's `scripts/cca.mjs runs [run-id]`, resolving the plugin root two directories above this skill folder. With no ID, list saved runs; use the exact selected ID to inspect one.

`--round N` retrieves a completed round and `--segment N` retrieves an ordered answer segment. Preserve the returned verdict/answer wording when displaying Claude's response. Activity excerpts are explicitly marked; they are not the full transcript. Run journals and answer Markdown paths remain available locally.

This operation is a pure read. A dead owner may produce a derived interrupted status without changing the journal. Do not start another model call, mark viewed, migrate roots or cancel work while inspecting it.
