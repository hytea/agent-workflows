# Carven Autobuild — Design

**Date:** 2026-06-19
**Status:** Approved (design phase)
**Author:** andrew.hyte + Claude

## Goal

Replace the prior Software Factory and LangGraph experiments with a beads-native, multi-agent system that turns `ready-to-build` beads into reviewed, locally-merged code while the author is asleep. The author designs and orders beads during the day, tags them, and an autonomous overnight supervisor drains the queue in conflict-aware parallel waves under a supervisor/advisor pattern.

Adapted from a prior Jira/glab `ticket-autobuild` workflow. Rather than swapping one set of hardcoded tools for another, the engine and skills are made **fully repo-agnostic**: all repo-specific policy (ticket system, VCS integration, toolchain, labels, branch, ports, push permission) lives in a per-repo config file. Carven is the first consumer, supplying a `bd` + local-merge config.

## Genericness — mechanism vs. policy

The system separates **mechanism** (repo-agnostic) from **policy** (per-repo config):

- **Mechanism** — `autobuild.js` (the engine) and the supervisor skills. Zero repo knowledge. They read the config, substitute `{placeholder}` values into command templates, and run them. Adding a new repo or ticket system never edits mechanism.
- **Policy** — two per-repo files:
  - `.claude/autobuild.config.json` — structured contract (schema-validated at launch): ticket-adapter command templates, VCS-adapter mode, toolchain commands, base branch, label names, dev-server port base, `pushAllowed` flag, brand-guide path, caps.
  - `.claude/autobuild.md` — short prose profile of repo conventions that don't fit structured config (loaded into agent RULES).

**Adapters are command templates, not engine code branches.** e.g. `ticket.ready: "bd ready --label {readyLabel} --json"`, `ticket.claim: "bd update {key} --claim"`, `vcs.mode: "local-merge"`. The engine is a pure template-runner with no per-system `if` ladder; supporting Linear or `gh` PRs later is a config entry, not an engine edit. The config is validated against a schema at launch (author present) so a malformed config fails loudly, never mid-wave at 3am.

## Non-goals

- No deploys overnight. The supervisor merges to a **local** `development` branch only. It never `git push`es and never triggers CI/CD. The author inspects and pushes in the morning.
- No design work by the author beyond writing clear beads with acceptance criteria. Decomposition into chunks is the system's job.
- Not a replacement for the role-matrix skills (`junior-dev`, `level-1`, `pr-advisor`); those remain for human-driven sessions. Autobuild is the unattended/parallel path.

> **Naming note (see Distribution):** the skills are generic and ship in the `hytea/agent-workflows` plugin as `/autobuild` (overnight) and `/autobuild-one` (daytime). This spec was first drafted with `/carven-autobuild` and `/carven-bead`; read those as the generic skills below. Carven specificity lives only in its config + profile, not skill names.

## Architecture — generic mechanism + per-repo policy

| Artifact | Repo-agnostic? | Type | Role |
|---|---|---|---|
| `.claude/workflows/autobuild.js` | **Yes** | Workflow engine | Build-one-ticket core: design → setup → implement → review → fix → return verdict. Takes `autonomous` flag + config. **Never merges, never pushes** (merge is supervisor authority). |
| `/carven-autobuild` | Thin wrapper | Supervisor skill (Opus) | **Fully autonomous** — conflict-aware wave loop, rate-limit wakeups, auto-merge-clean-locally, parks blockers. Reads Carven config. Overnight. |
| `/carven-bead` | Thin wrapper | Supervisor skill (Opus) | **Interactive** — one bead/epic; asks at design forks; author decides merges. Reads Carven config. Daytime. |
| `.claude/autobuild.config.json` | No (this IS Carven policy) | Config | Ticket-adapter templates (`bd`), VCS mode (`local-merge`), toolchain, base (`development`), labels, port base, `pushAllowed:false`, brand-guide path, caps. |
| `.claude/autobuild.md` | No | Prose profile | Carven conventions loaded into agent RULES (brand guide on UI, never push, links to CLAUDE.md). |

The engine carries zero Carven knowledge. The `carven-`prefixed skills are thin, config-driven entry points (the author's muscle-memory invocations); the same engine serves any repo with its own config.

Composition uses the Workflow engine's `workflow()` (one nesting level): the overnight supervisor calls `autobuild.js` per ticket within a wave. The engine's internals are inline phases (no further nesting), which respects the one-level limit.

The shared engine is the single source of build/review/fix logic. The two skills differ only in autonomy, looping, and merge authority. No duplicated implement/review logic.

## Shared workflow engine: `autobuild.js`

The engine reads `config` (the parsed `.claude/autobuild.config.json`) from `args` and substitutes its values everywhere below. Phase prompts reference `config.ticket.*` command templates (for `bd show`, claim, append-notes, label, close), `config.toolchain.*`, `config.base`, and `config.labels.*` — never literals. Carven's concrete values appear in the Config section below; the prose here is repo-agnostic.

One pipeline per ticket. When invoked per-wave by the supervisor, beads run concurrently (capped by the engine's concurrency limit). Phases:

1. **design** (Opus, scoped). Reads the bead (`bd show <key>`) + repo. Writes a dated spec to `docs/superpowers/specs/`. Returns `{spec, specPath, chunks[], surface, escalations[]}`.
   - `chunks`: ordered, dependency-respecting, each tagged `haiku` (cut-and-dry) / `sonnet` (normal) / `opus` (subtle/security-critical), with target files + self-contained TDD instructions.
   - `surface`: the predicted set of **directories** the work will touch (union of `chunks[].files` reduced to dirs). Used by the supervisor for conflict-aware wave packing.
   - `escalations`: only genuine architectural/execution forks where the right call is unclear. Default to letting Opus decide and document in the spec — usually empty.
   - **Bounded:** the designer is time/effort-scoped and must produce chunks or escalate. It does not sprawl into hours of exploration.
   - **Hoisting:** the overnight supervisor runs this exact design phase as a pre-wave pass (so it can read `surface` for conflict-aware packing), then passes the cached `{spec, chunks, surface}` back into the per-bead build run, which skips re-designing. The interactive `/carven-bead` skill does not hoist — it lets the build run perform design inline. Either way it is the same design agent, run once per bead.
2. **setup** (haiku). Creates a **git worktree** off `origin/development` for this bead (`isolation: 'worktree'`). Commits the spec. Transitions the bead to `in_progress` (idempotent — supervisor already claimed it). Reports branch + HEAD sha. Does not implement.
3. **implement** (sequential chunks, model per chunk, TDD). For each chunk: failing test first, then implement to green. **Per-chunk commit is mandatory** — `git add` ONLY the chunk's files (never `git add -A`), conventional message referencing the bead key + chunk id. This per-chunk commit is the restart checkpoint (see Rate-limit resume).
4. **review** (parallel fan-out). Always: **code** (Opus — correctness, bugs, tests, conventions), **security** (Opus — authz default-deny, secret/token handling, injection/SSRF, over-broad scopes, data exposure), **design-conformance** (Opus — did it build the right thing per the spec + bead acceptance criteria). Conditionally, when `git diff --name-only origin/development...HEAD` touches `apps/web`: **UI reviewer** (Opus + Playwright MCP — renders the affected page(s) and inspects actual layout: centering, clipping, overflow, brand-guide adherence).
   - **UI review is serialized across the wave** (shared Playwright browser; concurrent UI reviews would collide on tabs). Code/security/design-conformance fan out freely.
   - UI review runs the worktree's dev server in the background on a **supervisor-allocated unique port** (parallel worktrees cannot all bind 3000/4000), navigates via Playwright, screenshots, then tears the server down. Background launch only (never a blocking dev server).
   - Each reviewer returns the review schema `{approved, summary, blocking[]}`. A reviewer that errors returns `null` and is treated as **NOT clean** — never a pass.
5. **fix loop** (Opus, ≤ `maxFixRounds`). Fixes blocking findings, commits (relevant files only), re-runs the gate until green. Re-reviews. Exits when clean or rounds exhausted.
6. **return** `{key, branch, worktreePath, specPath, verdict: 'clean' | 'blocked', findings[]}`. **The workflow never merges.** Merge authority lives with the supervisor.

### Review schema

```
{ approved: boolean,
  summary: string,
  blocking: [{ severity: 'critical'|'high'|'medium', file: string, issue: string, fix: string }] }
```

## Config contract: `.claude/autobuild.config.json`

Schema-validated at launch. Repo-agnostic engine, repo-specific values. Carven's values shown:

```jsonc
{
  "base": "development",
  "pushAllowed": false,                       // local-merge only; no CI/CD trigger overnight
  "ticket": {                                 // adapter: command templates with {placeholders}
    "system": "bd",
    "ready":  "bd ready --label {readyLabel} --json",
    "show":   "bd show {key} --json",
    "claim":  "bd update {key} --claim",
    "note":   "bd update {key} --append-notes {text}",
    "label":  "bd update {key} --add-label {label}",
    "close":  "bd close {key}",
    "syncPull": "bd dolt pull",
    "syncPush": "bd dolt push"
  },
  "vcs": { "mode": "local-merge" },           // alt: "gh-pr" | "glab-mr"
  "toolchain": {                              // any may be "" to skip
    "install": "npm install",
    "build":   "npm run build:web",
    "test":    "<project test cmd>",
    "lint":    "<eslint cmd>",
    "format":  "<prettier cmd>",
    "formatFix": "<prettier --write cmd>"
  },
  "labels": { "ready": "ready-to-build", "parked": "needs-human" },
  "ui": { "devServerPortBase": 4100, "appGlob": "apps/web/**" },
  "brandGuidePath": "<path to brand guide doc>",
  "caps": { "concurrency": 4, "maxFixRounds": 2, "maxTicketsPerRun": 20 }
}
```

Toolchain command strings are confirmed against the manifest at launch (the supervisor may auto-fill `""` slots from `package.json` scripts, but config wins when set).

RULES string (assembled by the engine from config + `.claude/autobuild.md`, passed to every agent): operate ONLY inside the assigned worktree (absolute paths or `git -C`); base branch is `config.base`; TDD mandatory; match existing conventions; use the `config.ticket.*` templates for ticket state; if `config.pushAllowed` is false, **never `git push`**; `git add` only the current chunk's files; apply repo conventions from `.claude/autobuild.md` (for Carven: brand guide on any UI work, merge to local `development` only).

> In both skills below, every `bd ...` command shown is the **resolved Carven form** of a `config.ticket.*` template. The generic engine and skills issue the template; only Carven's config maps it to `bd`. Substituting a Linear/Jira config changes these commands without touching the skills.

## `/carven-bead` (daytime, interactive)

One bead or epic. Steps:
0. Load + schema-validate `.claude/autobuild.config.json`; load `.claude/autobuild.md`.
1. Resolve bead(s) via `bd show`; if epic, expand children; determine dependency order.
2. Scout repo path, base branch, toolchain.
3. Call `autobuild.js` with `autonomous: false`.
4. If the design phase returns `escalations`, surface ONLY those via `AskUserQuestion` (lead with the recommended option). Fold answers into the spec (re-commit). Nothing clear-cut goes to the author.
5. On `clean` verdict, ask the author whether to merge and whether to push. Author decides. Default: merge to local `development`, no push.
6. Report per-bead outcome, spec path, branch.

## `/carven-autobuild` (overnight, autonomous)

### Rate-limit anchor (established once, at launch, author present)

The 5-hour rolling reset is not exposed as a clean tool value. At launch (author present), the supervisor establishes a **window anchor** and writes it to a state file:
- **Preferred:** author pastes the reset time from `/usage` (a Claude Code TUI panel an agent cannot invoke directly).
- **Fallback:** Playwright MCP scrape of `claude.ai/settings/usage` using the author's authenticated browser session (auth cannot be established unattended at 3am, so this happens once at launch).
- Subsequent windows are derived by rolling forward: `reset(N) = anchor + N × 5h`. No auth needed at wakeup time.

State file (under the session/project dir) holds: `{ anchorResetISO, lastRunId, wave, cap, claimedKeys[] }`.

### Loop (per iteration)

0. (Once, at launch) Load + schema-validate `.claude/autobuild.config.json`; load `.claude/autobuild.md`; establish the rate-limit anchor.
1. `bd dolt pull`. Compute the next reset from the anchor and **arm `ScheduleWakeup(reset + 60s)` immediately**, before any work — so the moment a rate limit hits mid-wave, the resume is already scheduled for the soonest possible time. If the loop finishes naturally, the pending wakeup is harmless/ignored.
2. **Query** `bd ready --label ready-to-build` → candidate set.
3. **Design pass** (parallel scoped Opus): design each candidate, capturing `surface` (directory set) and caching the spec. A candidate whose design escalates → park `needs-human` (label + escalation note), drop from this run.
4. **Pack wave** (conflict-aware): reduce each candidate's surface to its set of touched **directories**; greedily select candidates whose directory-sets are **pairwise disjoint**, up to the concurrency cap. Overlapping candidates are held for later waves (overlapping work runs across successive waves, sequentially relative to one another; disjoint work runs in parallel now).
5. **Atomically claim** only the packed beads: `bd update <key> --claim` (sets assignee + in_progress in one op; prevents claim races).
6. **Build the wave** in parallel via `autobuild.js` (autonomous: true, cached design passed in so design is skipped). Persist the workflow `runId` to the state file as soon as it starts.
7. **Merge barrier** (supervisor authority): serially merge each `clean` ticket's worktree branch into **local `development`** (`git checkout development && git merge <branch>` — **no push**), choosing order, rebasing/re-testing as needed. A real `git merge` conflict (unforeseen surface overlap) → park that ticket `needs-human` with a note; the supervisor does NOT guess a resolution. `blocked` tickets → branch left in place, bead labeled `needs-human`, findings written to bead notes.
8. **Re-query** `bd ready` (beads whose blockers just closed now appear) and repeat from step 2 until no ready beads remain or a max-bead cap is hit.
9. **Clean exit:** final `bd dolt push` of state.

### Rate-limit resume

A Workflow's in-flight `agent()` calls cannot be paused; when the process aborts on a rate limit, running sub-agents die. The resume mechanism is `resumeFromRunId`, which replays cached completed agents instantly and re-runs the first incomplete agent from scratch.

- On rate-limit abort mid-wave: the supervisor exits. The wakeup is already armed (step 1).
- On wakeup: reload state file → re-invoke the workflow with `resumeFromRunId = lastRunId`. Completed agents return instantly from cache. Any agent that was mid-flight restarts; because implement-agents commit **per chunk**, a restarted implementer sees its prior commits in the worktree and continues from the next uncommitted chunk. Then re-arm the next window's wakeup and continue the loop.
- The real checkpoint is **bead state + committed worktree progress**, not workflow memory. Per-chunk commit discipline is what makes mid-flight restart safe.

## Labels

Label names come from `config.labels` (Carven values shown):
- `ready` = `ready-to-build` — author tags beads ready for autonomous build.
- `parked` = `needs-human` — supervisor parks beads that escalated at design, stayed blocked after fix rounds, or hit an unforeseen merge conflict. Findings/escalations in bead notes.

## Safety properties

- **No overnight deploy:** local merges only, no `git push`, no CI/CD trigger (push to `development` is the dev-deploy trigger per CLAUDE.md).
- **No claim races:** atomic `bd update --claim`.
- **No 3am merge guessing:** conflict-aware packing minimizes conflicts; genuine conflicts park rather than auto-resolve.
- **No false clean:** an errored reviewer is treated as not-clean; both/all reviewers must return.
- **No file-collision corruption:** per-bead worktrees isolate parallel writers.
- **Restart-safe:** per-chunk commits + `resumeFromRunId`.
- **Bounded designer:** time/effort-scoped, must chunk or escalate.

## Distribution — `hytea/agent-workflows`

The engine and skills do **not** live in the Carven repo. They live in a standalone, tool-neutral source repo `hytea/agent-workflows`, distributed to Claude Code as a plugin via a git-backed marketplace. This satisfies: reuse across work + personal projects, improvements propagating to every machine via `/plugin update`, and room for future supplementary workflows (backlog groomer, work-queue filler) in the same repo.

### Source/build split (tool-agnostic intent)

Authoring is tool-neutral; the Claude plugin is one **build target**, not the native layout. Other runners (Codex, etc.) can be added later without restructuring source.

- `src/` — portable assets, no Claude specifics:
  - `prompts/` — standalone prompt templates (design, implement, code-review, security-review, design-conformance, ui-review, merge) as `.md` with `{placeholder}` substitution. These are the genuinely portable core.
  - `config.schema.json` — the JSON Schema for `autobuild.config.json` (used for launch-time validation).
  - `skills/` — skill prose (tool-neutral body text).
  - `docs/` — design specs.
- `runners/claude/` — the Claude-specific adapter: `autobuild.js` (uses the `Workflow` API: `agent`/`parallel`/`pipeline`/`phase`/`resumeFromRunId`) and skill frontmatter wrappers. **This layer is per-tool by nature** — the orchestration API is not portable; a future `runners/codex/` would wrap the same `src/prompts` in its own runner. "Tool-agnostic" = portable prompts/config/specs + per-tool runner adapters, honestly scoped.
- `build/` — script that assembles `runners/claude` + `src` into a Claude plugin under `dist/` (`.claude-plugin/marketplace.json`, `plugins/autobuild/{skills,workflows}`). Supports a **local dist target** so a consuming repo can `/plugin marketplace add <local path>` during development (fast loop, no GitHub round-trip) as well as the published GitHub marketplace.

### Plugin contents

One marketplace, one `autobuild` plugin (grows later). Skills are **generic** — no `carven-` prefix:
- `/autobuild` — autonomous overnight supervisor.
- `/autobuild-one` — interactive daytime single-bead/epic supervisor.
- `autobuild.js` — the workflow engine.

Carven (and any consumer repo) is just a client: it carries `.claude/autobuild.config.json` + `.claude/autobuild.md` in its own repo and installs the plugin. The skills read whatever config the current repo provides. (The `/carven-*` names used earlier in this spec are superseded by the generic `/autobuild`, `/autobuild-one`; Carven specificity now lives entirely in its config + profile, not in skill names.)

## New-repo onboarding (genericness payoff)

A new repo adopts autobuild by adding two files — no engine or skill edits:
1. `.claude/autobuild.config.json` — its ticket adapter, VCS mode, toolchain, labels, caps.
2. `.claude/autobuild.md` — its conventions prose.

Then it invokes `autobuild.js` (directly or via its own thin skill). Carven ships both files as the reference implementation.

## Open implementation details (to resolve in the plan)

- Exact shell commands for the Carven toolchain (build/test/lint per app) — fill `config.toolchain` from the manifest at plan time.
- Port allocation scheme for parallel dev servers during UI review (`config.ui.devServerPortBase` + wave index).
- State-file location and final schema.
- How the supervisor reads the rate-limit anchor at runtime (state file populated at launch via `/usage` paste or Playwright scrape).
- Config JSON schema for launch-time validation.
- `vcs.mode` adapter implementations beyond `local-merge` (deferred until a second repo needs `gh-pr`/`glab-mr`; only `local-merge` built now).
