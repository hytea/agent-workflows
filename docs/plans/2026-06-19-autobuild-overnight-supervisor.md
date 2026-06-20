# Autobuild Overnight Supervisor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the autonomous overnight layer on top of the existing single-ticket engine: a reusable `autodesign` workflow that designs a bead once and caches the design back onto the bead, a conflict-aware overnight supervisor workflow that packs disjoint beads into parallel build waves and serially merges clean results into a LOCAL base branch, and the rate-limit anchor/wakeup/resume machinery that lets the supervisor survive 5-hour usage windows unattended.

**Architecture:** Three coordinated artifacts. (1) `autodesign.js` — a Workflow-engine script that runs the existing design agent for one bead and returns `{specPath, chunks, surface, escalations}`; it does NOT write back (no fs in workflow scripts) — the caller persists. (2) `autobuild-supervisor.js` — a Workflow script whose loop queries ready beads, builds a wave from PRE-DESIGNED beads via the existing engine through `workflow('autobuild', ...)`, and returns per-bead verdicts plus a merge plan; it never touches fs and never merges directly. (3) Two thin commands — `/autodesign` (designs one bead, writes the cached design back to bead notes, labels it `designed`; interactive path routes through superpowers brainstorming, autonomous path calls the workflow) and `/autobuild` (the overnight driver: establishes the rate-limit anchor, reads/writes the state file, arms `ScheduleWakeup`, calls the supervisor workflow, performs the actual git merges the workflow planned, and resumes via `resumeFromRunId` after a wakeup). The split is strict: **workflow scripts do orchestration + agent fan-out; command turns do filesystem, scheduling, and git merge** (the privileged, non-resumable side effects).

**Tech Stack:** Node.js (plain JS — Workflow scripts are not TypeScript), Claude Code Workflow API (`agent`, `parallel`, `pipeline`, `workflow`, `phase`, `log`, `args`, `resumeFromRunId`), `bd` CLI via `config.ticket.*` templates, git worktrees + local merge, `ScheduleWakeup` for rate-limit resume, `node:test` for unit tests of the pure helpers.

## Global Constraints

- Engine and all workflows/skills carry ZERO repo-specific knowledge — repo policy comes only from `config` (parsed `.claude/autobuild.config.json`) and `.claude/autobuild.md` prose.
- The supervisor and engine NEVER `git push` and NEVER trigger CI/CD. Merges target a LOCAL base branch only. (`config.pushAllowed` is `false` for Carven; push is the dev-deploy trigger.)
- Merge authority lives with the supervisor command turn, not the workflow. The workflow returns a merge PLAN; the command turn executes `git merge` and handles conflicts. A real merge conflict parks the bead `needs-human` — the supervisor NEVER guesses a resolution.
- Workflow scripts are plain JavaScript, not TypeScript. No type annotations. `Date.now()`/`Math.random()`/argless `new Date()` are UNAVAILABLE inside workflow scripts — pass timestamps in via `args`, stamp results after the workflow returns.
- Every workflow's `meta` object must be a pure literal (no variables, calls, spreads, or interpolation).
- `workflow()` nesting is ONE level only — the supervisor may call `workflow('autobuild', ...)` and `workflow('autodesign', ...)`, but those callees must NOT themselves call `workflow()`.
- Ticket commands are issued via `config.ticket.*` templates with `{placeholder}` substitution — never hardcode `bd`.
- A design is cached back to the bead as a fenced ```` ```autodesign ```` JSON block in bead notes `{specPath, surface, chunks}`, and the bead is labeled `designed`. The full prose spec stays a committed file under `docs/superpowers/specs/`.
- Conflict-aware packing: reduce each bead's `surface` to its set of touched DIRECTORIES; greedily select beads whose directory-sets are PAIRWISE DISJOINT, up to `config.caps.concurrency`. Overlapping beads wait for a later wave.
- Atomic claim only the packed beads via `config.ticket.claim` (sets assignee + in_progress in one op; prevents claim races).
- Rate-limit anchor is established ONCE at launch (author present) by author-paste of the `/usage` reset time; subsequent windows are pure arithmetic `reset(N) = anchor + N × 5h`. No scrape at wakeup.
- The resume wakeup is scheduled with `CronCreate({ recurring: false, durable: true })` at the next-reset wall-clock time — NOT `ScheduleWakeup` (which is clamped to a 1-hour max and tied to `/loop` mode; a 5-hour window exceeds its ceiling). `durable: true` is mandatory: a rate-limit abort can end the session, and only a durable cron survives to fire the unattended 3am resume.
- An errored reviewer/agent returns `null` and is treated as NOT clean — never a pass.
- Carven base branch is `development`; Carven labels are `ready` = `ready-to-build`, `parked` = `needs-human`, plus the new `designed` label.

---

## File Structure

- `src/lib/packWave.js` — pure function: given candidates with `surface` arrays + a concurrency cap, returns the disjoint wave + the held-over set. No I/O. (Pure → unit-testable.)
- `src/lib/designNotes.js` — pure functions to serialize a design to the fenced `autodesign` notes block and parse it back out of raw bead-notes text. No I/O. (Pure → unit-testable.)
- `src/lib/rateLimit.js` — pure functions: parse an author-pasted reset time to an ISO anchor, and compute the next reset ISO from an anchor + the current time. No I/O, no `Date.now()` (current time is passed in). (Pure → unit-testable.)
- `runners/claude/autodesign.template.js` — the autodesign Workflow script (design one bead, return design). Reuses `src/prompts/design.md` via the build's prompt inlining (`/*__PROMPT:design__*/`).
- `runners/claude/autobuild-supervisor.template.js` — the overnight supervisor Workflow script (wave loop, calls the engine per bead, returns verdicts + merge plan).
- `runners/claude/commands/autodesign.md` — `/autodesign` command (interactive-or-autonomous design + writeback).
- `runners/claude/commands/autobuild.md` — `/autobuild` command (overnight driver: anchor, state file, wakeup, merge execution, resume).
- `build/build.js` — MODIFY to also build `autodesign.js` and `autobuild-supervisor.js` (prompt inlining for autodesign) and copy the two new commands + the new lib files into the plugin.
- `runners/claude/plugin.json` — MODIFY: bump version to `0.2.0`.
- `examples/carven/autobuild.config.json` + `.claude/autobuild.config.json` (Carven) — MODIFY: add `labels.designed` and confirm `caps`.
- `test/packWave.test.js` — unit tests for wave packing.
- `test/designNotes.test.js` — unit tests for design notes serialize/parse round-trip.
- `test/rateLimit.test.js` — unit tests for anchor parse + next-reset arithmetic.
- `test/build.test.js` — MODIFY: assert the two new workflows + commands + libs ship into the plugin.

**Why pure-lib + thin-workflow split:** the genuinely tricky logic (packing disjoint sets, parsing a notes block, rolling a reset clock forward) is extracted into pure functions that run under `node:test` deterministically. The workflow scripts themselves cannot be unit-tested under `node -c` (top-level await/return is runtime-only — see the spine plan), so we keep them thin and push all testable logic into `src/lib/`. The workflows `require()` these libs? **No** — workflow scripts have no module system at runtime; they are inlined source. So the pure logic is DUPLICATED into the workflow as inlined helpers via the build's marker substitution, and the `src/lib/` copy is the tested source of truth. Each task that inlines a helper asserts (in a build test) that the inlined text matches the lib.

---

## Task 1: Wave-packing pure function

**Files:**
- Create: `src/lib/packWave.js`
- Test: `test/packWave.test.js`

**Interfaces:**
- Produces: `packWave(candidates, cap) -> { wave: Candidate[], held: Candidate[] }` exported from `src/lib/packWave.js`. `Candidate` is any object with a `surface: string[]` (file or directory paths) and a `key: string`. `cap` is a positive integer (the concurrency limit). Greedy: iterate candidates in input order; a candidate joins `wave` if its directory-set is disjoint from every already-selected candidate's directory-set AND `wave.length < cap`; otherwise it goes to `held`. Surface paths are reduced to directories with `dirOf(p)` = the path minus its last segment (a path with no `/` reduces to `'.'`).

- [ ] **Step 1: Write the failing test**

```js
// test/packWave.test.js
const test = require('node:test')
const assert = require('node:assert')
const { packWave } = require('../src/lib/packWave')

test('disjoint candidates all pack up to cap', () => {
  const c = [
    { key: 'a', surface: ['apps/api/src/foo/x.ts'] },
    { key: 'b', surface: ['apps/web/src/bar/y.tsx'] },
  ]
  const { wave, held } = packWave(c, 4)
  assert.deepStrictEqual(wave.map(x => x.key), ['a', 'b'])
  assert.deepStrictEqual(held, [])
})

test('overlapping directories are held, not packed', () => {
  const c = [
    { key: 'a', surface: ['apps/api/src/foo/x.ts'] },
    { key: 'b', surface: ['apps/api/src/foo/y.ts'] }, // same dir as a
  ]
  const { wave, held } = packWave(c, 4)
  assert.deepStrictEqual(wave.map(x => x.key), ['a'])
  assert.deepStrictEqual(held.map(x => x.key), ['b'])
})

test('cap limits wave size even when all disjoint', () => {
  const c = [
    { key: 'a', surface: ['d1/x'] },
    { key: 'b', surface: ['d2/x'] },
    { key: 'c', surface: ['d3/x'] },
  ]
  const { wave, held } = packWave(c, 2)
  assert.deepStrictEqual(wave.map(x => x.key), ['a', 'b'])
  assert.deepStrictEqual(held.map(x => x.key), ['c'])
})

test('a candidate touching two dirs blocks anything overlapping either', () => {
  const c = [
    { key: 'a', surface: ['d1/x', 'd2/y'] },
    { key: 'b', surface: ['d2/z'] }, // overlaps d2
    { key: 'c', surface: ['d3/w'] }, // disjoint
  ]
  const { wave, held } = packWave(c, 4)
  assert.deepStrictEqual(wave.map(x => x.key), ['a', 'c'])
  assert.deepStrictEqual(held.map(x => x.key), ['b'])
})

test('root-level file reduces to "." directory and overlaps other root files', () => {
  const c = [
    { key: 'a', surface: ['README.md'] },
    { key: 'b', surface: ['LICENSE'] }, // both reduce to "."
  ]
  const { wave, held } = packWave(c, 4)
  assert.deepStrictEqual(wave.map(x => x.key), ['a'])
  assert.deepStrictEqual(held.map(x => x.key), ['b'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/packWave.test.js`
Expected: FAIL with "Cannot find module '../src/lib/packWave'".

- [ ] **Step 3: Write the implementation**

```js
// src/lib/packWave.js
'use strict'

// Reduce a file/dir path to its containing directory. A path with no slash
// (a root-level file) reduces to '.', so two root files count as overlapping.
function dirOf(p) {
  const i = String(p).lastIndexOf('/')
  return i === -1 ? '.' : p.slice(0, i)
}

// Greedy conflict-aware packing: a candidate joins the wave only if its set of
// touched directories is disjoint from every already-selected candidate's set,
// and the wave has not hit the concurrency cap. Order is preserved.
function packWave(candidates, cap) {
  const list = Array.isArray(candidates) ? candidates : []
  const limit = Number.isInteger(cap) && cap > 0 ? cap : 1
  const wave = []
  const held = []
  const claimedDirs = new Set()
  for (const cand of list) {
    const dirs = (cand.surface || []).map(dirOf)
    const overlaps = dirs.some((d) => claimedDirs.has(d))
    if (!overlaps && wave.length < limit) {
      wave.push(cand)
      for (const d of dirs) claimedDirs.add(d)
    } else {
      held.push(cand)
    }
  }
  return { wave, held }
}

module.exports = { packWave, dirOf }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/packWave.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/packWave.js test/packWave.test.js
git commit -m "feat(autobuild): conflict-aware wave packing pure function"
```

---

## Task 2: Design-notes serialize/parse pure functions

**Files:**
- Create: `src/lib/designNotes.js`
- Test: `test/designNotes.test.js`

**Interfaces:**
- Produces, exported from `src/lib/designNotes.js`:
  - `serializeDesign(design) -> string` — given `{ specPath: string, surface: string[], chunks: object[] }`, returns a fenced block exactly: a line ```` ```autodesign ````, then `JSON.stringify({specPath, surface, chunks})` on its own line, then a closing ```` ``` ```` line. Only those three keys are serialized (escalations are NOT cached — an escalated bead is parked, never cached as designed).
  - `parseDesign(notesText) -> design | null` — scans raw bead-notes text for the LAST ```` ```autodesign ```` fenced block (last wins, so a re-design supersedes), `JSON.parse`s its body, and returns `{specPath, surface, chunks}`. Returns `null` if no block is present or the JSON is malformed (never throws).

- [ ] **Step 1: Write the failing test**

```js
// test/designNotes.test.js
const test = require('node:test')
const assert = require('node:assert')
const { serializeDesign, parseDesign } = require('../src/lib/designNotes')

const design = {
  specPath: 'docs/superpowers/specs/2026-06-19-x.md',
  surface: ['apps/api/src/foo'],
  chunks: [{ id: 'c1', title: 'do thing', model: 'sonnet', files: ['apps/api/src/foo/x.ts'], instructions: 'TDD it' }],
}

test('round-trips through serialize then parse', () => {
  const block = serializeDesign(design)
  const parsed = parseDesign(`some prior notes\n${block}\ntrailing`)
  assert.deepStrictEqual(parsed, design)
})

test('serialized block carries only the three cache keys', () => {
  const block = serializeDesign({ ...design, escalations: [{ decision: 'x' }] })
  const parsed = parseDesign(block)
  assert.deepStrictEqual(Object.keys(parsed).sort(), ['chunks', 'specPath', 'surface'])
})

test('parseDesign returns null when no block present', () => {
  assert.strictEqual(parseDesign('just some human notes, no fence'), null)
})

test('parseDesign returns null on malformed JSON, does not throw', () => {
  const bad = '```autodesign\n{not valid json\n```'
  assert.strictEqual(parseDesign(bad), null)
})

test('parseDesign takes the LAST block when re-designed', () => {
  const first = serializeDesign({ ...design, specPath: 'OLD.md' })
  const second = serializeDesign({ ...design, specPath: 'NEW.md' })
  const parsed = parseDesign(`${first}\n...later...\n${second}`)
  assert.strictEqual(parsed.specPath, 'NEW.md')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/designNotes.test.js`
Expected: FAIL with "Cannot find module '../src/lib/designNotes'".

- [ ] **Step 3: Write the implementation**

```js
// src/lib/designNotes.js
'use strict'

const FENCE_OPEN = '```autodesign'
const FENCE_CLOSE = '```'

// Serialize ONLY the three cache keys. Escalations are never cached — an
// escalated bead is parked for a human, not marked designed.
function serializeDesign(design) {
  const payload = {
    specPath: design.specPath,
    surface: design.surface,
    chunks: design.chunks,
  }
  return `${FENCE_OPEN}\n${JSON.stringify(payload)}\n${FENCE_CLOSE}`
}

// Find the LAST autodesign fenced block in raw notes text and parse it.
// Last wins so a re-design supersedes an older cached design. Never throws.
function parseDesign(notesText) {
  const text = String(notesText || '')
  let from = 0
  let lastBody = null
  for (;;) {
    const open = text.indexOf(FENCE_OPEN, from)
    if (open === -1) break
    const bodyStart = open + FENCE_OPEN.length
    const close = text.indexOf('\n' + FENCE_CLOSE, bodyStart)
    if (close === -1) break
    lastBody = text.slice(bodyStart, close).trim()
    from = close + FENCE_CLOSE.length
  }
  if (lastBody === null) return null
  try {
    const obj = JSON.parse(lastBody)
    return { specPath: obj.specPath, surface: obj.surface, chunks: obj.chunks }
  } catch (_e) {
    return null
  }
}

module.exports = { serializeDesign, parseDesign }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/designNotes.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/designNotes.js test/designNotes.test.js
git commit -m "feat(autobuild): design-notes serialize/parse for bead writeback cache"
```

---

## Task 3: Rate-limit anchor + next-reset arithmetic pure functions

**Files:**
- Create: `src/lib/rateLimit.js`
- Test: `test/rateLimit.test.js`

**Interfaces:**
- Produces, exported from `src/lib/rateLimit.js`:
  - `WINDOW_MS` — the constant `5 * 60 * 60 * 1000` (5 hours).
  - `nextReset(anchorISO, nowMs) -> string` — given the anchor reset time (ISO 8601 string) and the current epoch ms, returns the ISO string of the soonest reset boundary that is STRICTLY AFTER `nowMs`. Boundaries are `anchor + N × WINDOW_MS` for integer `N ≥ 0`. If `nowMs` is before the anchor, returns the anchor itself.
  - `wakeupDelaySeconds(anchorISO, nowMs, graceSeconds) -> number` — seconds from `nowMs` until `nextReset(...) + graceSeconds`. Always `≥ graceSeconds` (never negative). (Kept for diagnostics/logging; the actual scheduler uses the cron form below.)
  - `nextResetCron(anchorISO, nowMs, graceSeconds) -> string` — a 5-field one-shot cron expression (`"M H DoM Mon *"`, LOCAL time) for `nextReset(...) + graceSeconds`. This is what the `/autobuild` command feeds to `CronCreate({ recurring: false, durable: true })`. Cron has no seconds field, so the grace is applied then the time is floored to the minute. Local time because `CronCreate` interprets cron in the user's local timezone.
- The current time is ALWAYS passed in as `nowMs` (never read via `Date.now()`), so these functions are deterministic and testable, and so they remain callable from a workflow script's perspective if ever inlined (workflow scripts forbid `Date.now()`).
- **Why cron, not `ScheduleWakeup`:** `ScheduleWakeup` clamps `delaySeconds` to `[60, 3600]` (1-hour max) and is `/loop`-mode-specific. A 5-hour window (~18000s) exceeds that ceiling. `CronCreate` with `recurring: false` fires once at an arbitrary future wall-clock time; `durable: true` persists it across a session-ending rate-limit abort.

- [ ] **Step 1: Write the failing test**

```js
// test/rateLimit.test.js
const test = require('node:test')
const assert = require('node:assert')
const { nextReset, wakeupDelaySeconds, nextResetCron, WINDOW_MS } = require('../src/lib/rateLimit')

const anchor = '2026-06-19T22:00:00.000Z'
const anchorMs = Date.parse(anchor)

test('WINDOW_MS is five hours', () => {
  assert.strictEqual(WINDOW_MS, 5 * 60 * 60 * 1000)
})

test('nextReset rolls forward to the next boundary strictly after now', () => {
  // 1 minute after the anchor -> next boundary is anchor + 5h
  const r = nextReset(anchor, anchorMs + 60 * 1000)
  assert.strictEqual(r, new Date(anchorMs + WINDOW_MS).toISOString())
})

test('nextReset skips multiple elapsed windows', () => {
  // 12 hours after anchor -> third boundary (anchor + 15h)
  const r = nextReset(anchor, anchorMs + 12 * 60 * 60 * 1000)
  assert.strictEqual(r, new Date(anchorMs + 3 * WINDOW_MS).toISOString())
})

test('exactly on a boundary advances to the next one (strictly after)', () => {
  const r = nextReset(anchor, anchorMs + WINDOW_MS)
  assert.strictEqual(r, new Date(anchorMs + 2 * WINDOW_MS).toISOString())
})

test('now before anchor returns the anchor itself', () => {
  const r = nextReset(anchor, anchorMs - 1000)
  assert.strictEqual(r, anchor)
})

test('wakeupDelaySeconds adds grace and never goes negative', () => {
  const d = wakeupDelaySeconds(anchor, anchorMs + 60 * 1000, 60)
  // next boundary is 5h - 1min away, plus 60s grace
  const expected = (WINDOW_MS - 60 * 1000) / 1000 + 60
  assert.strictEqual(d, expected)
})

test('nextResetCron emits a one-shot 5-field cron for reset+grace in LOCAL time', () => {
  // Derive the expectation from the SAME Date the impl uses, so this test is
  // timezone-independent (works regardless of the CI machine's TZ).
  const nowMs = anchorMs + 60 * 1000
  const resetMs = Date.parse(nextReset(anchor, nowMs)) + 60 * 1000 // +grace
  const d = new Date(resetMs)
  const expected = `${d.getMinutes()} ${d.getHours()} ${d.getDate()} ${d.getMonth() + 1} *`
  assert.strictEqual(nextResetCron(anchor, nowMs, 60), expected)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/rateLimit.test.js`
Expected: FAIL with "Cannot find module '../src/lib/rateLimit'".

- [ ] **Step 3: Write the implementation**

```js
// src/lib/rateLimit.js
'use strict'

const WINDOW_MS = 5 * 60 * 60 * 1000 // 5-hour usage window

// Soonest reset boundary strictly after nowMs. Boundaries are anchor + N*WINDOW.
// If now is at or before the anchor, the anchor is the next reset.
function nextReset(anchorISO, nowMs) {
  const anchorMs = Date.parse(anchorISO)
  if (nowMs <= anchorMs) return new Date(anchorMs).toISOString()
  const elapsed = nowMs - anchorMs
  const n = Math.floor(elapsed / WINDOW_MS) + 1 // strictly-after => always advance
  return new Date(anchorMs + n * WINDOW_MS).toISOString()
}

// Seconds from now until the next reset plus a grace margin (e.g. 60s after
// the window flips, to be safely on the far side of the reset).
function wakeupDelaySeconds(anchorISO, nowMs, graceSeconds) {
  const grace = Number.isFinite(graceSeconds) ? graceSeconds : 0
  const resetMs = Date.parse(nextReset(anchorISO, nowMs))
  const secs = (resetMs - nowMs) / 1000 + grace
  return secs < grace ? grace : secs
}

// One-shot 5-field cron expression ("M H DoM Mon *") for the next reset plus a
// grace margin, in LOCAL time (CronCreate interprets cron in the user's tz).
// Cron has no seconds field, so we add grace then floor to the minute.
function nextResetCron(anchorISO, nowMs, graceSeconds) {
  const grace = Number.isFinite(graceSeconds) ? graceSeconds : 0
  const resetMs = Date.parse(nextReset(anchorISO, nowMs)) + grace * 1000
  const d = new Date(resetMs)
  // Local-time fields so the cron matches the user's wall clock.
  return `${d.getMinutes()} ${d.getHours()} ${d.getDate()} ${d.getMonth() + 1} *`
}

module.exports = { WINDOW_MS, nextReset, wakeupDelaySeconds, nextResetCron }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/rateLimit.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/rateLimit.js test/rateLimit.test.js
git commit -m "feat(autobuild): rate-limit anchor parse + next-reset arithmetic"
```

---

## Task 4: autodesign workflow script

**Files:**
- Create: `runners/claude/autodesign.template.js`

**Interfaces:**
- Consumes (via `args`): `{ config, profile, ticket: { key, branch, ticketText } }`. Reuses the existing `src/prompts/design.md` body through the build marker `/*__PROMPT:design__*/` (same prompt the engine uses — single design agent definition).
- Produces (workflow return value): `{ key, specPath, surface, chunks, escalations }` on success, or `{ key, error }` on failure. It runs ONLY the design agent — no setup, implement, or review. It does NOT write back to the bead and does NOT create a worktree (no fs side effects; the caller persists). The design agent still commits the prose spec file to the repo as `design.md` instructs (that is an agent action inside its own turn, not a workflow fs call).
- This workflow does NOT call `workflow()` (it is a leaf, callable by the supervisor within the one-level nesting limit).

- [ ] **Step 1: Write the workflow script**

```js
// runners/claude/autodesign.template.js
export const meta = {
  name: 'autodesign',
  description: 'Design one ticket: run the bounded design agent and return spec path, chunks, surface, and any escalations. Does not implement, set up a worktree, or write back to the ticket.',
  phases: [
    { title: 'design', detail: 'bounded opus decomposition into chunks + surface' },
  ],
}

const A = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const CFG = A.config || {}
const T = A.ticket || {}
const BASE = CFG.base
if (!T.key || !BASE) {
  return { key: T.key, error: 'autodesign requires args.config.base and args.ticket.key' }
}

const TC = CFG.toolchain || {}
const PROFILE = A.profile || ''
const noPush = CFG.pushAllowed ? '' : ' Do not push commits to any remote.'
const RULES = [
  `Operate ONLY inside the repo. Base branch: ${BASE}.`,
  `Toolchain: install="${TC.install || ''}", build="${TC.build || ''}", test="${TC.test || ''}", lint="${TC.lint || ''}".`,
  `Match existing conventions.`,
  `Use these ticket commands (substitute placeholders): show="${(CFG.ticket || {}).show || ''}", note="${(CFG.ticket || {}).note || ''}", label="${(CFG.ticket || {}).label || ''}".`,
  `git add ONLY the spec file you create (never "git add -A").${noPush}`,
  PROFILE ? `Repo conventions:\n${PROFILE}` : '',
].filter(Boolean).join(' ')

const DESIGN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['spec', 'specPath', 'surface', 'chunks', 'escalations'],
  properties: {
    spec: { type: 'string' }, specPath: { type: 'string' },
    surface: { type: 'array', items: { type: 'string' } },
    chunks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'title', 'model', 'files', 'instructions'],
      properties: { id: { type: 'string' }, title: { type: 'string' }, model: { type: 'string', enum: ['haiku', 'sonnet', 'opus'] }, files: { type: 'array', items: { type: 'string' } }, instructions: { type: 'string' },
        testExempt: { type: 'boolean' }, testExemptReason: { type: 'string' } } } },
    escalations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['decision', 'options', 'recommendation', 'rationale'],
      properties: { decision: { type: 'string' }, options: { type: 'array', items: { type: 'string' } }, recommendation: { type: 'string' }, rationale: { type: 'string' } } } },
  },
}

const fill = (tpl, map) => tpl.replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m))
const ctx = { RULES, key: T.key, branch: T.branch, base: BASE }

phase('design')
const designText = T.ticketText ? `\n\nTICKET DETAILS:\n${T.ticketText}` : ''
const design = await agent(
  fill(/*__PROMPT:design__*/, ctx) + designText,
  { label: `${T.key} design`, phase: 'design', model: 'opus', agentType: 'claude', schema: DESIGN_SCHEMA }
)
if (!design) return { key: T.key, error: 'design agent errored' }

return {
  key: T.key,
  specPath: design.specPath,
  surface: design.surface || [],
  chunks: design.chunks || [],
  escalations: design.escalations || [],
}
```

- [ ] **Step 2: Verify the script is a syntactically valid workflow body**

The Workflow runtime wraps the body in an async function with injected globals. `node -c` cannot parse top-level `await`/`return` (that is by design — see the spine plan). Verify the same way the spine's `promptSubstitution.test.js` does: strip `export ` and wrap in an `AsyncFunction`. Run this one-off check:

```bash
node -e '
const fs=require("fs");
let s=fs.readFileSync("runners/claude/autodesign.template.js","utf8");
s=s.replace(/^export\s+const\s+meta/,"const meta").replace("/*__PROMPT:design__*/","`x`");
const AF=Object.getPrototypeOf(async function(){}).constructor;
new AF("args","agent","parallel","pipeline","phase","log","budget","workflow",s);
console.log("OK");
'
```

Expected: prints `OK` (no SyntaxError).

- [ ] **Step 3: Commit**

```bash
git add runners/claude/autodesign.template.js
git commit -m "feat(autobuild): autodesign workflow — bounded single-bead design agent"
```

---

## Task 5: Build autodesign into the plugin

**Files:**
- Modify: `build/build.js`
- Modify: `test/build.test.js`

**Interfaces:**
- Consumes: `loadPrompts()` (already returns `design`), the marker-replacement helper `buildEngine`-style logic already in `build.js`.
- Produces: the built plugin now contains `plugins/autobuild/workflows/autodesign.js` with the `/*__PROMPT:design__*/` marker replaced by the inlined `design.md` text. `build({outDir})` still returns `{ distDir }`.

- [ ] **Step 1: Write the failing build test**

```js
// append to test/build.test.js
test('build ships the autodesign workflow with design prompt inlined', () => {
  const { distDir } = build({ outDir: tmp('autodesign') })
  const p = path.join(distDir, 'plugins/autobuild/workflows/autodesign.js')
  assert.ok(fs.existsSync(p), 'missing autodesign.js')
  const src = fs.readFileSync(p, 'utf8')
  assert.ok(!src.includes('/*__PROMPT:'), 'unreplaced prompt marker in autodesign.js')
  assert.match(src, /Design ticket/) // text from design.md is inlined
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/build.test.js`
Expected: FAIL — `autodesign.js` does not exist in the build output yet.

- [ ] **Step 3: Generalize the engine-build helper and add autodesign**

In `build/build.js`, replace the single-engine `buildEngine()` with a parameterized builder and call it for both the engine and autodesign. Add this function and update `build()`:

```js
// Build any template that uses /*__PROMPT:name__*/ markers, replacing each
// marker with its inlined, JS-escaped prompt text.
function buildTemplate(tplRelPath, markerNames) {
  const tplPath = path.join(ROOT, tplRelPath)
  let src = fs.readFileSync(tplPath, 'utf8')
  const prompts = loadPrompts()
  const map = {
    design: prompts.design, implement: prompts.implement,
    codeReview: prompts.codeReview, securityReview: prompts.securityReview,
    designConformance: prompts.designConformance,
  }
  for (const name of markerNames) {
    src = src.split(`/*__PROMPT:${name}__*/`).join(quote(map[name]))
  }
  return src
}
```

Then inside `build()`, after the existing engine write, add:

```js
  // autodesign workflow (only the design marker)
  const autodesign = buildTemplate('runners/claude/autodesign.template.js', ['design'])
  const autodesignPath = path.join(distDir, 'plugins', 'autobuild', 'workflows', 'autodesign.js')
  fs.writeFileSync(autodesignPath, autodesign)
```

And change the existing engine build to call the generalized helper (replace the old `buildEngine()` body or call):

```js
  const engine = buildTemplate('runners/claude/autobuild.template.js', ['design', 'implement', 'codeReview', 'securityReview', 'designConformance'])
```

Keep `buildEngine` removed or as a thin wrapper; do NOT leave a now-dead `buildEngine` function (dead code is a review finding).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/build.test.js`
Expected: PASS (existing build tests + the new autodesign test).

- [ ] **Step 5: Verify the full build still works end-to-end**

Run: `node build/build.js --local && node --test`
Expected: build prints `built -> .../dist-local`; full suite green.

- [ ] **Step 6: Commit**

```bash
git add build/build.js test/build.test.js
git commit -m "feat(autobuild): build autodesign workflow into plugin via generalized template builder"
```

---

## Task 6: /autodesign command (interactive + autonomous, with writeback)

**Files:**
- Create: `runners/claude/commands/autodesign.md`

**Interfaces:**
- Consumes: the shipped validator (`lib/validateConfig`), the `autodesign` workflow (`Workflow({ name: 'autobuild:autodesign', args })`), the `serializeDesign` notes format from `src/lib/designNotes.js` (the command shells out to it via `node -e` from the plugin `lib/`, same pattern as the validator), and the config's `ticket.note` / `ticket.label` / `ticket.show` templates.
- Produces: a designed bead — prose spec committed to `docs/superpowers/specs/`, the `autodesign` JSON block appended to bead notes, and the `designed` label applied. This is the unit the overnight supervisor reuses.

- [ ] **Step 1: Write the command body**

```markdown
---
description: Design one bead end-to-end and cache the design back to the bead — interactively (superpowers brainstorm) or autonomously (bounded Opus). Marks the bead `designed` so the overnight supervisor reuses it without re-designing.
---

# /autodesign

Turn one bead into a cached, build-ready design. The design (spec path + chunks + surface) is written back to the bead as a fenced `autodesign` JSON block and the bead is labeled `designed`, so a later `/autobuild` wave reuses it instead of re-designing.

Argument: a bead key. Optional flag `--auto` for the autonomous path.

## Steps

1. **Load and validate config.** Resolve the plugin dir (the directory containing this command file, one level up). Read `.claude/autobuild.config.json` + `.claude/autobuild.md`. Validate via the shipped validator:
   ```
   PLUGIN="$(cd "$(dirname "$0")/.." && pwd)"
   node -e "const{validateConfig}=require(process.env.PLUGIN+'/lib/validateConfig');console.log(JSON.stringify(validateConfig(require(process.cwd()+'/.claude/autobuild.config.json'))))"
   ```
   If `valid` is false, print `errors` and stop. If the config is missing, stop and tell the user.
2. **Read the bead.** Run the resolved `config.ticket.show` command for the key. Capture the bead title + description as the ticket text.
3. **Branch on mode:**
   - **Interactive (default, no `--auto`):** Use the superpowers brainstorming skill with the human to produce the design (spec prose, chunk decomposition with per-chunk model tier + target files + TDD instructions, and the directory surface). Commit the prose spec to `docs/superpowers/specs/YYYY-MM-DD-<key>-<slug>.md`. Assemble a `design` object `{ specPath, surface, chunks }`.
   - **Autonomous (`--auto`):** Invoke `Workflow({ name: 'autobuild:autodesign', args: { config, profile: <autobuild.md text>, ticket: { key, branch: '<key-lowercase>-<slug>', ticketText: <bead text> } } })`. If the result has `error`, stop and report. If `escalations` is non-empty, do NOT cache — instead apply the `parked` label and append the escalations to bead notes, then stop and report (a human must resolve the fork; see `/autobuild` for the same parking rule). Otherwise take `{ specPath, surface, chunks }` from the result.
4. **Write the design back to the bead.** Serialize the design to the `autodesign` notes block and append it, then apply the `designed` label. Use the plugin's `designNotes` lib for the exact format:
   ```
   BLOCK="$(node -e "const{serializeDesign}=require(process.env.PLUGIN+'/lib/designNotes');process.stdout.write(serializeDesign(JSON.parse(process.env.DESIGN)))")"
   ```
   with `DESIGN` set to the JSON of `{specPath, surface, chunks}`. Then run the resolved `config.ticket.note` template with the block as `{text}`, and the resolved `config.ticket.label` template with `{label}` = `config.labels.designed`. Finally run `config.ticket.syncPush` (`bd dolt push`) so the cached design is durable.
5. **Report.** Print the spec path, the chunk count + their model tiers, and the surface directories.

## Rules

- Never `git push` to a remote (the spec file is committed locally on the current branch only).
- An escalated design is NEVER cached or labeled `designed` — it is parked `needs-human`.
- The interactive and autonomous paths converge on the SAME bead-notes format (`serializeDesign`), so the supervisor reads either identically.
```

- [ ] **Step 2: Verify the command references real config keys**

Run: `node -e "const c=require('$HOME/Documents/GitHub/carven/.claude/autobuild.config.json'); for (const k of ['note','label','show','syncPush']) if(!c.ticket[k]) throw new Error('missing ticket.'+k); if(!c.labels) throw new Error('no labels'); console.log('config keys ok:', Object.keys(c.labels))"`
Expected: prints `config keys ok: [ 'ready', 'parked' ]` — note `designed` is ADDED in Task 9; this step confirms the other keys exist now.

- [ ] **Step 3: Commit**

```bash
git add runners/claude/commands/autodesign.md
git commit -m "feat(autobuild): /autodesign command — interactive or autonomous design with bead writeback"
```

---

## Task 7: Overnight supervisor workflow script

**Files:**
- Create: `runners/claude/autobuild-supervisor.template.js`

**Interfaces:**
- Consumes (via `args`): `{ config, profile, beads: WaveBead[], nowMs }` where `WaveBead = { key, branch, specPath, surface, chunks }` — the ALREADY-DESIGNED, ALREADY-PACKED, ALREADY-CLAIMED beads for ONE wave (the command turn does query/design/pack/claim before calling this; see Task 8). `nowMs` is passed in because workflow scripts cannot read the clock.
- Produces (workflow return value): `{ results: BuildResult[] }` where each `BuildResult` is the engine's return value `{ key, branch, worktreePath, specPath, verdict, findings }` plus nothing else. The supervisor does NOT merge and does NOT touch fs — it builds the wave in parallel via `workflow('autobuild', ...)` and returns the verdicts. The command turn (Task 8) executes merges from these results.
- This is the ONLY workflow that calls `workflow()`. Its callee (`autobuild`) is a leaf, so the one-level nesting limit holds.

- [ ] **Step 1: Write the supervisor script**

```js
// runners/claude/autobuild-supervisor.template.js
export const meta = {
  name: 'autobuild-supervisor',
  description: 'Build ONE pre-packed wave of designed, claimed beads in parallel via the autobuild engine, and return each verdict. Never merges and never pushes — the caller performs merges from the returned verdicts.',
  phases: [
    { title: 'wave', detail: 'parallel single-ticket builds via the autobuild engine' },
  ],
}

const A = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const CFG = A.config || {}
const PROFILE = A.profile || ''
const BEADS = Array.isArray(A.beads) ? A.beads : []
if (!CFG.base || BEADS.length === 0) {
  return { results: [], error: 'supervisor requires config.base and a non-empty beads[]' }
}

phase('wave')
log(`building wave of ${BEADS.length}: ${BEADS.map((b) => b.key).join(', ')}`)

// Each bead is already designed (chunks + specPath cached) and claimed. Pass the
// cached design straight into the engine so it SKIPS its own design phase.
const results = await parallel(
  BEADS.map((b) => () =>
    workflow('autobuild', {
      config: CFG,
      profile: PROFILE,
      ticket: { key: b.key, branch: b.branch, specPath: b.specPath, chunks: b.chunks },
      autonomous: true,
    })
  )
)

// A bead whose build threw resolves to null in the array — surface it as blocked
// so the caller parks it rather than silently dropping it.
const normalized = results.map((r, i) =>
  r || { key: BEADS[i].key, branch: BEADS[i].branch, verdict: 'blocked', findings: [{ issue: 'build workflow errored or was skipped' }] }
)

return { results: normalized }
```

- [ ] **Step 2: Verify the script is a syntactically valid workflow body**

```bash
node -e '
const fs=require("fs");
let s=fs.readFileSync("runners/claude/autobuild-supervisor.template.js","utf8");
s=s.replace(/^export\s+const\s+meta/,"const meta");
const AF=Object.getPrototypeOf(async function(){}).constructor;
new AF("args","agent","parallel","pipeline","phase","log","budget","workflow",s);
console.log("OK");
'
```

Expected: prints `OK`.

- [ ] **Step 3: Commit**

```bash
git add runners/claude/autobuild-supervisor.template.js
git commit -m "feat(autobuild): overnight supervisor workflow — parallel wave build via engine, returns verdicts"
```

---

## Task 8: Build supervisor into the plugin

**Files:**
- Modify: `build/build.js`
- Modify: `test/build.test.js`

**Interfaces:**
- Consumes: the `buildTemplate` helper from Task 5. The supervisor has NO prompt markers (it only orchestrates), so it is copied verbatim — but its `export const meta` stays intact and it must ship as `workflows/autobuild-supervisor.js`.
- Produces: `plugins/autobuild/workflows/autobuild-supervisor.js` in the build output.

- [ ] **Step 1: Write the failing build test**

```js
// append to test/build.test.js
test('build ships the supervisor workflow', () => {
  const { distDir } = build({ outDir: tmp('supervisor') })
  const p = path.join(distDir, 'plugins/autobuild/workflows/autobuild-supervisor.js')
  assert.ok(fs.existsSync(p), 'missing autobuild-supervisor.js')
  const src = fs.readFileSync(p, 'utf8')
  assert.match(src, /name: 'autobuild-supervisor'/)
  assert.ok(!src.includes('/*__PROMPT:'), 'supervisor should have no prompt markers')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/build.test.js`
Expected: FAIL — supervisor not in build output.

- [ ] **Step 3: Add the supervisor copy to `build()`**

The supervisor has no markers; copy it through (use `buildTemplate(..., [])` so it shares the read path, or a plain `copyFileSync`). Add inside `build()`:

```js
  // supervisor workflow (no prompt markers — pure orchestration)
  const supervisor = buildTemplate('runners/claude/autobuild-supervisor.template.js', [])
  fs.writeFileSync(path.join(distDir, 'plugins', 'autobuild', 'workflows', 'autobuild-supervisor.js'), supervisor)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/build.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add build/build.js test/build.test.js
git commit -m "feat(autobuild): build supervisor workflow into plugin"
```

---

## Task 9: Ship pure libs into the plugin + add `designed` label to configs

**Files:**
- Modify: `build/build.js`
- Modify: `test/build.test.js`
- Modify: `examples/carven/autobuild.config.json`
- Modify: `/Users/heber/Documents/GitHub/carven/.claude/autobuild.config.json`
- Modify: `src/config.schema.json`

**Interfaces:**
- Consumes: the existing lib-copy pattern in `build()` (it already copies `validateConfig.js` into `lib/`).
- Produces: `plugins/autobuild/lib/designNotes.js` shipped (the `/autodesign` command shells into it). Config schema accepts `labels.designed`. Carven config + example carry `labels.designed: "designed"`.

- [ ] **Step 1: Write the failing build test**

```js
// append to test/build.test.js
test('build ships designNotes lib into plugin', () => {
  const { distDir } = build({ outDir: tmp('designnotes-lib') })
  assert.ok(fs.existsSync(path.join(distDir, 'plugins/autobuild/lib/designNotes.js')), 'missing designNotes.js in lib')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/build.test.js`
Expected: FAIL — `designNotes.js` not in `lib/`.

- [ ] **Step 3: Ship the lib in `build()`**

Next to the existing `validateConfig.js` copy line, add:

```js
  cp(path.join(ROOT, 'src', 'lib', 'designNotes.js'), path.join(distDir, 'plugins', 'autobuild', 'lib', 'designNotes.js'))
```

- [ ] **Step 4: Add `designed` to the config schema**

In `src/config.schema.json`, the `labels` object currently requires `ready` and `parked`. Add `designed` as a required string property (the supervisor relies on it). Locate the `labels` schema block and update it to require all three:

```json
"labels": {
  "type": "object",
  "additionalProperties": false,
  "required": ["ready", "parked", "designed"],
  "properties": {
    "ready": { "type": "string" },
    "parked": { "type": "string" },
    "designed": { "type": "string" }
  }
}
```

(Match the surrounding indentation/format of the existing schema file exactly.)

- [ ] **Step 5: Add `designed` to both Carven configs**

In `examples/carven/autobuild.config.json` and `/Users/heber/Documents/GitHub/carven/.claude/autobuild.config.json`, update the `labels` object:

```json
"labels": { "ready": "ready-to-build", "parked": "needs-human", "designed": "designed" }
```

- [ ] **Step 6: Verify configs still validate against the updated schema**

Run from the agent-workflows repo root:
```bash
node -e "const{validateConfig}=require('./src/lib/validateConfig');const c=require('./examples/carven/autobuild.config.json');const r=validateConfig(c);if(!r.valid)throw new Error(JSON.stringify(r.errors));console.log('example valid')"
node -e "const{validateConfig}=require('./src/lib/validateConfig');const c=require(process.env.HOME+'/Documents/GitHub/carven/.claude/autobuild.config.json');const r=validateConfig(c);if(!r.valid)throw new Error(JSON.stringify(r.errors));console.log('carven valid')"
```
Expected: prints `example valid` then `carven valid`.

- [ ] **Step 7: Run the full suite**

Run: `node --test`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add build/build.js test/build.test.js src/config.schema.json examples/carven/autobuild.config.json
git commit -m "feat(autobuild): ship designNotes lib; add designed label to schema + carven config"
cd /Users/heber/Documents/GitHub/carven && git add .claude/autobuild.config.json && git commit -m "chore(autobuild): add designed label to consumer config" && cd -
```

(The Carven config lives in a different repo — commit it there on its own branch `chore/autobuild-consumer-config` if that branch is checked out, otherwise on the current branch. Do NOT push.)

---

## Task 10: /autobuild overnight driver command (anchor + state + wakeup + merge + resume)

**Files:**
- Create: `runners/claude/commands/autobuild.md`

**Interfaces:**
- Consumes: the shipped validator, `parseDesign` + `serializeDesign` from `lib/designNotes.js`, `nextResetCron` from a shipped `lib/rateLimit.js`, `packWave` from a shipped `lib/packWave.js`, the `autodesign` and `autobuild-supervisor` workflows, `CronCreate`/`CronList`/`CronDelete`, and the config `ticket.*`/`labels.*` templates.
- Produces: the autonomous overnight loop. This is the privileged driver — it owns the filesystem state file, the wakeup scheduling, and the actual `git merge`. The workflows it calls own only agent fan-out.

> **Prerequisite:** Task 10 needs `packWave.js` and `rateLimit.js` shipped into the plugin `lib/`. Add their `cp(...)` lines in `build()` alongside the `designNotes.js` line from Task 9, and extend the Task 9 build test to assert all three libs ship. (Do this as Step 0 below so Task 10 is self-contained.)

- [ ] **Step 0: Ship packWave + rateLimit libs and assert in build test**

In `build/build.js`, alongside the `designNotes.js` copy, add:

```js
  cp(path.join(ROOT, 'src', 'lib', 'packWave.js'), path.join(distDir, 'plugins', 'autobuild', 'lib', 'packWave.js'))
  cp(path.join(ROOT, 'src', 'lib', 'rateLimit.js'), path.join(distDir, 'plugins', 'autobuild', 'lib', 'rateLimit.js'))
```

Append to `test/build.test.js`:

```js
test('build ships packWave and rateLimit libs into plugin', () => {
  const { distDir } = build({ outDir: tmp('overnight-libs') })
  assert.ok(fs.existsSync(path.join(distDir, 'plugins/autobuild/lib/packWave.js')), 'missing packWave.js')
  assert.ok(fs.existsSync(path.join(distDir, 'plugins/autobuild/lib/rateLimit.js')), 'missing rateLimit.js')
})
```

Run: `node --test test/build.test.js` → expected PASS after adding the `cp` lines (write the test first, watch it fail, then add the lines, then pass).

- [ ] **Step 1: Write the command body**

```markdown
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
```

- [ ] **Step 2: Verify referenced libs + config keys resolve**

Run from the agent-workflows repo root after a local build:
```bash
node build/build.js --local
node -e "for (const m of ['packWave','rateLimit','designNotes','validateConfig']) require('./dist-local/plugins/autobuild/lib/'+m); console.log('all libs require-able')"
```
Expected: prints `all libs require-able`.

- [ ] **Step 3: Commit**

```bash
git add build/build.js test/build.test.js runners/claude/commands/autobuild.md
git commit -m "feat(autobuild): /autobuild overnight driver — anchor, state, wakeup, conflict-aware waves, local merge, resume"
```

---

## Task 11: Version bump + docs + final build verification

**Files:**
- Modify: `runners/claude/plugin.json`
- Modify: `runners/claude/README.md` (or the repo `README.md` if that is where command docs live)

**Interfaces:**
- Produces: plugin version `0.2.0`; README lists the three commands (`/autobuild-one`, `/autodesign`, `/autobuild`) and the two new workflows.

- [ ] **Step 1: Bump the plugin version**

In `runners/claude/plugin.json`, change `"version": "0.1.0"` to `"version": "0.2.0"`.

- [ ] **Step 2: Document the new commands**

In the runner README, add a short section listing the overnight surface: `/autodesign <key> [--auto]` (cache a design to a bead), `/autobuild` (overnight autonomous loop), and the safety invariants (local-merge only, never push, parks blockers, one author touch for the anchor). Keep it terse — the design doc is the full reference.

- [ ] **Step 3: Full build + full suite**

Run: `node build/build.js --local && node --test`
Expected: build prints `built -> .../dist-local`; the entire test suite is green. Run it 3 times to confirm no parallel-build flakiness:
```bash
for i in 1 2 3; do node --test 2>&1 | tail -3; done
```
Expected: 3 clean runs (no failures).

- [ ] **Step 4: Reinstall the plugin locally and smoke the command surface**

```bash
node -e "const p=require('./dist-local/plugins/autobuild/.claude-plugin/plugin.json'); if(p.version!=='0.2.0') throw new Error('version not bumped'); console.log('plugin', p.version)"
ls dist-local/plugins/autobuild/workflows/   # expect: autobuild.js autodesign.js autobuild-supervisor.js
ls dist-local/plugins/autobuild/commands/    # expect: autobuild-one.md autodesign.md autobuild.md
ls dist-local/plugins/autobuild/lib/         # expect: validateConfig.js config.schema.json designNotes.js packWave.js rateLimit.js
```
Expected: all three workflows, all three commands, all five lib files present; version `0.2.0`.

- [ ] **Step 5: Commit**

```bash
git add runners/claude/plugin.json runners/claude/README.md
git commit -m "chore(autobuild): bump plugin to 0.2.0, document overnight commands"
```

---

## Post-plan: live validation (human-run, not a task)

After the branch merges, the author validates the overnight layer the same way the spine was validated — incrementally, smallest first:

1. `/autodesign <tiny-bead> --auto` on one small bead → confirm the spec commits, the `autodesign` notes block appears, and the `designed` label is applied (`bd show`).
2. `/autobuild` with `caps.maxTicketsPerRun: 1` and two trivially-disjoint pre-designed beads → confirm one wave packs, builds in isolated worktrees, and merges to LOCAL `development` with NO push (`git log origin/development` unchanged).
3. Simulate a resume: confirm the state file holds `anchorResetISO` + `lastRunId`, and that `/autobuild --resume` re-enters cleanly.

These are deferred to live human validation because they exercise real `bd` state, real worktrees, and real scheduling — none of which a unit test can faithfully reproduce.

---

## Deferred (explicitly NOT in this plan)

- ~~**Rendered UI review via Playwright**~~ — NOW IMPLEMENTED (post-plan). The engine's review fan-out conditionally appends a Playwright UI reviewer when the diff touches `config.ui.appGlob`: it background-launches the worktree dev server on `config.ui.devServerPortBase` (+ optional `args.waveIndex`), renders affected pages, inspects layout/clipping/overflow/brand, then tears the server down. Prompt: `src/prompts/ui-review.md`. Cross-wave serialization of the shared browser remains a supervisor concern.
- **Playwright auto-scrape of the rate-limit anchor** — author-paste only for now; scrape is a documented future extension.
- **`vcs.mode` adapters beyond `local-merge`** (`gh-pr`, `glab-mr`) — deferred until a second consumer needs them.
- **Backlog-groomer / queue-filler workflows** — the `autodesign` workflow is the reusable seam they will build on, but they are out of scope here.
