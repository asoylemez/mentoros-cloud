const express = require("express");

const { programs } = require("../db/repos");
const reports = require("../lib/reports");
const { requireApiKey, requireCompany, ownRecord, wrap } = require("./_helpers");

const router = express.Router();

/**
 * REPORTS (HR, signed-in organisation only). The data and its rules:
 * lib/reports.js. Query: from, to, programId ("" | "none" | id), lang.
 */

function run(build) {
  return wrap(async (req, res) => {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    const pid = String(req.query.programId || "");
    if (pid && pid !== "none" && !ownRecord(req, res, programs.get(pid), "Programme not found")) return;
    res.setHeader("Cache-Control", "no-store");
    res.json(build(companyId, req.query));
  });
}

router.get("/reports/management", requireApiKey, run(reports.management));
router.get("/reports/surveys", requireApiKey, run(reports.surveyResults));

module.exports = router;
