const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const src = fs.readFileSync(
  path.join(__dirname, '..', 'runners', 'claude', 'autobuild-supervisor.template.js'), 'utf8'
)

test('supervisor begins with a meta export and never pushes', () => {
  assert.match(src, /export const meta = \{/)
  assert.ok(!/git push/.test(src), 'supervisor must never push')
})

test('supervisor threads a per-bead waveIndex into each parallel engine call', () => {
  // The engine computes uiPort = devServerPortBase + waveIndex so concurrent
  // UI-touching beads bind distinct dev-server ports. The supervisor fans the
  // beads out via parallel(), so each call MUST pass its own index — otherwise
  // every bead defaults to waveIndex 0, collides on the port, and the second
  // UI bead is spuriously parked.
  assert.match(src, /waveIndex/, 'supervisor must pass waveIndex into the engine')
  // The map callback must expose the index and forward it.
  assert.match(src, /\.map\(\s*\(b,\s*i\)\s*=>/, 'wave map must capture the bead index')
})
