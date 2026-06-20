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
