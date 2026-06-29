'use strict'

// Classify `gh pr checks --json name,state,conclusion` output into one verdict
// the autobuild-issue EM supervisor branches on. Pure + total: malformed input
// never throws, it degrades to a non-conclusive verdict.
//
// gh reports each check with a `state`. For check runs the state can be the
// generic terminal bucket COMPLETED, in which case the real outcome is in
// `conclusion`. We treat SUCCESS and the non-blocking conclusions (SKIPPED,
// NEUTRAL) as fine, FAILURE/CANCELLED/TIMED_OUT/ACTION_REQUIRED as failing, and
// anything not yet terminal (PENDING/QUEUED/IN_PROGRESS/unknown) as pending.

const PASS = new Set(['SUCCESS'])
const NONBLOCKING = new Set(['SKIPPED', 'NEUTRAL'])
const FAIL = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'])

// The effective outcome for one check: prefer conclusion when the state is the
// generic COMPLETED bucket (or absent), else use state.
function outcome(check) {
  const state = String((check && check.state) || '').toUpperCase()
  const conclusion = String((check && check.conclusion) || '').toUpperCase()
  const terminalBucket = state === 'COMPLETED' || state === ''
  const verdict = terminalBucket && conclusion ? conclusion : state
  if (PASS.has(verdict) || NONBLOCKING.has(verdict)) return 'pass'
  if (FAIL.has(verdict)) return 'fail'
  return 'pending'
}

function summarize(checks) {
  if (!Array.isArray(checks) || checks.length === 0) {
    return { state: 'none', pending: 0, failing: [] }
  }
  const failing = []
  let pending = 0
  for (const c of checks) {
    const o = outcome(c)
    if (o === 'fail') failing.push({ name: (c && c.name) || '(unnamed)' })
    else if (o === 'pending') pending++
  }
  let state
  if (failing.length > 0) state = 'failing'
  else if (pending > 0) state = 'pending'
  else state = 'passing'
  return { state, pending, failing }
}

module.exports = { summarize }
