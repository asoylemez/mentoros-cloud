const express = require("express");

const config = require("../config");
const { db, slugify } = require("../db");
const { mentors, mentees, mentorships, programs, surveys } = require("../db/repos");
const mailer = require("../mail/mailer");
const { requireApiKey, requireCompany, wrap } = require("./_helpers");

const router = express.Router();

/**
 * SURVEY MANAGEMENT (HR, signed-in organisation only) - V04.
 *
 * One row per survey sent to one person: mid-term survey rounds (checkins)
 * and closing surveys. Shows WHO answered and who did not - never the
 * answers (those are in Reports). HR sends reminders to the pending ones,
 * one by one or all at once; the reminder is the same personal link with
 * the organisation's reminder text (Admin > E-mails).
 *
 * Reminder rules (same as the HR Dashboard):
 *   - only to unanswered surveys, only with an e-mail address
 *   - at most one per person per 24 hours
 *   - a mid-term survey only while its mentorship is active
 */

const DAY = 24 * 60 * 60 * 1000;
const MAX_PER_REQUEST = 300;
const checkinUrl = token => `${config.siteBaseUrl}/checkin.html?token=${token}`;
const surveyUrl = token => `${config.siteBaseUrl}/survey.html?token=${token}`;
const TABLE = { checkin: "checkins", closing: "surveys" };

function rowsOf(companyId) {
  return db.prepare(`
    SELECT 'checkin' AS type, id, mentorship_id, role, member_id, recipient_name, recipient_email, status,
           sent_at, completed_at, reminder_count, last_reminded_at, language, token
      FROM checkins WHERE company_id = ?
    UNION ALL
    SELECT 'closing' AS type, id, mentorship_id, role, COALESCE(member_id, ''), recipient_name, recipient_email, status,
           sent_at, completed_at, reminder_count, last_reminded_at, language, token
      FROM surveys WHERE company_id = ?
    ORDER BY sent_at DESC`).all(companyId, companyId);
}

/** Why a reminder cannot go now ('' = it can). */
function blocker(row, ms, now = Date.now()) {
  if (row.status === "completed") return "completed";
  if (!ms) return "mentorship_missing";
  if (row.type === "checkin" && ms.status !== "active") return "mentorship_not_active";
  if (!String(row.recipient_email || "").trim()) return "no_email";
  const last = Date.parse(row.last_reminded_at || row.sent_at || "");
  if (Number.isFinite(last) && now - last < DAY) return "too_soon";
  return "";
}

function nextReminderAt(row) {
  const last = Date.parse(row.last_reminded_at || row.sent_at || "");
  return Number.isFinite(last) ? new Date(last + DAY).toISOString() : "";
}

/** The other side of the match, as the e-mails name it. */
function otherSide(row, ms) {
  if (row.role === "mentor") return ms.groupId ? (ms.groupName || ms.menteeName || "") : (ms.menteeName || "");
  return ms.mentorName || "";
}

router.get("/survey-management", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const cid = slugify(companyId);

  const msById = new Map(mentorships.listByCompany(cid).map(m => [m.id, m]));
  const sicil = new Map([...mentors.listByCompany(cid), ...mentees.listByCompany(cid)].map(p => [p.id, p.sicilNo || ""]));
  const progName = new Map(programs.listByCompany(cid).map(p => [p.id, p.name]));

  const rows = rowsOf(cid).map(r => {
    const ms = msById.get(r.mentorship_id) || null;
    const personId = !ms ? "" : r.role === "mentor" ? ms.mentorId : (r.member_id || ms.menteeId);
    const why = blocker(r, ms);
    return {
      key: `${r.type}:${r.id}`,
      type: r.type,
      id: r.id,
      mentorshipId: r.mentorship_id,
      mentorshipStatus: ms ? ms.status : "",
      programId: ms ? (ms.programId || "") : "",
      programName: ms ? (progName.get(ms.programId) || "") : "",
      pair: ms ? `${ms.mentorName || ""} → ${ms.groupId ? (ms.groupName || ms.menteeName || "") : (ms.menteeName || "")}` : "",
      group: !!(ms && ms.groupId),
      role: r.role,
      sicilNo: sicil.get(personId) || "",
      name: r.recipient_name || "",
      sentAt: r.sent_at,
      status: r.status === "completed" ? "completed" : "pending",
      completedAt: r.completed_at || "",
      reminderCount: Number(r.reminder_count) || 0,
      lastRemindedAt: r.last_reminded_at || "",
      canRemind: !why,
      blocker: why,
      nextReminderAt: why === "too_soon" ? nextReminderAt(r) : ""
    };
  });

  res.json({ rows, programs: [...progName].map(([id, name]) => ({ id, name })), maxPerRequest: MAX_PER_REQUEST });
}));

/**
 * { items: [{ type: "checkin" | "closing", id }] } - reminders, one e-mail
 * per person. Answer: { sent, skipped, failed } (each with type, id, name).
 */
router.post("/survey-management/remind", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const cid = slugify(companyId);
  const items = (req.body || {}).items;
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: "Choose at least one survey.", code: "no_items" });
  }
  if (items.length > MAX_PER_REQUEST) {
    return res.status(400).json({ error: `At most ${MAX_PER_REQUEST} reminders at once.`, code: "too_many", max: MAX_PER_REQUEST });
  }

  const sent = [], skipped = [], failed = [];
  const seen = new Set();
  for (const it of items) {
    const type = it && it.type, id = String((it && it.id) || "");
    if (!TABLE[type] || !id || seen.has(`${type}:${id}`)) continue;
    seen.add(`${type}:${id}`);

    // Only this organisation's rows: another organisation's id is "not found".
    const raw = db.prepare(`SELECT * FROM ${TABLE[type]} WHERE id = ? AND company_id = ?`).get(id, cid);
    if (!raw) { skipped.push({ type, id, reason: "not_found" }); continue; }
    const row = { ...raw, type, member_id: raw.member_id || "" };
    const ms = mentorships.get(row.mentorship_id);
    const why = blocker(row, ms && ms.companyId === cid ? ms : null);
    const who = { type, id, name: row.recipient_name || "" };
    if (why) { skipped.push({ ...who, reason: why }); continue; }

    const lang = row.language === "en" ? "en" : "tr";
    try {
      if (type === "checkin") {
        await mailer.sendCheckin({
          to: row.recipient_email, name: row.recipient_name, otherName: otherSide(row, ms),
          groupName: ms.groupId ? (ms.groupName || ms.menteeName || "") : "",
          checkin: { id: row.id }, mentorship: ms, url: checkinUrl(row.token), reminder: true, lang
        });
        db.prepare(`UPDATE checkins SET reminder_count = reminder_count + 1, last_reminded_at = ? WHERE id = ?`)
          .run(new Date().toISOString(), row.id);
      } else {
        await mailer.sendSurvey({
          to: row.recipient_email, name: row.recipient_name, otherName: otherSide(row, ms),
          survey: { id: row.id, recipientName: row.recipient_name }, mentorship: ms,
          url: surveyUrl(row.token), reminder: true, lang
        });
        surveys.markReminded(row.id);
      }
      sent.push(who);
    } catch (error) {
      failed.push({ ...who, reason: error.message, code: error.code || "send_failed" });
    }
  }

  res.json({ success: sent.length > 0, sent, skipped, failed });
}));

module.exports = router;
