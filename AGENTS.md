# agent-workflows — publishing the autobuild plugin

How the `autobuild` Claude Code plugin is built, versioned, and published. The
plugin source is tool-neutral (`src/` + `runners/`); the build assembles it into
a Claude plugin tree that a local marketplace serves.

## Publish target (how it actually ships)

The marketplace is registered as a **local directory**, not the git repo:

- `~/.claude/plugins/known_marketplaces.json` → `agent-workflows` →
  `{ source: "directory", path: ".../agent-workflows/dist-local" }`
- So "publishing" = rebuild `dist-local/`, then point Claude Code at it.
- `dist-local/` (and `dist/`) are **gitignored** — there is nothing to git-push
  for the plugin itself. The marketplace reads the built files off disk.
- Installed versions cache under `~/.claude/plugins/cache/agent-workflows/autobuild/<version>/`.
  Old versions linger (e.g. `0.1.0` is `.orphaned_at`); the active one is in
  `~/.claude/plugins/installed_plugins.json` under `autobuild@agent-workflows`.

## Publish steps

1. Land the change on `main` (PR merge). Bump `runners/claude/plugin.json`
   `version` for any shipped change (this is what the cache keys on).
2. Build the local marketplace from current `main`:
   ```
   npm run build -- --local      # writes dist-local/  (or: node build/build.js --local)
   npm test                      # 63+ tests must pass; build must be clean
   ```
3. Tag + GitHub release on the merge commit:
   ```
   git tag -a vX.Y.Z <merge-sha> -m "autobuild vX.Y.Z — <summary>"
   git push origin vX.Y.Z
   gh release create vX.Y.Z -R hytea/agent-workflows --title "autobuild vX.Y.Z" --notes-file <notes> --latest
   ```
4. **In the Claude Code TUI** (these are `/plugin` commands — not runnable from a
   shell/agent):
   ```
   /plugin marketplace update agent-workflows
   /plugin update autobuild
   ```
   Confirm `/plugin` shows `autobuild@agent-workflows` at the new version.

## Gotcha — stale cached version

A past session validated config against an orphaned `0.1.0` schema, which wrongly
rejected the `labels.designed` key that `0.2.0`+ allows. After updating, if an
autobuild command fails config validation on a valid config, confirm the command
resolved the **current** version's `lib/validateConfig.js` (the newest path under
`~/.claude/plugins/cache/agent-workflows/autobuild/<version>/`), not an orphaned
older one.

## Layout reminder

```
src/         portable assets (prompts, config schema, libs) — no Claude specifics
runners/     per-tool adapters; runners/claude holds the Workflow engine + commands
build/       assembles runners/claude + src into the plugin tree
dist/        published plugin (gitignored)         — `npm run build`
dist-local/  LOCAL marketplace source (gitignored) — `npm run build -- --local`
```

Build-time inlining: `/*__PROMPT:name__*/` and `/*__SCHEMA:name__*/` markers in
the templates are replaced from `src/prompts/` and `src/lib/designSchema.js` —
workflow script bodies cannot `require`, so shared assets are injected at build.

## Current

- Latest release: **v0.3.0** — overnight supervisor + `/autobuild-issue`
  (autonomous single-issue → review-ready PR). Release:
  https://github.com/hytea/agent-workflows/releases/tag/v0.3.0
