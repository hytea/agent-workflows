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

test('build inlines the shared design schema from a single source into both workflows', () => {
  const { distDir } = build({ outDir: tmp('design-schema') })
  for (const f of ['autobuild.js', 'autodesign.js']) {
    const src = fs.readFileSync(path.join(distDir, 'plugins/autobuild/workflows', f), 'utf8')
    assert.ok(!src.includes('/*__SCHEMA:'), `unreplaced schema marker in ${f}`)
    // The inlined object must carry the design contract's signature fields.
    assert.match(src, /const DESIGN_SCHEMA = \{"type":"object"/, `design schema not inlined in ${f}`)
    assert.match(src, /"escalations"/, `inlined schema missing escalations in ${f}`)
  }
})

test('raw templates no longer hand-maintain a duplicate design schema literal', () => {
  // The schema lives once in src/lib/designSchema.js and is injected at build
  // time; neither template should re-declare the literal object (which is how the
  // two copies silently drifted before).
  for (const f of ['autobuild.template.js', 'autodesign.template.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'runners', 'claude', f), 'utf8')
    assert.ok(src.includes('/*__SCHEMA:design__*/'), `${f} must use the schema marker`)
    assert.ok(!/required: \['spec', 'specPath'/.test(src), `${f} still inlines the design schema literal`)
  }
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

test('build ships the ciStatus lib into plugin (autobuild-issue CI polling)', () => {
  const { distDir } = build({ outDir: tmp('cistatus-lib') })
  assert.ok(fs.existsSync(path.join(distDir, 'plugins/autobuild/lib/ciStatus.js')), 'missing ciStatus.js')
})

test('build ships all command files', () => {
  const { distDir } = build({ outDir: tmp('commands') })
  for (const f of ['autobuild-one.md', 'autodesign.md', 'autobuild.md', 'autobuild-issue.md']) {
    assert.ok(fs.existsSync(path.join(distDir, 'plugins/autobuild/commands', f)), `missing command ${f}`)
  }
})
