const fs = require('fs')
const path = require('path')
const Ajv = require('ajv')

const schema = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'config.schema.json'), 'utf8')
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
