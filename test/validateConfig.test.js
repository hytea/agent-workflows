const test = require('node:test')
const assert = require('node:assert')
const { validateConfig } = require('../src/lib/validateConfig')

const good = {
  base: 'development',
  pushAllowed: false,
  ticket: { system: 'bd', ready: 'bd ready --label {readyLabel} --json', show: 'bd show {key} --json', claim: 'bd update {key} --claim', note: 'bd update {key} --append-notes {text}', label: 'bd update {key} --add-label {label}' },
  vcs: { mode: 'local-merge' },
  toolchain: { install: 'npm install', build: 'npm run build', test: 'npm run test' },
  labels: { ready: 'ready-to-build', parked: 'needs-human', designed: 'designed' },
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

test('rejects a config missing labels.designed with an actionable error', () => {
  // labels.designed is consumed by /autodesign and /autobuild (they apply it as
  // the "cached design" tag), so it is genuinely required — a config without it
  // cannot run the design→build flow. The rejection must name the missing key so
  // an upgrading user knows exactly what to add.
  const bad = { ...good, labels: { ...good.labels } }; delete bad.labels.designed
  const r = validateConfig(bad)
  assert.strictEqual(r.valid, false)
  assert.ok(r.errors.some((e) => /designed/.test(e)), `error must name 'designed': ${JSON.stringify(r.errors)}`)
})

test('enforces object checks on a type-less node (properties/required only)', () => {
  // Guards the validator against a future schema node that omits type:'object'
  // but declares required/additionalProperties — JSON Schema permits this and
  // the node must still be enforced rather than silently skipped.
  const { validateNode } = require('../src/lib/validateConfig')
  const node = {
    required: ['a'],
    additionalProperties: false,
    properties: { a: { type: 'string' } },
  }
  // missing required 'a'
  assert.strictEqual(validateNode({}, node).valid, false, 'must catch missing required on a type-less node')
  // unknown property
  assert.strictEqual(validateNode({ a: 'x', b: 1 }, node).valid, false, 'must catch unknown prop on a type-less node')
  // valid
  assert.strictEqual(validateNode({ a: 'x' }, node).valid, true)
})
