# Repository Rules

- `package.json` is the only version source. Keep the lock file and changelog synchronized with it.
- A request containing four or more distinct features or optimizations requires an automatic version bump before edits.
- Feature bundles increment the minor version. Fix-only bundles increment the patch version unless the user specifies a version.
- Create and verify a pre-change ZIP snapshot before any release upgrade.
- Preserve the legacy application ID and shared-memory identifiers unless an explicitly approved migration replaces them.
