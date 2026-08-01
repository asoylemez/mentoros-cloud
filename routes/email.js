const express = require("express");

const config = require("../config");
const { companies, mentors, matchRequests, mentorships } = require("../db/repos");
const mailer = require("../mail/mailer");
const { requireApiKey, requireCompany, wrap } = require("./_helpers");

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
  requestNotFound: { tr: "Request not found", en: "Request not found" },
  mentorshipNotFound: { tr: "Mentorship not found", en: "Mentorship not found" },
  invitesSent: {
    tr: n => `${n} davet gonderildi.`,
    en: n => `${n} invitation${n === 1 ? "" : "s"} sent.`
  },
  partial: {
    tr: (ok, bad) => `${ok} gonderildi, ${bad} basarisiz.`,
    en: (ok, bad) => `${ok} sent, ${bad} failed.`
  },
  approvalSent: {
    tr: list => `Onay baglantisi gonderildi: ${list}`,
    en: list => `Approval link sent to: ${list}`
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
// 2. ONAY LINKLERI
// =====================================================================

router.post("/email/approval/:id", requireApiKey, wrap(async (req, res) => {
  const { target = "both", lang = "tr" } = req.body;

  const request = matchRequests.get(req.params.id);
  if (!request) {
    return res.status(404).json({ error: m("requestNotFound", lang) });
  }

  const base = config.siteBaseUrl;
  const c = encodeURIComponent(request.companyId);

  const link = (type, token) =>
    `${base}/match_approval.html?id=${request.id}&type=${type}&token=${token}&company=${c}`;

  const targets = [];

  // --- Yonetici ---
  if (target === "manager") {
    if (request.managerApproval === "not_required") {
      return res.status(400).json({
        error: lang === "tr"
          ? "Bu talep icin yonetici bilgisi girilmemis."
          : "No manager was entered for this request."
      });
    }

    targets.push({
      type: "manager",
      email: request.managerEmail || "",
      url: link("manager", request.managerToken)
    });
  }

  /**
   * YONETICI KAPISI
   *
   * Yonetici henuz onaylamadiysa mentor ve mentee'ye e-posta GONDERILMEZ.
   * Sebep: yonetici reddederse mentorun ve mentee'nin zamani bosa
   * harcanmis, beklenti bosuna yaratilmis olur.
   */
  const gateBlocked =
    (target === "mentor" || target === "mentee" || target === "both") &&
    !matchRequests.managerGateOpen(request);

  if (gateBlocked) {
    return res.status(409).json({
      error: lang === "tr"
        ? "Once yoneticinin onayi gerekiyor."
        : "The manager must approve first.",
      detail: lang === "tr"
        ? `Bu eslesme icin once ${request.managerName || "mentee'nin yoneticisi"} ` +
          `onay vermeli. Onaylandiktan sonra mentor ve mentee'ye baglanti gonderebilirsiniz.`
        : `${request.managerName || "The mentee's manager"} must approve this match ` +
          `first. After that you can send the links to the mentor and the mentee.`,
      code: "manager_pending"
    });
  }

  if (target === "mentor" || target === "both") {
    // Mentor e-postasi talepte yoksa mentor kaydindan al.
    const email = request.mentorEmail ||
                  mentors.get(request.mentorId)?.email || "";

    targets.push({ type: "mentor", email, url: link("mentor", request.mentorToken) });
  }

  if (target === "mentee" || target === "both") {
    targets.push({
      type: "mentee",
      email: request.menteeEmail || "",
      url: link("mentee", request.menteeToken)
    });
  }

  const sent = [];
  const failed = [];

  for (const t of targets) {
    if (!t.email) {
      failed.push({
        type: t.type,
        reason: {
          mentor: m("noMentorEmail", lang),
          mentee: m("noMenteeEmail", lang),
          manager: m("noManagerEmail", lang)
        }[t.type]
      });
      continue;
    }

    try {
      await mailer.sendApproval({
        to: t.email,
        type: t.type,
        request,
        url: t.url,
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
      ? m("approvalSent", lang, sent.map(s => s.email).join(", "))
      : m("noneSent", lang)
  });
}));

// =====================================================================
// 3. CALISMA ALANI LINKI
// =====================================================================

router.post("/email/workspace/:id", requireApiKey, wrap(async (req, res) => {
  const { target = "both", lang = "tr" } = req.body;

  const ms = mentorships.get(req.params.id);
  if (!ms) {
    return res.status(404).json({ error: m("mentorshipNotFound", lang) });
  }

  const url = `${config.siteBaseUrl}/mentorship_workspace.html` +
              `?id=${ms.id}&token=${ms.accessToken}`;

  const targets = [];

  if (target === "mentor" || target === "both") {
    const email = ms.mentorEmail || mentors.get(ms.mentorId)?.email || "";
    targets.push({ type: "mentor", email, other: ms.menteeName });
  }

  if (target === "mentee" || target === "both") {
    targets.push({ type: "mentee", email: ms.menteeEmail || "", other: ms.mentorName });
  }

  const sent = [];
  const failed = [];

  for (const t of targets) {
    if (!t.email) {
      failed.push({ type: t.type, reason: m("noEmailOnFile", lang) });
      continue;
    }

    try {
      await mailer.sendWorkspace({
        to: t.email,
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
  res.json(mailer.history(req.params.refId));
}));

// SMTP kurulu mu? (Frontend butonlari buna gore gosterir.)
router.get("/email/status", requireApiKey, wrap(async (req, res) => {
  res.json({ configured: mailer.isConfigured() });
}));

module.exports = router;
