const express = require("express");

const formConfig = require("../lib/formConfig");
const { requireApiKey, requireCompany, wrap } = require("./_helpers");

const router = express.Router();

/**
 * REGISTRATION FORM SETTINGS (HR, signed-in organisation only) - 5a.
 * What may change: public/assets/formSchema.js. Locked fields and
 * unknown keys are dropped by sanitize(), so the server enforces it.
 */

router.get("/registration-forms", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  res.json({ config: formConfig.get(companyId), isDefault: formConfig.isDefault(companyId),
             limits: formConfig.schema.LIMITS });
}));

router.put("/registration-forms", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const config = formConfig.save(companyId, (req.body || {}).config);
  res.json({ success: true, config, isDefault: false });
}));

/** Back to the forms as they ship. */
router.delete("/registration-forms", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  res.json({ success: true, config: formConfig.reset(companyId), isDefault: true });
}));

module.exports = router;
