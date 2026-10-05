const express = require("express");

const config = require("../config");
const { companies, programs } = require("../db/repos");
const mailer = require("../mail/mailer");
const { events, startMail, buildICS, startEnd, hasStarted, isValidTimeZone, DEFAULT_TZ } = require("../lib/events");
const { checkSelection, resolve } = require("../lib/announcements");
const { requireApiKey, requireCompany, ownRecord, wrap } = require("./_helpers");

const router = express.Router();

/**
 * ====================================================================
 * EVENTS  (HR, signed-in organisation only) - stage 6a
 * ====================================================================
 * Rules and mail queue: lib/events.js. Every event id goes through
 * ownRecord() (another organisation's event answers 404); participant
 * selections reuse the announcement picker's checks (checkSelection).
 */

const bad = (res, status, code, error, extra = {}) => res.status(status).json({ error, code, ...extra });
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v + "T00:00:00Z"));
const isTime = v => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const answerUrl = token => `${config.siteBaseUrl}/event_response.html?token=${token}`;

/** Checks and cleans the event fields. Returns { error, code } or { fields }. */
function readFields(companyId, body, existing) {
  const b = body || {};
  const L = events.LIMITS;
  const pick = (k, fallback) => (b[k] === undefined ? fallback : b[k]);
  const f = {
    title: String(pick("title", existing ? existing.title : "")).replace(/\s+/g, " ").trim(),
    eventType: String(pick("eventType", existing ? existing.eventType : "group_mentoring")),
    description: String(pick("description", existing ? existing.description : "")).replace(/\r\n?/g, "\n").trim(),
    eventDate: String(pick("eventDate", existing ? existing.eventDate : "")),
    startTime: String(pick("startTime", existing ? existing.startTime : "")),
    durationMinutes: Number(pick("durationMinutes", existing ? existing.durationMinutes : 60)),
    timezone: String(pick("timezone", existing ? existing.timezone : (companies.get(companyId) || {}).defaultTimezone || DEFAULT_TZ)),
    location: String(pick("location", existing ? existing.location : "")).trim(),
    onlineUrl: String(pick("onlineUrl", existing ? existing.onlineUrl : "")).trim(),
    language: pick("language", existing ? existing.language : "tr") === "en" ? "en" : "tr",
    programId: String(pick("programId", existing ? existing.programId : "") || ""),
    inviteMessage: String(pick("inviteMessage", existing ? existing.inviteMessage : "")).replace(/\r\n?/g, "\n").trim(),
    reminderMessage: String(pick("reminderMessage", existing ? existing.reminderMessage : "")).replace(/\r\n?/g, "\n").trim()
  };
  if (!f.title) return { code: "title_required", error: "Give the event a title." };
  if (f.title.length > L.title) return { code: "title_too_long", error: "The title is too long." };
  if (!events.TYPES.includes(f.eventType)) return { code: "bad_type", error: "Unknown event type." };
  if (!isDate(f.eventDate)) return { code: "bad_date", error: "Give a valid date." };
  if (!isTime(f.startTime)) return { code: "bad_time", error: "Give a valid start time (HH:MM)." };
  if (!Number.isInteger(f.durationMinutes) || f.durationMinutes < L.durationMin || f.durationMinutes > L.durationMax) {
    return { code: "bad_duration", error: "The duration must be between 5 minutes and 12 hours." };
  }
  if (!isValidTimeZone(f.timezone)) return { code: "bad_timezone", error: "Unknown time zone." };
  if (f.description.length > L.description) return { code: "description_too_long", error: "The description is too long." };
  if (f.location.length > L.location) return { code: "location_too_long", error: "The place is too long." };
  if (f.onlineUrl && (!/^https?:\/\/\S+$/i.test(f.onlineUrl) || f.onlineUrl.length > L.onlineUrl)) {
    return { code: "bad_url", error: "The online link must start with http:// or https://." };
  }
  if (f.inviteMessage.length > L.message || f.reminderMessage.length > L.message) {
    return { code: "message_too_long", error: "The message is too long." };
  }
  if (f.programId) {
    const p = programs.get(f.programId);
    if (!p || p.companyId !== companyId) return { code: "not_found", error: "Programme not found", status: 404 };
  }
  return { fields: f };
}

function view(ev) {
  const { start, end } = startEnd(ev);
  return { ...ev, startUtc: start.toISOString(), endUtc: end.toISOString(), started: hasStarted(ev) };
}

// ---------------------------------------------------------------------
// The organisation's default time zone (Organisation Settings)
// ---------------------------------------------------------------------

router.put("/company-timezone", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const tz = String((req.body || {}).timezone || "");
  if (!isValidTimeZone(tz)) return bad(res, 400, "bad_timezone", "Unknown time zone.");
  res.json({ success: true, timezone: companies.setDefaultTimezone(companyId, tz).defaultTimezone });
}));

// ---------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------

router.get("/events", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const c = companies.get(companyId) || {};
  res.json({ defaultTimezone: c.defaultTimezone || DEFAULT_TZ, smtpConfigured: mailer.isConfigured(),
             events: events.listByCompany(companyId).map(view) });
}));

router.post("/events", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const r = readFields(companyId, req.body, null);
  if (r.error) return bad(res, r.status || 400, r.code, r.error);
  const ev = events.create(companyId, r.fields);
  res.json({ success: true, event: view(ev) });
}));

router.get("/events/:id", requireApiKey, wrap(async (req, res) => {
  const ev = ownRecord(req, res, events.get(req.params.id), "Event not found");
  if (!ev) return;
  res.json({ ...view(ev), participants: events.participants(ev.id).map(p => ({ ...p, token: undefined, answerUrl: answerUrl(p.token) })) });
}));

/**
 * Changes an event. When it was already sent to people, they get an
 * update with the new calendar entry; when the DATE or TIME changed,
 * their answers go back to "waiting" first (agreed rule).
 */
router.put("/events/:id", requireApiKey, wrap(async (req, res) => {
  const ev = ownRecord(req, res, events.get(req.params.id), "Event not found");
  if (!ev) return;
  if (ev.status !== "scheduled") return bad(res, 409, "cancelled", "A cancelled event cannot be changed.");
  const r = readFields(ev.companyId, req.body, ev);
  if (r.error) return bad(res, r.status || 400, r.code, r.error);
  const u = events.update(ev, r.fields);
  let notified = 0;
  if (u.shown && events.participants(ev.id).some(p => p.invitedAt)) {
    if (u.timeChanged) events.resetResponses(ev.id);
    notified = events.queue(ev.id, "update");
    if (notified) startMail(ev.id);
  }
  res.json({ success: true, event: view(u.event), notified, responsesReset: !!(u.timeChanged && notified) });
}));

/** Deletes an event. One that people were invited to must be cancelled first. */
router.delete("/events/:id", requireApiKey, wrap(async (req, res) => {
  const ev = ownRecord(req, res, events.get(req.params.id), "Event not found");
  if (!ev) return;
  if (ev.status === "scheduled" && !hasStarted(ev) && events.participants(ev.id).some(p => p.invitedAt)) {
    return bad(res, 409, "cancel_first", "People were invited to this event: cancel it first, so their calendars are updated.");
  }
  events.remove(ev.id);
  res.json({ success: true });
}));

// ---------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------

router.post("/events/:id/participants", requireApiKey, wrap(async (req, res) => {
  const ev = ownRecord(req, res, events.get(req.params.id), "Event not found");
  if (!ev) return;
  if (ev.status !== "scheduled") return bad(res, 409, "cancelled", "A cancelled event cannot get participants.");
  const c = checkSelection(ev.companyId, (req.body || {}).selection);
  if (c.error) return res.status(c.code === "not_found" ? 404 : 400).json(c);
  const list = resolve(ev.companyId, c.selection);
  const added = events.addParticipants(ev, list);
  res.json({ success: true, added, alreadyIn: list.length - added });
}));

/**
 * Removes a participant. Someone already invited gets a short notice
 * with a calendar cancellation, so the entry leaves their calendar.
 */
router.delete("/events/:id/participants/:pid", requireApiKey, wrap(async (req, res) => {
  const ev = ownRecord(req, res, events.get(req.params.id), "Event not found");
  if (!ev) return;
  const p = events.participant(ev.id, req.params.pid);
  if (!p) return bad(res, 404, "not_found", "Participant not found");
  let notified = false, notice = "";
  if (p.invitedAt && ev.status === "scheduled" && !hasStarted(ev)) {
    try {
      const company = companies.get(ev.companyId) || {};
      await mailer.sendEventMail({
        kind: "removed", event: ev, participant: p, company, url: "",
        ics: buildICS({ event: ev, participant: p, method: "CANCEL", organizerName: company.name,
                        organizerEmail: company.replyTo || mailer.fromAddress() })
      });
      notified = true;
    } catch (err) { notice = err.message; }
  }
  events.removeParticipant(p.id);
  res.json({ success: true, notified, notice });
}));

/** Who actually attended - only once the event has started. */
router.patch("/events/:id/participants/:pid/attendance", requireApiKey, wrap(async (req, res) => {
  const ev = ownRecord(req, res, events.get(req.params.id), "Event not found");
  if (!ev) return;
  if (ev.status !== "scheduled") return bad(res, 409, "cancelled", "The event was cancelled.");
  if (!hasStarted(ev)) return bad(res, 409, "not_started", "Attendance can be recorded once the event has started.");
  const p = events.participant(ev.id, req.params.pid);
  if (!p) return bad(res, 404, "not_found", "Participant not found");
  const value = String((req.body || {}).attendance || "");
  if (!["", "attended", "absent"].includes(value)) return bad(res, 400, "bad_attendance", "Unknown attendance value.");
  events.setAttendance(p.id, value);
  res.json({ success: true, attendance: value });
}));

// ---------------------------------------------------------------------
// Mails: invitations, reminders, cancellation (in the background)
// ---------------------------------------------------------------------

function mailGuard(res, ev) {
  if (ev.status !== "scheduled") { bad(res, 409, "cancelled", "The event was cancelled."); return false; }
  if (hasStarted(ev)) { bad(res, 409, "started", "The event has already started."); return false; }
  if (!mailer.isConfigured()) { bad(res, 400, "smtp_not_configured", "The e-mail server is not set up."); return false; }
  return true;
}

/** Invitations to everyone not invited yet. */
router.post("/events/:id/invite", requireApiKey, wrap(async (req, res) => {
  const ev = ownRecord(req, res, events.get(req.params.id), "Event not found");
  if (!ev || !mailGuard(res, ev)) return;
  const n = events.queue(ev.id, "invite");
  if (!n) return bad(res, 400, "nobody_to_invite", "Everyone on the list has already been invited.");
  startMail(ev.id);
  res.status(202).json({ success: true, queued: n });
}));

/** Reminder to the invited people who have not answered. */
router.post("/events/:id/remind", requireApiKey, wrap(async (req, res) => {
  const ev = ownRecord(req, res, events.get(req.params.id), "Event not found");
  if (!ev || !mailGuard(res, ev)) return;
  const n = events.queue(ev.id, "reminder");
  if (!n) return bad(res, 400, "nobody_to_remind", "Everyone invited has answered.");
  startMail(ev.id);
  res.status(202).json({ success: true, queued: n });
}));

/** Cancels the event; invited people get a cancellation (notify: false = no mail). */
router.post("/events/:id/cancel", requireApiKey, wrap(async (req, res) => {
  const ev = ownRecord(req, res, events.get(req.params.id), "Event not found");
  if (!ev) return;
  if (ev.status !== "scheduled") return bad(res, 409, "cancelled", "The event is already cancelled.");
  const body = req.body || {};
  const reason = String(body.reason || "").trim().slice(0, 500);
  const notify = body.notify !== false;
  if (notify && !mailer.isConfigured() && events.participants(ev.id).some(p => p.invitedAt)) {
    return bad(res, 400, "smtp_not_configured", "The e-mail server is not set up, so the cancellation cannot be sent.");
  }
  events.cancel(ev.id, reason);
  const n = notify ? events.queue(ev.id, "cancel") : 0;
  if (n) startMail(ev.id);
  res.json({ success: true, notified: n });
}));

// ---------------------------------------------------------------------
// The participant's own page (token, no sign-in)
// ---------------------------------------------------------------------

router.get("/public/event/:token", wrap(async (req, res) => {
  const p = events.participantByToken(req.params.token);
  if (!p) return bad(res, 404, "not_found", "This link is not valid.");
  const ev = events.get(p.eventId);
  if (!ev) return bad(res, 404, "not_found", "This link is not valid.");
  const c = companies.get(ev.companyId) || {};
  const { logos } = require("../lib/logo");
  const { start, end } = startEnd(ev);
  res.json({
    name: p.fullName, response: p.response, note: p.responseNote,
    event: {
      title: ev.title, type: ev.eventType, description: ev.description, location: ev.location, onlineUrl: ev.onlineUrl,
      timezone: ev.timezone, startUtc: start.toISOString(), endUtc: end.toISOString(), language: ev.language,
      status: ev.status, cancelReason: ev.cancelReason, started: hasStarted(ev)
    },
    companyName: c.name || "", logoUrl: logos.url(ev.companyId)
  });
}));

router.post("/public/event/:token", wrap(async (req, res) => {
  const p = events.participantByToken(req.params.token);
  if (!p) return bad(res, 404, "not_found", "This link is not valid.");
  const ev = events.get(p.eventId);
  if (!ev || ev.status !== "scheduled") return bad(res, 409, "cancelled", "This event was cancelled.");
  if (hasStarted(ev)) return bad(res, 409, "started", "This event has already started.");
  const response = (req.body || {}).response;
  if (!["accepted", "declined"].includes(response)) return bad(res, 400, "bad_response", "Choose yes or no.");
  const note = String((req.body || {}).note || "").trim().slice(0, 500);
  events.respond(p.id, response, note);
  res.json({ success: true, response });
}));

module.exports = router;
