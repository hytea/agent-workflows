'use strict'

const WINDOW_MS = 5 * 60 * 60 * 1000 // 5-hour usage window

// Soonest reset boundary strictly after nowMs. Boundaries are anchor + N*WINDOW.
// If now is at or before the anchor, the anchor is the next reset.
function nextReset(anchorISO, nowMs) {
  const anchorMs = Date.parse(anchorISO)
  if (nowMs <= anchorMs) return new Date(anchorMs).toISOString()
  const elapsed = nowMs - anchorMs
  const n = Math.floor(elapsed / WINDOW_MS) + 1 // strictly-after => always advance
  return new Date(anchorMs + n * WINDOW_MS).toISOString()
}

// Seconds from now until the next reset plus a grace margin (e.g. 60s after
// the window flips, to be safely on the far side of the reset).
function wakeupDelaySeconds(anchorISO, nowMs, graceSeconds) {
  const grace = Number.isFinite(graceSeconds) ? graceSeconds : 0
  const resetMs = Date.parse(nextReset(anchorISO, nowMs))
  const secs = (resetMs - nowMs) / 1000 + grace
  return secs < grace ? grace : secs
}

// One-shot 5-field cron expression ("M H DoM Mon *") for the next reset plus a
// grace margin, in LOCAL time (CronCreate interprets cron in the user's tz).
// Cron has no seconds field, so we add grace then floor to the minute.
function nextResetCron(anchorISO, nowMs, graceSeconds) {
  const grace = Number.isFinite(graceSeconds) ? graceSeconds : 0
  const resetMs = Date.parse(nextReset(anchorISO, nowMs)) + grace * 1000
  const d = new Date(resetMs)
  // Local-time fields so the cron matches the user's wall clock.
  return `${d.getMinutes()} ${d.getHours()} ${d.getDate()} ${d.getMonth() + 1} *`
}

module.exports = { WINDOW_MS, nextReset, wakeupDelaySeconds, nextResetCron }
