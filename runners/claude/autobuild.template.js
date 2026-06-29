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
const AUTONOMOUS = !!A.autonomous // reserved: consumed by the autonomous supervisor (follow-up plan)
const BASE = CFG.base
const TC = CFG.toolchain || {}
const CAPS = CFG.caps || {}
const UI = CFG.ui || {}
const MAX_FIX_ROUNDS = Number.isInteger(CAPS.maxFixRounds) ? CAPS.maxFixRounds : 2
// UI review runs only when the repo declares a renderable frontend (ui config
// with a dev-server command) AND the change touches the app glob. The port is
// the configured base plus an optional caller-supplied wave index so parallel
// worktrees never bind the same port.
const uiConfigured = !!(UI.devServerCmd && UI.appGlob)
const uiPort = (Number.isInteger(UI.devServerPortBase) ? UI.devServerPortBase : 4100) + (Number.isInteger(A.waveIndex) ? A.waveIndex : 0)
if (!T.key || !BASE) {
  return { error: 'autobuild requires args.config.base and args.ticket.key', got: { base: BASE, key: T.key } }
}

const testCmd = TC.test || ''
const lintCmd = TC.lint || ''
const buildCmd = TC.build || ''

// RULES: assembled from config + the consumer's autobuild.md (passed in A.profile).
const PROFILE = A.profile || ''
const noPush = CFG.pushAllowed ? '' : ' Do not push commits to any remote.'
const RULES = [
  `Operate ONLY inside the assigned worktree (absolute paths or git -C). Base branch: ${BASE}.`,
  `Toolchain: install="${TC.install || ''}", build="${buildCmd}", test="${testCmd}", lint="${lintCmd}".`,
  `TDD is mandatory: failing test first, then implement. Match existing conventions.`,
  `Use these ticket commands (substitute placeholders): show="${(CFG.ticket||{}).show||''}", note="${(CFG.ticket||{}).note||''}", label="${(CFG.ticket||{}).label||''}".`,
  `git add ONLY the current chunk's files (never "git add -A").${noPush}`,
  `DESTRUCTIVE-OPERATION GUARDRAIL (autonomous mode — you cannot ask a human, so never guess): ` +
    `NEVER run a command that discards work or mutates state outside your chunk without first auditing the exact ramifications. Specifically forbidden unless you have inspected the full state and confirmed zero unintended loss: ` +
    `(a) destructive git — git reset --hard, git checkout/restore that overwrites a modified file, git clean -fd, git stash drop, force branch deletion, or anything that drops uncommitted or unpushed work; prefer git reset --soft/--mixed, inspect git status + git stash list + git reflog first, and NEVER run any of these while unrelated dirty files are present in the tree. ` +
    `(b) filesystem destruction — rm -rf, deleting untracked files, or overwriting/truncating any file you did not create or that lies OUTSIDE your assigned worktree. ` +
    `(c) database / external mutation — destructive migrations (e.g. prisma migrate reset), dropping tables, destructive SQL, deleting cloud resources, or sending real emails/webhooks/payments. ` +
    `If a task seems to require any of the above, STOP and surface it as a blocking finding (the supervisor will park it needs-human) — do not perform the operation. To undo your OWN just-made commit, use git reset --soft HEAD~1 inside the worktree, never --hard.`,
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
const SETUP_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['worktreePath', 'headSha'],
  properties: { worktreePath: { type: 'string' }, headSha: { type: 'string' } },
}
// Forces the implementer to report observed red→green evidence so the engine
// can mechanically reject chunks where the failing-test-first phase was skipped
// or the test did not actually discriminate the change (red exit was 0).
const IMPLEMENT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['testFile', 'redCommand', 'redExitCode', 'redFailureMessage', 'greenCommand', 'greenExitCode', 'committed'],
  properties: {
    testFile: { type: 'string' },
    redCommand: { type: 'string' },
    redExitCode: { type: 'integer' },
    redFailureMessage: { type: 'string' },
    greenCommand: { type: 'string' },
    greenExitCode: { type: 'integer' },
    lintExitCode: { type: 'integer' },
    committed: { type: 'boolean' },
  },
}
// Shared design-agent output contract, inlined at build time from
// src/lib/designSchema.js (workflow bodies cannot require). Single source means
// the engine and autodesign never validate against divergent shapes.
const DESIGN_SCHEMA = /*__SCHEMA:design__*/

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
  `${RULES}\n\nPrepare ${T.key}. Create a fresh git WORKTREE for branch "${T.branch}" off the LOCAL "${BASE}" branch (git worktree add -b ${T.branch} <path> ${BASE}). Fork off LOCAL ${BASE} — NOT origin/${BASE} — because the supervisor merges each finished ticket into local ${BASE} as the run progresses, so local ${BASE} is the freshest, most-compounded state; building off it lets this ticket's work compound on prior tickets and avoids same-file merge conflicts later. (The supervisor is responsible for bringing local ${BASE} up to date with origin once at run start; do not fetch/reset ${BASE} yourself.) The approved design spec was written to "${specPath}" but is NOT yet committed (it may be an uncommitted file in the current checkout, which the new worktree cannot see). Ensure the spec exists INSIDE the worktree at the same relative path (copy it in if absent) and commit it there on "${T.branch}" with message "docs(${T.key}): design spec" — use git -C <worktreePath> for every git command so nothing lands on the base branch. Run the install command if deps are missing. Return the absolute worktree path (worktreePath) and HEAD sha (headSha). Do NOT implement.`,
  { label: `${T.key} setup`, phase: 'setup', model: 'haiku', agentType: 'claude', schema: SETUP_SCHEMA }
)

if (!setup) return { key: T.key, branch: T.branch, specPath, verdict: 'blocked', findings: [{ issue: 'setup agent errored' }] }
// All subsequent agents (implement/review/fix) operate INSIDE the worktree.
// Thread its absolute path into the prompt context so every git command can be
// scoped to it (git -C {worktreePath}); otherwise an agent that does not cd into
// the worktree commits to the ambient branch (the base branch), leaking work.
ctx.worktreePath = setup.worktreePath
// UI-review context (consumed only when the UI reviewer runs).
ctx.uiPort = uiPort
ctx.devServerCmd = (UI.devServerCmd || '').replace('{port}', String(uiPort))

// IMPLEMENT (sequential, model per chunk). Each chunk reports red→green
// evidence; the engine gates on a real red phase so a non-discriminating test
// (passes with and without the fix) cannot slip through as "TDD done".
phase('implement')
const haveTestCmd = !!testCmd // no test command configured => nothing to gate
for (const c of chunks) {
  // A chunk may be genuinely non-testable (LICENSE, README, pure config). The
  // design agent marks those testExempt with a reason; the gate then skips so a
  // legitimate chunk is not hard-blocked just because the repo has a test cmd.
  const gateChunk = haveTestCmd && !c.testExempt
  if (haveTestCmd && c.testExempt) log(`${T.key} ${c.id}: TDD gate skipped (testExempt: ${c.testExemptReason || 'no reason given'})`)
  const impl = await agent(
    fill(/*__PROMPT:implement__*/, { ...ctx, chunkId: c.id, chunkTitle: c.title, chunkFiles: (c.files || []).join(', '), chunkInstructions: c.instructions }),
    { label: `${T.key} ${c.id}: ${c.title}`, phase: 'implement', model: c.model || 'sonnet', agentType: 'claude', schema: gateChunk ? IMPLEMENT_SCHEMA : undefined }
  )
  if (!impl) return { key: T.key, branch: T.branch, specPath, worktreePath: setup.worktreePath, verdict: 'blocked', findings: [{ issue: `implement agent errored on chunk ${c.id}` }] }
  if (gateChunk) {
    const redOk = Number.isInteger(impl.redExitCode) && impl.redExitCode !== 0
    const greenOk = impl.greenExitCode === 0
    if (!redOk || !greenOk || !impl.committed) {
      log(`${T.key} ${c.id}: TDD gate failed (red=${impl.redExitCode}, green=${impl.greenExitCode}, committed=${impl.committed})`)
      return {
        key: T.key, branch: T.branch, specPath, worktreePath: setup.worktreePath, verdict: 'blocked',
        findings: [{
          severity: 'high', file: impl.testFile || (c.files || [])[0] || '',
          issue: `TDD red phase not satisfied for chunk ${c.id}: the test did not fail before implementation (red exit ${impl.redExitCode}, green exit ${impl.greenExitCode}, committed ${impl.committed}). A test that passes without the change does not discriminate the fix.`,
          fix: 'Make the test fail without the implementation (usually the mock/fixture is too permissive), prove red, then re-implement.',
        }],
      }
    }
  }
}

// UI-TOUCH DETECTION: the rendered UI reviewer runs only when the repo declares
// a renderable frontend (ui config) AND this change touches the app glob. The
// workflow cannot run git itself, so a cheap agent reports the diff verdict once.
let touchesUI = false
if (uiConfigured) {
  const det = await agent(
    `${RULES}\n\nIn the worktree at "${setup.worktreePath}", run: git -C "${setup.worktreePath}" diff --name-only ${BASE}...${T.branch}. Does ANY changed path match the glob "${UI.appGlob}"? Answer strictly via the schema.`,
    { label: `${T.key} ui-detect`, phase: 'review', model: 'haiku', agentType: 'claude', schema: { type: 'object', additionalProperties: false, required: ['touchesUI'], properties: { touchesUI: { type: 'boolean' } } } }
  )
  // Fail CLOSED: a null det means the detector errored, so we cannot prove the
  // change is UI-free. Default to running the rendered review (every other
  // reviewer fails closed too) rather than silently merging a UI change unseen.
  touchesUI = det ? !!det.touchesUI : uiConfigured
  if (!det) log(`${T.key}: ui-detect errored → running UI review anyway (fail-closed, port ${uiPort})`)
  else if (touchesUI) log(`${T.key}: change touches ${UI.appGlob} → UI review enabled (port ${uiPort})`)
}

// REVIEW + FIX loop
let round = 0, clean = false, lastBlocking = []
while (round <= MAX_FIX_ROUNDS) {
  phase('review')
  // Code/security/design-conformance always run. The rendered UI reviewer is
  // appended only for UI-touching changes; it renders the page via Playwright
  // on the allocated port. A reviewer that errors returns null → treated as
  // NOT clean (never a silent pass).
  const reviewers = [
    () => agent(fill(/*__PROMPT:codeReview__*/, ctx), { label: `${T.key} code r${round}`, phase: 'review', model: 'opus', agentType: 'claude', schema: REVIEW_SCHEMA }),
    () => agent(fill(/*__PROMPT:securityReview__*/, ctx), { label: `${T.key} sec r${round}`, phase: 'review', model: 'opus', agentType: 'claude', schema: REVIEW_SCHEMA }),
    () => agent(fill(/*__PROMPT:designConformance__*/, ctx), { label: `${T.key} conf r${round}`, phase: 'review', model: 'opus', agentType: 'claude', schema: REVIEW_SCHEMA }),
  ]
  if (touchesUI) {
    reviewers.push(() => agent(fill(/*__PROMPT:uiReview__*/, ctx), { label: `${T.key} ui r${round}`, phase: 'review', model: 'opus', agentType: 'claude', schema: REVIEW_SCHEMA }))
  }
  const reviews = await parallel(reviewers)
  const [code, sec, conf] = reviews
  const ui = touchesUI ? reviews[3] : true // non-UI tickets have no UI reviewer to satisfy
  const allReturned = code && sec && conf && ui
  const blocking = reviews.flatMap((r) => (r && r.blocking) || [])
  // A reviewer that ERRORED contributes nothing to `blocking`, so the run can be
  // not-clean (allReturned false) with an empty blocking list. Backfill an
  // actionable finding naming the missing reviewer so a parked ticket never
  // carries an empty, reasonless findings list.
  const reviewerNames = touchesUI ? ['code', 'security', 'design-conformance', 'ui'] : ['code', 'security', 'design-conformance']
  const erroredReviewers = reviewerNames.filter((_n, i) => !reviews[i])
  lastBlocking = blocking.length || allReturned ? blocking : erroredReviewers.map((n) => ({
    severity: 'high', file: '', issue: `The ${n} reviewer did not return (agent errored), so this ticket could not be verified clean.`,
    fix: `Re-run the build for ${T.key}; the ${n} review must complete before merge.`,
  }))
  if (blocking.length === 0 && allReturned) { clean = true; break }
  if (round === MAX_FIX_ROUNDS) { log(`${T.key}: ${blocking.length} blocking after ${round} rounds (or a reviewer errored)`); break }
  phase('fix')
  await agent(
    `${RULES}\n\nFix these BLOCKING review findings for ${T.key} on branch "${T.branch}", working INSIDE the worktree at "${setup.worktreePath}" (cd there or use git -C "${setup.worktreePath}" for every git command — never commit from the base checkout). Commit relevant files only. Re-run the test and lint commands until green. Findings:\n${JSON.stringify(blocking, null, 2)}`,
    { label: `${T.key} fix r${round}`, phase: 'fix', model: 'opus', agentType: 'claude' }
  )
  round++
}

return {
  key: T.key, branch: T.branch,
  worktreePath: setup.worktreePath,
  specPath, verdict: clean ? 'clean' : 'blocked', findings: clean ? [] : lastBlocking,
}
