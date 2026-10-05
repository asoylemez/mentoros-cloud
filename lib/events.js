const crypto = require("crypto");
const { db, newId, now, slugify } = require("../db");

/**
 * ====================================================================
 * EVENTS  (stage 6a)
 * ====================================================================
 *
 * Group mentoring / coaching sessions, trainings and online sessions,
 * planned on the platform. Participants are invited by e-mail with a
 * calendar invitation (.ics) and answer on their own page (token, no
 * sign-in). Decisions agreed for the cloud:
 *   - every event has its OWN time zone (the organisation's default time
 *     zone is the starting point); e-mails name it, the calendar file
 *     carries the start in UTC so every calendar shows local time
 *   - the event can be changed after the invitations: participants get an
 *     update and their calendar entry is replaced (same UID, higher
 *     SEQUENCE). When the DATE or TIME changes, answers go back to
 *     "waiting" - a "yes" for 10:00 says nothing about 15:00
 *   - after the start HR records who actually attended
 *   - no capacity limit, no automatic reminders (HR sends them)
 * Nothing here calls the AI.
 *
 * Mails go out in the background, one participant at a time: a
 * participant row carries the mail it is waiting for (pending_mail), so a
 * restart carries on where it stopped (resumeUnfinished).
 */

const TYPES = ["group_mentoring", "group_coaching", "training", "online", "other"];
const LIMITS = { title: 200, description: 4000, location: 300, onlineUrl: 1000, message: 2000, durationMin: 5, durationMax: 720 };
const DEFAULT_TZ = "Europe/Istanbul";

// ---------------------------------------------------------------------
// Time zones (no library: Intl knows the IANA zones and their DST rules)
// ---------------------------------------------------------------------

function isValidTimeZone(tz) {
  if (!tz || typeof tz !== "string") return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

/** Minutes the zone is ahead of UTC at a given moment (DST included). */
function offsetMinutes(utcMs, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).formatToParts(new Date(utcMs));
  const g = t => Number(parts.find(p => p.type === t).value);
  return Math.round((Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - utcMs) / 60000);
}

/** "2026-10-10" + "14:00" in a zone -> the UTC moment (Date). */
function localToUtc(date, time, tz) {
  const [y, m, d] = String(date).split("-").map(Number);
  const [h, mi] = String(time).split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let utc = guess - offsetMinutes(guess, tz) * 60000;
  const again = offsetMinutes(utc, tz);                    // around a DST change
  utc = guess - again * 60000;
  return new Date(utc);
}

/** "GMT+3", "GMT-4", "GMT+5:30" for the zone at that moment. */
function gmtLabel(tz, at) {
  const off = offsetMinutes(at.getTime(), tz);
  const sign = off < 0 ? "-" : "+";
  const h = Math.floor(Math.abs(off) / 60), m = Math.abs(off) % 60;
  return `GMT${sign}${h}${m ? ":" + String(m).padStart(2, "0") : ""}`;
}

/** Start and end of an event as UTC moments. */
function startEnd(ev) {
  const start = localToUtc(ev.eventDate, ev.startTime, ev.timezone || DEFAULT_TZ);
  return { start, end: new Date(start.getTime() + (ev.durationMinutes || 60) * 60000) };
}

const hasStarted = ev => startEnd(ev).start.getTime() <= Date.now();

// ---------------------------------------------------------------------
// Calendar file (RFC 5545). Times in UTC - every calendar converts them
// to the reader's own time zone.
// ---------------------------------------------------------------------

const icsEscape = t => String(t || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsTime = d => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Lines longer than 75 octets are folded (continuation lines start with a space). */
function fold(line) {
  const out = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > 73) { out.push(cur); cur = " " + ch; } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n");
}

function buildICS({ event, participant, method, organizerName, organizerEmail, url }) {
  const { start, end } = startEnd(event);
  const where = [event.location, event.onlineUrl].filter(Boolean).join(" - ");
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//MentorOS//Events//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${event.icsUid}`,
    `SEQUENCE:${event.icsSequence || 0}`,
    `DTSTAMP:${icsTime(new Date())}`,
    `DTSTART:${icsTime(start)}`,
    `DTEND:${icsTime(end)}`,
    `SUMMARY:${icsEscape(event.title)}`,
    `DESCRIPTION:${icsEscape([event.description, url].filter(Boolean).join("\n\n"))}`,
    where ? `LOCATION:${icsEscape(where)}` : "",
    event.onlineUrl ? `URL:${icsEscape(event.onlineUrl)}` : "",
    `ORGANIZER;CN=${icsEscape(organizerName || "MentorOS")}:mailto:${organizerEmail || "noreply@mentoros.invalid"}`,
    `ATTENDEE;CN=${icsEscape(participant.fullName || participant.email)};ROLE=REQ-PARTICIPANT;RSVP=FALSE:mailto:${participant.email}`,
    `STATUS:${method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR"
  ].filter(Boolean);
  return lines.map(fold).join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------

function camel(row) {
  if (!row) return null;
  const o = {};
  for (const [k, v] of Object.entries(row)) o[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v;
  return o;
}

const events = {
  TYPES, LIMITS, DEFAULT_TZ,

  get(id) {
    return camel(db.prepare(`SELECT * FROM events WHERE id = ?`).get(id));
  },

  listByCompany(companyId) {
    return db.prepare(`
      SELECT e.*,
        (SELECT COUNT(*) FROM event_participants p WHERE p.event_id = e.id) AS total,
        (SELECT COUNT(*) FROM event_participants p WHERE p.event_id = e.id AND p.invited_at != '') AS invited,
        (SELECT COUNT(*) FROM event_participants p WHERE p.event_id = e.id AND p.response = 'accepted') AS accepted,
        (SELECT COUNT(*) FROM event_participants p WHERE p.event_id = e.id AND p.response = 'declined') AS declined,
        (SELECT COUNT(*) FROM event_participants p WHERE p.event_id = e.id AND p.attendance = 'attended') AS attended,
        (SELECT COUNT(*) FROM event_participants p WHERE p.event_id = e.id AND p.pending_mail != '') AS sending
        FROM events e WHERE e.company_id = ? ORDER BY e.event_date DESC, e.start_time DESC
    `).all(slugify(companyId)).map(camel);
  },

  create(companyId, f) {
    const id = newId(), ts = now();
    db.prepare(`
      INSERT INTO events (id, company_id, title, event_type, description, event_date, start_time, duration_minutes,
                          timezone, location, online_url, language, program_id, status, ics_uid, ics_sequence,
                          invite_message, reminder_message, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, 0, ?, ?, ?, ?)
    `).run(id, slugify(companyId), f.title, f.eventType, f.description, f.eventDate, f.startTime, f.durationMinutes,
           f.timezone, f.location, f.onlineUrl, f.language, f.programId || "", `${id}@mentoros`,
           f.inviteMessage || "", f.reminderMessage || "", ts, ts);
    return events.get(id);
  },

  /** Saves a change. Returns { event, timeChanged, changed }. */
  update(ev, f) {
    const keys = ["title", "eventType", "description", "eventDate", "startTime", "durationMinutes", "timezone",
                  "location", "onlineUrl", "language", "programId", "inviteMessage", "reminderMessage"];
    const changed = keys.filter(k => f[k] !== undefined && String(f[k]) !== String(ev[k]));
    if (!changed.length) return { event: ev, timeChanged: false, changed };
    const timeChanged = changed.some(k => ["eventDate", "startTime", "durationMinutes", "timezone"].includes(k));
    // what the participants' calendars show changed -> new SEQUENCE
    const shown = changed.some(k => !["inviteMessage", "reminderMessage", "programId", "language"].includes(k));
    const col = k => k.replace(/[A-Z]/g, c => "_" + c.toLowerCase());
    const sets = changed.map(k => `${col(k)} = @${k}`).join(", ");
    db.prepare(`UPDATE events SET ${sets}, ics_sequence = ics_sequence + @bump, updated_at = @ts WHERE id = @id`)
      .run({ ...Object.fromEntries(changed.map(k => [k, f[k]])), bump: shown ? 1 : 0, ts: now(), id: ev.id });
    return { event: events.get(ev.id), timeChanged, changed, shown };
  },

  remove(id) {
    db.prepare(`DELETE FROM events WHERE id = ?`).run(id);   // participants: ON DELETE CASCADE
  },

  participants(eventId) {
    return db.prepare(`SELECT * FROM event_participants WHERE event_id = ? ORDER BY full_name COLLATE NOCASE, email`)
      .all(eventId).map(camel);
  },

  participant(eventId, pid) {
    return camel(db.prepare(`SELECT * FROM event_participants WHERE id = ? AND event_id = ?`).get(pid, eventId));
  },

  participantByToken(token) {
    if (!token) return null;
    return camel(db.prepare(`SELECT * FROM event_participants WHERE token = ?`).get(String(token)));
  },

  /** Adds people (one row per address). Returns how many were new. */
  addParticipants(ev, list) {
    const add = db.prepare(`
      INSERT OR IGNORE INTO event_participants (id, event_id, company_id, person_type, person_id, full_name, email, token, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let n = 0;
    db.transaction(() => {
      for (const r of list) n += add.run(newId(), ev.id, ev.companyId, r.type, r.id || "", r.name || "", r.email,
                                         crypto.randomBytes(24).toString("base64url"), now()).changes;
    })();
    return n;
  },

  removeParticipant(pid) {
    db.prepare(`DELETE FROM event_participants WHERE id = ?`).run(pid);
  },

  /** Puts a mail in the queue of the chosen participants. */
  queue(eventId, kind, where) {
    const filter = {
      invite: `invited_at = ''`,
      reminder: `invited_at != '' AND response = 'pending'`,
      update: `invited_at != ''`,
      cancel: `invited_at != ''`
    }[kind] || where;
    return db.prepare(`UPDATE event_participants SET pending_mail = ?, mail_status = 'queued', mail_error = ''
                        WHERE event_id = ? AND ${filter}`).run(kind, eventId).changes;
  },

  /** Answers back to "waiting" (the date or time changed). */
  resetResponses(eventId) {
    db.prepare(`UPDATE event_participants SET response = 'pending', response_note = '', responded_at = ''
                 WHERE event_id = ? AND invited_at != ''`).run(eventId);
  },

  respond(pid, response, note) {
    db.prepare(`UPDATE event_participants SET response = ?, response_note = ?, responded_at = ? WHERE id = ?`)
      .run(response, note, now(), pid);
  },

  setAttendance(pid, value) {
    db.prepare(`UPDATE event_participants SET attendance = ? WHERE id = ?`).run(value, pid);
  },

  cancel(id, reason) {
    db.prepare(`UPDATE events SET status = 'cancelled', cancel_reason = ?, cancelled_at = ?, ics_sequence = ics_sequence + 1,
                updated_at = ? WHERE id = ?`).run(reason, now(), now(), id);
    return events.get(id);
  }
};

// ---------------------------------------------------------------------
// Background mail queue
// ---------------------------------------------------------------------

const running = new Set();

function startMail(eventId) {
  if (running.has(eventId)) return;
  running.add(eventId);
  setImmediate(async () => {
    try {
      const mailer = require("../mail/mailer");
      const { companies } = require("../db/repos");
      const config = require("../config");
      const next = db.prepare(`SELECT * FROM event_participants WHERE event_id = ? AND pending_mail != '' LIMIT 1`);
      let row;
      while ((row = next.get(eventId))) {
        const p = camel(row);
        const ev = events.get(eventId);
        if (!ev) break;
        const company = companies.get(ev.companyId) || {};
        try {
          await mailer.sendEventMail({
            kind: p.pendingMail, event: ev, participant: p, company,
            url: `${config.siteBaseUrl}/event_response.html?token=${p.token}`,
            ics: buildICS({
              event: ev, participant: p, method: ["cancel", "removed"].includes(p.pendingMail) ? "CANCEL" : "REQUEST",
              organizerName: company.name, organizerEmail: company.replyTo || mailer.fromAddress(),
              url: `${config.siteBaseUrl}/event_response.html?token=${p.token}`
            })
          });
          const extra = p.pendingMail === "invite" ? `, invited_at = '${now()}'`
                      : p.pendingMail === "reminder" ? `, reminder_count = reminder_count + 1, last_reminded_at = '${now()}'` : "";
          db.prepare(`UPDATE event_participants SET pending_mail = '', mail_status = 'sent', mail_error = '',
                      last_mail_kind = ?, last_mail_at = ? ${extra} WHERE id = ?`).run(p.pendingMail, now(), p.id);
        } catch (err) {
          db.prepare(`UPDATE event_participants SET pending_mail = '', mail_status = 'failed', mail_error = ?, last_mail_kind = ? WHERE id = ?`)
            .run(String(err.message || "send failed").slice(0, 300), p.pendingMail, p.id);
        }
      }
    } catch (err) {
      console.error(`  ! Event ${eventId} mails could not be sent:`, err.message);
    } finally {
      running.delete(eventId);
    }
  });
}

function resumeUnfinished() {
  const rows = db.prepare(`SELECT DISTINCT event_id FROM event_participants WHERE pending_mail != ''`).all();
  for (const { event_id } of rows) startMail(event_id);
  if (rows.length) console.log(`  Events: ${rows.length} unfinished mailing(s) resumed`);
}

module.exports = { events, startMail, resumeUnfinished, buildICS, startEnd, hasStarted, gmtLabel, isValidTimeZone,
                   localToUtc, offsetMinutes, DEFAULT_TZ };
