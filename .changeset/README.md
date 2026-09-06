# Release notes

Run `bun run changeset` for a user-visible change. Select `grok-build2` and a
patch, minor, or major bump. Commit the generated note with the change.

The Version packages workflow collects these notes in a version PR. Merge that
PR after CI passes to build a GitHub release. This private package tracks the
binary version only. It is never published to npm.
