const test = require('node:test')
const assert = require('node:assert')
const { nextReset, wakeupDelaySeconds, nextResetCron, WINDOW_MS } = require('../src/lib/rateLimit')

const anchor = '2026-06-19T22:00:00.000Z'
const anchorMs = Date.parse(anchor)

test('WINDOW_MS is five hours', () => {
  assert.strictEqual(WINDOW_MS, 5 * 60 * 60 * 1000)
})

test('nextReset rolls forward to the next boundary strictly after now', () => {
  // 1 minute after the anchor -> next boundary is anchor + 5h
  const r = nextReset(anchor, anchorMs + 60 * 1000)
  assert.strictEqual(r, new Date(anchorMs + WINDOW_MS).toISOString())
})

test('nextReset skips multiple elapsed windows', () => {
  // 12 hours after anchor -> third boundary (anchor + 15h)
  const r = nextReset(anchor, anchorMs + 12 * 60 * 60 * 1000)
  assert.strictEqual(r, new Date(anchorMs + 3 * WINDOW_MS).toISOString())
})

test('exactly on a boundary advances to the next one (strictly after)', () => {
  const r = nextReset(anchor, anchorMs + WINDOW_MS)
  assert.strictEqual(r, new Date(anchorMs + 2 * WINDOW_MS).toISOString())
})

test('now before anchor returns the anchor itself', () => {
  const r = nextReset(anchor, anchorMs - 1000)
  assert.strictEqual(r, anchor)
})

test('wakeupDelaySeconds adds grace and never goes negative', () => {
  const d = wakeupDelaySeconds(anchor, anchorMs + 60 * 1000, 60)
  // next boundary is 5h - 1min away, plus 60s grace
  const expected = (WINDOW_MS - 60 * 1000) / 1000 + 60
  assert.strictEqual(d, expected)
})

test('nextResetCron emits a one-shot 5-field cron for reset+grace in LOCAL time', () => {
  // Derive the expectation from the SAME Date the impl uses, so this test is
  // timezone-independent (works regardless of the CI machine's TZ).
  const nowMs = anchorMs + 60 * 1000
  const resetMs = Date.parse(nextReset(anchor, nowMs)) + 60 * 1000 // +grace
  const d = new Date(resetMs)
  const expected = `${d.getMinutes()} ${d.getHours()} ${d.getDate()} ${d.getMonth() + 1} *`
  assert.strictEqual(nextResetCron(anchor, nowMs, 60), expected)
})
