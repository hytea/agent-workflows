'use strict'

// Single source of truth for the design-agent's JSON output contract. Both the
// autobuild engine and the autodesign workflow validate the design agent against
// this exact shape. Workflow script bodies cannot `require`, so build.js inlines
// this object at each /*__SCHEMA:design__*/ marker (mirroring prompt inlining) —
// keeping one definition instead of two hand-synced copies that silently drift.
const DESIGN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['spec', 'specPath', 'surface', 'chunks', 'escalations'],
  properties: {
    spec: { type: 'string' }, specPath: { type: 'string' },
    surface: { type: 'array', items: { type: 'string' } },
    chunks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'title', 'model', 'files', 'instructions'],
      properties: { id: { type: 'string' }, title: { type: 'string' }, model: { type: 'string', enum: ['haiku', 'sonnet', 'opus'] }, files: { type: 'array', items: { type: 'string' } }, instructions: { type: 'string' },
        testExempt: { type: 'boolean' }, testExemptReason: { type: 'string' } } } },
    escalations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['decision', 'options', 'recommendation', 'rationale'],
      properties: { decision: { type: 'string' }, options: { type: 'array', items: { type: 'string' } }, recommendation: { type: 'string' }, rationale: { type: 'string' } } } },
  },
}

module.exports = { DESIGN_SCHEMA }
