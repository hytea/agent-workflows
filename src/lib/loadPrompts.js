const fs = require('fs')
const path = require('path')

const DIR = path.join(__dirname, '..', 'prompts')
const FILES = {
  design: 'design.md',
  implement: 'implement.md',
  codeReview: 'code-review.md',
  securityReview: 'security-review.md',
  designConformance: 'design-conformance.md',
}

function loadPrompts() {
  const out = {}
  for (const [key, file] of Object.entries(FILES)) {
    out[key] = fs.readFileSync(path.join(DIR, file), 'utf8').trim()
  }
  return out
}

module.exports = { loadPrompts }
