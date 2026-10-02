const express = require("express");
const { mentors, mentees, companies } = require("../db/repos");
const { requireApiKey, requireCompany, ownRecord, wrap } = require("./_helpers");

const router = express.Router();

/** Firma yoksa FK hatasi verir; once anlamli bir mesaj don. */
function ensureCompany(req, res) {
  const companyId = requireCompany(req, res);
  if (!companyId) return null;

  if (!companies.exists(companyId)) {
    res.status(404).json({
      error: `"${companyId}" firmasi bulunamadi. Once firmayi olusturun.`
    });
    return null;
  }
  return companyId;
}

// --- MENTORLAR -------------------------------------------------------

router.get("/mentors", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  res.json(mentors.listByCompany(companyId));
}));

router.post("/mentors", requireApiKey, wrap(async (req, res) => {
  const companyId = ensureCompany(req, res);
  if (!companyId) return;

  if (!req.body.fullName) {
    return res.status(400).json({ error: "fullName is required" });
  }

  const mentor = mentors.create(companyId, req.body);

  res.json({
    message: "Mentor profile saved",
    id: mentor.id,
    mentor
  });
}));

router.get("/mentors/:id", requireApiKey, wrap(async (req, res) => {
  const mentor = ownRecord(req, res, mentors.get(req.params.id), "Mentor not found");
  if (!mentor) return;
  res.json(mentor);
}));

/**
 * Mentor profilini guncelle (IK duzenler).
 * Mentorun kendisi formu tekrar doldurmak zorunda kalmaz.
 */
router.patch("/mentors/:id", requireApiKey, wrap(async (req, res) => {
  if (!ownRecord(req, res, mentors.get(req.params.id), "Mentor not found")) return;

  const updated = mentors.update(req.params.id, req.body);

  if (!updated) {
    return res.status(404).json({ error: "Mentor not found" });
  }

  res.json({ success: true, message: "Mentor profile updated", mentor: updated });
}));

/**
 * Mentoru sil.
 *
 * GUVENLIK AGI: Mentorun devam eden bir mentorluk iliskisi varsa,
 * silmek o iliskiyi ve TUM TOPLANTI NOTLARINI da yok eder (foreign key
 * cascade). Bu yuzden once uyari doneriz; IK bilerek onaylarsa
 * ?force=true ile tekrar cagirir.
 */
router.delete("/mentors/:id", requireApiKey, wrap(async (req, res) => {
  const mentor = ownRecord(req, res, mentors.get(req.params.id), "Mentor not found");
  if (!mentor) return;

  const activeCount = mentors.activeMentorshipCount(req.params.id);
  const force = req.query.force === "true";

  if (activeCount > 0 && !force) {
    return res.status(409).json({
      error: "This mentor has an active mentorship.",
      code: "has_active_mentorships",
      activeMentorships: activeCount,
      warning:
        `Silerseniz ${activeCount} adet calisma alani ve icindeki tum ` +
        `toplanti notlari da silinir. Bunun yerine mentoru "pasif" ` +
        `yapmayi dusunun.`
    });
  }

  mentors.remove(req.params.id);

  res.json({
    success: true,
    message: "Mentor deleted",
    deletedMentorships: activeCount
  });
}));

// --- MENTEE'LER ------------------------------------------------------

router.get("/mentees", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  res.json(mentees.listByCompany(companyId));
}));

router.post("/mentees", requireApiKey, wrap(async (req, res) => {
  const companyId = ensureCompany(req, res);
  if (!companyId) return;

  const mentee = mentees.create(companyId, req.body);

  res.json({
    message: "Mentee saved",
    id: mentee.id,
    mentee
  });
}));

router.get("/mentees/:id", requireApiKey, wrap(async (req, res) => {
  const mentee = ownRecord(req, res, mentees.get(req.params.id), "Mentee not found");
  if (!mentee) return;
  res.json(mentee);
}));

/** Mentee profilini guncelle (IK duzenler). */
router.patch("/mentees/:id", requireApiKey, wrap(async (req, res) => {
  if (!ownRecord(req, res, mentees.get(req.params.id), "Mentee not found")) return;

  const updated = mentees.update(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: "Mentee not found" });
  res.json({ success: true, message: "Mentee profile updated", mentee: updated });
}));

/** Mentee'yi sil. */
router.delete("/mentees/:id", requireApiKey, wrap(async (req, res) => {
  const mentee = ownRecord(req, res, mentees.get(req.params.id), "Mentee not found");
  if (!mentee) return;
  mentees.remove(req.params.id);
  res.json({ success: true, message: "Mentee deleted" });
}));

module.exports = router;
