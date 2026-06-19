const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const src = fs.readFileSync(
  path.join(__dirname, '..', 'runners', 'claude', 'autobuild.template.js'), 'utf8'
)

test('template begins with a meta export', () => {
  assert.match(src, /export const meta = \{/)
})

test('template contains all five prompt markers', () => {
  for (const m of ['design', 'implement', 'codeReview', 'securityReview', 'designConformance']) {
    assert.ok(src.includes(`/*__PROMPT:${m}__*/`), `missing marker ${m}`)
  }
})

test('template never calls git push', () => {
  assert.ok(!/git push/.test(src), 'engine must never push')
})

test('template defines a REVIEW_SCHEMA and uses parallel for reviews', () => {
  assert.match(src, /REVIEW_SCHEMA/)
  assert.match(src, /await parallel\(/)
})

test('template enforces a TDD red-phase gate on implement chunks', () => {
  assert.match(src, /IMPLEMENT_SCHEMA/, 'must define an implement schema capturing red/green evidence')
  assert.match(src, /redExitCode/, 'must capture the red-phase exit code')
  // Gate must block when the red phase did not actually fail (exit 0).
  assert.match(src, /redOk[\s\S]*redExitCode !== 0/, 'must require a non-zero red exit')
  assert.match(src, /enforceRed = !!testCmd/, 'gate must be skipped when no test command is configured')
})
