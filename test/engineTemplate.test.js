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
