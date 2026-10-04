const express = require("express");

const { companies, mentorships, mentors, mentees, menteeGroups, programs } = require("../db/repos");
const mailer = require("../mail/mailer");
const { announcements, attachments, storageReport, checkSelection, resolve, startSending, validEmail } = require("../lib/announcements");
const staffAuth = require("./staffAuth");
const { requireApiKey, requireCompany, ownRecord, wrap } = require("./_helpers");

const router = express.Router();

/**
 * ====================================================================
 * ANNOUNCEMENTS  (HR, signed-in organisation only) - stage 4a
 * ====================================================================
 * Rules and sending: lib/announcements.js. Every announcement id is
 * checked with ownRecord() (another organisation's answers 404) and every
 * id inside a recipient selection with checkSelection().
 */

// ---------------------------------------------------------------------
// The organisation's announcement settings (reply address)
// ---------------------------------------------------------------------

router.get("/announcement-settings", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const c = companies.get(companyId) || {};
  res.json({
    replyTo: c.replyTo || "", companyName: c.name || "", smtpConfigured: mailer.isConfigured(),
    attachments: {
      usedBytes: attachments.companyBytes(companyId),
      limits: attachments.LIMITS,
      types: Object.keys(attachments.TYPES)
    }
  });
}));

router.put("/announcement-settings", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const replyTo = String((req.body || {}).replyTo || "").trim();
  if (replyTo && !validEmail(replyTo)) {
    return res.status(400).json({ error: "The reply address is not a valid e-mail address.", code: "bad_reply_to" });
  }
  const c = companies.setReplyTo(companyId, replyTo);
  res.json({ success: true, replyTo: c.replyTo || "" });
}));

// ---------------------------------------------------------------------
// People to choose from
// ---------------------------------------------------------------------

/** Programmes, groups and active people, for the recipient picker. */
router.get("/announcements/people", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const person = m => ({ id: m.id, fullName: m.fullName, email: m.email, role: m.role || "" });
  res.json({
    programs: programs.listByCompany(companyId).map(p => ({ id: p.id, name: p.name, status: p.status })),
    groups: menteeGroups.listByCompany(companyId).map(g => ({ id: g.id, name: g.name, memberCount: g.members.length })),
    mentors: mentors.listByCompany(companyId).filter(m => m.status === "active").map(person),
    mentees: mentees.listByCompany(companyId).filter(m => m.status === "active").map(person)
  });
}));

/** Who a selection reaches (before saving or sending). */
router.post("/announcements/preview-recipients", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const c = checkSelection(companyId, (req.body || {}).selection);
  if (c.error) return res.status(c.code === "not_found" ? 404 : 400).json(c);
  const list = resolve(companyId, c.selection);
  res.json({ count: list.length, recipients: list.map(r => ({ type: r.type, name: r.name, email: r.email })) });
}));

// ---------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------

router.get("/announcements", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  res.json(announcements.listByCompany(companyId));
}));

router.get("/announcements/:id", requireApiKey, wrap(async (req, res) => {
  const a = ownRecord(req, res, announcements.get(req.params.id), "Announcement not found");
  if (!a) return;
  res.json({ ...a, recipients: announcements.recipients(a.id), attachments: attachments.list(a.id) });
}));

/** Saves a draft: { subject, body, selection, language } (new without an id). */
function saveDraft(req, res, existing) {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const body = req.body || {};
  const text = announcements.checkText(body.subject, body.body);
  if (text.error) return res.status(400).json(text);
  const sel = checkSelection(companyId, body.selection);
  if (sel.error) return res.status(sel.code === "not_found" ? 404 : 400).json(sel);
  const a = announcements.saveDraft(companyId, existing ? existing.id : null,
    { subject: text.subject, body: text.body, selection: sel.selection, language: body.language });
  res.json({ success: true, announcement: a });
}

router.post("/announcements", requireApiKey, wrap(async (req, res) => saveDraft(req, res, null)));

router.put("/announcements/:id", requireApiKey, wrap(async (req, res) => {
  const a = ownRecord(req, res, announcements.get(req.params.id), "Announcement not found");
  if (!a) return;
  if (a.status !== "draft") {
    return res.status(409).json({ error: "A sent announcement cannot be edited.", code: "not_draft" });
  }
  saveDraft(req, res, a);
}));

router.delete("/announcements/:id", requireApiKey, wrap(async (req, res) => {
  const a = ownRecord(req, res, announcements.get(req.params.id), "Announcement not found");
  if (!a) return;
  if (a.status === "sending") {
    return res.status(409).json({ error: "The announcement is being sent; delete it when sending has finished.", code: "sending" });
  }
  announcements.remove(a.id);
  res.json({ success: true });
}));

/**
 * Sends a saved draft. Returns at once (202); the e-mails go out in the
 * background - GET /announcements/:id shows the progress.
 */
router.post("/announcements/:id/send", requireApiKey, wrap(async (req, res) => {
  const a = ownRecord(req, res, announcements.get(req.params.id), "Announcement not found");
  if (!a) return;
  if (a.status !== "draft") {
    return res.status(409).json({ error: "This announcement has already been sent.", code: "not_draft" });
  }
  const text = announcements.checkText(a.subject, a.body, { forSending: true });
  if (text.error) return res.status(400).json(text);
  if (!mailer.isConfigured()) {
    return res.status(400).json({ error: "The e-mail server is not set up, so the announcement cannot be sent.", code: "smtp_not_configured" });
  }
  // The selection is checked again: people may have been deleted since.
  const sel = checkSelection(a.companyId, a.selection);
  if (sel.error) return res.status(400).json(sel);
  const list = resolve(a.companyId, sel.selection);
  if (!list.length) return res.status(400).json({ error: "The selection reaches nobody.", code: "no_recipients" });

  announcements.queue(a.id, list);
  startSending(a.id);
  res.status(202).json({ success: true, queued: list.length });
}));

/** Failed recipients again (same announcement, same text). */
router.post("/announcements/:id/resend-failed", requireApiKey, wrap(async (req, res) => {
  const a = ownRecord(req, res, announcements.get(req.params.id), "Announcement not found");
  if (!a) return;
  if (a.status === "draft") return res.status(409).json({ error: "This announcement has not been sent yet.", code: "draft" });
  if (!mailer.isConfigured()) {
    return res.status(400).json({ error: "The e-mail server is not set up.", code: "smtp_not_configured" });
  }
  const n = announcements.requeueFailed(a.id);
  if (n) startSending(a.id);
  res.status(202).json({ success: true, queued: n });
}));

// ---------------------------------------------------------------------
// Attachments (stage 4b) - raw upload, one file per request:
//   POST /announcements/:id/attachments?name=<file name>
//   body = the file's bytes (Content-Type: application/octet-stream)
// Raw bytes instead of base64-in-JSON: a third smaller, and the global
// 1 MB JSON limit does not apply.
// ---------------------------------------------------------------------

const rawFile = express.raw({ type: () => true, limit: attachments.LIMITS.bytesPerAnnouncement + 1024 });

router.post("/announcements/:id/attachments", requireApiKey, rawFile, wrap(async (req, res) => {
  const a = ownRecord(req, res, announcements.get(req.params.id), "Announcement not found");
  if (!a) return;
  if (a.status !== "draft") {
    return res.status(409).json({ error: "Files can only be added to a draft.", code: "not_draft" });
  }
  const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const r = attachments.add(a, req.query.name, data);
  if (r.error) return res.status(r.code === "disk_nearly_full" ? 507 : 400).json(r);
  res.json({ success: true, attachment: r.attachment, usedBytes: attachments.companyBytes(a.companyId) });
}));

router.delete("/announcements/:id/attachments/:attId", requireApiKey, wrap(async (req, res) => {
  const a = ownRecord(req, res, announcements.get(req.params.id), "Announcement not found");
  if (!a) return;
  if (a.status !== "draft") {
    return res.status(409).json({ error: "Files of a sent announcement cannot be removed.", code: "not_draft" });
  }
  if (!attachments.remove(a.id, req.params.attId)) return res.status(404).json({ error: "File not found", code: "not_found" });
  res.json({ success: true, usedBytes: attachments.companyBytes(a.companyId) });
}));

/** Sends a stored file as a download (never shown inline in the browser). */
function sendFile(res, f) {
  const ascii = f.filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  res.setHeader("Content-Type", f.mime || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.end(f.data);
}

router.get("/announcements/:id/attachments/:attId", requireApiKey, wrap(async (req, res) => {
  const a = ownRecord(req, res, announcements.get(req.params.id), "Announcement not found");
  if (!a) return;
  const f = attachments.get(a.id, req.params.attId);
  if (!f) return res.status(404).json({ error: "File not found", code: "not_found" });
  sendFile(res, f);
}));

/** Super admin: disk, database, backups and attachment space per organisation. */
router.get("/storage-report", staffAuth.requireSuperAdmin, wrap(async (req, res) => {
  res.json(storageReport());
}));

// ---------------------------------------------------------------------
// Workspace (token): announcements sent to everyone in it
// ---------------------------------------------------------------------

router.get("/public/workspace/:id/announcements", wrap(async (req, res) => {
  const ms = mentorships.get(req.params.id);
  if (!ms || !req.query.token || ms.accessToken !== String(req.query.token)) {
    return res.status(403).json({ error: "You do not have access to this workspace.", code: "invalid_token" });
  }
  res.json(announcements.forMentorship(ms).map(a => ({ ...a, attachments: attachments.list(a.id) })));
}));

/** A file of an announcement this workspace shows (and only such). */
router.get("/public/workspace/:id/announcements/:annId/attachments/:attId", wrap(async (req, res) => {
  const ms = mentorships.get(req.params.id);
  if (!ms || !req.query.token || ms.accessToken !== String(req.query.token)) {
    return res.status(403).json({ error: "You do not have access to this workspace.", code: "invalid_token" });
  }
  if (!announcements.forMentorship(ms).some(a => a.id === req.params.annId)) {
    return res.status(404).json({ error: "File not found", code: "not_found" });
  }
  const f = attachments.get(req.params.annId, req.params.attId);
  if (!f) return res.status(404).json({ error: "File not found", code: "not_found" });
  sendFile(res, f);
}));

module.exports = router;
