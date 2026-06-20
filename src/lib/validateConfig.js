const fs = require('fs')
const path = require('path')

const schemaNeighbor = path.join(__dirname, 'config.schema.json')
const schemaParent = path.join(__dirname, '..', 'config.schema.json')
const schema = JSON.parse(
  fs.readFileSync(fs.existsSync(schemaNeighbor) ? schemaNeighbor : schemaParent, 'utf8')
)

// Zero-dependency validator for the autobuild config schema subset.
// Supports the keywords this schema actually uses: type (object/string/
// integer/boolean), required, properties, additionalProperties:false, enum.
// Deliberately NOT a general JSON Schema engine — keeping it dependency-free
// means the shipped plugin validates from any consumer repo without ajv on the
// module resolution path. If the schema grows new keywords, extend checkNode.
function typeOk(value, type) {
  switch (type) {
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value)
    case 'array': return Array.isArray(value)
    case 'string': return typeof value === 'string'
    case 'boolean': return typeof value === 'boolean'
    case 'integer': return typeof value === 'number' && Number.isInteger(value)
    case 'number': return typeof value === 'number'
    default: return true
  }
}

function checkNode(value, node, instancePath, errors) {
  if (node.type && !typeOk(value, node.type)) {
    errors.push(`${instancePath || '(root)'} must be ${node.type}`)
    return // type is wrong; deeper checks would be noise
  }
  if (node.enum && !node.enum.includes(value)) {
    errors.push(`${instancePath || '(root)'} must be one of ${JSON.stringify(node.enum)}`)
  }
  // Apply object checks for any node that declares object-applicable keywords,
  // not only nodes with an explicit type:'object'. JSON Schema does not require
  // the type keyword, so a properties/required-only node must still be enforced
  // — otherwise such a node would silently skip required/additionalProperties.
  const isObjectNode = node.type === 'object'
    || node.properties !== undefined || node.required !== undefined || node.additionalProperties !== undefined
  if (isObjectNode && value && typeof value === 'object' && !Array.isArray(value)) {
    const props = node.properties || {}
    for (const key of node.required || []) {
      if (!(key in value)) errors.push(`${instancePath || '(root)'} missing required property '${key}'`)
    }
    if (node.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in props)) errors.push(`${instancePath || '(root)'} has unknown property '${key}'`)
      }
    }
    for (const [key, childSchema] of Object.entries(props)) {
      if (key in value) checkNode(value[key], childSchema, `${instancePath}/${key}`, errors)
    }
  }
}

function validateConfig(config) {
  return validateNode(config, schema)
}

// Validate a value against an arbitrary schema node. Exposed so the schema
// subset's semantics (including type-less object nodes) can be tested directly.
function validateNode(value, node) {
  const errors = []
  checkNode(value, node, '', errors)
  return { valid: errors.length === 0, errors }
}

module.exports = { validateConfig, validateNode }
