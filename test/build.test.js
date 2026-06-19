const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { build } = require('../build/build')

test('build produces the expected plugin structure', () => {
  const { distDir } = build({ local: true })
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
  const { distDir } = build({ local: true })
  const must = [
    'plugins/autobuild/lib/config.schema.json',
    'plugins/autobuild/lib/validateConfig.js',
  ]
  for (const f of must) {
    assert.ok(fs.existsSync(path.join(distDir, f)), `missing ${f}`)
  }
})
