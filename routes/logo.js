const express = require("express");

const { companies } = require("../db/repos");
const { logos } = require("../lib/logo");
const staffAuth = require("./staffAuth");
const { requireApiKey, requireCompany, wrap } = require("./_helpers");

const router = express.Router();

/**
 * ====================================================================
 * COMPANY LOGO  (rules: lib/logo.js)
 * ====================================================================
 *   GET    /logo/:token              public image (random URL)
 *   GET    /my-company               the signed-in organisation: name + logo
 *   PUT    /company-logo             HR uploads its own logo (raw bytes)
 *   DELETE /company-logo             HR removes it
 *   PUT    /companies/:id/logo       super admin, for any organisation
 *   DELETE /companies/:id/logo       super admin
 */

const rawImage = express.raw({ type: () => true, limit: logos.MAX_BYTES + 1024 });

router.get("/logo/:token", (req, res) => {
  const img = logos.byToken(req.params.token);
  if (!img) return res.status(404).end();
  res.setHeader("Content-Type", img.mime);
  res.setHeader("X-Content-Type-Options", "nosniff");
  // The URL changes with every upload, so it can be cached for long.
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.end(img.data);
});

router.get("/my-company", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const c = companies.get(companyId) || {};
  res.json({ companyId, name: c.name || "", logo: logos.info(companyId), maxBytes: logos.MAX_BYTES });
}));

function saveLogo(res, companyId, body, by) {
  const r = logos.set(companyId, Buffer.isBuffer(body) ? body : Buffer.alloc(0), by);
  if (r.error) return res.status(400).json(r);
  res.json({ success: true, logo: r.logo });
}

router.put("/company-logo", requireApiKey, rawImage, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  saveLogo(res, companyId, req.body, "organisation");
}));

router.delete("/company-logo", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  logos.remove(companyId);
  res.json({ success: true });
}));

router.put("/companies/:id/logo", staffAuth.requireSuperAdmin, rawImage, wrap(async (req, res) => {
  if (!companies.get(req.params.id)) return res.status(404).json({ error: "Company not found" });
  saveLogo(res, req.params.id, req.body, "super admin");
}));

router.delete("/companies/:id/logo", staffAuth.requireSuperAdmin, wrap(async (req, res) => {
  if (!companies.get(req.params.id)) return res.status(404).json({ error: "Company not found" });
  logos.remove(req.params.id);
  res.json({ success: true });
}));

module.exports = router;
