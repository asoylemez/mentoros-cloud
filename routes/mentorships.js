const express = require("express");

const config = require("../config");
const { mentors, mentees, mentorships, meetings, meetingDuration, isRealDate } = require("../db/repos");
const { composeMenteeNeed, composeGroupNeed } = require("../lib/menteeNeed");
const { loadMatchableGroup } = require("../lib/groupRules");
const { db } = require("../db");
const { generateDevelopmentPlan } = require("../ai/devplan");
const { generateGuidance } = require("../ai/guidedSession");
const { requireApiKey, requireCompany, ownRecord, refuseGroupMember, wrap } = require("./_helpers");
const { programForMatch } = require("../lib/programRules");

const router = express.Router();

/**
 * Ham erisim token'ini disari vermez; kullanima hazir calisma alani
 * linki uretir. IK bu linki mentor ve mentee ile paylasir - onlar
 * giris yapmadan, paylasimli anahtar olmadan calisma alanina girer.
 */
function withWorkspaceLink(ms) {
  const { accessToken, ...rest } = ms;

  return {
    ...rest,
    workspaceUrl:
      `${config.siteBaseUrl}/mentorship_workspace.html` +
      `?id=${ms.id}&token=${accessToken}`
  };
}

// =====================================================================
// MENTORLUK ILISKILERI
// =====================================================================

/**
 * ====================================================================
 * MATCH = MENTORSHIP  (no approval flow)
 * ====================================================================
 *
 * HR picks the mentor (after the AI suggestions or by hand) and the
 * mentorship and its workspace open AT ONCE. Nobody is e-mailed here:
 * HR sends the workspace e-mail from the HR Dashboard when ready.
 *
 * Body: { mentorId, menteeId, closingDate?, language }
 *   - menteeId of a registered mentee: name, e-mail, role and need are
 *     taken from the RECORDS, never from the browser.
 *   - a menteeId that matches no record is a typed-in (unregistered)
 *     mentee - only in an organisation without programmes; then
 *     menteeName / menteeEmail / menteeRole / menteeDepartment /
 *     developmentNeed come from the body.
 *   - period: with a programme it ends on the programme's end date;
 *     without one HR must give closingDate (YYYY-MM-DD, today or later).
 */
router.post("/mentorships", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const body = req.body || {};
  const { mentorId, menteeId, groupId } = body;
  const lang = body.language === "en" ? "en" : "tr";

  if (!mentorId || (!menteeId && !groupId)) {
    return res.status(400).json({ error: "mentorId and menteeId (or groupId) are required" });
  }

  const mentor = ownRecord(req, res, mentors.get(mentorId), "Mentor not found");
  if (!mentor) return;

  if (groupId) return createGroupMentorship(req, res, companyId, mentor, body, lang);

  // A registered mentee must be the organisation's own; an id that
  // matches no record is a typed-in mentee.
  let mentee = null;
  const found = mentees.get(menteeId);
  if (found) {
    mentee = ownRecord(req, res, found, "Mentee not found");
    if (!mentee) return;
    if (refuseGroupMember(res, mentee)) return;
  }

  // Programme rule; the programme is taken from the mentee, never from the body.
  const rule = programForMatch(res, companyId, mentee, mentor);
  if (!rule) return;

  // One mentor per mentee at a time.
  if (mentee) {
    const engagement = mentees.engagement(companyId, mentee.id);
    if (engagement.state === "matched") {
      return res.status(409).json({
        error: "This mentee already has an active mentorship.",
        detail: engagement.mentorName ? `Mentor: ${engagement.mentorName}` : undefined,
        action: "Complete or cancel the existing mentorship before creating a new match.",
        code: "mentee_already_engaged",
        state: engagement.state,
        mentorName: engagement.mentorName,
        mentorshipId: engagement.mentorshipId
      });
    }
  }

  // Period of the match
  const closingDate = periodEnd(res, rule, body);
  if (!closingDate) return;

  const payload = {
    programId: rule.programId,
    closingDate,
    mentorId: mentor.id,
    mentorName: mentor.fullName || "",
    mentorEmail: mentor.email || "",
    menteeId,
    goals: [], developmentAreas: [], successCriteria: []
  };
  if (mentee) {
    Object.assign(payload, {
      menteeName: mentee.fullName || "",
      menteeEmail: mentee.email || "",
      menteeRole: mentee.role || "",
      menteeDepartment: mentee.department || "",
      developmentNeed: composeMenteeNeed(mentee, lang)
    });
  } else {
    Object.assign(payload, {
      menteeName: String(body.menteeName || "").trim() || "Mentee",
      menteeEmail: String(body.menteeEmail || "").trim(),
      menteeRole: String(body.menteeRole || "").trim(),
      menteeDepartment: String(body.menteeDepartment || "").trim(),
      developmentNeed: String(body.developmentNeed || "").trim()
    });
  }

  const { created, mentorship } = mentorships.create(companyId, payload);
  if (!created) {
    // Same mentor + mentee + programme already had a mentorship (e.g. a
    // completed one): say so instead of silently reusing it.
    return res.status(409).json({
      error: "This mentor and mentee already had a mentorship in this programme.",
      code: "pair_exists",
      mentorshipId: mentorship.id
    });
  }

  const withLink = withWorkspaceLink(mentorship);
  res.json({
    success: true,
    message: "Mentorship created",
    mentorshipId: mentorship.id,
    mentorship: withLink,
    workspaceUrl: withLink.workspaceUrl
  });
}));

/**
 * GROUP MATCH: one mentor with a mentee group. One mentorship, one shared
 * workspace, ONE place of the mentor's capacity. The members are copied
 * into mentorship_members (a snapshot). mentee_id is "group:<groupId>".
 */
function createGroupMentorship(req, res, companyId, mentor, body, lang) {
  const group = loadMatchableGroup(req, res, companyId, body.groupId);
  if (!group) return;

  // Programme rule: the group's programme, the mentor must be in it.
  const rule = programForMatch(res, companyId,
    { id: group.id, companyId: group.companyId, programId: group.programId }, mentor);
  if (!rule) return;

  const closingDate = periodEnd(res, rule, body);
  if (!closingDate) return;

  const { created, mentorship } = mentorships.create(companyId, {
    programId: rule.programId,
    closingDate,
    mentorId: mentor.id,
    mentorName: mentor.fullName || "",
    mentorEmail: mentor.email || "",
    menteeId: `group:${group.id}`,
    menteeName: group.name,
    menteeEmail: "",
    menteeRole: "",
    menteeDepartment: "",
    developmentNeed: composeGroupNeed(group.memberRecords, lang),
    groupId: group.id,
    groupName: group.name,
    members: group.memberRecords.map(m => ({ id: m.id, fullName: m.fullName, email: m.email, role: m.role })),
    goals: [], developmentAreas: [], successCriteria: []
  });
  if (!created) {
    return res.status(409).json({
      error: "This mentor and this group already had a mentorship in this programme.",
      code: "pair_exists",
      mentorshipId: mentorship.id
    });
  }

  const withLink = withWorkspaceLink(mentorship);
  res.json({
    success: true,
    message: "Group mentorship created",
    mentorshipId: mentorship.id,
    mentorship: withLink,
    workspaceUrl: withLink.workspaceUrl
  });
}

/**
 * End date of a new match: the programme's end date, or (without a
 * programme) the date HR gave - today or later. Null after writing 400.
 */
function periodEnd(res, rule, body) {
  if (rule.program) return rule.program.endDate;
  const closingDate = String(body.closingDate || "").trim();
  const today = new Date().toISOString().slice(0, 10);
  if (!isRealDate(closingDate) || closingDate < today) {
    res.status(400).json({
      error: "Give the end date of the match (today or later).",
      code: "closing_date_required"
    });
    return null;
  }
  return closingDate;
}

router.get("/mentorships", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  // When the workspace e-mail last went out (HR sends it by hand from the
  // dashboard, so the dashboard shows who has not been told yet).
  const lastSent = new Map(db.prepare(`
    SELECT ref_id, MAX(sent_at) AS at FROM email_log
     WHERE company_id = ? AND kind = 'workspace' AND ok = 1
     GROUP BY ref_id
  `).all(companyId).map(r => [r.ref_id, r.at]));

  res.json(mentorships.listByCompany(companyId).map(ms => ({
    ...withWorkspaceLink(ms),
    workspaceEmailSentAt: lastSent.get(ms.id) || ""
  })));
}));

router.get("/mentorships/:id", requireApiKey, wrap(async (req, res) => {
  // Toplantilar da dahil doner - calisma sayfasi tek istekle yuklenir.
  const mentorship = ownRecord(req, res, mentorships.getWithMeetings(req.params.id), "Mentorship not found");
  if (!mentorship) return;
  res.json(withWorkspaceLink(mentorship));
}));

/**
 * Mentorluk iliskisini sil (IK).
 *
 * GUVENLIK AGI: Toplanti notlari varsa once uyari doneriz. Silmek
 * onlari da yok eder (foreign key cascade) ve geri alinamaz.
 * IK bilerek onaylarsa ?force=true ile tekrar cagirir.
 */
router.delete("/mentorships/:id", requireApiKey, wrap(async (req, res) => {
  const ms = ownRecord(req, res, mentorships.get(req.params.id), "Mentorship not found");
  if (!ms) return;

  const meetings = mentorships.meetingCount(req.params.id);
  const force = req.query.force === "true";

  if (meetings > 0 && !force) {
    return res.status(409).json({
      error: "This mentorship has meeting notes.",
      code: "has_meetings",
      meetingCount: meetings,
      warning:
        `Silerseniz ${meetings} adet toplanti notu da kalici olarak silinir. ` +
        `Bunun yerine iliskiyi "tamamlandi" olarak isaretlemeyi dusunun - ` +
        `boylece gecmis kayitlar korunur.`
    });
  }

  const removed = mentorships.remove(req.params.id);

  res.json({
    success: true,
    message: "Mentorship deleted",
    deletedMeetings: removed.deletedMeetings,
    note: "The mentor's capacity has been released."
  });
}));

router.patch("/mentorships/:id/status", requireApiKey, wrap(async (req, res) => {
  const allowed = ["active", "completed", "paused", "cancelled"];
  const { status } = req.body;

  if (!allowed.includes(status)) {
    return res.status(400).json({ error: "Invalid status", allowed });
  }

  const existing = ownRecord(req, res, mentorships.get(req.params.id), "Mentorship not found");
  if (!existing) return;

  const updated = mentorships.updateStatus(req.params.id, status);

  // Iliski bittiyse mentorun kapasitesini geri ver.
  if (["completed", "cancelled"].includes(status) && existing.status === "active") {
    mentors.incrementMenteeCount(existing.mentorId, -1);
  }

  res.json({ success: true, mentorshipId: updated.id, status: updated.status });
}));

// Calisma alaninin kapanacagi tarihi belirle / revize et (IK).
// Tarih bilgi amaclidir: sayfa SILINMEZ, tarih gecse bile erisim acik kalir.
// Bos deger gonderilirse tarih temizlenir.
router.patch("/mentorships/:id/closing-date", requireApiKey, wrap(async (req, res) => {
  if (!ownRecord(req, res, mentorships.get(req.params.id), "Mentorship not found")) return;

  const raw = (req.body.closingDate || "").trim();

  // Bosaltmaya izin ver; dolu ise YYYY-AA-GG bicimini bekle.
  if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return res.status(400).json({ error: "closingDate must be YYYY-MM-DD or empty" });
  }

  const updated = mentorships.setClosingDate(req.params.id, raw);

  res.json({
    success: true,
    mentorshipId: updated.id,
    closingDate: updated.closingDate || ""
  });
}));

// Hedefleri elle guncelleme (mentor veya mentee)
router.patch("/mentorships/:id/development-plan", requireApiKey, wrap(async (req, res) => {
  if (!ownRecord(req, res, mentorships.get(req.params.id), "Mentorship not found")) return;

  const updated = mentorships.updateDevelopmentPlan(req.params.id, {
    goals: req.body.goals || [],
    developmentAreas: req.body.developmentAreas || [],
    successCriteria: req.body.successCriteria || []
  });

  res.json({
    success: true,
    message: "Development plan updated",
    mentorship: updated
  });
}));

// =====================================================================
// TOPLANTILAR
//
// Eski surumde bu tamamen kirikti (Firestore subcollection, SQLite'ta
// karsiligi yoktu). Artik calisiyor.
// =====================================================================

router.get("/mentorships/:id/meetings", requireApiKey, wrap(async (req, res) => {
  if (!ownRecord(req, res, mentorships.get(req.params.id), "Mentorship not found")) return;
  res.json(meetings.listByMentorship(req.params.id));
}));

router.post("/mentorships/:id/meetings", requireApiKey, wrap(async (req, res) => {
  const { meetingDate, title } = req.body;

  if (!ownRecord(req, res, mentorships.get(req.params.id), "Mentorship not found")) return;

  if (!meetingDate || !title) {
    return res.status(400).json({ error: "meetingDate and title are required" });
  }
  // The duration is required: it feeds HR meeting tracking.
  if (meetingDuration(req.body.duration ?? req.body.durationMinutes) === null) {
    return res.status(400).json({
      error: "The meeting duration is required (HH:MM, between 00:01 and 12:00).",
      code: "duration_required"
    });
  }

  const meeting = meetings.create(req.params.id, req.body);

  res.json({
    success: true,
    message: "Meeting note saved",
    meetingId: meeting.id,
    meeting
  });
}));

router.patch(
  "/mentorships/:id/meetings/:meetingId/action",
  requireApiKey,
  wrap(async (req, res) => {
    const { index, status } = req.body;

    // The mentorship must be the company's own, and the meeting must
    // belong to THAT mentorship (not merely exist somewhere).
    if (!ownRecord(req, res, mentorships.get(req.params.id), "Mentorship not found")) return;

    const meeting = meetings.get(req.params.meetingId);
    if (!meeting || meeting.mentorshipId !== req.params.id) {
      return res.status(404).json({ error: "Meeting not found", code: "not_found" });
    }

    const updated = meetings.updateActionStatus(
      req.params.meetingId,
      Number(index),
      status === "done" ? "done" : "open"
    );

    if (!updated) {
      return res.status(400).json({ error: "Meeting or action item not found" });
    }

    res.json({ success: true, meeting: updated });
  })
);

// =====================================================================
// AI: GELISIM PLANI
// =====================================================================

router.post("/development-plan", requireApiKey, wrap(async (req, res) => {
  const {
    mentorshipId,
    menteeRole,
    menteeDepartment,
    developmentNeed,
    menteeName,
    mentorName,
    language = "tr"
  } = req.body;

  // Iliski id'si verildiyse bilgileri DB'den al (daha guvenilir).
  let input = { menteeRole, menteeDepartment, developmentNeed, mentorRole: "" };
  let knownNames = [menteeName, mentorName].filter(Boolean);

  if (mentorshipId) {
    const ms = ownRecord(req, res, mentorships.get(mentorshipId), "Mentorship not found");
    if (!ms) return;
    const mentor = mentors.get(ms.mentorId);

    input = {
      menteeRole: ms.menteeRole || menteeRole || "",
      menteeDepartment: ms.menteeDepartment || menteeDepartment || "",
      developmentNeed: ms.developmentNeed || developmentNeed || "",
      mentorRole: mentor?.role || ""
    };
    knownNames = [ms.menteeName, ms.mentorName, mentor?.fullName].filter(Boolean);
  }

  if (!input.developmentNeed) {
    return res.status(400).json({ error: "developmentNeed is required" });
  }

  // NOT: isimler AI'a GITMEZ - sadece maskeleme listesine girer.
  const plan = await generateDevelopmentPlan({
    ...input,
    language,
    knownNames
  });

  // Iliski verildiyse plani dogrudan kaydet.
  if (mentorshipId) {
    mentorships.updateDevelopmentPlan(mentorshipId, {
      goals: plan.developmentGoals,
      developmentAreas: plan.developmentAreas,
      successCriteria: plan.successCriteria
    });
  }

  res.json(plan);
}));

// =====================================================================
// AI: REHBERLI SEANS
//
// Bu endpoint eski server.js'te HIC YOKTU; guided_session.html
// cagiriyordu ama karsiligi olmadigi icin sayfa kirikti.
// =====================================================================

router.post("/guided-session", requireApiKey, wrap(async (req, res) => {
  const {
    step = 1,
    mentorshipId = "",
    userInput = "",
    previousAnswers = {},
    mentorName = "",
    menteeName = "",
    language = "tr"
  } = req.body;

  let developmentNeed = req.body.developmentNeed || "";
  let knownNames = [mentorName, menteeName].filter(Boolean);

  if (mentorshipId) {
    // A mentorship id that is not the company's own is refused (404).
    const ms = ownRecord(req, res, mentorships.get(mentorshipId), "Mentorship not found");
    if (!ms) return;

    developmentNeed = ms.developmentNeed || developmentNeed;
    knownNames = [ms.mentorName, ms.menteeName].filter(Boolean);
  }

  const guidance = await generateGuidance({
    step: Number(step) || 1,
    userInput,
    previousAnswers,
    developmentNeed,
    knownNames,
    language
  });

  res.json(guidance);
}));

// =====================================================================
// HR: MEETING TRACKING  (dates and durations only - never the content)
//
// What was discussed stays between mentor and mentee: this endpoint
// returns, per mentorship, only the meeting dates and durations and the
// figures derived from them. Titles, agendas, notes and action items are
// never selected here.
// =====================================================================

const SILENT_DAYS = 45;          // active, but no meeting for this long
const DAY = 86400000;

router.get("/meeting-tracking", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  const todayStr = new Date().toISOString().slice(0, 10);
  const today = Date.parse(todayStr + "T00:00:00Z");
  const upcoming = d => !!d && String(d).slice(0, 10) >= todayStr;

  // ?programId=<id> | none (no programme) | all (default)
  const pf = String(req.query.programId || "all");
  const inFilter = ms => pf === "all" || (pf === "none" ? !ms.programId : ms.programId === pf);

  const rows = mentorships.listByCompany(companyId).filter(inFilter).map(ms => {
    const items = meetings.listByMentorship(ms.id).map(m => ({
      date: m.meetingDate,
      durationMinutes: m.durationMinutes == null ? null : Number(m.durationMinutes)
    }));
    const timed = items.filter(m => m.durationMinutes != null);
    const total = timed.reduce((a, m) => a + m.durationMinutes, 0);
    const last = items.length ? items[items.length - 1].date : null;
    const lastTs = last ? Date.parse(String(last).slice(0, 10) + "T00:00:00Z") : NaN;

    return {
      id: ms.id,
      programId: ms.programId || "",
      mentorName: ms.mentorName || "",
      menteeName: ms.menteeName || "",
      isGroup: !!ms.groupId,
      menteeDeleted: !!ms.menteeDeleted,
      memberCount: (ms.members || []).length,
      status: ms.status,
      meetings: items,
      meetingCount: items.length,
      timedCount: timed.length,
      totalMinutes: total,
      avgMinutes: timed.length ? Math.round(total / timed.length) : null,
      firstMeeting: items.length ? items[0].date : null,
      lastMeeting: last,
      daysSinceLast: Number.isFinite(lastTs) ? Math.max(0, Math.floor((today - lastTs) / DAY)) : null,
      // Only an UPCOMING date is "next": when a note is saved without a
      // next date, the mentorship keeps the meeting's own (past) date.
      nextMeetingDate: upcoming(ms.nextMeetingDate) ? ms.nextMeetingDate : "",
      nextMeetingTime: upcoming(ms.nextMeetingDate) ? (ms.nextMeetingTime || "") : ""
    };
  });

  const active = rows.filter(r => r.status === "active");
  res.json({
    silentDays: SILENT_DAYS,
    stats: {
      total: rows.length,
      active: active.length,
      completed: rows.filter(r => r.status === "completed").length,
      neverMet: active.filter(r => r.meetingCount === 0).length,
      silent: active.filter(r => r.daysSinceLast != null && r.daysSinceLast >= SILENT_DAYS).length
    },
    rows
  });
}));

module.exports = router;
