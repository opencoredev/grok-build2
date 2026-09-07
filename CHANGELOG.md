# grok-build2

## 1.0.17

The first public release follows local preview 1.0.16 so existing installations can update without a downgrade.

### Minor Changes

- f5995e8: Route native image requests through the Codex MCP bridge. Recover eligible
  transient goal failures without executing partial tool calls. Preserve provider
  response identity and report MCP browser launch failures. Use the existing
  CLIProxyAPI credentials through the shared grok and grok2 launcher. Disable
  network telemetry in this fork. Add Tenki PR checks and versioned native archives.

### Patch Changes

- f5995e8: Install fork releases automatically in the background after the first archive
  install. Verify downloads and activate the launcher and binary together. Keep
  running sessions unchanged, support rollback, and retain an update opt-out.

Changesets adds release entries when the Version packages PR is created.
