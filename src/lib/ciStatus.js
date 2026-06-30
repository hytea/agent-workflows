'use strict'

// Classify `gh pr checks <branch> --json bucket,name` output into one
// verdict the autobuild-issue EM supervisor branches on. Pure + total: malformed
// input never throws.
//
// gh's `bucket` field is the authoritative categorizer (see `gh pr checks
// --help`): 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel'. We treat pass
// and skipping as satisfied, fail and cancel as blocking, pending as not-yet,
// and ANY unrecognized bucket as pending (never silently pass a state we don't
// understand). NOTE the caller must NOT collapse gh's non-zero exit (8=pending,
// 1=failing) to an empty array — an empty array means "no checks configured",
// which is a DIFFERENT verdict (none) from "could not read checks" (unknown).

const PASS = new Set(['pass', 'skipping'])
const FAIL = new Set(['fail', 'cancel'])

function bucketOf(check) {
  return String((check && check.bucket) || '').toLowerCase()
}

function summarize(checks) {
  // Non-array input means we could not read a checks list at all — distinct from
  // an empty list (genuinely no CI). The caller must treat 'unknown' as "do not
  // declare merge-ready", never as success.
  if (!Array.isArray(checks)) return { state: 'unknown', pending: 0, failing: [] }
  if (checks.length === 0) return { state: 'none', pending: 0, failing: [] }
  const failing = []
  let pending = 0
  for (const c of checks) {
    const b = bucketOf(c)
    if (PASS.has(b)) continue
    if (FAIL.has(b)) failing.push({ name: (c && c.name) || '(unnamed)' })
    else pending++ // 'pending' and any unrecognized bucket: not yet conclusive
  }
  let state
  if (failing.length > 0) state = 'failing'
  else if (pending > 0) state = 'pending'
  else state = 'passing'
  return { state, pending, failing }
}

module.exports = { summarize }
