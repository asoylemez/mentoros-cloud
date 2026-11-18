const express = require("express");

const peopleImport = require("../lib/peopleImport");
const { requireApiKey, requireCompany, wrap } = require("./_helpers");

const router = express.Router();

/**
 * PEOPLE IMPORT (V11) - Admin -> Import people. Signed-in organisation only;
 * the organisation comes from the session, never from the request.
 *
 *   GET  /people-import/template?lang=tr|en   the Excel template
 *   POST /people-import/preview               the file (raw body) -> what would happen; writes nothing
 *   POST /people-import/commit                the same file -> saved in one transaction
 *   GET  /people-import/history               the latest uploads
 *
 * Options go in the query string (the body is the file):
 *   existing = skip | fill, programId, attest = 1 (commit), name = file name
 */
const rawFile = express.raw({ type: () => true, limit: peopleImport.LIMITS.fileBytes + 1024 });

function fail(res, e) {
  if (e instanceof peopleImport.ImportError) {
    return res.status(400).json({ error: e.en, errorTr: e.tr, code: e.code });
  }
  throw e;
}

const optsOf = req => ({
  existing: req.query.existing === "fill" ? "fill" : "skip",
  programId: String(req.query.programId || "").slice(0, 64),
  fileName: String(req.query.name || "").slice(0, 200)
});

router.get("/people-import/template", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const lang = req.query.lang === "en" ? "en" : "tr";
  const file = peopleImport.template(companyId, lang);
  const name = lang === "en" ? "MentorOS_people_import_template.xlsx" : "MentorOS_kisi_aktarma_sablonu.xlsx";
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(file);
}));

router.post("/people-import/preview", requireApiKey, rawFile, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  try {
    res.json(peopleImport.analyze(companyId, Buffer.isBuffer(req.body) ? req.body : null, optsOf(req)));
  } catch (e) { fail(res, e); }
}));

router.post("/people-import/commit", requireApiKey, rawFile, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  try {
    const result = peopleImport.commit(companyId, Buffer.isBuffer(req.body) ? req.body : null,
      { ...optsOf(req), kvkkAttested: req.query.attest === "1" });
    res.json({ success: true, result });
  } catch (e) { fail(res, e); }
}));

router.get("/people-import/history", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  res.json(peopleImport.history(companyId));
}));

module.exports = router;
