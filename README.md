# agent-workflows

Reusable, multi-agent development workflows. Tool-neutral source; ships to Claude Code as a plugin via a git-backed marketplace.

## What's here

| Workflow | Purpose |
|---|---|
| **autobuild** | Turn ready-to-build tickets into reviewed, locally-merged code. Conflict-aware parallel waves, model-tiered TDD workers in isolated worktrees, Opus review panel (code + security + design-conformance + rendered UI), supervisor-gated local merge. Two entry points: `/autobuild` (autonomous, overnight) and `/autobuild-one` (interactive, daytime). |

More workflows (backlog grooming, work-queue filling) will live alongside.

## Architecture: mechanism vs. policy

- **Mechanism** (this repo) — generic engine + skills. Zero repo knowledge.
- **Policy** (each consuming repo) — `.claude/autobuild.config.json` (ticket adapter, VCS mode, toolchain, labels, caps) + `.claude/autobuild.md` (conventions prose).

A new repo adopts a workflow by adding those two files and installing the plugin. No engine edits.

## Layout (source/build split)

```
src/         portable assets (prompts, skill prose, config schema, docs) — no Claude specifics
runners/     per-tool adapters; runners/claude holds the Workflow-API engine + skill wrappers
build/       assembles runners/claude + src into a Claude plugin under dist/
dist/        generated Claude plugin (marketplace.json + plugins/) — gitignored except when published
examples/    reference consumer configs (examples/carven)
```

The Claude plugin is one build target. Other runners (Codex, etc.) can be added under `runners/` against the same `src/prompts` without restructuring.

## Install (Claude Code)

```
/plugin marketplace add hytea/agent-workflows
/plugin install autobuild
```

Local dev loop: `npm run build -- --local` then `/plugin marketplace add <path-to-dist>`.

## Commands

| Command | Description |
|---|---|
| `/autobuild-one <key>` | Interactive single-bead build: design → TDD implement → adversarial review → supervisor-gated local merge. Daytime use. |
| `/autodesign <key> [--auto]` | Design one bead and cache the spec back to the bead's notes. Without `--auto` it runs an interactive brainstorm before caching; with `--auto` it drafts and caches autonomously. |
| `/autobuild` | Autonomous overnight loop. Packs conflict-free parallel waves from all designed+ready beads, builds each wave in isolated worktrees, merges locally. **Never pushes.** Parks blockers. One author touch sets the rate-limit anchor. |
| `/autobuild-issue <key>` | Autonomous single-issue engineering manager. Shepherds ONE issue from design through a clean, review-ready PR: designs if needed, builds via the engine, **pushes and opens a PR**, then drives internal adversarial review and CI to green. Stops only when the PR is clean and ready to merge. No waves, no wakeups. **Never auto-merges.** |

### Overnight safety invariants

- `vcs.mode: local-merge` — commits land on your local branch only; nothing is pushed to remote.
- Blocker beads are parked (labeled, skipped) rather than aborting the run.
- A single author-supplied anchor commit fixes the 1-hour rate-limit window; the engine never manufactures commits to shift it.
- All state is written to `dist-local/` (gitignored); nothing leaks to `src/` or `runners/`.

Full design: `src/docs/autobuild-design.md`.

## Design

See `src/docs/` for the full design spec.
