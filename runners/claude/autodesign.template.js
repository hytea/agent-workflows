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
