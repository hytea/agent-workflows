# Autobuild Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the generic autobuild engine that takes ONE ticket through design → worktree setup → model-tiered TDD implementation → parallel adversarial review (code + security + design-conformance) → fix loop → verdict, plus a Claude plugin build step and an interactive `/autobuild-one` command, validated end-to-end on one real Carven bead.

**Architecture:** A repo-agnostic Workflow-engine script (`runners/claude/autobuild.js`) reads a per-repo config and runs a single-ticket pipeline using `agent()`/`parallel()`. Prompt bodies live as portable templates in `src/prompts/` and are inlined into the engine at build time. A Node build script assembles `runners/claude` + `src` into a Claude plugin under `dist/`. The Carven repo consumes it via a local marketplace and supplies `.claude/autobuild.config.json` + `.claude/autobuild.md`. This plan deliberately omits wave-packing, the autonomous overnight loop, rate-limit resume, and rendered UI review — those are follow-up plans.

**Tech Stack:** Node.js (build script + engine, plain JS — the Workflow engine runs plain JS, not TS), Claude Code Workflow API (`agent`, `parallel`, `phase`, `log`), `bd` CLI (ticket state), git worktrees, JSON Schema (config validation via `ajv`).

## Global Constraints

- Engine and skills carry ZERO repo-specific knowledge — all repo policy comes from `config` (the parsed `.claude/autobuild.config.json`) and `.claude/autobuild.md` prose. Copy verbatim from spec.
- Engine NEVER merges and NEVER pushes. Merge authority is the supervisor/human. In this plan `/autobuild-one` leaves the reviewed branch for the human to merge.
- Workflow scripts are plain JavaScript, not TypeScript. No type annotations. `Date.now()`/`Math.random()`/argless `new Date()` are unavailable in scripts.
- The engine's `meta` object must be a pure literal (no variables/calls/spreads).
- Ticket commands are issued via `config.ticket.*` templates with `{placeholder}` substitution — never hardcode `bd`/`jira`.
- TDD mandatory in implement chunks: failing test first, then implement. `git add` only the chunk's files, never `git add -A`.
- A reviewer that errors returns `null` and is treated as NOT clean — never a pass. Both/all reviewers must return for a clean verdict.
- Worktree isolation: each ticket builds in its own git worktree off `config.base`.
- Carven base branch is `development`; Carven `pushAllowed` is `false`.

---

## File Structure

- `src/prompts/design.md` — design/decomposition prompt template (portable).
- `src/prompts/implement.md` — per-chunk implementation prompt template.
- `src/prompts/code-review.md` — code review prompt template.
- `src/prompts/security-review.md` — security review prompt template.
- `src/prompts/design-conformance.md` — design-conformance review prompt template.
- `src/lib/loadPrompts.js` — reads `src/prompts/*.md`, returns a `{name: text}` map (used by build).
- `src/lib/validateConfig.js` — validates a config object against `src/config.schema.json` via ajv; throws on invalid.
- `runners/claude/autobuild.js` — the Workflow engine (single-ticket pipeline). Prompts inlined at build time.
- `runners/claude/autobuild.template.js` — engine source with `/*__PROMPT:name__*/` markers the build replaces with prompt text.
- `runners/claude/commands/autobuild-one.md` — the `/autobuild-one` slash-command body (skill prose).
- `runners/claude/plugin.json` — plugin manifest (name, version, description).
- `build/build.js` — assembles the Claude plugin into `dist/`. Supports `--local`.
- `build/marketplace.template.json` — marketplace manifest template.
- `package.json` — declares `ajv` dep and `build`/`test` scripts.
- `test/validateConfig.test.js` — unit tests for config validation.
- `test/build.test.js` — unit test asserting build output structure.
- `test/promptSubstitution.test.js` — unit test asserting all prompt markers are replaced.

---

## Task 1: package.json + config validator

**Files:**
- Create: `package.json`
- Create: `src/lib/validateConfig.js`
- Test: `test/validateConfig.test.js`

**Interfaces:**
- Produces: `validateConfig(config) -> { valid: boolean, errors: string[] }` exported from `src/lib/validateConfig.js`. Does NOT throw; returns errors so callers decide. Reads schema from `src/config.schema.json` (already exists).

- [ ] **Step 1: Create package.json**

```json
{
  "name": "agent-workflows",
  "version": "0.1.0",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "build": "node build/build.js",
    "test": "node --test"
  },
  "dependencies": {
    "ajv": "^8.17.1"
  }
}
```

- [ ] **Step 2: Install ajv**

Run: `cd ~/Documents/GitHub/agent-workflows && npm install`
Expected: `ajv` added, `node_modules/` created.

- [ ] **Step 3: Write the failing test**

Create `test/validateConfig.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert')
const { validateConfig } = require('../src/lib/validateConfig')

const good = {
  base: 'development',
  pushAllowed: false,
  ticket: { system: 'bd', ready: 'bd ready --label {readyLabel} --json', show: 'bd show {key} --json', claim: 'bd update {key} --claim', note: 'bd update {key} --append-notes {text}', label: 'bd update {key} --add-label {label}' },
  vcs: { mode: 'local-merge' },
  toolchain: { install: 'npm install', build: 'npm run build', test: 'npm run test' },
  labels: { ready: 'ready-to-build', parked: 'needs-human' },
}

test('accepts a valid config', () => {
  const r = validateConfig(good)
  assert.strictEqual(r.valid, true, JSON.stringify(r.errors))
})

test('rejects missing required base', () => {
  const bad = { ...good }; delete bad.base
  const r = validateConfig(bad)
  assert.strictEqual(r.valid, false)
})

test('rejects unknown vcs mode', () => {
  const bad = { ...good, vcs: { mode: 'svn-commit' } }
  const r = validateConfig(bad)
  assert.strictEqual(r.valid, false)
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd ~/Documents/GitHub/agent-workflows && node --test test/validateConfig.test.js`
Expected: FAIL with "Cannot find module '../src/lib/validateConfig'".

- [ ] **Step 5: Write minimal implementation**

Create `src/lib/validateConfig.js`:

```js
const fs = require('fs')
const path = require('path')
const Ajv = require('ajv')

const schema = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'config.schema.json'), 'utf8')
)
const ajv = new Ajv({ allErrors: true })
const validate = ajv.compile(schema)

function validateConfig(config) {
  const valid = validate(config)
  const errors = valid ? [] : (validate.errors || []).map(
    (e) => `${e.instancePath || '(root)'} ${e.message}`
  )
  return { valid: !!valid, errors }
}

module.exports = { validateConfig }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd ~/Documents/GitHub/agent-workflows && node --test test/validateConfig.test.js`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
cd ~/Documents/GitHub/agent-workflows
git add package.json package-lock.json src/lib/validateConfig.js test/validateConfig.test.js
git commit -m "feat: config schema validator"
```

---

## Task 2: Prompt templates

**Files:**
- Create: `src/prompts/design.md`
- Create: `src/prompts/implement.md`
- Create: `src/prompts/code-review.md`
- Create: `src/prompts/security-review.md`
- Create: `src/prompts/design-conformance.md`
- Create: `src/lib/loadPrompts.js`
- Test: `test/loadPrompts.test.js`

**Interfaces:**
- Produces: `loadPrompts() -> { design, implement, codeReview, securityReview, designConformance }` (string values) from `src/lib/loadPrompts.js`. Each value is the file's text. Used by the build to inline prompts.
- Prompt templates use `{placeholder}` tokens the ENGINE substitutes at runtime (e.g. `{RULES}`, `{key}`, `{specPath}`, `{chunkId}`, `{chunkTitle}`, `{chunkFiles}`, `{chunkInstructions}`, `{base}`, `{branch}`, `{testCmd}`, `{lintCmd}`). The build does NOT substitute these — it only copies prompt text into the engine.

- [ ] **Step 1: Write design.md**

Create `src/prompts/design.md`:

```
{RULES}

Design ticket {key}. Read the ticket details provided and the repo. Produce an APPROVED, scoped design — do NOT implement.

Write a dated design spec to docs/superpowers/specs/ (create the dir if needed) and git add + commit it on the current branch ("docs({key}): design spec").

Return (via the structured schema):
- spec: the full design text.
- specPath: the committed spec file path.
- surface: the set of DIRECTORIES the work will touch (union of all chunk target files reduced to their directories). Used for conflict-aware scheduling.
- chunks: ordered, dependency-respecting, each tagged model "haiku" (cut-and-dry) / "sonnet" (normal) / "opus" (subtle or security-critical), each with target files and self-contained TDD instructions.
- escalations: ONLY genuine architectural/execution forks where the right call is unclear. Default to deciding yourself and documenting in the spec — escalations should usually be empty.

Stay scoped. Do not sprawl into hours of exploration.
```

- [ ] **Step 2: Write implement.md**

Create `src/prompts/implement.md`:

```
{RULES}

Implement ONE chunk of {key} on branch "{branch}" inside the assigned worktree. Do NOT switch branches. First READ the approved design spec at "{specPath}" — it is authoritative.

CHUNK {chunkId} — {chunkTitle}
Target files: {chunkFiles}
Instructions:
{chunkInstructions}

TDD: write a FAILING test first, then implement to green. Run the test command ({testCmd}) and lint command ({lintCmd}); fix what you touched until both pass. git add ONLY this chunk's files (never "git add -A") and commit with a conventional message referencing {key} and "{chunkId}". Report the changes and the test result.
```

- [ ] **Step 3: Write code-review.md**

Create `src/prompts/code-review.md`:

```
{RULES}

Adversarially CODE-review {key} on branch "{branch}". Inspect "git diff {base}...{branch}" and the changed files; cross-check against the spec at "{specPath}". Check correctness, bugs, missing or weak tests, error handling, and convention adherence. Verify the test command ({testCmd}) passes. Report ONLY genuinely blocking issues, each with file + a concrete fix. State clearly if clean.
```

- [ ] **Step 4: Write security-review.md**

Create `src/prompts/security-review.md`:

```
{RULES}

Adversarially SECURITY-review {key} on branch "{branch}". Inspect "git diff {base}...{branch}". Scrutinize authorization/authz enforcement (default-deny, no bypass), credential/secret/token handling (no logging or leak), SSRF/injection in outbound calls, over-broad scopes or permissions, and any unintended data exposure. Report ONLY genuinely blocking security issues, each with file + a concrete fix. State clearly if clean.
```

- [ ] **Step 5: Write design-conformance.md**

Create `src/prompts/design-conformance.md`:

```
{RULES}

DESIGN-CONFORMANCE review {key} on branch "{branch}". Read the approved spec at "{specPath}" and the ticket's acceptance criteria. Inspect "git diff {base}...{branch}". Judge whether the implementation built the RIGHT thing: does it satisfy the spec and acceptance criteria, are any chunks missing or partially done, did it add unrequested scope? Report ONLY genuinely blocking conformance gaps, each with file + a concrete fix. State clearly if it conforms.
```

- [ ] **Step 6: Write the failing test**

Create `test/loadPrompts.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert')
const { loadPrompts } = require('../src/lib/loadPrompts')

test('loads all five prompts as non-empty strings', () => {
  const p = loadPrompts()
  for (const k of ['design', 'implement', 'codeReview', 'securityReview', 'designConformance']) {
    assert.ok(typeof p[k] === 'string' && p[k].length > 0, `missing ${k}`)
  }
})

test('implement prompt references the RULES placeholder', () => {
  assert.match(loadPrompts().implement, /\{RULES\}/)
})
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd ~/Documents/GitHub/agent-workflows && node --test test/loadPrompts.test.js`
Expected: FAIL with "Cannot find module '../src/lib/loadPrompts'".

- [ ] **Step 8: Write loadPrompts.js**

Create `src/lib/loadPrompts.js`:

```js
const fs = require('fs')
const path = require('path')

const DIR = path.join(__dirname, '..', 'prompts')
const FILES = {
  design: 'design.md',
  implement: 'implement.md',
  codeReview: 'code-review.md',
  securityReview: 'security-review.md',
  designConformance: 'design-conformance.md',
}

function loadPrompts() {
  const out = {}
  for (const [key, file] of Object.entries(FILES)) {
    out[key] = fs.readFileSync(path.join(DIR, file), 'utf8').trim()
  }
  return out
}

module.exports = { loadPrompts }
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd ~/Documents/GitHub/agent-workflows && node --test test/loadPrompts.test.js`
Expected: PASS (2 tests).

- [ ] **Step 10: Commit**

```bash
cd ~/Documents/GitHub/agent-workflows
git add src/prompts src/lib/loadPrompts.js test/loadPrompts.test.js
git commit -m "feat: portable prompt templates + loader"
```

---

## Task 3: Engine template (single-ticket pipeline)

**Files:**
- Create: `runners/claude/autobuild.template.js`
- Test: `test/engineTemplate.test.js`

**Interfaces:**
- Consumes: prompt markers `/*__PROMPT:design__*/`, `/*__PROMPT:implement__*/`, `/*__PROMPT:codeReview__*/`, `/*__PROMPT:securityReview__*/`, `/*__PROMPT:designConformance__*/` — the build (Task 4) replaces each with a backtick-quoted prompt string.
- Produces: the built `autobuild.js` whose `args` contract is `{ config, ticket: {key, branch, specPath?, chunks?}, autonomous }`. When `ticket.chunks` is absent the engine runs the design phase; when present (supervisor pre-designed) it skips design. Returns `{ key, branch, worktreePath, specPath, verdict: 'clean'|'blocked', findings }`.

- [ ] **Step 1: Write the failing test**

Create `test/engineTemplate.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const src = fs.readFileSync(
  path.join(__dirname, '..', 'runners', 'claude', 'autobuild.template.js'), 'utf8'
)

test('template begins with a meta export', () => {
  assert.match(src, /export const meta = \{/)
})

test('template contains all five prompt markers', () => {
  for (const m of ['design', 'implement', 'codeReview', 'securityReview', 'designConformance']) {
    assert.ok(src.includes(`/*__PROMPT:${m}__*/`), `missing marker ${m}`)
  }
})

test('template never calls git push', () => {
  assert.ok(!/git push/.test(src), 'engine must never push')
})

test('template defines a REVIEW_SCHEMA and uses parallel for reviews', () => {
  assert.match(src, /REVIEW_SCHEMA/)
  assert.match(src, /await parallel\(/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Documents/GitHub/agent-workflows && node --test test/engineTemplate.test.js`
Expected: FAIL with "no such file ... autobuild.template.js".

- [ ] **Step 3: Write the engine template**

Create `runners/claude/autobuild.template.js`:

```js
export const meta = {
  name: 'autobuild',
  description: 'Build one ticket: design, worktree, model-tiered TDD implement, parallel adversarial review (code+security+design-conformance), fix loop, return verdict. Never merges, never pushes.',
  phases: [
    { title: 'design', detail: 'decompose ticket into chunks (skipped if pre-designed)' },
    { title: 'setup', detail: 'worktree off base, commit spec' },
    { title: 'implement', detail: 'sequential model-tiered TDD chunks' },
    { title: 'review', detail: 'parallel code + security + design-conformance' },
    { title: 'fix', detail: 'opus fixes blocking findings' },
  ],
}

const A = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const CFG = A.config || {}
const T = A.ticket || {}
const AUTONOMOUS = !!A.autonomous
const BASE = CFG.base
const TC = CFG.toolchain || {}
const CAPS = CFG.caps || {}
const MAX_FIX_ROUNDS = Number.isInteger(CAPS.maxFixRounds) ? CAPS.maxFixRounds : 2
if (!T.key || !BASE) {
  return { error: 'autobuild requires args.config.base and args.ticket.key', got: { base: BASE, key: T.key } }
}

const testCmd = TC.test || ''
const lintCmd = TC.lint || ''
const buildCmd = TC.build || ''
const checks = ['build', 'test', 'lint', 'format'].map((k) => TC[k]).filter(Boolean).join(' && ')

// RULES: assembled from config + the consumer's autobuild.md (passed in A.profile).
const PROFILE = A.profile || ''
const noPush = CFG.pushAllowed ? '' : ' NEVER run "git push".'
const RULES = [
  `Operate ONLY inside the assigned worktree (absolute paths or git -C). Base branch: ${BASE}.`,
  `Toolchain: install="${TC.install || ''}", build="${buildCmd}", test="${testCmd}", lint="${lintCmd}".`,
  `TDD is mandatory: failing test first, then implement. Match existing conventions.`,
  `Use these ticket commands (substitute placeholders): show="${(CFG.ticket||{}).show||''}", note="${(CFG.ticket||{}).note||''}", label="${(CFG.ticket||{}).label||''}".`,
  `git add ONLY the current chunk's files (never "git add -A").${noPush}`,
  PROFILE ? `Repo conventions:\n${PROFILE}` : '',
].filter(Boolean).join(' ')

const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['approved', 'summary', 'blocking'],
  properties: {
    approved: { type: 'boolean' }, summary: { type: 'string' },
    blocking: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['severity', 'file', 'issue', 'fix'],
      properties: { severity: { type: 'string', enum: ['critical', 'high', 'medium'] }, file: { type: 'string' }, issue: { type: 'string' }, fix: { type: 'string' } } } },
  },
}
const DESIGN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['spec', 'specPath', 'surface', 'chunks', 'escalations'],
  properties: {
    spec: { type: 'string' }, specPath: { type: 'string' },
    surface: { type: 'array', items: { type: 'string' } },
    chunks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'title', 'model', 'files', 'instructions'],
      properties: { id: { type: 'string' }, title: { type: 'string' }, model: { type: 'string', enum: ['haiku', 'sonnet', 'opus'] }, files: { type: 'array', items: { type: 'string' } }, instructions: { type: 'string' } } } },
    escalations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['decision', 'options', 'recommendation', 'rationale'],
      properties: { decision: { type: 'string' }, options: { type: 'array', items: { type: 'string' } }, recommendation: { type: 'string' }, rationale: { type: 'string' } } } },
  },
}

const fill = (tpl, map) => tpl.replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m))
const ctx = { RULES, key: T.key, branch: T.branch, base: BASE, testCmd, lintCmd }

// DESIGN (skipped if supervisor pre-designed and passed chunks)
let specPath = T.specPath
let chunks = Array.isArray(T.chunks) ? T.chunks : null
let escalations = []
if (!chunks) {
  phase('design')
  const designText = T.ticketText ? `\n\nTICKET DETAILS:\n${T.ticketText}` : ''
  const design = await agent(
    fill(/*__PROMPT:design__*/, ctx) + designText,
    { label: `${T.key} design`, phase: 'design', model: 'opus', agentType: 'claude', schema: DESIGN_SCHEMA }
  )
  if (!design) return { key: T.key, branch: T.branch, verdict: 'blocked', findings: [{ issue: 'design agent errored' }] }
  specPath = design.specPath
  chunks = design.chunks || []
  escalations = design.escalations || []
  if (escalations.length > 0) {
    return { key: T.key, branch: T.branch, specPath, verdict: 'blocked', escalations, findings: [], reason: 'design escalation' }
  }
  if (chunks.length === 0) {
    return { key: T.key, branch: T.branch, specPath, verdict: 'blocked', findings: [{ issue: 'design produced no chunks' }] }
  }
}
ctx.specPath = specPath

// SETUP (create worktree, commit spec)
phase('setup')
const setup = await agent(
  `${RULES}\n\nPrepare ${T.key}. git fetch origin. Create a fresh git WORKTREE for branch "${T.branch}" off "origin/${BASE}" (git worktree add -b ${T.branch} <path> origin/${BASE}). The approved design spec is at "${specPath}"; ensure it is committed on this branch. Run the install command if deps are missing. Report the absolute worktree path and HEAD sha. Do NOT implement.`,
  { label: `${T.key} setup`, phase: 'setup', model: 'haiku', agentType: 'claude' }
)

// IMPLEMENT (sequential, model per chunk)
phase('implement')
for (const c of chunks) {
  await agent(
    fill(/*__PROMPT:implement__*/, { ...ctx, chunkId: c.id, chunkTitle: c.title, chunkFiles: (c.files || []).join(', '), chunkInstructions: c.instructions }),
    { label: `${T.key} ${c.id}: ${c.title}`, phase: 'implement', model: c.model || 'sonnet', agentType: 'claude' }
  )
}

// REVIEW + FIX loop
let round = 0, clean = false, lastBlocking = []
while (round <= MAX_FIX_ROUNDS) {
  phase('review')
  const [code, sec, conf] = await parallel([
    () => agent(fill(/*__PROMPT:codeReview__*/, ctx), { label: `${T.key} code r${round}`, phase: 'review', model: 'opus', agentType: 'claude', schema: REVIEW_SCHEMA }),
    () => agent(fill(/*__PROMPT:securityReview__*/, ctx), { label: `${T.key} sec r${round}`, phase: 'review', model: 'opus', agentType: 'claude', schema: REVIEW_SCHEMA }),
    () => agent(fill(/*__PROMPT:designConformance__*/, ctx), { label: `${T.key} conf r${round}`, phase: 'review', model: 'opus', agentType: 'claude', schema: REVIEW_SCHEMA }),
  ])
  const allReturned = code && sec && conf
  const blocking = [...((code && code.blocking) || []), ...((sec && sec.blocking) || []), ...((conf && conf.blocking) || [])]
  lastBlocking = blocking
  if (blocking.length === 0 && allReturned) { clean = true; break }
  if (round === MAX_FIX_ROUNDS) { log(`${T.key}: ${blocking.length} blocking after ${round} rounds (or a reviewer errored)`); break }
  phase('fix')
  await agent(
    `${RULES}\n\nFix these BLOCKING review findings for ${T.key} on branch "${T.branch}", commit (relevant files only). Re-run the test and lint commands until green. Findings:\n${JSON.stringify(blocking, null, 2)}`,
    { label: `${T.key} fix r${round}`, phase: 'fix', model: 'opus', agentType: 'claude' }
  )
  round++
}

return {
  key: T.key, branch: T.branch,
  worktreePath: (setup && typeof setup === 'string') ? setup : null,
  specPath, verdict: clean ? 'clean' : 'blocked', findings: clean ? [] : lastBlocking,
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Documents/GitHub/agent-workflows && node --test test/engineTemplate.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/GitHub/agent-workflows
git add runners/claude/autobuild.template.js test/engineTemplate.test.js
git commit -m "feat: single-ticket autobuild engine template"
```

---

## Task 4: Build script (assemble Claude plugin)

**Files:**
- Create: `runners/claude/plugin.json`
- Create: `runners/claude/commands/autobuild-one.md`
- Create: `build/marketplace.template.json`
- Create: `build/build.js`
- Test: `test/build.test.js`
- Test: `test/promptSubstitution.test.js`

**Interfaces:**
- Consumes: `loadPrompts()` (Task 2), the engine template with `/*__PROMPT:name__*/` markers (Task 3).
- Produces: `dist/.claude-plugin/marketplace.json`, `dist/plugins/autobuild/.claude-plugin/plugin.json`, `dist/plugins/autobuild/workflows/autobuild.js` (markers replaced), `dist/plugins/autobuild/commands/autobuild-one.md`. `build/build.js` exports `build({ local }) -> { distDir }` AND runs when invoked directly.

- [ ] **Step 1: Write plugin.json**

Create `runners/claude/plugin.json`:

```json
{
  "name": "autobuild",
  "version": "0.1.0",
  "description": "Multi-agent ticket autobuild: design, TDD implement, adversarial review, supervisor-gated merge. Repo-agnostic; configured per repo via .claude/autobuild.config.json.",
  "author": { "name": "hytea" },
  "repository": "https://github.com/hytea/agent-workflows",
  "keywords": ["claude-code", "workflow", "automation", "tickets", "multi-agent"]
}
```

- [ ] **Step 2: Write the autobuild-one command body**

Create `runners/claude/commands/autobuild-one.md`:

```markdown
---
description: Interactively build one ticket (or epic's children) end-to-end — design, TDD implement, adversarial review — then let you decide the merge.
---

# /autobuild-one

Drive one ticket through the autobuild engine, interactively. You do the judgment (resolve, checkpoint, decide merge); the engine does the deterministic design → implement → review → fix fan-out.

## Steps

1. **Load config.** Read `.claude/autobuild.config.json` in the repo root and `.claude/autobuild.md` (conventions prose). If the config is missing or fails schema validation, stop and tell the user.
2. **Resolve the ticket.** From the argument (a ticket key or epic key), run the config's `ticket.show` command to read it. If it's an epic, expand to children and confirm order with the user.
3. **Run the engine.** Invoke `Workflow({ name: 'autobuild', args })` with `args = { config, profile: <autobuild.md text>, ticket: { key, branch: '<key-lowercase>-<slug>', ticketText: <the ticket body> }, autonomous: false }`.
4. **Handle escalations.** If the result `verdict` is `blocked` with `escalations`, surface ONLY those to the user via the question tool (lead with the recommended option), fold answers into guidance, and re-run.
5. **Report + merge decision.** On `verdict: clean`, summarize the branch, spec path, and review outcome. Ask the user whether to merge to `config.base` and whether to push. Default: merge locally, do NOT push (engine and this command never push on their own). On `verdict: blocked`, report the findings and leave the branch for manual attention.

## Rules

- Never `git push` unless the user explicitly says to AND `config.pushAllowed` is true.
- The engine never merges — merging is your action, taken only after the user decides.
```

- [ ] **Step 3: Write marketplace template**

Create `build/marketplace.template.json`:

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "agent-workflows",
  "owner": { "name": "hytea" },
  "metadata": {
    "description": "Reusable multi-agent development workflows by hytea.",
    "homepage": "https://github.com/hytea/agent-workflows"
  },
  "plugins": [
    { "name": "autobuild", "source": "./plugins/autobuild" }
  ]
}
```

- [ ] **Step 4: Write the failing build test**

Create `test/build.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { build } = require('../build/build')

test('build produces the expected plugin structure', () => {
  const { distDir } = build({ local: true })
  const must = [
    '.claude-plugin/marketplace.json',
    'plugins/autobuild/.claude-plugin/plugin.json',
    'plugins/autobuild/workflows/autobuild.js',
    'plugins/autobuild/commands/autobuild-one.md',
  ]
  for (const f of must) {
    assert.ok(fs.existsSync(path.join(distDir, f)), `missing ${f}`)
  }
})
```

- [ ] **Step 5: Write the failing prompt-substitution test**

Create `test/promptSubstitution.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { build } = require('../build/build')

test('built engine has no unreplaced prompt markers', () => {
  const { distDir } = build({ local: true })
  const engine = fs.readFileSync(path.join(distDir, 'plugins/autobuild/workflows/autobuild.js'), 'utf8')
  assert.ok(!engine.includes('/*__PROMPT:'), 'unreplaced prompt marker remains')
  assert.match(engine, /Adversarially CODE-review/)  // prompt text inlined
})
```

- [ ] **Step 6: Run both tests to verify they fail**

Run: `cd ~/Documents/GitHub/agent-workflows && node --test test/build.test.js test/promptSubstitution.test.js`
Expected: FAIL with "Cannot find module '../build/build'".

- [ ] **Step 7: Write the build script**

Create `build/build.js`:

```js
const fs = require('fs')
const path = require('path')
const { loadPrompts } = require('../src/lib/loadPrompts')

const ROOT = path.join(__dirname, '..')

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }) }
function mkdirp(p) { fs.mkdirSync(p, { recursive: true }) }
function cp(src, dest) { mkdirp(path.dirname(dest)); fs.copyFileSync(src, dest) }

// JS-string-escape a prompt and wrap in backticks for inlining.
function quote(text) {
  return '`' + text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${') + '`'
}

function buildEngine() {
  const tplPath = path.join(ROOT, 'runners', 'claude', 'autobuild.template.js')
  let src = fs.readFileSync(tplPath, 'utf8')
  const prompts = loadPrompts()
  const map = {
    design: prompts.design, implement: prompts.implement,
    codeReview: prompts.codeReview, securityReview: prompts.securityReview,
    designConformance: prompts.designConformance,
  }
  for (const [name, text] of Object.entries(map)) {
    src = src.split(`/*__PROMPT:${name}__*/`).join(quote(text))
  }
  return src
}

function build({ local } = {}) {
  const distDir = path.join(ROOT, local ? 'dist-local' : 'dist')
  rmrf(distDir)
  // marketplace manifest
  cp(path.join(ROOT, 'build', 'marketplace.template.json'), path.join(distDir, '.claude-plugin', 'marketplace.json'))
  // plugin manifest
  cp(path.join(ROOT, 'runners', 'claude', 'plugin.json'), path.join(distDir, 'plugins', 'autobuild', '.claude-plugin', 'plugin.json'))
  // command
  cp(path.join(ROOT, 'runners', 'claude', 'commands', 'autobuild-one.md'), path.join(distDir, 'plugins', 'autobuild', 'commands', 'autobuild-one.md'))
  // engine (markers replaced)
  const engine = buildEngine()
  const enginePath = path.join(distDir, 'plugins', 'autobuild', 'workflows', 'autobuild.js')
  mkdirp(path.dirname(enginePath))
  fs.writeFileSync(enginePath, engine)
  return { distDir }
}

module.exports = { build }

if (require.main === module) {
  const local = process.argv.includes('--local')
  const { distDir } = build({ local })
  console.log(`built -> ${distDir}`)
}
```

- [ ] **Step 8: Add dist-local to .gitignore**

Append to `.gitignore`:

```
dist-local/
```

- [ ] **Step 9: Run both tests to verify they pass**

Run: `cd ~/Documents/GitHub/agent-workflows && node --test test/build.test.js test/promptSubstitution.test.js`
Expected: PASS.

- [ ] **Step 10: Run the full build and eyeball the engine**

Run: `cd ~/Documents/GitHub/agent-workflows && node build/build.js && node -c dist/plugins/autobuild/workflows/autobuild.js && echo "engine parses"`
Expected: `built -> .../dist` then `engine parses` (no syntax error from the inlined prompts).

- [ ] **Step 11: Commit**

```bash
cd ~/Documents/GitHub/agent-workflows
git add runners/claude/plugin.json runners/claude/commands/autobuild-one.md build/ test/build.test.js test/promptSubstitution.test.js .gitignore
git commit -m "feat: build script assembling the autobuild Claude plugin"
```

---

## Task 5: Wire Carven as consumer + end-to-end validation on one bead

**Files:**
- Create (in Carven repo): `/Users/heber/Documents/GitHub/carven/.claude/autobuild.config.json` (copy from `examples/carven/`)
- Create (in Carven repo): `/Users/heber/Documents/GitHub/carven/.claude/autobuild.md` (copy from `examples/carven/`)

**Interfaces:**
- Consumes: the built local plugin from Task 4 (`dist-local/`).
- Produces: a validated run of `/autobuild-one` against one real, trivial Carven bead, leaving a reviewed branch the human inspects.

- [ ] **Step 1: Build the local plugin**

Run: `cd ~/Documents/GitHub/agent-workflows && node build/build.js --local && echo built`
Expected: `dist-local/` populated.

- [ ] **Step 2: Copy Carven config + profile into Carven**

```bash
mkdir -p /Users/heber/Documents/GitHub/carven/.claude
cp ~/Documents/GitHub/agent-workflows/examples/carven/autobuild.config.json /Users/heber/Documents/GitHub/carven/.claude/autobuild.config.json
cp ~/Documents/GitHub/agent-workflows/examples/carven/autobuild.md /Users/heber/Documents/GitHub/carven/.claude/autobuild.md
```

- [ ] **Step 3: Validate the Carven config against the schema**

Run:
```bash
cd ~/Documents/GitHub/agent-workflows && node -e "
const {validateConfig}=require('./src/lib/validateConfig');
const c=require('/Users/heber/Documents/GitHub/carven/.claude/autobuild.config.json');
console.log(validateConfig(c));
"
```
Expected: `{ valid: true, errors: [] }`.

- [ ] **Step 4: Install the local marketplace in Carven (manual, user-run)**

In a Claude Code session rooted at Carven, run:
- `/plugin marketplace add /Users/heber/Documents/GitHub/agent-workflows/dist-local`
- `/plugin install autobuild`

Expected: `autobuild` plugin installed; `/autobuild-one` command available. (This step is interactive; the implementing agent should pause and ask the user to run it, then confirm.)

- [ ] **Step 5: Pick a trivial validation bead**

Run: `bd ready --json | head -c 2000` (in Carven). Choose ONE small, low-risk, single-file bead (or create a throwaway one: `bd create --type chore --title "autobuild smoke: add a code comment to apps/api/src/index.ts" -p 3`). Note its key.

- [ ] **Step 6: Run /autobuild-one on the bead (user-driven, interactive)**

In the Carven session: `/autobuild-one <bead-key>`
Expected: engine runs design → worktree setup → implement → 3-way review → returns `verdict`. Observe the live progress via `/workflows`.

- [ ] **Step 7: Verify the spine end-to-end**

Confirm, with evidence:
```bash
# a worktree was created off development
git -C /Users/heber/Documents/GitHub/carven worktree list
# the ticket branch has commits (spec + chunk commits)
git -C /Users/heber/Documents/GitHub/carven log --oneline <branch> -5
# nothing was pushed
git -C /Users/heber/Documents/GitHub/carven log --oneline origin/development -1
```
Expected: a worktree for the branch exists; branch has a spec commit + at least one chunk commit; `origin/development` is unchanged (no push). The command reported a `clean` or `blocked` verdict with findings.

- [ ] **Step 8: Clean up the smoke worktree**

```bash
git -C /Users/heber/Documents/GitHub/carven worktree remove <worktree-path> --force
git -C /Users/heber/Documents/GitHub/carven branch -D <branch>
```
(If the bead was a throwaway, `bd close <key>` or delete it.)

- [ ] **Step 9: Commit the Carven consumer files (Carven repo, feat branch)**

```bash
cd /Users/heber/Documents/GitHub/carven
git add .claude/autobuild.config.json .claude/autobuild.md
git commit -m "chore: add autobuild consumer config + conventions profile"
```

---

## Self-Review

**Spec coverage (spine scope):**
- Generic engine, config-driven, never push/merge → Tasks 3, 4 (engine), enforced in tests.
- Design phase + chunks + escalations → Task 3 (DESIGN_SCHEMA, design phase, escalation short-circuit).
- Worktree setup → Task 3 setup phase.
- Model-tiered TDD implement, per-chunk commit → Task 3 implement loop + implement.md prompt.
- Parallel code + security + design-conformance review, errored reviewer = not clean → Task 3 review loop (`allReturned` gate).
- Fix loop ≤ maxFixRounds → Task 3.
- Build to Claude plugin, local dev loop → Task 4 (`--local`).
- Config validation at launch → Task 1 + Task 5 step 3, and command step 1.
- Carven reference consumer + end-to-end validation on one bead → Task 5.
- DEFERRED (follow-up plans, intentionally absent): wave-packing, autonomous overnight loop, rate-limit anchor/wakeup/resume, rendered UI review, the `/autobuild` autonomous command. Noted in plan header.

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. Step 4 of Task 5 is necessarily interactive (plugin install is a TUI action) and is explicitly marked user-run with a pause instruction — not a placeholder.

**Type consistency:** Engine `args` contract `{config, profile, ticket:{key,branch,specPath?,chunks?,ticketText?}, autonomous}` is consistent between Task 3 (engine) and Task 4 (command body invocation). Return shape `{key,branch,worktreePath,specPath,verdict,findings,escalations?}` consistent between engine and command step 4/5. `loadPrompts()` keys (`design/implement/codeReview/securityReview/designConformance`) match the build's marker map and the engine's marker names.

**Note for executor:** the engine references `Workflow({ name: 'autobuild' })` from the command — this resolves only after the plugin is installed (Task 5 step 4). During Tasks 1–4 the engine is validated by parsing/structure tests, not by execution; first real execution is Task 5.
