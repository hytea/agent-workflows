const test = require('node:test')
const assert = require('node:assert')
const { summarize } = require('../src/lib/ciStatus')

// `gh pr checks <branch> --json bucket,state,name` emits one object per check.
// The authoritative categorizer is `bucket`: 'pass' | 'fail' | 'pending' |
// 'skipping' | 'cancel'. summarize() reduces the list to one verdict the EM
// supervisor branches on, distinguishing "no CI configured" (none) from
// "could not read CI" (unknown) so a read failure never reads as merge-ready.

test('no checks configured -> none', () => {
  assert.strictEqual(summarize([]).state, 'none')
})

test('non-array / malformed input -> unknown (never none, never throws)', () => {
  assert.strictEqual(summarize(null).state, 'unknown')
  assert.strictEqual(summarize(undefined).state, 'unknown')
  assert.strictEqual(summarize('garbage').state, 'unknown')
})

test('all pass -> passing', () => {
  const r = summarize([
    { name: 'build', bucket: 'pass' },
    { name: 'test', bucket: 'pass' },
  ])
  assert.strictEqual(r.state, 'passing')
  assert.strictEqual(r.pending, 0)
  assert.deepStrictEqual(r.failing, [])
})

test('any pending (none failing) -> pending', () => {
  const r = summarize([
    { name: 'build', bucket: 'pass' },
    { name: 'test', bucket: 'pending' },
  ])
  assert.strictEqual(r.state, 'pending')
  assert.strictEqual(r.pending, 1)
})

test('any fail -> failing, even with others pending', () => {
  const r = summarize([
    { name: 'lint', bucket: 'fail' },
    { name: 'test', bucket: 'pending' },
  ])
  assert.strictEqual(r.state, 'failing')
  assert.deepStrictEqual(r.failing.map((f) => f.name), ['lint'])
})

test('cancel counts as failing (a cancelled required check blocks merge)', () => {
  const r = summarize([
    { name: 'e2e', bucket: 'cancel' },
    { name: 'build', bucket: 'pass' },
  ])
  assert.strictEqual(r.state, 'failing')
  assert.deepStrictEqual(r.failing.map((f) => f.name), ['e2e'])
})

test('skipping is non-blocking (does not fail or stall the gate)', () => {
  const r = summarize([
    { name: 'optional', bucket: 'skipping' },
    { name: 'test', bucket: 'pass' },
  ])
  assert.strictEqual(r.state, 'passing')
  assert.deepStrictEqual(r.failing, [])
})

test('all skipping -> passing (nothing to wait on, nothing failed)', () => {
  const r = summarize([
    { name: 'a', bucket: 'skipping' },
    { name: 'b', bucket: 'skipping' },
  ])
  assert.strictEqual(r.state, 'passing')
})

test('bucket is case-insensitive', () => {
  const r = summarize([
    { name: 'build', bucket: 'PASS' },
    { name: 'test', bucket: 'Fail' },
  ])
  assert.strictEqual(r.state, 'failing')
  assert.deepStrictEqual(r.failing.map((f) => f.name), ['test'])
})

test('an unrecognized bucket is treated as pending, not silently passed', () => {
  // Forward-compat: a bucket value gh adds later must never be mistaken for
  // pass. Unknown => not-yet-conclusive (pending), so the gate keeps polling
  // rather than declaring a PR merge-ready on a state it does not understand.
  const r = summarize([{ name: 'mystery', bucket: 'something-new' }])
  assert.strictEqual(r.state, 'pending')
})
