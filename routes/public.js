const express = require("express");
const { logos } = require("../lib/logo");
const formConfig = require("../lib/formConfig");

const {
  companies, mentors, mentees, mentorships, meetings,
  meetingDuration, programs
} = require("../db/repos");

/** Name of the programme a mentorship belongs to ('' = none). */
function programNameOf(programId) {
  const p = programId ? programs.get(programId) : null;
  return p ? p.name : "";
}
const { generateDevelopmentPlan } = require("../ai/devplan");
const { generateGuidance } = require("../ai/guidedSession");
const mailer = require("../mail/mailer");
const { wrap } = require("./_helpers");

const router = express.Router();

// =====================================================================
// 1. MENTOR KAYDI  (davet linki ile)
// =====================================================================

/** Davet token'i gecerli mi? Form acilmadan once cagrilir. */
router.get("/public/invite/:token", wrap(async (req, res) => {
  const company = companies.findByInviteToken(req.params.token);

  if (!company) {
    return res.status(404).json({
      error: "This invitation link is invalid or has expired.",
      code: "invalid_invite"
    });
  }

  // Sadece formun ihtiyaci olan kadar bilgi doner.
  res.json({
    companyId: company.companyId,
    companyName: company.name,
    logoUrl: logos.url(company.companyId),
    // The organisation's form settings (which fields, required, texts).
    formConfig: formConfig.get(company.companyId)
  });
}));

/** Mentor kaydi. Giris yok, API anahtari yok - sadece davet token'i. */
router.post("/public/invite/:token/mentors", wrap(async (req, res) => {
  const company = companies.findByInviteToken(req.params.token);

  if (!company) {
    return res.status(403).json({
      error: "This invitation link is invalid.",
      code: "invalid_invite"
    });
  }

  if (!req.body.fullName || !req.body.email) {
    return res.status(400).json({ error: "Name and email are required." });
  }
  // Required fields as the organisation's form settings make them.
  const missingFields = formConfig.missing(company.companyId, "mentor", req.body);
  if (missingFields.length) {
    return res.status(400).json({ error: "Some required fields are empty.", code: "missing_fields", fields: missingFields });
  }

  const mentor = mentors.create(company.companyId, req.body);

  // Mentora id disinda hicbir sey donmez - baska mentorlari goremez.
  res.json({
    success: true,
    message: "Your mentor profile has been saved.",
    id: mentor.id
  });
}));

/** Mentee kaydi. Giris yok, API anahtari yok - sadece davet token'i. */
router.post("/public/invite/:token/mentees", wrap(async (req, res) => {
  const company = companies.findByInviteToken(req.params.token);

  if (!company) {
    return res.status(403).json({
      error: "This invitation link is invalid.",
      code: "invalid_invite"
    });
  }

  if (!req.body.fullName || !req.body.email) {
    return res.status(400).json({ error: "Name and email are required." });
  }
  // Required fields as the organisation's form settings make them.
  const missingFields = formConfig.missing(company.companyId, "mentee", req.body);
  if (missingFields.length) {
    return res.status(400).json({ error: "Some required fields are empty.", code: "missing_fields", fields: missingFields });
  }

  const mentee = mentees.create(company.companyId, req.body);

  res.json({
    success: true,
    message: "Your mentee profile has been saved.",
    id: mentee.id
  });
}));

// =====================================================================
// 3. CALISMA ALANI  (iliskiye ozel token ile)
// =====================================================================

/** Her calisma alani isteginde token dogrulanir. */
function requireWorkspaceToken(req, res, next) {
  const token = req.query.token || req.body?.token;
  const mentorship = mentorships.verifyAccess(req.params.id, token);

  if (!mentorship) {
    return res.status(403).json({
      error: "You do not have access to this workspace.",
      code: "invalid_token"
    });
  }

  req.mentorship = mentorship;
  next();
}

router.get("/public/workspace/:id", requireWorkspaceToken, wrap(async (req, res) => {
  const full = mentorships.getWithMeetings(req.params.id);

  // Erisim token'i kendisini geri dondurmez.
  const { accessToken, ...safe } = full;
  safe.programName = programNameOf(full.programId);
  safe.logoUrl = logos.url(full.companyId);
  // Group: members by name only - the workspace link is shared by the
  // whole group, so it does not carry the members' e-mail addresses.
  safe.members = (full.members || []).map(m => ({ fullName: m.fullName, role: m.role }));
  // The mentor's availability calendar (stored on the mentor).
  safe.mentorAvailability = mentors.getMeetingSlots(full.mentorId) || { weekly: {}, dates: {}, updatedAt: null };
  res.json(safe);
}));

/**
 * The mentor's meeting availability (weekly slots + specific dates).
 * Stored on the mentor, so every workspace of this mentor shows it.
 * Anyone holding this workspace link may edit it (as in v28).
 */
router.put("/public/workspace/:id/availability", requireWorkspaceToken, wrap(async (req, res) => {
  const saved = mentors.setMeetingSlots(req.mentorship.mentorId, req.body || {});
  if (!saved) {
    return res.status(404).json({ error: "The mentor of this workspace was not found.", code: "no_mentor" });
  }
  res.json({ success: true, mentorAvailability: saved });
}));

/** AI ile hedef uret. Isimler AI'a GITMEZ (bkz. ai/devplan.js). */
router.post(
  "/public/workspace/:id/development-plan",
  requireWorkspaceToken,
  wrap(async (req, res) => {
    const ms = req.mentorship;
    const mentor = mentors.get(ms.mentorId);

    const plan = await generateDevelopmentPlan({
      menteeRole: ms.menteeRole,
      menteeDepartment: ms.menteeDepartment,
      developmentNeed: ms.developmentNeed,
      mentorRole: mentor?.role || "",
      language: req.body.language || "tr",
      knownNames: [ms.menteeName, ms.mentorName, mentor?.fullName].filter(Boolean)
    });

    mentorships.updateDevelopmentPlan(req.params.id, {
      goals: plan.developmentGoals,
      developmentAreas: plan.developmentAreas,
      successCriteria: plan.successCriteria
    });

    res.json(plan);
  })
);

/** Hedefleri elle guncelle (mentor veya mentee duzenleyebilir). */
router.patch(
  "/public/workspace/:id/development-plan",
  requireWorkspaceToken,
  wrap(async (req, res) => {
    const updated = mentorships.updateDevelopmentPlan(req.params.id, {
      goals: req.body.goals || [],
      developmentAreas: req.body.developmentAreas || [],
      successCriteria: req.body.successCriteria || []
    });

    const { accessToken, ...safe } = updated;
    res.json({ success: true, mentorship: safe });
  })
);

/** Toplanti notu ekle. */
router.post(
  "/public/workspace/:id/meetings",
  requireWorkspaceToken,
  wrap(async (req, res) => {
    if (!req.body.meetingDate || !req.body.title) {
      return res.status(400).json({ error: "Date and title are required." });
    }
    // The duration is required: it feeds HR meeting tracking.
    if (meetingDuration(req.body.duration ?? req.body.durationMinutes) === null) {
      return res.status(400).json({
        error: "The meeting duration is required (HH:MM, between 00:01 and 12:00).",
        code: "duration_required"
      });
    }

    const meeting = meetings.create(req.params.id, req.body);

    // Sonraki gorusme tarihi girildiyse mentor ve mentee'ye takvim daveti
    // (.ics) gonder. E-POSTA HATASI KAYDI BLOKLAMAZ - not her halukarda
    // kaydedilir; sonuc bilgi amacli yanitta doner.
    let invite = null;
    if (req.body.nextMeetingDate) {
      try {
        const result = await mailer.sendMeetingInvite({
          mentorship: req.mentorship,
          meetingDate: req.body.nextMeetingDate,
          time: req.body.nextMeetingTime || "10:00",
          focus: req.body.nextMeetingFocus || "",
          guests: req.body.nextMeetingGuests || "",
          lang: req.body.language === "en" ? "en" : "tr"
        });
        // Gecersiz/atlanan adresler de doner - arayuz "davet gitti" deyip
        // birini sessizce disarida birakmasin.
        invite = { sent: result.ok, guests: result.guests };
      } catch (err) {
        console.error("Toplanti daveti gonderilemedi:", err.message);
        invite = { sent: false, reason: err.code || err.message };
      }
    }

    res.json({ success: true, meetingId: meeting.id, meeting, invite });
  })
);

/** Aksiyon maddesini tamamlandi/acik isaretle. */
router.patch(
  "/public/workspace/:id/meetings/:meetingId/action",
  requireWorkspaceToken,
  wrap(async (req, res) => {
    // The token opens ONE workspace: the meeting must belong to it.
    // (Without this, any valid workspace link could change the action
    // items of any meeting whose id it knew - in any organisation.)
    const meeting = meetings.get(req.params.meetingId);
    if (!meeting || meeting.mentorshipId !== req.params.id) {
      return res.status(404).json({ error: "Meeting not found.", code: "not_found" });
    }

    const updated = meetings.updateActionStatus(
      req.params.meetingId,
      Number(req.body.index),
      req.body.status === "done" ? "done" : "open"
    );

    if (!updated) {
      return res.status(400).json({ error: "Action item not found." });
    }

    res.json({ success: true, meeting: updated });
  })
);

/** Rehberli seans. */
router.post(
  "/public/workspace/:id/guided-session",
  requireWorkspaceToken,
  wrap(async (req, res) => {
    const ms = req.mentorship;

    const guidance = await generateGuidance({
      step: Number(req.body.step) || 1,
      userInput: req.body.userInput || "",
      previousAnswers: req.body.previousAnswers || {},
      developmentNeed: ms.developmentNeed,
      knownNames: [ms.mentorName, ms.menteeName].filter(Boolean),
      language: req.body.language || "tr"
    });

    res.json(guidance);
  })
);

module.exports = router;
