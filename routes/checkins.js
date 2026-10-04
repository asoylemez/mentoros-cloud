const express = require("express");

const config = require("../config");
const { mentors, mentorships, checkins, companies } = require("../db/repos");
const mailer = require("../mail/mailer");
const questionSet = require("../lib/checkinQuestions");
const { logos } = require("../lib/logo");
const { requireApiKey, requireCompany, ownRecord, wrap } = require("./_helpers");

const router = express.Router();

/**
 * ====================================================================
 * CHECK-IN FEEDBACK  (mid-programme feedback)
 * ====================================================================
 *
 * HR asks the mentor, the mentee (in a group: every member) or both for
 * a short mid-programme feedback, any number of times. It is NOT the
 * closing survey. Each person gets a personal link (no sign-in); only HR
 * sees the answers - never the other party - and nothing goes to the AI.
 *
 * The questions are the organisation's own set ("Feedback questions"
 * page, lib/checkinQuestions.js); every round keeps a copy of them.
 */

const checkinUrl = token => `${config.siteBaseUrl}/checkin.html?token=${token}`;

// ---------------------------------------------------------------------
// The organisation's question set (HR, signed in)
// ---------------------------------------------------------------------

router.get("/checkin-questions", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const { questions, isDefault } = questionSet.load(companyId);
  res.json({ questions, isDefault, types: questionSet.TYPES, limits: questionSet.LIMITS });
}));

router.put("/checkin-questions", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const result = questionSet.save(companyId, (req.body || {}).questions);
  if (!result.ok) {
    return res.status(400).json({ error: "The question set is not valid.", code: "invalid_questions", errors: result.errors });
  }
  res.json({ success: true, questions: result.questions, isDefault: false });
}));

/** Back to the default questions. */
router.delete("/checkin-questions", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  res.json({ success: true, questions: questionSet.reset(companyId), isDefault: true });
}));

// ---------------------------------------------------------------------
// Sending a round (HR)
// ---------------------------------------------------------------------

/** Who gets the request: mentor, mentee (every member of a group) or both. */
function recipients(ms, target) {
  const list = [];
  if (target === "mentor" || target === "both") {
    list.push({
      role: "mentor", memberId: "",
      name: ms.mentorName || "",
      email: ms.mentorEmail || (mentors.get(ms.mentorId) || {}).email || "",
      other: ms.groupId ? "" : (ms.menteeName || "")
    });
  }
  if (target === "mentee" || target === "both") {
    if (ms.groupId) {
      for (const m of ms.members) {
        list.push({ role: "mentee", memberId: m.id, name: m.fullName, email: m.email || "", other: ms.mentorName || "" });
      }
    } else if (!ms.menteeDeleted) {
      list.push({ role: "mentee", memberId: "", name: ms.menteeName || "", email: ms.menteeEmail || "", other: ms.mentorName || "" });
    }
  }
  return list;
}

/**
 * { target: "mentor" | "mentee" | "both", language }
 * Someone with an unanswered round gets the SAME link again (reminder).
 * Without SMTP the rounds are still made and their links returned, so
 * HR can share them by hand.
 */
router.post("/mentorships/:id/checkin", requireApiKey, wrap(async (req, res) => {
  const ms = ownRecord(req, res, mentorships.get(req.params.id), "Mentorship not found");
  if (!ms) return;
  const body = req.body || {};
  const target = ["mentor", "mentee", "both"].includes(body.target) ? body.target : "both";
  const lang = body.language === "en" ? "en" : "tr";

  if (ms.status !== "active") {
    return res.status(400).json({ error: "Feedback can only be asked for an active mentorship.", code: "mentorship_not_active" });
  }

  const list = recipients(ms, target);
  if (!list.length) {
    return res.status(400).json({ error: "There is nobody to ask for this choice.", code: "no_recipients" });
  }

  const questions = questionSet.get(ms.companyId);
  const sent = [], failed = [];

  for (const r of list) {
    const { checkin, reminded } = checkins.openRound(ms.companyId, {
      mentorshipId: ms.id, role: r.role, memberId: r.memberId,
      recipientName: r.name, recipientEmail: r.email, language: lang, questions
    });
    const url = checkinUrl(checkin.token);
    if (!r.email) {
      failed.push({ role: r.role, name: r.name, reason: "No email address on file.", code: "no_email", checkinUrl: url });
      continue;
    }
    try {
      await mailer.sendCheckin({
        to: r.email, name: r.name, otherName: r.other, groupName: ms.groupId ? ms.groupName : "",
        checkin, mentorship: ms, url, reminder: reminded, lang
      });
      sent.push({ role: r.role, name: r.name, email: r.email, reminder: reminded });
    } catch (error) {
      failed.push({ role: r.role, name: r.name, email: r.email, reason: error.message,
                    code: error.code || "send_failed", checkinUrl: url });
    }
  }

  res.status(sent.length ? 200 : 502).json({ success: sent.length > 0, sent, failed });
}));

/** All rounds of a mentorship, newest first, with answers (HR only). */
router.get("/mentorships/:id/checkins", requireApiKey, wrap(async (req, res) => {
  const ms = ownRecord(req, res, mentorships.get(req.params.id), "Mentorship not found");
  if (!ms) return;
  res.json({
    mentorshipId: ms.id,
    summary: checkins.summary(ms.id),
    rounds: checkins.listByMentorship(ms.id).map(c => ({
      id: c.id,
      role: c.role,
      name: c.recipientName,
      status: c.status,
      sentAt: c.sentAt,
      completedAt: c.completedAt,
      reminderCount: c.reminderCount,
      needsSupport: c.needsSupport,
      language: c.language,
      questions: c.questions,
      answers: c.status === "completed" ? c.answers : null,
      checkinUrl: c.status === "pending" ? checkinUrl(c.token) : ""
    }))
  });
}));

// ---------------------------------------------------------------------
// The person's own page (token, no sign-in)
// ---------------------------------------------------------------------

function openByToken(req, res) {
  const c = checkins.getByToken(req.params.token);
  if (!c) {
    res.status(404).json({ error: "This feedback link is not valid.", code: "not_found" });
    return null;
  }
  return c;
}

router.get("/public/checkin/:token", wrap(async (req, res) => {
  const c = openByToken(req, res);
  if (!c) return;
  const ms = mentorships.get(c.mentorshipId);
  const company = ms ? companies.get(ms.companyId) : null;
  res.json({
    status: c.status,
    role: c.role,
    recipientName: c.recipientName,
    // The other side's name only - nothing else about the mentorship.
    otherName: c.role === "mentor"
      ? (ms && ms.groupId ? ms.groupName : (ms && !ms.menteeDeleted ? ms.menteeName : ""))
      : (ms ? ms.mentorName : ""),
    isGroup: !!(ms && ms.groupId),
    companyName: company ? company.name : "",
    logoUrl: ms ? logos.url(ms.companyId) : "",
    language: c.language,
    questions: c.questions,
    completedAt: c.completedAt
  });
}));

router.post("/public/checkin/:token", wrap(async (req, res) => {
  const c = openByToken(req, res);
  if (!c) return;
  if (c.status === "completed") {
    return res.status(409).json({ error: "This feedback has already been sent.", code: "already_completed" });
  }
  const { answers, missing, needsSupport } = questionSet.readAnswers(c.questions, (req.body || {}).answers);
  if (missing.length) {
    return res.status(400).json({ error: "Please answer the required questions.", code: "missing_answers", missing });
  }
  checkins.complete(c.id, answers, needsSupport);
  res.json({ success: true });
}));

module.exports = router;
