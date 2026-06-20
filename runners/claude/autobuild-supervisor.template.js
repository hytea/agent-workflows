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
