const fs = require('fs')
const path = require('path')
const { loadPrompts } = require('../src/lib/loadPrompts')

const ROOT = path.join(__dirname, '..')

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }) }
function mkdirp(p) { fs.mkdirSync(p, { recursive: true }) }
function cp(src, dest) { mkdirp(path.dirname(dest)); fs.copyFileSync(src, dest) }

// JS-string-escape a prompt and wrap in backticks for inlining.
function quote(text) {
  return '`' + text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${') + '`'
}

function buildEngine() {
  const tplPath = path.join(ROOT, 'runners', 'claude', 'autobuild.template.js')
  let src = fs.readFileSync(tplPath, 'utf8')
  const prompts = loadPrompts()
  const map = {
    design: prompts.design, implement: prompts.implement,
    codeReview: prompts.codeReview, securityReview: prompts.securityReview,
    designConformance: prompts.designConformance,
  }
  for (const [name, text] of Object.entries(map)) {
    src = src.split(`/*__PROMPT:${name}__*/`).join(quote(text))
  }
  return src
}

function build({ local } = {}) {
  const distDir = path.join(ROOT, local ? 'dist-local' : 'dist')
  rmrf(distDir)
  // marketplace manifest
  cp(path.join(ROOT, 'build', 'marketplace.template.json'), path.join(distDir, '.claude-plugin', 'marketplace.json'))
  // plugin manifest
  cp(path.join(ROOT, 'runners', 'claude', 'plugin.json'), path.join(distDir, 'plugins', 'autobuild', '.claude-plugin', 'plugin.json'))
  // command
  cp(path.join(ROOT, 'runners', 'claude', 'commands', 'autobuild-one.md'), path.join(distDir, 'plugins', 'autobuild', 'commands', 'autobuild-one.md'))
  // engine (markers replaced)
  const engine = buildEngine()
  const enginePath = path.join(distDir, 'plugins', 'autobuild', 'workflows', 'autobuild.js')
  mkdirp(path.dirname(enginePath))
  fs.writeFileSync(enginePath, engine)
  return { distDir }
}

module.exports = { build }

if (require.main === module) {
  const local = process.argv.includes('--local')
  const { distDir } = build({ local })
  console.log(`built -> ${distDir}`)
}
