const fs = require('fs')
const path = require('path')
const Ajv = require('ajv')

const schemaNeighbor = path.join(__dirname, 'config.schema.json')
const schemaParent = path.join(__dirname, '..', 'config.schema.json')
const schema = JSON.parse(
  fs.readFileSync(fs.existsSync(schemaNeighbor) ? schemaNeighbor : schemaParent, 'utf8')
)
const ajv = new Ajv({ allErrors: true })
const validate = ajv.compile(schema)

function validateConfig(config) {
  const valid = validate(config)
  const errors = valid ? [] : (validate.errors || []).map(
    (e) => `${e.instancePath || '(root)'} ${e.message}`
  )
  return { valid: !!valid, errors }
}

module.exports = { validateConfig }
