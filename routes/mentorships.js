const express = require("express");

const config = require("../config");
const { mentors, mentorships, meetings } = require("../db/repos");
const { generateDevelopmentPlan } = require("../ai/devplan");
const { generateGuidance } = require("../ai/guidedSession");
const { requireApiKey, requireCompany, wrap, requireLicense } = require("./_helpers");

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

router.post("/mentorships", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const { mentorId, menteeId } = req.body;

  if (!mentorId || !menteeId) {
    return res.status(400).json({ error: "mentorId and menteeId are required" });
  }

  const { created, mentorship } = mentorships.create(companyId, req.body);

  const withLink = withWorkspaceLink(mentorship);

  res.json({
    success: true,
    message: created
      ? "Workspace created"
      : "A workspace already exists for this match",
    mentorshipId: mentorship.id,
    mentorship: withLink,
    workspaceUrl: withLink.workspaceUrl
  });
}));

router.get("/mentorships", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  res.json(mentorships.listByCompany(companyId).map(withWorkspaceLink));
}));

router.get("/mentorships/:id", requireApiKey, wrap(async (req, res) => {
  // Toplantilar da dahil doner - calisma sayfasi tek istekle yuklenir.
  const mentorship = mentorships.getWithMeetings(req.params.id);
  if (!mentorship) {
    return res.status(404).json({ error: "Mentorship not found" });
  }
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
  const ms = mentorships.get(req.params.id);

  if (!ms) {
    return res.status(404).json({ error: "Mentorship not found" });
  }

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

  const existing = mentorships.get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: "Mentorship not found" });
  }

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
  if (!mentorships.get(req.params.id)) {
    return res.status(404).json({ error: "Mentorship not found" });
  }

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
  if (!mentorships.get(req.params.id)) {
    return res.status(404).json({ error: "Mentorship not found" });
  }

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
  if (!mentorships.get(req.params.id)) {
    return res.status(404).json({ error: "Mentorship not found" });
  }
  res.json(meetings.listByMentorship(req.params.id));
}));

router.post("/mentorships/:id/meetings", requireApiKey, wrap(async (req, res) => {
  const { meetingDate, title } = req.body;

  if (!meetingDate || !title) {
    return res.status(400).json({ error: "meetingDate and title are required" });
  }
  if (!mentorships.get(req.params.id)) {
    return res.status(404).json({ error: "Mentorship not found" });
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

router.post("/development-plan", requireApiKey, requireLicense, wrap(async (req, res) => {
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
    const ms = mentorships.get(mentorshipId);
    if (!ms) {
      return res.status(404).json({ error: "Mentorship not found" });
    }
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

router.post("/guided-session", requireApiKey, requireLicense, wrap(async (req, res) => {
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
    const ms = mentorships.get(mentorshipId);
    if (ms) {
      developmentNeed = ms.developmentNeed || developmentNeed;
      knownNames = [ms.mentorName, ms.menteeName].filter(Boolean);
    }
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

module.exports = router;
