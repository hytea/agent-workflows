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
