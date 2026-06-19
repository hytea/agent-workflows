const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { build } = require('../build/build')

test('built engine has no unreplaced prompt markers', () => {
  const { distDir } = build({ local: true })
  const engine = fs.readFileSync(path.join(distDir, 'plugins/autobuild/workflows/autobuild.js'), 'utf8')
  assert.ok(!engine.includes('/*__PROMPT:'), 'unreplaced prompt marker remains')
  assert.match(engine, /Adversarially CODE-review/)  // prompt text inlined
})
