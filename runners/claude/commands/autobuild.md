---
description: Autonomous overnight supervisor. Drains ready-to-build beads in conflict-aware parallel waves, designs undesigned beads, builds via the engine, merges clean results to the LOCAL base branch (never pushes), parks blockers, and survives 5-hour rate-limit windows via scheduled wakeups.
---

# /autobuild

Drive the overnight build loop. You own the privileged side effects the workflows cannot: the filesystem state file, wakeup scheduling, and the actual `git merge`. The workflows do design and build fan-out; you decide and execute merges.

## One-time launch (author present)

1. **Load and validate config** (same pattern as `/autodesign` Step 1). Resolve `PLUGIN`. Stop on invalid/missing config.
2. **Establish the rate-limit anchor.** Ask the author to paste the reset time shown in their `/usage` panel (Claude Code TUI). Parse it to an ISO anchor with the shipped lib:
   ```
   node -e "const d=new Date(process.env.RESET); if(isNaN(+d)) throw new Error('bad reset time'); console.log(d.toISOString())"
   ```
   (Accept any format `Date` parses; if it fails, ask again.) This is the ONLY time the author is needed — every later wakeup is pure arithmetic.
3. **Write the state file** at `$(git rev-parse --git-path autobuild)/state.json` (a repo-local, git-ignored path): `{ anchorResetISO, lastRunId: null, wakeupJobId: null, wave: 0, cap: <config.caps.concurrency>, claimedKeys: [], doneKeys: [], parkedKeys: [] }`. Create the dir if needed.

## Loop (each iteration)

1. **Sync + arm wakeup FIRST.** Run `config.ticket.syncPull` (`bd dolt pull`). Then compute and arm the next-window wakeup BEFORE any work, so a mid-wave rate limit already has a resume scheduled. Compute the cron expression from the anchor:
   ```
   CRON="$(node -e "const{nextResetCron}=require(process.env.PLUGIN+'/lib/rateLimit');console.log(nextResetCron(process.env.ANCHOR, Date.now(), 60))")"
   ```
   Then schedule a durable one-shot: `CronCreate({ cron: CRON, recurring: false, durable: true, prompt: '/autobuild --resume' })`. `durable: true` is required so the wakeup survives a session-ending rate-limit abort. Record the returned job ID in the state file as `wakeupJobId`. Before arming, delete any stale prior wakeup: if the state file has a `wakeupJobId`, call `CronDelete({ id: <it> })` first (avoid stacking duplicate resumes across iterations). If the loop finishes naturally, `CronDelete` the pending job at clean exit.
2. **Query ready beads.** Run the resolved `config.ticket.ready` (`bd ready --label ready-to-build --json`). Parse the JSON array.
3. **Ensure each ready bead is designed.** For each bead, read its notes via `config.ticket.show` and `parseDesign(notes)`. If `parseDesign` returns a design, use it. If not, design it now: invoke `/autodesign <key> --auto` semantics — call `Workflow({ name: 'autobuild:autodesign', args: {...} })`, and on success write the design back via `serializeDesign` + `config.ticket.note` + the `designed` label (exactly as `/autodesign` Step 4). If the autodesign returns `escalations`, park the bead (`config.labels.parked` + append escalations to notes) and drop it from this run. A bead with no chunks after design is parked too.
4. **Pack a wave.** Build the candidate list `[{ key, branch: '<key>-<slug>', surface, specPath, chunks }]` from the designed beads, then:
   ```
   WAVE="$(node -e "const{packWave}=require(process.env.PLUGIN+'/lib/packWave');process.stdout.write(JSON.stringify(packWave(JSON.parse(process.env.CANDS), Number(process.env.CAP))))")"
   ```
   with `CAP` = `config.caps.concurrency`. The `wave` array is this wave; `held` waits for a later iteration.
5. **Atomically claim** only the wave beads: run `config.ticket.claim` (`bd update <key> --claim`) per wave bead. Append claimed keys to the state file.
6. **Build the wave.** Invoke `Workflow({ name: 'autobuild:autobuild-supervisor', args: { config, profile, beads: <wave>, nowMs: Date.now() } })`. **Immediately persist the returned/observed `runId` to the state file as `lastRunId`** so a wakeup can resume it.
7. **Merge barrier (you execute this — workflows never merge).** For each result with `verdict: 'clean'`, serially: `git checkout <config.base>` then `git merge --no-ff <result.branch>`. On a clean merge: run `config.ticket.close` for the bead, add its key to `doneKeys`. On a REAL `git merge` conflict: abort the merge (`git merge --abort`), apply `config.labels.parked`, append a note explaining the conflict, add to `parkedKeys` — do NOT attempt resolution. For each result with `verdict: 'blocked'`: leave the branch in place, apply `config.labels.parked`, append the `findings`/`escalations` to bead notes via `config.ticket.note`, add to `parkedKeys`. **Never `git push`.**
8. **Re-query and repeat.** Go to Loop step 2 (beads whose blockers just closed now appear). Stop when: no ready beads remain, or `doneKeys.length + parkedKeys.length >= config.caps.maxTicketsPerRun`.
9. **Clean exit.** Run `config.ticket.syncPush` (`bd dolt push`). If the state file holds a `wakeupJobId`, `CronDelete({ id: <it> })` so no stale resume fires after a successful drain. Report a summary: done keys, parked keys (with reasons), and any held beads not reached.

## Resume (`/autobuild --resume`, fired by the durable cron wakeup)

1. Read the state file. If it is missing or `lastRunId` is null, there is nothing to resume — fall through to a fresh Loop iteration (re-arm wakeup, re-query).
2. Re-arm the NEXT wakeup first (Loop step 1 — note this `CronDelete`s the just-fired job's ID and arms the following window), then re-invoke the in-flight wave: `Workflow({ name: 'autobuild:autobuild-supervisor', resumeFromRunId: <lastRunId> })`. Completed agents return from cache instantly; mid-flight agents restart, and because the engine commits PER CHUNK, a restarted implementer continues from the next uncommitted chunk in its worktree.
3. When the resumed wave returns, perform the merge barrier (Loop step 7) for its results, then continue the Loop from step 2.

> The fired one-shot cron auto-deletes itself (`recurring: false`), so re-arming in step 2 creates a fresh job for the next window; the `CronDelete` guard in Loop step 1 is a no-op on the already-gone job but protects against a still-pending one if the loop re-armed before the prior fired.

## Rules

- NEVER `git push` and NEVER trigger CI/CD. Merges are local only. (`config.pushAllowed` is `false`.)
- NEVER guess a merge-conflict resolution — park the bead for a human.
- The author is needed ONCE (the anchor paste). All wakeups are unattended arithmetic.
- The resume wakeup MUST be a durable one-shot cron (`CronCreate({ recurring: false, durable: true })`) — never `ScheduleWakeup` (1-hour ceiling, dies with the session). Arm it BEFORE building the wave, and delete the prior job ID first to avoid stacking duplicates.
- An escalated or no-chunk design parks the bead; it is never built blindly.
- A bead is claimed ONLY after it is in a packed wave (atomic `--claim` prevents races with a second supervisor or a human).
