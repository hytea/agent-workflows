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

test('built engine is syntactically valid as a workflow async-body', () => {
  const { distDir } = build({ local: true })
  const src = fs.readFileSync(path.join(distDir, 'plugins/autobuild/workflows/autobuild.js'), 'utf8')
  const body = src.replace(/^export\s+const\s+meta/, 'const meta')
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  assert.doesNotThrow(() => {
    new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'budget', 'workflow', body)
  }, 'inlined prompts must produce a syntactically valid workflow body')
})
