const test = require('node:test')
const assert = require('node:assert')
const { summarize } = require('../src/lib/ciStatus')

// gh pr checks --json name,state,conclusion emits one object per check. Older gh
// reports a `state` ('SUCCESS'|'FAILURE'|'PENDING'|...), newer adds `conclusion`
// alongside a bucket. summarize must reduce a heterogeneous list to one verdict
// the EM supervisor can branch on without parsing gh's surface itself.

test('no checks at all -> none (CI not configured on the repo)', () => {
  const r = summarize([])
  assert.strictEqual(r.state, 'none')
})

test('all successful -> passing', () => {
  const r = summarize([
    { name: 'build', state: 'SUCCESS' },
    { name: 'test', state: 'SUCCESS' },
  ])
  assert.strictEqual(r.state, 'passing')
  assert.strictEqual(r.pending, 0)
  assert.deepStrictEqual(r.failing, [])
})

test('any pending (and none failing) -> pending', () => {
  const r = summarize([
    { name: 'build', state: 'SUCCESS' },
    { name: 'test', state: 'PENDING' },
  ])
  assert.strictEqual(r.state, 'pending')
  assert.strictEqual(r.pending, 1)
})

test('any failure -> failing, even if others still pending', () => {
  const r = summarize([
    { name: 'lint', state: 'FAILURE' },
    { name: 'test', state: 'PENDING' },
  ])
  assert.strictEqual(r.state, 'failing')
  assert.deepStrictEqual(r.failing.map((f) => f.name), ['lint'])
})

test('classifies via conclusion when state is the generic COMPLETED bucket', () => {
  const r = summarize([
    { name: 'build', state: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: 'e2e', state: 'COMPLETED', conclusion: 'FAILURE' },
  ])
  assert.strictEqual(r.state, 'failing')
  assert.deepStrictEqual(r.failing.map((f) => f.name), ['e2e'])
})

test('treats SKIPPED and NEUTRAL conclusions as non-blocking (not failures)', () => {
  const r = summarize([
    { name: 'optional', state: 'COMPLETED', conclusion: 'SKIPPED' },
    { name: 'advisory', state: 'COMPLETED', conclusion: 'NEUTRAL' },
    { name: 'test', state: 'SUCCESS' },
  ])
  assert.strictEqual(r.state, 'passing')
  assert.deepStrictEqual(r.failing, [])
})

test('lower-cased gh states are handled too', () => {
  const r = summarize([
    { name: 'build', state: 'success' },
    { name: 'test', state: 'failure' },
  ])
  assert.strictEqual(r.state, 'failing')
  assert.deepStrictEqual(r.failing.map((f) => f.name), ['test'])
})

test('never throws on malformed input', () => {
  assert.strictEqual(summarize(null).state, 'none')
  assert.strictEqual(summarize(undefined).state, 'none')
  assert.strictEqual(summarize('garbage').state, 'none')
  assert.strictEqual(summarize([{ junk: true }]).state, 'pending') // unknown = not yet conclusive
})
