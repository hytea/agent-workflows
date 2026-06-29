// test/designNotes.test.js
const test = require('node:test')
const assert = require('node:assert')
const { serializeDesign, parseDesign } = require('../src/lib/designNotes')

const design = {
  specPath: 'docs/superpowers/specs/2026-06-19-x.md',
  surface: ['apps/api/src/foo'],
  chunks: [{ id: 'c1', title: 'do thing', model: 'sonnet', files: ['apps/api/src/foo/x.ts'], instructions: 'TDD it' }],
}

test('round-trips through serialize then parse', () => {
  const block = serializeDesign(design)
  const parsed = parseDesign(`some prior notes\n${block}\ntrailing`)
  assert.deepStrictEqual(parsed, design)
})

test('serialized block carries only the three cache keys', () => {
  const block = serializeDesign({ ...design, escalations: [{ decision: 'x' }] })
  const parsed = parseDesign(block)
  assert.deepStrictEqual(Object.keys(parsed).sort(), ['chunks', 'specPath', 'surface'])
})

test('parseDesign returns null when no block present', () => {
  assert.strictEqual(parseDesign('just some human notes, no fence'), null)
})

test('parseDesign returns null on malformed JSON, does not throw', () => {
  const bad = '```autodesign\n{not valid json\n```'
  assert.strictEqual(parseDesign(bad), null)
})

test('parseDesign takes the LAST block when re-designed', () => {
  const first = serializeDesign({ ...design, specPath: 'OLD.md' })
  const second = serializeDesign({ ...design, specPath: 'NEW.md' })
  const parsed = parseDesign(`${first}\n...later...\n${second}`)
  assert.strictEqual(parsed.specPath, 'NEW.md')
})

test('parseDesign advances cleanly past each close across many adjacent blocks', () => {
  // Three blocks with no filler between them. The scan cursor must land strictly
  // PAST each closing fence (\n```), not on its last backtick, so every block is
  // consumed exactly once and the genuinely-last design wins.
  const blocks = ['A.md', 'B.md', 'LAST.md'].map((p) => serializeDesign({ ...design, specPath: p }))
  const parsed = parseDesign(blocks.join('\n'))
  assert.strictEqual(parsed.specPath, 'LAST.md')
})

test('parseDesign returns the closing fence position past the delimiter (no re-scan)', () => {
  // A single block whose JSON body itself contains the FENCE_OPEN token must not
  // confuse the cursor: parsing returns the real payload, never a fragment.
  const block = serializeDesign({ ...design, specPath: 'docs/```autodesign-in-path.md' })
  const parsed = parseDesign(`prefix\n${block}\nsuffix`)
  assert.strictEqual(parsed.specPath, 'docs/```autodesign-in-path.md')
})
