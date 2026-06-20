const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { build } = require('../build/build')

// Each test builds into its own temp dir so parallel test files never race on a shared dist.
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `autobuild-${name}-`))

test('built engine has no unreplaced prompt markers', () => {
  const { distDir } = build({ outDir: tmp('markers') })
  const engine = fs.readFileSync(path.join(distDir, 'plugins/autobuild/workflows/autobuild.js'), 'utf8')
  assert.ok(!engine.includes('/*__PROMPT:'), 'unreplaced prompt marker remains')
  assert.match(engine, /Adversarially CODE-review/)  // prompt text inlined
})

test('built engine is syntactically valid as a workflow async-body', () => {
  const { distDir } = build({ outDir: tmp('syntax') })
  const src = fs.readFileSync(path.join(distDir, 'plugins/autobuild/workflows/autobuild.js'), 'utf8')
  const body = src.replace(/^export\s+const\s+meta/, 'const meta')
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  assert.doesNotThrow(() => {
    new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'budget', 'workflow', body)
  }, 'inlined prompts must produce a syntactically valid workflow body')
})

// The destructive-operation guardrail is a safety invariant in the agent RULES.
// Assert it ships in BOTH autonomous workflows so a future refactor cannot
// silently drop it (the build wires RULES into every agent prompt at runtime).
test('both workflows carry the destructive-operation guardrail', () => {
  const { distDir } = build({ outDir: tmp('guardrail') })
  for (const wf of ['autobuild.js', 'autodesign.js']) {
    const src = fs.readFileSync(path.join(distDir, 'plugins/autobuild/workflows', wf), 'utf8')
    assert.match(src, /DESTRUCTIVE-OPERATION GUARDRAIL/, `${wf} missing destructive-operation guardrail`)
  }
})
