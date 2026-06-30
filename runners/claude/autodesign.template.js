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
  `DESTRUCTIVE-OPERATION GUARDRAIL (autonomous mode): you are DESIGNING ONLY — write the spec file and nothing else. NEVER run destructive git (reset --hard, checkout/restore over a modified file, clean -fd, stash drop), NEVER rm -rf or overwrite files you did not create, and NEVER touch the database or any external service. If the task seems to need such an action, capture it as an escalation rather than performing it.`,
  PROFILE ? `Repo conventions:\n${PROFILE}` : '',
].filter(Boolean).join(' ')

// Shared design-agent output contract, inlined at build time from
// src/lib/designSchema.js (workflow bodies cannot require) — same source the
// autobuild engine uses, so the two never validate against divergent shapes.
const DESIGN_SCHEMA = /*__SCHEMA:design__*/

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
