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
  assert.match(src, /haveTestCmd = !!testCmd/, 'gate must be skipped when no test command is configured')
})

test('template lets a chunk opt out of the TDD gate when genuinely non-testable', () => {
  // A docs/LICENSE/config chunk marked testExempt must not be hard-blocked.
  assert.match(src, /testExempt/, 'must honor a per-chunk testExempt flag')
  assert.match(src, /gateChunk = haveTestCmd && !c\.testExempt/, 'gate must skip exempt chunks')
})

test('UI-touch detection fails CLOSED when the detector errors', () => {
  // If the cheap ui-detect agent errors (returns null), the engine must NOT
  // silently skip the rendered UI review (fail-open). Like every other reviewer,
  // an unknown UI verdict must err toward running the review, not merging blind.
  assert.match(
    src,
    /touchesUI = det \? !!det\.touchesUI : uiConfigured/,
    'errored UI detection must default to running the UI review when UI is configured'
  )
})

test('a blocked verdict from an errored reviewer carries an actionable finding', () => {
  // When reviewers all return clean blocking lists but one ERRORED (null), the
  // run is not clean yet lastBlocking is empty. The final verdict must not be
  // "blocked" with findings:[] — a human parking it needs a reason. The engine
  // must synthesize a finding describing the errored reviewer.
  assert.match(src, /reviewer (errored|did not return)/i, 'must explain an errored-reviewer block')
  assert.match(src, /lastBlocking = blocking\.length/, 'must backfill an explanatory finding when blocking is empty but not clean')
})
