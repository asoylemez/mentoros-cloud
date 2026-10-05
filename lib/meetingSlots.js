/**
 * ====================================================================
 * MENTOR MEETING AVAILABILITY  (workspace -> "Mentor availability")
 * ====================================================================
 *
 * Stored on the MENTOR (mentors.meeting_slots, JSON), not on a single
 * mentorship: a mentor with two mentees marks the calendar once and both
 * workspaces show it.
 *
 *   {
 *     weekly:  { "1": [9, 10], "3": [14] },     // ISO weekday 1=Mon..7=Sun
 *     dates:   { "2026-10-07": [10, 11] },      // specific days
 *     updatedAt: "2026-09-23T10:00:00.000Z"
 *   }
 *
 * A number is the START hour of a one-hour slot: 9 = 09:00-10:00.
 * Slots run 08:00-20:00 (start hours 8..19). Times are Istanbul time,
 * like the rest of the application.
 *
 * Anyone who can open the workspace may edit it (decision: the mentor
 * and the mentee share one workspace link). Past dates are dropped on
 * every save and never shown. Only availability is shown - nobody books
 * a slot here.
 */

const FIRST_HOUR = 8;
const LAST_HOUR = 19;          // last slot 19:00-20:00
const MAX_DAYS_AHEAD = 366;
const MAX_DATES = 200;

/** Today in Istanbul (UTC+3, no DST), as YYYY-MM-DD. */
function todayIstanbul() {
  return new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
}

function hoursOf(list) {
  const out = new Set();
  for (const h of Array.isArray(list) ? list : []) {
    const n = Number(h);
    if (Number.isInteger(n) && n >= FIRST_HOUR && n <= LAST_HOUR) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

/** Cleans input from the browser (or the DB). Never throws. */
function sanitize(input) {
  const src = input && typeof input === "object" ? input : {};
  const weekly = {};
  for (let day = 1; day <= 7; day++) {
    const hours = hoursOf(src.weekly && src.weekly[day]);
    if (hours.length) weekly[day] = hours;
  }

  const today = todayIstanbul();
  const limit = new Date(Date.parse(today + "T00:00:00Z") + MAX_DAYS_AHEAD * 86400000)
    .toISOString().slice(0, 10);
  const dates = {};
  const keys = Object.keys((src.dates && typeof src.dates === "object") ? src.dates : {})
    .filter(k => validDate(k) && k >= today && k <= limit)
    .sort()
    .slice(0, MAX_DATES);
  for (const k of keys) {
    const hours = hoursOf(src.dates[k]);
    if (hours.length) dates[k] = hours;
  }
  return { weekly, dates };
}

/** From the stored string; past dates are dropped on read too. */
function parse(raw) {
  let obj = {};
  try { obj = raw ? JSON.parse(raw) : {}; } catch { obj = {}; }
  const clean = sanitize(obj);
  return { ...clean, updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : null };
}

function serialize(input) {
  return JSON.stringify({ ...sanitize(input), updatedAt: new Date().toISOString() });
}

module.exports = { FIRST_HOUR, LAST_HOUR, sanitize, parse, serialize, todayIstanbul };
