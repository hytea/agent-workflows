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

5. **Build the issue via the engine.** Invoke `Workflow({ name: 'autobuild:autobuild', args })` with `args = { config, profile: <autobuild.md text>, ticket: { key, branch: '<key-lowercase>-<slug>', specPath, chunks, ticketText: <issue body> }, autonomous: true }`. If the issue already carries a cached design (`parseDesign` on its notes returns chunks), pass `specPath` + `chunks` so the engine skips design; otherwise the engine designs it.
   - On `verdict: blocked` with `escalations`: a genuine design fork needs a human. **Report only** — surface the escalations and stop. Do NOT apply any label.
   - On `verdict: blocked` with `findings`: the adversarial review could not be made clean within the engine's fix rounds. **Report only** — surface the findings and the worktree/branch, and stop. Do NOT apply any label.
   - On `verdict: clean`: continue. The result carries `branch`, `worktreePath`, and `specPath`.

6. **Push the branch and open the PR.** From inside the worktree, push the build branch to origin and open a PR against `config.base`:
   ```
   git -C <worktreePath> push -u origin <branch>
   gh pr create --base <config.base> --head <branch> --title "<issue key>: <issue title>" --body <generated summary>
   ```
   Generate the PR body from the spec and the engine's review summary (what was built, how it was verified). If a PR for the branch already exists (re-run), reuse it (`gh pr view <branch>`) instead of creating a duplicate.

7. **Drive CI to green.** Poll the PR's checks until they conclude, using the shipped `ciStatus` helper to classify `gh pr checks` output:
   ```
   node -e "const{summarize}=require(process.env.PLUGIN+'/lib/ciStatus');const cp=require('child_process');const out=cp.execSync('gh pr checks '+process.env.BRANCH+' --json name,state,conclusion 2>/dev/null||echo []',{encoding:'utf8'});console.log(JSON.stringify(summarize(JSON.parse(out))))"
   ```
   `summarize` returns `{ state: 'pending' | 'passing' | 'failing' | 'none', pending, failing[] }`.
   - `state: 'none'` (no checks configured on the repo): treat CI as satisfied and skip to Step 9.
   - `state: 'pending'`: wait and re-poll. Pace yourself — re-check on a sensible interval rather than busy-looping.
   - `state: 'passing'`: CI is green; go to Step 9.
   - `state: 'failing'`: go to Step 8 to fix.

8. **Fix CI/review failures via the engine, then re-push.** For each failing check, gather its log (`gh run view --log-failed` or the check's detail) and feed the concrete failure into a fix pass: re-invoke `Workflow({ name: 'autobuild:autobuild', args })` on the SAME branch with the failures appended to `ticket.ticketText` as blocking context (the engine re-runs its TDD + adversarial review fix loop inside the existing worktree). Re-push the branch (Step 6's push only) and return to Step 7. Bound this to `config.caps.maxFixRounds` CI-fix rounds; if still failing after that, **report only** (surface the failing checks and the PR URL) and stop.

9. **Report ready-to-merge.** The PR is open, internal adversarial review passed, and CI is green (or absent). Summarize: PR URL, branch, spec path, what was built, and the review + CI outcome. **Stop here — never merge.** The human makes the merge call.

## Rules

- This mode pushes and opens a PR by design. It still NEVER merges and NEVER force-pushes; a failed fast-forward or a diverged base is a human decision.
- One issue only. No waves, no rate-limit anchor, no scheduled wakeups — this is a single autonomous run.
- On any `blocked` outcome (design escalation, un-clean review, or CI still failing after the fix budget): report only, apply no labels, and leave the branch/PR for a human. Do not park or close the issue.
- Every build/fix/review job is done by an engine-spawned expert subagent; you orchestrate and decide, you do not implement directly.
