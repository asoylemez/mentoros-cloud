const express = require("express");

const config = require("../config");
const {
  companies, mentors, mentees, mentorships, meetings, matchRequests
} = require("../db/repos");
const { generateDevelopmentPlan } = require("../ai/devplan");
const { generateGuidance } = require("../ai/guidedSession");
const mailer = require("../mail/mailer");
const { wrap, requireLicense } = require("./_helpers");

const router = express.Router();

/** Red gerekcesi gecerli mi? Degilse hata nesnesi doner. */
function validateRejection(type, category, note) {
  const allowed = REJECTION_CATEGORIES[type] || [];

  if (!category || !allowed.includes(category)) {
    return {
      error: "A reason is required when declining.",
      detail: "Please choose why you are declining this match.",
      code: "reason_required"
    };
  }

  // "Diger" secildiyse aciklama sart - yoksa kategori bilgi tasimaz.
  if (category === "other" && String(note || "").trim().length < 5) {
    return {
      error: "Please add a short explanation.",
      detail: "You selected 'Other', so a brief note is needed.",
      code: "note_required"
    };
  }

  return null;
}

/**
 * ====================================================================
 * HERKESE ACIK ROUTE'LAR  (x-api-key GEREKTIRMEZ)
 * ====================================================================
 *
 * PROBLEM:
 *   Eskiden mentor kayit formu, calisma sayfasi ve onay sayfasi
 *   paylasimli API anahtarini (x-api-key) HTML icinde tasiyordu.
 *   Yani forma ulasan bir mentor, sayfanin kaynagina bakip anahtari
 *   okuyabiliyor ve onunla TUM IK verilerine (butun mentorlar,
 *   butun eslesmeler) erisebiliyordu.
 *
 * COZUM:
 *   Bu sayfalar artik paylasimli anahtar tasimaz. Her biri, SADECE
 *   kendi kaynagina erisim veren bir token kullanir:
 *
 *     - Kayit formu       -> firmanin davet token'i
 *     - Onay sayfasi      -> o talebe ozel mentor/mentee token'i
 *     - Calisma sayfasi   -> o iliskiye ozel erisim token'i
 *
 *   Token, sahibine baska hicbir sey gostermez.
 */

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
    companyName: company.name
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

  const mentee = mentees.create(company.companyId, req.body);

  res.json({
    success: true,
    message: "Your mentee profile has been saved.",
    id: mentee.id
  });
}));

// =====================================================================
// 2. ESLESME ONAYI  (talebe ozel token ile)
// =====================================================================

router.get("/public/approval/:id", wrap(async (req, res) => {
  const { type, token } = req.query;

  const request = matchRequests.verifyToken(req.params.id, type, token);
  if (!request) {
    return res.status(403).json({
      error: "This approval link is invalid.",
      code: "invalid_token"
    });
  }

  const { mentorToken, menteeToken, managerToken, ...safe } = request;

  // Sayfa, yonetici kapisinin durumunu bilmeli ki mentor/mentee'ye
  // "once yoneticinin onayi bekleniyor" diyebilsin.
  safe.managerGateOpen = matchRequests.managerGateOpen(request);

  res.json(safe);
}));

/**
 * Red gerekcesi kategorileri.
 *
 * NEDEN KATEGORI + SERBEST NOT?
 *   Sadece serbest metin olsaydi IK istatistik cikaramazdi.
 *   Sadece kategori olsaydi ayrinti kaybolurdu.
 *   Ikisi birlikte: "6 red, 4'u zamanlama" + neden oyle oldugu.
 */
const REJECTION_CATEGORIES = {
  manager: ["timing", "priority", "workload", "different_mentor", "other"],
  mentor:  ["timing", "capacity", "not_my_area", "different_mentor", "other"],
  mentee:  ["timing", "priority", "different_mentor", "other"]
};

router.patch("/public/approval/:id", wrap(async (req, res) => {
  const { type, status, token, rejectionCategory, rejectionNote } = req.body;

  if (!["mentor", "mentee", "manager"].includes(type)) {
    return res.status(400).json({ error: "Invalid party." });
  }
  if (!["approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "Invalid approval status." });
  }

  const request = matchRequests.verifyToken(req.params.id, type, token);
  if (!request) {
    return res.status(403).json({ error: "This approval link is invalid." });
  }

  if (request.status !== "pending") {
    return res.status(409).json({
      error: "This request has already been resolved.",
      status: request.status
    });
  }

  // ==================================================================
  // YONETICI KAPISI
  //
  // Mentee'nin yoneticisi girilmisse, mentor ve mentee ONDAN ONCE onay
  // veremez. Sebep: mentee'nin zamanini taahhut eden kisi yoneticisidir.
  // Yonetici reddederse mentorun zamani bosa harcanmamis olur.
  // ==================================================================

  if (type === "manager") {
    if (request.managerApproval === "not_required") {
      return res.status(400).json({
        error: "No manager approval is required for this request."
      });
    }

    if (request.managerApproval !== "pending") {
      return res.status(409).json({
        error: "You have already responded to this request.",
        status: request.managerApproval
      });
    }

    // Red ediliyorsa GEREKCE ZORUNLU.
    // "Reddedildi" tek basina IK'ya hicbir sey soylemez.
    if (status === "rejected") {
      const problem = validateRejection("manager", rejectionCategory, rejectionNote);
      if (problem) return res.status(400).json(problem);
    }

    const updated = matchRequests.setManagerApproval(req.params.id, status);

    // Yonetici reddettiyse surec biter - mentor/mentee hic rahatsiz edilmez.
    if (status === "rejected") {
      matchRequests.setRejection(req.params.id, {
        by: "manager",
        category: rejectionCategory,
        note: rejectionNote
      });
      matchRequests.setStatus(req.params.id, "rejected");

      return res.json({
        success: true,
        status: "rejected",
        message: "The request has been declined. No further approvals will be requested."
      });
    }

    return res.json({
      success: true,
      status: "manager_approved",
      message: "Approved. The mentor and the mentee can now be asked to confirm.",
      managerApproval: updated.managerApproval
    });
  }

  // --- Mentor / mentee: yonetici kapisi acik mi? ---
  if (!matchRequests.managerGateOpen(request)) {
    return res.status(409).json({
      error: "Manager approval is still pending.",
      detail:
        `This match first needs approval from the mentee's manager` +
        (request.managerName ? ` (${request.managerName})` : "") + ".",
      code: "manager_pending"
    });
  }

  if (status === "rejected") {
    const problem = validateRejection(type, rejectionCategory, rejectionNote);
    if (problem) return res.status(400).json(problem);
  }

  const updated = matchRequests.setApproval(req.params.id, type, status);

  // --- Reddedildi ---
  if (updated.mentorApproval === "rejected" || updated.menteeApproval === "rejected") {
    matchRequests.setRejection(req.params.id, {
      by: type,
      category: rejectionCategory,
      note: rejectionNote
    });
    matchRequests.setStatus(req.params.id, "rejected");

    return res.json({ success: true, status: "rejected" });
  }

  // --- Iki taraf da onayladi -> calisma alani ac ---
  if (
    updated.mentorApproval === "approved" &&
    updated.menteeApproval === "approved" &&
    !updated.mentorshipId
  ) {
    const { mentorship } = mentorships.create(updated.companyId, {
      mentorId: updated.mentorId,
      menteeId: updated.menteeId,
      mentorName: updated.mentorName,
      menteeName: updated.menteeName,
      mentorEmail: updated.mentorEmail,
      menteeEmail: updated.menteeEmail,
      menteeRole: updated.menteeRole,
      menteeDepartment: updated.menteeDepartment,
      developmentNeed: updated.developmentNeed,
      goals: [],
      developmentAreas: [],
      successCriteria: []
    });

    matchRequests.setStatus(req.params.id, "approved", mentorship.id);

    return res.json({
      success: true,
      status: "approved",
      mentorshipId: mentorship.id,
      // Calisma sayfasi linki - kendi erisim token'iyla
      workspaceUrl:
        `${config.siteBaseUrl}/mentorship_workspace.html` +
        `?id=${mentorship.id}&token=${mentorship.accessToken}`
    });
  }

  // --- Bir taraf onayladi, digeri bekliyor ---
  res.json({
    success: true,
    status: "pending",
    mentorApproval: updated.mentorApproval,
    menteeApproval: updated.menteeApproval
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
  res.json(safe);
}));

/** AI ile hedef uret. Isimler AI'a GITMEZ (bkz. ai/devplan.js). */
router.post(
  "/public/workspace/:id/development-plan",
  requireWorkspaceToken,
  requireLicense,
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
  requireLicense,
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
