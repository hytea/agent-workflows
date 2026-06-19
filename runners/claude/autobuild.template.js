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
const MAX_FIX_ROUNDS = Number.isInteger(CAPS.maxFixRounds) ? CAPS.maxFixRounds : 2
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
  `${RULES}\n\nPrepare ${T.key}. git fetch origin. Create a fresh git WORKTREE for branch "${T.branch}" off "origin/${BASE}" (git worktree add -b ${T.branch} <path> origin/${BASE}). The approved design spec is at "${specPath}"; ensure it is committed on this branch. Run the install command if deps are missing. Return the absolute worktree path (worktreePath) and HEAD sha (headSha). Do NOT implement.`,
  { label: `${T.key} setup`, phase: 'setup', model: 'haiku', agentType: 'claude', schema: SETUP_SCHEMA }
)

if (!setup) return { key: T.key, branch: T.branch, specPath, verdict: 'blocked', findings: [{ issue: 'setup agent errored' }] }

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
  worktreePath: setup.worktreePath,
  specPath, verdict: clean ? 'clean' : 'blocked', findings: clean ? [] : lastBlocking,
}
