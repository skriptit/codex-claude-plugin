# Third-party dependencies

The MIT license in this repository covers this project's original code and documentation. Dependencies and external services retain their own licenses and terms.

Release archives contain this project's source or compiled runtime and dependency manifests. They do not contain `node_modules`, Claude Code executables, or other third-party package implementations. Installation downloads the locked dependencies from npm, including their upstream license files.

| Direct runtime dependency | Upstream terms |
| --- | --- |
| `@anthropic-ai/claude-agent-sdk` | Anthropic's package is subject to its [legal agreements](https://code.claude.com/docs/en/legal-and-compliance); it is not covered by this project's MIT license. See the installed package's `LICENSE.md` and `README.md`. |
| `@modelcontextprotocol/server` | Its distributed `LICENSE` describes an Apache-2.0 transition with remaining MIT contributions. Read that file for the applicable terms; package metadata alone does not describe the transition. |
| `zod` | MIT; see the installed package's `LICENSE`. |

Transitive dependencies and development tools also retain their own licenses, distributed with those packages. Exact versions and registry integrity hashes are recorded in `package-lock.json`.

Codex and Claude Code are separate products with their own access requirements and terms. This project is independently maintained and is not affiliated with or endorsed by OpenAI or Anthropic.
