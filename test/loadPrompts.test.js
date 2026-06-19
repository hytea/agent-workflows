const test = require('node:test')
const assert = require('node:assert')
const { loadPrompts } = require('../src/lib/loadPrompts')

test('loads all five prompts as non-empty strings', () => {
  const p = loadPrompts()
  for (const k of ['design', 'implement', 'codeReview', 'securityReview', 'designConformance']) {
    assert.ok(typeof p[k] === 'string' && p[k].length > 0, `missing ${k}`)
  }
})

test('implement prompt references the RULES placeholder', () => {
  assert.match(loadPrompts().implement, /\{RULES\}/)
})
