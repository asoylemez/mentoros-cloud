const express = require("express");

const tpl = require("../lib/emailTemplates");
const mailer = require("../mail/mailer");
const { requireApiKey, requireCompany, wrap } = require("./_helpers");

const router = express.Router();

/**
 * E-MAIL TEMPLATES (HR, signed-in organisation only) - V03.
 * Each organisation changes only its own texts; the company comes from
 * the session, never from the request.
 */

router.get("/email-templates", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  res.json({ templates: tpl.list(companyId), limits: tpl.LIMITS });
}));

function keyLang(req, res) {
  const { key, lang } = req.params;
  if (!tpl.has(key)) { res.status(404).json({ error: "Unknown e-mail template.", code: "unknown_template" }); return null; }
  if (!tpl.LANGS.includes(lang)) { res.status(400).json({ error: "Language must be tr or en.", code: "bad_lang" }); return null; }
  return { key, lang };
}

router.put("/email-templates/:key/:lang", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const k = keyLang(req, res);
  if (!k) return;
  const r = tpl.save(companyId, k.key, k.lang, req.body || {});
  if (r.error) return res.status(400).json(r);
  res.json({ success: true, template: r.template });
}));

/** Back to the default text. */
router.delete("/email-templates/:key/:lang", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const k = keyLang(req, res);
  if (!k) return;
  res.json({ success: true, template: tpl.reset(companyId, k.key, k.lang) });
}));

/** The e-mail as it would look, with sample names (text not saved). */
router.post("/email-templates/:key/:lang/preview", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const k = keyLang(req, res);
  if (!k) return;
  const c = tpl.check(k.key, req.body || {});
  if (c.error) return res.status(400).json(c);
  res.json(mailer.previewTemplate(companyId, k.key, k.lang, c.value));
}));

module.exports = router;
