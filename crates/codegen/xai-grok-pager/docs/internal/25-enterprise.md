# Feature controls

These are the registered boolean keys in `[features]`. The registry in
`xai-grok-config-types/src/registry.rs` is the source of truth. The documentation
test checks that each registered feature appears here.

| Key | Controls |
| --- | --- |
| `session_search` | SQLite session search |
| `lsp_tools` | Language-server navigation |
| `web_fetch` | Web fetch tool |
| `session_recap` | Session recaps |
| `ask_user_question` | User question tool |
| `voice_mode` | Voice input |
| `write_file` | File writing tool |
| `feedback` | Feedback prompts |
| `feedback_trace_card` | Trace consent card |
| `turn_summary` | Dashboard turn summaries |
| `cancel_rewind` | Prompt restore on early cancellation |
| `compaction_verbatim_input` | Verbatim compaction input |
| `two_pass_compaction` | Background first-pass compaction |
| `backend_tools` | Server-side search tools |
| `auto_wake` | Continuation after background work |
| `subagent_worktree_snapshot` | Saved subagent worktrees |
| `active_agent_messages` | Messages to active descendants |
| `repo_status_in_system_prompt` | Repository status in the prompt |
| `dock` | Consolidated activity panel |

This fork disables network telemetry independently of these feature controls.
Enabling a feedback feature does not enable network telemetry.
