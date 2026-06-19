const test = require('node:test')
const assert = require('node:assert')
const { validateConfig } = require('../src/lib/validateConfig')

const good = {
  base: 'development',
  pushAllowed: false,
  ticket: { system: 'bd', ready: 'bd ready --label {readyLabel} --json', show: 'bd show {key} --json', claim: 'bd update {key} --claim', note: 'bd update {key} --append-notes {text}', label: 'bd update {key} --add-label {label}' },
  vcs: { mode: 'local-merge' },
  toolchain: { install: 'npm install', build: 'npm run build', test: 'npm run test' },
  labels: { ready: 'ready-to-build', parked: 'needs-human' },
}

test('accepts a valid config', () => {
  const r = validateConfig(good)
  assert.strictEqual(r.valid, true, JSON.stringify(r.errors))
})

test('rejects missing required base', () => {
  const bad = { ...good }; delete bad.base
  const r = validateConfig(bad)
  assert.strictEqual(r.valid, false)
})

test('rejects unknown vcs mode', () => {
  const bad = { ...good, vcs: { mode: 'svn-commit' } }
  const r = validateConfig(bad)
  assert.strictEqual(r.valid, false)
})

test('rejects an unknown top-level property (additionalProperties:false)', () => {
  const bad = { ...good, surprise: true }
  const r = validateConfig(bad)
  assert.strictEqual(r.valid, false)
})

test('rejects a wrong-typed property', () => {
  const bad = { ...good, base: 42 }
  const r = validateConfig(bad)
  assert.strictEqual(r.valid, false)
})

test('rejects a missing nested required ticket field', () => {
  const bad = { ...good, ticket: { ...good.ticket } }; delete bad.ticket.show
  const r = validateConfig(bad)
  assert.strictEqual(r.valid, false)
})
