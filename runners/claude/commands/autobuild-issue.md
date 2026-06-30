---
description: Autonomous single-issue engineering manager. Shepherds ONE issue from design through a clean, review-ready PR — designs if needed, builds via the engine, opens a PR, drives internal review and CI to green, and stops only when the PR is clean and ready to merge. No waves, no wakeups. Never auto-merges.
---

# /autobuild-issue

Drive ONE issue end-to-end, autonomously, like an engineering manager: you know what the issue needs, what good work looks like, and what "done" means. You spawn expert subagents (via the engine) for design, TDD implementation, and adversarial review, and you make every call along the way. You stop only when the PR is open and clean — internal adversarial review passed AND CI green — leaving the final merge to a human.

Unlike `/autobuild-one` (interactive, stops at the local branch) and `/autobuild` (overnight waves, local-merge, never pushes), this mode is fully autonomous for a single issue and DOES push + open a PR. It still NEVER auto-merges.

## Steps

1. **Load and validate config.** Same as `/autobuild-one` Step 1: read `.claude/autobuild.config.json` and `.claude/autobuild.md`, resolve `PLUGIN` (the directory containing this command file, two levels up), validate via the shipped dependency-free validator. Stop on invalid/missing config and print the `errors`.

2. **Resolve the issue.** From the argument (a ticket/issue key), run `config.ticket.show` to read it. This mode builds exactly one issue — if given an epic, stop and tell the user to pick a single child (this command does not expand epics).

3. **Confirm the remote is ready.** This mode pushes and opens a PR, so it requires a remote. Verify `origin` exists (`git -C <repo> remote get-url origin`) and `gh auth status` succeeds. If either fails, stop and report — do not fall back to a local-only build (that is what `/autobuild-one` is for).

4. **Bring local `config.base` current with origin (fast-forward only).** Same as `/autobuild-one` Step 3: `git -C <repo> fetch origin`, then `git -C <repo> checkout <config.base> && git -C <repo> merge --ff-only origin/<config.base>`. If the fast-forward fails, do NOT force it — report and stop.

5. **Build the issue via the engine.** Invoke `Workflow({ name: 'autobuild:autobuild', args })` with `args = { config, profile: <autobuild.md text>, ticket: { key, branch: '<key-lowercase>-<slug>', specPath, chunks, ticketText: <issue body> }, waveIndex: <random 0–49>, autonomous: true }`. If the issue already carries a cached design (`parseDesign` on its notes returns chunks), pass `specPath` + `chunks` so the engine skips design; otherwise the engine designs it.
   - **Pick a non-colliding `waveIndex`.** The engine derives the UI dev-server port as `ui.devServerPortBase + waveIndex`. This mode is single-issue (no wave), but two `/autobuild-issue` runs (or one alongside an overnight wave) must not bind the same port, so pass a random `waveIndex` in `[0, 49]` rather than defaulting to 0. Without it, every concurrent UI build collides on the base port and all but the first are spuriously blocked with a "ui reviewer did not return" finding.
   - On `verdict: blocked` with `escalations`: a genuine design fork needs a human. **Report only** — surface the escalations and stop. Do NOT apply any label.
   - On `verdict: blocked` with `findings`: the adversarial review could not be made clean within the engine's fix rounds. **Report only** — surface the findings and the worktree/branch, and stop. Do NOT apply any label.
   - On `verdict: clean`: continue. The result carries `branch`, `worktreePath`, and `specPath`.

6. **Push the branch and open the PR.** From inside the worktree, push the build branch to origin and open a PR against `config.base`:
   ```
   git -C <worktreePath> push -u origin <branch>
   gh pr create --base <config.base> --head <branch> --title "<issue key>: <issue title>" --body <generated summary>
   ```
   Generate the PR body from the spec and the engine's review summary (what was built, how it was verified). If a PR for the branch already exists (re-run), reuse it (`gh pr view <branch>`) instead of creating a duplicate.

7. **Drive CI to green.** Poll the PR's checks, classifying them with the shipped `ciStatus` helper. The categorizer is gh's `bucket` field — request `--json bucket,name` (the classifier reads only those two). CRITICAL: `gh pr checks` exits NON-ZERO when checks are pending (exit 8) or failing (exit 1) while STILL writing valid JSON to stdout, so you must capture stdout regardless of exit code and must NOT collapse a non-zero exit to `[]` (that would mask the very states you are polling for). Run:
   ```
   # Assign BOTH here, then export — the `node -e` child reads them from process.env.
   # PLUGIN was resolved in Step 1's shell; re-resolve it here (a separate shell does
   # NOT inherit it) so the block is self-contained:
   PLUGIN="$(cd "$(dirname "$0")/.." && pwd)"   # or the absolute path found in Step 1
   BRANCH=<build branch>
   export PLUGIN BRANCH
   node -e "
     const { summarize } = require(process.env.PLUGIN + '/lib/ciStatus');
     const { execFileSync } = require('child_process');
     let out = '', err = '';
     try { out = execFileSync('gh', ['pr','checks', process.env.BRANCH, '--json','bucket,name'], { encoding: 'utf8' }); }
     catch (e) { out = (e.stdout || '').toString(); err = (e.stderr || '').toString(); }  // gh exits 8/1 with JSON still on stdout
     let verdict;
     if (out.trim()) {
       let checks; try { checks = JSON.parse(out); } catch (_e) { checks = null; }  // bad JSON => unknown
       verdict = summarize(checks);
     } else if (/no checks/i.test(err)) {
       verdict = { state: 'none', pending: 0, failing: [] };   // gh: 'no checks reported on the <branch> branch' => genuinely no CI
     } else {
       verdict = { state: 'unknown', pending: 0, failing: [] }; // empty + any other message (e.g. 'no pull requests found') => could not read checks
     }
     console.log(JSON.stringify(verdict));
   "
   ```
   `summarize` returns `{ state: 'passing' | 'failing' | 'pending' | 'none' | 'unknown', pending, failing[] }`. The empty-stdout cases are disambiguated above by gh's stderr: a "no checks" message → `none`; anything else (notably "no pull requests found") → `unknown` (do not declare ready). If a future gh rewords the no-checks message so this misfires, the failure is SAFE — it yields `unknown`, which stops and reports rather than declaring a phantom-green PR ready.
   - `state: 'passing'`: CI is green → Step 9.
   - `state: 'none'` (gh reported no checks): this can mean "the repo has no CI" OR "the required workflows have not registered yet" (a freshly pushed branch, a check queued behind an approval gate). Do NOT immediately declare ready on the first `none` after pushing — that would merge a PR whose CI never ran. Re-poll across a short settle window (e.g. a few polls over ~1–2 minutes); only if it stays `none` for the whole window treat CI as genuinely absent → Step 9. If any later poll flips to `pending`/`failing`/`passing`, follow that instead.
   - `state: 'pending'`: checks still running. Wait and re-poll on a sensible interval (do not busy-loop). Bound the total wait — a check can stay pending forever (an offline self-hosted runner, a workflow blocked on a never-granted environment approval). Cap pending polling at a reasonable deadline (e.g. ~30 minutes of wall-clock, or whatever the repo's CI realistically needs); if it is still pending past the deadline, **report only** (surface that CI never concluded and the PR URL) and stop, rather than looping indefinitely.
   - `state: 'failing'`: go to Step 8.
   - `state: 'unknown'` (could NOT read checks — gh auth/network error, no PR, unparseable output): do NOT treat as success. Retry a couple of times; if it persists, **report only** (surface that CI status could not be determined and the PR URL) and stop. A PR is never declared ready on an undetermined CI state.

8. **Fix failing checks in the EXISTING worktree, then re-push.** The build branch and its worktree from Step 5 already exist, so do NOT re-invoke the full engine here — its setup phase runs `git worktree add -b <branch>`, which fails when the branch already exists. Instead, fix in place:
   - For each failing check, gather the concrete failure (`gh pr checks <branch>` for the link, then `gh run view --log-failed` for workflow runs, or fetch the check's detail) so the fix targets the real error, not a guess.
   - Spawn a fix subagent scoped to the existing worktree (same RULES/conventions the engine uses): `Task`/`Agent` instructed to work INSIDE `<worktreePath>` (cd there or `git -C <worktreePath>`), reproduce the failure locally where possible (run `config.toolchain.test`/`lint`/`build`), fix it under TDD, and commit only the relevant files. Never force-push, never touch the base branch.
   - Re-run the engine's adversarial review on the fixed branch so a CI fix cannot regress review quality. Use the engine's OWN review prompts as the single source — `src/prompts/code-review.md`, `security-review.md`, `design-conformance.md`, and (only if the change touches `ui.appGlob`) `ui-review.md`, the same set the engine's `reviewerSpecs` runs — rather than an ad-hoc panel described here. Do not hand-maintain a separate reviewer list in this command; if the engine's panel changes, this step must follow it.
   - Re-push the branch (`git -C <worktreePath> push origin <branch>` — no `-u`, no force) and return to Step 7.
   - Bound this to `config.caps.maxFixRounds` CI-fix rounds; if still failing after that, **report only** (surface the failing checks and the PR URL) and stop.

9. **Report ready-to-merge.** The PR is open, internal adversarial review passed, and CI is green (or absent). Summarize: PR URL, branch, spec path, what was built, and the review + CI outcome. **Stop here — never merge.** The human makes the merge call.

## Rules

- This mode pushes and opens a PR by design. It still NEVER merges and NEVER force-pushes; a failed fast-forward or a diverged base is a human decision.
- One issue only. No waves, no rate-limit anchor, no scheduled wakeups — this is a single autonomous run.
- On any `blocked` outcome (design escalation, un-clean review, or CI still failing after the fix budget): report only, apply no labels, and leave the branch/PR for a human. Do not park or close the issue.
- Every build/fix/review job is done by an engine-spawned expert subagent; you orchestrate and decide, you do not implement directly.
