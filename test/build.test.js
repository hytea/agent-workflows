const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { build } = require('../build/build')

// Each test builds into its own temp dir so parallel test files never race on a shared dist.
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `autobuild-${name}-`))

test('build produces the expected plugin structure', () => {
  const { distDir } = build({ outDir: tmp('structure') })
  const must = [
    '.claude-plugin/marketplace.json',
    'plugins/autobuild/.claude-plugin/plugin.json',
    'plugins/autobuild/workflows/autobuild.js',
    'plugins/autobuild/commands/autobuild-one.md',
  ]
  for (const f of must) {
    assert.ok(fs.existsSync(path.join(distDir, f)), `missing ${f}`)
  }
})

test('build ships config schema and validator into plugin lib/', () => {
  const { distDir } = build({ outDir: tmp('ships') })
  const must = [
    'plugins/autobuild/lib/config.schema.json',
    'plugins/autobuild/lib/validateConfig.js',
  ]
  for (const f of must) {
    assert.ok(fs.existsSync(path.join(distDir, f)), `missing ${f}`)
  }
})

test('build ships the autodesign workflow with design prompt inlined', () => {
  const { distDir } = build({ outDir: tmp('autodesign') })
  const p = path.join(distDir, 'plugins/autobuild/workflows/autodesign.js')
  assert.ok(fs.existsSync(p), 'missing autodesign.js')
  const src = fs.readFileSync(p, 'utf8')
  assert.ok(!src.includes('/*__PROMPT:'), 'unreplaced prompt marker in autodesign.js')
  assert.match(src, /Design ticket/) // text from design.md is inlined
})

test('build ships the supervisor workflow', () => {
  const { distDir } = build({ outDir: tmp('supervisor') })
  const p = path.join(distDir, 'plugins/autobuild/workflows/autobuild-supervisor.js')
  assert.ok(fs.existsSync(p), 'missing autobuild-supervisor.js')
  const src = fs.readFileSync(p, 'utf8')
  assert.match(src, /name: 'autobuild-supervisor'/)
  assert.ok(!src.includes('/*__PROMPT:'), 'supervisor should have no prompt markers')
})

test('build ships designNotes lib into plugin', () => {
  const { distDir } = build({ outDir: tmp('designnotes-lib') })
  assert.ok(fs.existsSync(path.join(distDir, 'plugins/autobuild/lib/designNotes.js')), 'missing designNotes.js in lib')
})

test('build ships packWave and rateLimit libs into plugin', () => {
  const { distDir } = build({ outDir: tmp('overnight-libs') })
  assert.ok(fs.existsSync(path.join(distDir, 'plugins/autobuild/lib/packWave.js')), 'missing packWave.js')
  assert.ok(fs.existsSync(path.join(distDir, 'plugins/autobuild/lib/rateLimit.js')), 'missing rateLimit.js')
})

test('build ships all command files', () => {
  const { distDir } = build({ outDir: tmp('commands') })
  for (const f of ['autobuild-one.md', 'autodesign.md', 'autobuild.md']) {
    assert.ok(fs.existsSync(path.join(distDir, 'plugins/autobuild/commands', f)), `missing command ${f}`)
  }
})
