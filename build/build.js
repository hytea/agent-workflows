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

// Build any template that uses /*__PROMPT:name__*/ markers, replacing each
// marker with its inlined, JS-escaped prompt text.
function buildTemplate(tplRelPath, markerNames) {
  const tplPath = path.join(ROOT, tplRelPath)
  let src = fs.readFileSync(tplPath, 'utf8')
  const prompts = loadPrompts()
  const map = {
    design: prompts.design, implement: prompts.implement,
    codeReview: prompts.codeReview, securityReview: prompts.securityReview,
    designConformance: prompts.designConformance,
  }
  for (const name of markerNames) {
    src = src.split(`/*__PROMPT:${name}__*/`).join(quote(map[name]))
  }
  return src
}

function build({ local, outDir } = {}) {
  const distDir = outDir ? path.resolve(outDir) : path.join(ROOT, local ? 'dist-local' : 'dist')
  rmrf(distDir)
  // marketplace manifest
  cp(path.join(ROOT, 'build', 'marketplace.template.json'), path.join(distDir, '.claude-plugin', 'marketplace.json'))
  // plugin manifest
  cp(path.join(ROOT, 'runners', 'claude', 'plugin.json'), path.join(distDir, 'plugins', 'autobuild', '.claude-plugin', 'plugin.json'))
  // command
  cp(path.join(ROOT, 'runners', 'claude', 'commands', 'autobuild-one.md'), path.join(distDir, 'plugins', 'autobuild', 'commands', 'autobuild-one.md'))
  // config schema + validator (shipped into lib/ so the command can require them)
  cp(path.join(ROOT, 'src', 'config.schema.json'), path.join(distDir, 'plugins', 'autobuild', 'lib', 'config.schema.json'))
  cp(path.join(ROOT, 'src', 'lib', 'validateConfig.js'), path.join(distDir, 'plugins', 'autobuild', 'lib', 'validateConfig.js'))
  // autobuild engine (all markers replaced)
  const engine = buildTemplate('runners/claude/autobuild.template.js', ['design', 'implement', 'codeReview', 'securityReview', 'designConformance'])
  const enginePath = path.join(distDir, 'plugins', 'autobuild', 'workflows', 'autobuild.js')
  mkdirp(path.dirname(enginePath))
  fs.writeFileSync(enginePath, engine)
  // autodesign workflow (only the design marker)
  const autodesign = buildTemplate('runners/claude/autodesign.template.js', ['design'])
  const autodesignPath = path.join(distDir, 'plugins', 'autobuild', 'workflows', 'autodesign.js')
  fs.writeFileSync(autodesignPath, autodesign)
  return { distDir }
}

module.exports = { build }

if (require.main === module) {
  const local = process.argv.includes('--local')
  const { distDir } = build({ local })
  console.log(`built -> ${distDir}`)
}
