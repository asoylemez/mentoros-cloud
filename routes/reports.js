const express = require("express");

const { programs } = require("../db/repos");
const reports = require("../lib/reports");
const { requireApiKey, requireCompany, ownRecord, refuseIfAiOff, wrap } = require("./_helpers");
const aiSummary = require("../lib/aiSummary");
const { companies } = require("../db/repos");

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
router.get("/reports/events", requireApiKey, run(reports.eventsReport));

/** People for the person report picker (person number, name, roles). */
router.get("/reports/people", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  res.setHeader("Cache-Control", "no-store");
  res.json(reports.personList(companyId));
}));

/** One person's report: ?sicil=0001 (+ from, to, lang). 404 if no such person here. */
router.get("/reports/person", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  res.setHeader("Cache-Control", "no-store");
  const report = reports.personReport(companyId, req.query);
  if (!report) return res.status(404).json({ error: "No person with this person number.", code: "person_not_found" });
  res.json(report);
}));

// ---------------------------------------------------------------------
// AI EXECUTIVE SUMMARY (V06) - lib/aiSummary.js
// ---------------------------------------------------------------------

function programOk(req, res, pid) {
  pid = String(pid || "");
  return !pid || pid === "none" || !!ownRecord(req, res, programs.get(pid), "Programme not found");
}

/** The organisation's last summary (no AI call) and whether AI is on. */
router.get("/reports/ai-summary", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  res.setHeader("Cache-Control", "no-store");
  res.json({ aiEnabled: companies.aiEnabled(companyId), last: aiSummary.last(companyId) });
}));

/** Exactly what would go to the AI for these filters (nothing personal). */
router.get("/reports/ai-summary/input", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  if (!programOk(req, res, req.query.programId)) return;
  res.setHeader("Cache-Control", "no-store");
  const input = aiSummary.buildInput(companyId, req.query);
  res.json({ ...input, text: aiSummary.toText(companyId, input) });
}));

/** Generate a new summary: { from, to, programId, lang }. Replaces the last one. */
router.post("/reports/ai-summary", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  if (refuseIfAiOff(res, companyId)) return;
  const body = req.body || {};
  if (!programOk(req, res, body.programId)) return;
  try {
    res.json({ success: true, summary: await aiSummary.generate(companyId, body) });
  } catch (error) {
    if (error.code === "summary_running") return res.status(409).json({ error: error.message, code: error.code });
    throw error;
  }
}));

module.exports = router;
