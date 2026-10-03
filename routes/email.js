const express = require("express");

const config = require("../config");
const { companies, mentors, mentorships } = require("../db/repos");
const mailer = require("../mail/mailer");
const { requireApiKey, requireCompany, ownRecord, wrap } = require("./_helpers");

const router = express.Router();

/**
 * ====================================================================
 * E-POSTA GONDERIMI (IK)
 * ====================================================================
 *
 * Linkleri elle kopyalayip yapistirmak yerine dogrudan gonderir.
 *
 * NOT: Bu e-postalar firmanin KENDI SMTP sunucusundan gider.
 * Icerik hicbir ucuncu tarafa (yapay zeka dahil) ulasmaz.
 */

/** IK'nin gordugu mesajlar iki dilli olmali - firma Ingilizce calisiyor olabilir. */
const M = {
  noMentorEmail: {
    tr: "Mentorun e-posta adresi kayitli degil.",
    en: "No email address on file for the mentor."
  },
  noManagerEmail: {
    tr: "Yoneticinin e-posta adresi girilmemis.",
    en: "No email address was entered for the manager."
  },
  noMenteeEmail: {
    tr: "Mentee'nin e-posta adresi girilmemis.",
    en: "No email address was entered for the mentee."
  },
  noEmailOnFile: {
    tr: "E-posta adresi kayitli degil.",
    en: "No email address on file."
  },
  needEmail: {
    tr: "En az bir e-posta adresi gerekli.",
    en: "At least one email address is required."
  },
  companyNotFound: { tr: "Company not found", en: "Company not found" },
  mentorshipNotFound: { tr: "Mentorship not found", en: "Mentorship not found" },
  invitesSent: {
    tr: n => `${n} davet gonderildi.`,
    en: n => `${n} invitation${n === 1 ? "" : "s"} sent.`
  },
  partial: {
    tr: (ok, bad) => `${ok} gonderildi, ${bad} basarisiz.`,
    en: (ok, bad) => `${ok} sent, ${bad} failed.`
  },
  workspaceSent: {
    tr: list => `Calisma alani baglantisi gonderildi: ${list}`,
    en: list => `Workspace link sent to: ${list}`
  },
  noneSent: {
    tr: "Hicbir e-posta gonderilemedi.",
    en: "No emails could be sent."
  }
};

const m = (key, lang, ...args) => {
  const v = M[key][lang === "tr" ? "tr" : "en"];
  return typeof v === "function" ? v(...args) : v;
};

/** Ortak hata cevabi - IT'nin anlayacagi teshisle. */
function fail(res, error) {
  const d = error.diagnosis || mailer.diagnose(error);

  return res.status(error.code === "SMTP_NOT_CONFIGURED" ? 503 : 502).json({
    error: d.title,
    detail: d.detail,
    action: d.action,
    code: error.code || "send_failed"
  });
}

// =====================================================================
// 1. MENTOR DAVETI
// =====================================================================

router.post("/email/invite", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const { emails, lang = "tr", form } = req.body;

  const list = (Array.isArray(emails) ? emails : String(emails || "").split(/[,;\s]+/))
    .map(e => e.trim())
    .filter(Boolean);

  if (!list.length) {
    return res.status(400).json({ error: m("needEmail", lang) });
  }

  const company = companies.get(companyId);
  if (!company) {
    return res.status(404).json({ error: m("companyNotFound", lang) });
  }

  const token = companies.getInviteToken(companyId);
  const page = form === "mentee" ? "mentee_register.html" : "register.html";
  const url = `${config.siteBaseUrl}/${page}?invite=${token}`;

  const sent = [];
  const failed = [];

  for (const to of list) {
    try {
      await mailer.sendInvite({
        to,
        companyName: company.name,
        companyId,
        url,
        lang,
        form
      });
      sent.push(to);

    } catch (error) {
      // Ilk hata SMTP yapilandirmasiyla ilgiliyse devam etmenin anlami yok.
      if (error.code === "SMTP_NOT_CONFIGURED") return fail(res, error);

      failed.push({ email: to, reason: error.message });
    }
  }

  res.json({
    success: sent.length > 0,
    sent,
    failed,
    message: failed.length
      ? m("partial", lang, sent.length, failed.length)
      : m("invitesSent", lang, sent.length)
  });
}));

// =====================================================================
// 3. CALISMA ALANI LINKI
// =====================================================================

router.post("/email/workspace/:id", requireApiKey, wrap(async (req, res) => {
  const { target = "both", lang = "tr" } = req.body;

  const ms = ownRecord(req, res, mentorships.get(req.params.id), m("mentorshipNotFound", lang));
  if (!ms) return;

  const url = `${config.siteBaseUrl}/mentorship_workspace.html` +
              `?id=${ms.id}&token=${ms.accessToken}`;

  const targets = [];

  if (target === "mentor" || target === "both") {
    const email = ms.mentorEmail || mentors.get(ms.mentorId)?.email || "";
    targets.push({ type: "mentor", email, name: ms.mentorName, other: ms.menteeName });
  }

  if (target === "mentee" || target === "both") {
    if (ms.groupId) {
      // Group mentorship: every member gets their own copy.
      for (const member of ms.members) {
        targets.push({ type: "mentee", email: member.email || "", name: member.fullName, other: ms.mentorName });
      }
    } else {
      targets.push({ type: "mentee", email: ms.menteeEmail || "", name: ms.menteeName, other: ms.mentorName });
    }
  }

  const sent = [];
  const failed = [];

  for (const t of targets) {
    if (!t.email) {
      failed.push({ type: t.type, name: t.name, reason: m("noEmailOnFile", lang) });
      continue;
    }

    try {
      await mailer.sendWorkspace({
        to: t.email,
        role: t.type,
        name: t.name,
        otherName: t.other,
        mentorship: ms,
        url,
        lang
      });
      sent.push({ type: t.type, email: t.email });

    } catch (error) {
      if (error.code === "SMTP_NOT_CONFIGURED") return fail(res, error);
      failed.push({ type: t.type, email: t.email, reason: error.message });
    }
  }

  res.json({
    success: sent.length > 0,
    sent,
    failed,
    message: sent.length
      ? m("workspaceSent", lang, sent.map(s => s.email).join(", "))
      : m("noneSent", lang)
  });
}));

// =====================================================================
// 4. GONDERIM GECMISI
// =====================================================================

router.get("/email/history/:refId", requireApiKey, wrap(async (req, res) => {
  // Only the signed-in company's own log rows (email_log.company_id).
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  res.json(mailer.history(req.params.refId, companyId));
}));

// SMTP kurulu mu? (Frontend butonlari buna gore gosterir.)
router.get("/email/status", requireApiKey, wrap(async (req, res) => {
  res.json({ configured: mailer.isConfigured() });
}));

module.exports = router;
