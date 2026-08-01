const express = require("express");

const config = require("../config");
const { mentors, mentorships, meetings, surveys } = require("../db/repos");
const mailer = require("../mail/mailer");
const { getSurvey, flatQuestions } = require("../lib/surveyQuestions");
const { requireApiKey, requireCompany, wrap } = require("./_helpers");

const router = express.Router();

/**
 * ====================================================================
 * KAPANIS ANKETLERI
 * ====================================================================
 *
 * AKIS
 *   1. IK panosundan "Mentore anket gonder" / "Mentee'ye anket gonder"
 *   2. Kisiye ozel token uretilir, e-posta ile link gider
 *   3. Kisi linke tiklar, giris yapmadan anketi doldurur
 *   4. IK "Cevaplari goster" ile ikisinin cevabini birlikte gorur
 *
 * GIZLILIK
 *   Cevaplari YALNIZCA IK gorur. Anket ucu (token ile acilan) kendi
 *   anketinden baskasini DONDURMEZ - mentor, mentee'nin cevabini
 *   goremez. Bu, anket sayfasinda kullaniciya verilen sozun teknik
 *   karsiligidir.
 *
 * YAPAY ZEKA
 *   Anketin hicbir asamasinda AI cagrisi yoktur. Cevaplar veritabanina
 *   yazilir, e-posta SMTP ile gider.
 */

function surveyUrl(token) {
  return `${config.siteBaseUrl}/survey.html?token=${token}`;
}

/** Cevaplarin yaninda gosterilecek sistem verisi (ankette SORULMAZ). */
function mentorshipStats(mentorshipId) {
  const list = meetings.listByMentorship(mentorshipId);

  let totalActions = 0;
  let doneActions = 0;

  for (const meeting of list) {
    const items = Array.isArray(meeting.actionItems) ? meeting.actionItems : [];
    totalActions += items.length;
    doneActions += items.filter(a => a && a.status === "done").length;
  }

  return {
    meetingCount: list.length,
    // meetings.listByMentorship ARTAN tarih sirasiyla doner:
    // ilk kayit en eski gorusme, son kayit en yenisi.
    firstMeeting: list.length ? list[0].meetingDate : null,
    lastMeeting: list.length ? list[list.length - 1].meetingDate : null,
    totalActions,
    doneActions
  };
}

// =====================================================================
// IK: ANKET GONDER
// =====================================================================

router.post("/mentorships/:id/survey", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const role = req.body.role === "mentor" ? "mentor" : "mentee";
  const lang = req.body.language === "en" ? "en" : "tr";

  const ms = mentorships.get(req.params.id);
  if (!ms) {
    return res.status(404).json({ error: "Mentorship not found" });
  }

  // Alici bilgisi iliskiden gelir. Mentor e-postasi iliskide bos ise
  // mentor kaydindan tamamlanir.
  const recipient = role === "mentor"
    ? {
        name: ms.mentorName || "",
        email: ms.mentorEmail || (mentors.get(ms.mentorId) || {}).email || "",
        other: ms.menteeName || ""
      }
    : {
        name: ms.menteeName || "",
        email: ms.menteeEmail || "",
        other: ms.mentorName || ""
      };

  if (!recipient.email) {
    return res.status(400).json({
      error: role === "mentor"
        ? "No email address on file for the mentor."
        : "No email address on file for the mentee.",
      code: "no_email"
    });
  }

  // Zaten CEVAPLANMISSA yeniden gonderme. Ikinci bir link, ilk cevabin
  // uzerine yazilmasi riskini dogurur; IK'ya durumu acikca soyleriz.
  const done = surveys.listByMentorship(ms.id)
    .find(s => s.role === role && s.status === "completed");

  if (done) {
    return res.status(409).json({
      error: role === "mentor"
        ? "The mentor has already completed the survey."
        : "The mentee has already completed the survey.",
      code: "already_completed",
      completedAt: done.completedAt
    });
  }

  const { survey, reused } = surveys.create(companyId, {
    mentorshipId: ms.id,
    role,
    recipientName: recipient.name,
    recipientEmail: recipient.email,
    language: lang
  });

  try {
    await mailer.sendSurvey({
      to: recipient.email,
      otherName: recipient.other,
      survey,
      mentorship: ms,
      url: surveyUrl(survey.token),
      lang
    });
  } catch (error) {
    // Anket kaydi DURUR - IK linki elle de paylasabilsin diye geri doner.
    return res.status(502).json({
      error: error.message,
      code: error.code || "send_failed",
      surveyUrl: surveyUrl(survey.token)
    });
  }

  res.json({
    success: true,
    role,
    reused,                       // mevcut bekleyen anket yeniden gonderildi mi
    sentTo: recipient.email,
    surveyUrl: surveyUrl(survey.token)
  });
}));

// =====================================================================
// IK: CEVAPLARI GOSTER
// =====================================================================

router.get("/mentorships/:id/surveys", requireApiKey, wrap(async (req, res) => {
  const lang = req.query.language === "en" ? "en" : "tr";

  const ms = mentorships.get(req.params.id);
  if (!ms) {
    return res.status(404).json({ error: "Mentorship not found" });
  }

  const list = surveys.listByMentorship(ms.id);

  // Her rol icin TEK kayit gosterilir: cevaplanmis varsa o, yoksa
  // bekleyen. IK'nin ilgilendigi sey "bu kisi doldurdu mu".
  function pick(role) {
    const all = list.filter(s => s.role === role);
    const done = all.find(s => s.status === "completed");
    const chosen = done || all[0];

    if (!chosen) return { role, state: "not_sent" };

    return {
      role,
      state: chosen.status,                 // pending | completed
      recipientName: chosen.recipientName,
      recipientEmail: chosen.recipientEmail,
      sentAt: chosen.sentAt,
      completedAt: chosen.completedAt,
      surveyUrl: surveyUrl(chosen.token),
      // Sorularin metni ANKETIN kendi dilinde doner; cevap o dilde
      // verildi. IK arayuzu farkli dilde olsa bile soru-cevap eslesmesi
      // bozulmasin diye boyle.
      definition: chosen.status === "completed"
        ? getSurvey(role, chosen.language)
        : null,
      answers: chosen.answers || null
    };
  }

  res.json({
    mentorshipId: ms.id,
    mentorName: ms.mentorName || "",
    menteeName: ms.menteeName || "",
    stats: mentorshipStats(ms.id),
    mentor: pick("mentor"),
    mentee: pick("mentee"),
    language: lang
  });
}));

// =====================================================================
// KATILIMCI: ANKETI GETIR  (token ile, giris yok)
// =====================================================================

router.get("/public/survey/:token", wrap(async (req, res) => {
  const survey = surveys.getByToken(req.params.token);

  if (!survey) {
    return res.status(404).json({ error: "Survey not found", code: "invalid_token" });
  }

  const ms = mentorships.get(survey.mentorshipId) || {};

  // Karsi tarafin ADI gosterilir (kim ile calistigini hatirlatmak icin),
  // ama karsi tarafin CEVAPLARI asla donmez.
  const otherName = survey.role === "mentor"
    ? (ms.menteeName || "")
    : (ms.mentorName || "");

  res.json({
    role: survey.role,
    status: survey.status,
    recipientName: survey.recipientName,
    otherName,
    language: survey.language,
    definition: getSurvey(survey.role, survey.language),
    answers: survey.status === "completed" ? survey.answers : null
  });
}));

// =====================================================================
// KATILIMCI: ANKETI GONDER
// =====================================================================

router.post("/public/survey/:token", wrap(async (req, res) => {
  const survey = surveys.getByToken(req.params.token);

  if (!survey) {
    return res.status(404).json({ error: "Survey not found", code: "invalid_token" });
  }

  if (survey.status === "completed") {
    return res.status(409).json({
      error: "This survey has already been submitted.",
      code: "already_completed"
    });
  }

  const incoming = req.body && typeof req.body.answers === "object"
    ? req.body.answers
    : null;

  if (!incoming) {
    return res.status(400).json({ error: "answers is required" });
  }

  // SADECE tanimli sorularin cevaplari saklanir. Istemciden gelen
  // fazladan alanlar sessizce atilir - anket kaydi soru setiyle
  // uyumlu kalsin.
  const allowed = new Set(flatQuestions(survey.role, survey.language).map(q => q.id));
  const clean = {};

  for (const [key, value] of Object.entries(incoming)) {
    if (!allowed.has(key)) continue;
    if (value === null || value === undefined || value === "") continue;
    clean[key] = typeof value === "string" ? value.trim().slice(0, 4000) : value;
  }

  const result = surveys.submit(req.params.token, clean);

  if (!result.ok) {
    return res.status(409).json({ error: "Could not submit", code: result.reason });
  }

  res.json({ success: true });
}));

module.exports = router;
