# Handoff — Autobuild overnight: follow-up + finish the autonomous loop

Paste this into a FRESH Claude session (in either repo as noted). It preserves the in-flight follow-up work and the remaining implementation. Date of handoff: 2026-06-20.

## Where things stand

Two repos:
- **`hytea/agent-workflows`** (`/Users/heber/Documents/GitHub/agent-workflows`) — the generic autobuild plugin source. Work branch `feat/autobuild-overnight` @ `7252f85`, pushed to origin, NOT merged to main. 42/42 tests green. Built locally to `dist-local/`.
- **`carven`** (`/Users/heber/Documents/GitHub/carven`) — consumer. Local `development` @ `5da47f6` carries 6 autobuild-merged beads (NOT pushed; `origin/development` still `2a6242e`). Consumer config on branch `chore/autobuild-consumer-config`.

The plugin (0.2.0) ships 3 workflows (`autobuild`, `autodesign`, `autobuild-supervisor`) + 3 commands (`/autobuild-one`, `/autodesign`, `/autobuild`) + 5 libs (`validateConfig`, `config.schema.json`, `designNotes`, `packWave`, `rateLimit`).

**What has actually run live:** `/autodesign` (autonomous), the single-ticket engine, and a manual bead-by-bead overnight drive of epic `carven-5m3e` (6/7 merged to local development, 1 parked). The full `/autobuild` slash-command loop (claim→pack→merge-barrier→cron-resume as ONE autonomous run) has NEVER run end-to-end — only its pieces, driven manually via the Workflow tool.

**Read first for full context:** the project memory `project_autobuild_overnight_system.md` (in the carven memory dir) and `docs/plans/2026-06-19-autobuild-overnight-supervisor.md` in agent-workflows. The overnight run log is `/tmp/overnight-run.md` (ephemeral — copy out if needed).

## Critical environment facts (don't relearn these the hard way)

- The plugin's slash-commands (`/autobuild`, `/autodesign`) are USER-invoked; a Claude turn cannot call another plugin's slash-command. To exercise workflows from a turn, invoke them via the Workflow tool: `Workflow({ name: 'autobuild:autobuild', args })` (NAMESPACED name — bare `autobuild` does not resolve) or `Workflow({ scriptPath: '<dist-local path>/workflows/autobuild.js', args })`.
- `Workflow({ name: ... })` resolves to the INSTALLED plugin. `dist-local` is only installed when the user runs `/plugin marketplace add <dist-local path>` + `/plugin install`. If you change engine/prompt source, rebuild (`node build/build.js --local`) AND the user must REINSTALL for the `name:` path to pick it up; the `scriptPath:` path runs the file directly but its nested `workflow('autobuild:autobuild')` still resolves to the INSTALLED engine.
- Workflow scripts: plain JS, top-level await/return + `export const meta` (NOT node -c parseable); forbid `Date.now()`/`Math.random()`/argless `new Date()`. Verify syntax with the AsyncFunction-wrap check used in `test/promptSubstitution.test.js`.
- `bd show --json` / `bd ready --json` return ARRAYS (use `result[0]` / iterate), not objects.
- Engine RULES carry a DESTRUCTIVE-OPERATION GUARDRAIL (no `reset --hard`/`rm -rf`/destructive DB without audit; escalate instead). HONOR IT YOURSELF too: never `git reset --hard` with unrelated dirty files present (this destroyed an uncommitted AGENTS.md earlier — use `--soft`/`--mixed` or stash, and inspect `git status`+`stash list`+`reflog` first).
- All merges are LOCAL only. NEVER `git push` the carven work. `pushAllowed: false`.

## TRACK A — finish the overnight-run follow-ups (carven repo)

1. **Rebase + land the parked bead `carven-5m3e.7`.** It built clean but its merge into `development` conflicted on `apps/web/src/pages/SignupSheetDetail.tsx` (3rd same-file bead; region overlap). Its branch `carven-5m3e-7-paid-email-note` and worktree `/private/tmp/carven-5m3e-7-paid-email-note` (@ `ece10ee`) are PRESERVED. Rebase the branch onto current local `development` (`5da47f6`), resolve the overlap (the change is a small informational note in the header/actions area that confirmation emails need a paid plan), then `git merge --no-ff` into local `development`. Close the bead (`bd close carven-5m3e.7`), remove its `needs-human` label, tear down the worktree+branch, `bd dolt push`. Do NOT push git.
2. **Review the 6 already-merged beads** on local `development` before any push decision. They had code-review + type-check only — the 5 frontend ones had NO rendered UI review (Plan 4 not built). Spot-check `apps/web/src/pages/{CreateSignupSheet,SignupSheetDetail,SignupSheetPublic}.tsx` for the merged changes; run `npm run test -w apps/api -- signup` (expect 7/7) and `npm run build -w apps/web` (expect green). The user decides whether/when to push `development`.
3. **Reapply the lost `AGENTS.md` change** if the user supplies it (an uncommitted edit was destroyed by a `reset --hard` during cleanup; unrecoverable from git).

## TRACK B — finish + harden the autonomous loop (agent-workflows repo, branch feat/autobuild-overnight)

The loop exists as prose in `runners/claude/commands/autobuild.md` but has never run as one autonomous unit. Goals: make it actually runnable end-to-end and close the known gaps. Suggested order:

1. **Live-verify the fixes via reinstall.** Ask the user to reinstall the plugin from `dist-local`, then drive a SMALL real run (2–3 tiny disjoint beads tagged `ready-to-build`) and confirm: (a) zero commits leak to local `development` (worktree-isolation fix); (b) worktrees fork off LOCAL `development` and compound (fork-off-local fix — build bead B after merging bead A, confirm B sees A's changes); (c) an agent asked to do something destructive parks instead of doing it (guardrail). Prefer backend beads (vitest coverage) for signal.
2. **Verify the rate-limit resume path end-to-end (the biggest untested piece).** Confirm `CronCreate({recurring:false,durable:true})` fires `/autobuild --resume`, that the state file (`$(git rev-parse --git-path autobuild)/state.json`) round-trips `{anchorResetISO,lastRunId,wakeupJobId,...}`, and that re-invoking with `resumeFromRunId` replays cached agents + continues. The `runId` IS surfaced in every Workflow launch result (confirmed) — wire the command to capture it. This has only been reasoned about, never run.
3. **Exercise the full `/autobuild` loop as ONE autonomous run** (not manual bead-by-bead): query ready → ensure-designed (autodesign + writeback) → packWave → claim only packed → supervisor builds wave → merge barrier (local, park conflicts) → re-query → durable-cron wakeup. Use a small tagged set. This is the integration test that has never happened.
4. **Plan 4 — rendered UI review: DONE (commit bb8907c), needs a LIVE render to confirm.** Implemented: the review fan-out conditionally appends a Playwright UI reviewer when a cheap `touchesUI` agent finds the diff matches `config.ui.appGlob`. It background-launches the worktree dev server on `config.ui.devServerPortBase` (+ `args.waveIndex`), renders affected pages, inspects centering/clipping/overflow/brand, tears down. Prompt `src/prompts/ui-review.md`; build test asserts it ships + is gated. STILL TO VERIFY LIVE: build a UI bead through the engine and confirm the reviewer actually starts the dev server, renders via Playwright MCP, and returns findings — only build/syntax/test-level verified so far, never rendered a real page. Cross-wave serialization of the shared browser is still a supervisor concern (the engine runs one ticket's UI review at a time; the supervisor must not run two UI reviews concurrently — not yet enforced).

## Known limitations to fix or decide on (surfaced by the run)

- **packWave directory-granularity is conservative** for feature work clustering in `apps/web/src/pages` (one dir → most FE beads see each other as overlapping → mostly serial waves). Consider file-granularity packing OR rely on scope-fenced decomposition (assign each same-file bead a disjoint REGION in its instructions — this worked: `.3`+`.5` auto-merged, only `.7` overlapped). Decide which.
- **Decomposition must assign disjoint regions** for same-file beads, or they conflict on merge (that's what parked `.7`). Whatever materializes child beads from an epic should encode region scope in each bead's instructions.
- **`vcs.mode` adapters beyond `local-merge`** (`gh-pr`, `glab-mr`) are still unbuilt — only `local-merge` exists. Defer until a second consumer needs them.

## Progress (updated 2026-06-20, resumed session)
- TRACK A DONE: `carven-5m3e.7` rebased onto local `development` (trivial both-hooks conflict resolved), merged (`ca2a4d7`), epic `carven-5m3e` auto-closed, all 7 children closed, web build green, beads pushed. carven `origin/development` still `2a6242e` (nothing pushed).
- TRACK B item 4 (Plan 4 UI review) DONE at commit `bb8907c` — see updated item 4 above; live render still unverified.
- agent-workflows branch `feat/autobuild-overnight` @ `bb8907c`, 43/43 tests, pushed. ~20 commits beyond main.

## Definition of done (REMAINING — all gated on a plugin REINSTALL or fresh ready-to-build beads)
- Reinstall the plugin from `dist-local` so the `name:`-resolved engine carries every fix (worktree-isolation, fork-off-local, namespaced call, guardrail, UI reviewer). Until then only the `scriptPath:` path runs the latest engine.
- One full autonomous `/autobuild` run on a small tagged set using the loop's OWN orchestration (anchor → cron arm → query → design → packWave → claim → supervisor wave → merge barrier → re-query) — not the manual bead-by-bead drive used so far. Confirm zero leaks, fork-off-local compounding, and conflict-parking.
- Verify the durable-cron rate-limit resume fires `/autobuild --resume` and `resumeFromRunId` continues the wave (never run live).
- Render a real UI bead through the engine to confirm the UI reviewer starts the dev server + renders via Playwright.
- Merge-to-main is the user's call. Nothing in carven pushed without the user's say-so.
