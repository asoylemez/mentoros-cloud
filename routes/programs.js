const express = require("express");

const { programs, mentors, mentees } = require("../db/repos");
const { requireApiKey, requireCompany, ownRecord, wrap } = require("./_helpers");

const router = express.Router();

/**
 * ====================================================================
 * MENTORING PROGRAMMES  (HR, signed-in organisation only)
 * ====================================================================
 *
 * An organisation can run several programmes, each with a start and an
 * end date. HR places mentors (one or more programmes each) and mentees
 * (one programme each) into programmes from the registries.
 *
 * Every programme id that arrives - in the URL or in a body - is checked
 * with ownRecord(): another organisation's programme answers 404, the
 * same as a missing one.
 */

router.get("/programs", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  res.json(programs.listByCompany(companyId));
}));

router.post("/programs", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  const v = programs.validate(companyId, req.body || {});
  if (v.error) return res.status(400).json({ error: v.error, code: v.code });

  res.json({ success: true, program: programs.create(companyId, v.value) });
}));

/** Edit fields and / or archive: { name, description, startDate, endDate, archived } */
router.patch("/programs/:id", requireApiKey, wrap(async (req, res) => {
  const program = ownRecord(req, res, programs.get(req.params.id), "Programme not found");
  if (!program) return;
  const body = req.body || {};

  const editsFields = ["name", "description", "startDate", "endDate"].some(k => body[k] !== undefined);
  let updated = program;

  if (editsFields) {
    const v = programs.validate(program.companyId, body, program);
    if (v.error) return res.status(400).json({ error: v.error, code: v.code });
    updated = programs.update(program.id, v.value);
  }
  if (body.archived !== undefined) {
    updated = programs.setArchived(program.id, !!body.archived);
  }

  res.json({ success: true, program: updated });
}));

/**
 * Only an EMPTY programme can be deleted. Once a match request or a
 * mentorship has been made in it, it can only be archived - those
 * records keep pointing at it.
 */
router.delete("/programs/:id", requireApiKey, wrap(async (req, res) => {
  const program = ownRecord(req, res, programs.get(req.params.id), "Programme not found");
  if (!program) return;

  const usage = programs.usage(program.id);
  if (usage.matchRequests || usage.mentorships) {
    return res.status(409).json({
      error: "This programme already has match requests or mentorships. Archive it instead.",
      code: "program_in_use",
      ...usage
    });
  }

  programs.remove(program.id);
  res.json({ success: true, message: "Programme deleted" });
}));

// =====================================================================
// PLACING PEOPLE INTO PROGRAMMES
// =====================================================================

/**
 * Checks a list of programme ids sent by the browser.
 * Each must be the organisation's own. A programme can be NEWLY added
 * only while it is not archived; one the person is already in may stay.
 * Returns the cleaned list, or null after writing the error response.
 */
function checkProgramIds(req, res, ids, alreadyIn = []) {
  if (!Array.isArray(ids) || ids.some(x => typeof x !== "string")) {
    res.status(400).json({ error: "programIds must be a list of programme ids.", code: "bad_program_ids" });
    return null;
  }
  const unique = [...new Set(ids.filter(Boolean))];
  for (const id of unique) {
    const program = ownRecord(req, res, programs.get(id), "Programme not found");
    if (!program) return null;
    if (program.archived && !alreadyIn.includes(id)) {
      res.status(400).json({ error: "An archived programme cannot be assigned.", code: "program_archived" });
      return null;
    }
  }
  return unique;
}

/** A mentor's programmes, replaced as a whole: { programIds: [...] } (?force=true after a warning) */
router.put("/mentors/:id/programs", requireApiKey, wrap(async (req, res) => {
  const mentor = ownRecord(req, res, mentors.get(req.params.id), "Mentor not found");
  if (!mentor) return;

  const ids = checkProgramIds(req, res, (req.body || {}).programIds, mentor.programIds);
  if (!ids) return;

  // Taking a mentor out of a programme where they have ACTIVE mentorships
  // asks first (409, then ?force=true). The mentorships are not touched:
  // they stay in their programme and keep running.
  if (req.query.force !== "true") {
    const removed = (mentor.programIds || []).filter(id => !ids.includes(id));
    const busy = removed
      .map(id => ({ program: programs.get(id), count: programs.activeMentorshipsOfMentor(mentor.id, id) }))
      .filter(x => x.program && x.count > 0);
    if (busy.length) {
      return res.status(409).json({
        error: "This mentor has active mentorships in a programme being removed. They keep running in that programme.",
        code: "mentor_has_mentorships_in_program",
        programs: busy.map(x => ({ id: x.program.id, name: x.program.name, activeMentorships: x.count }))
      });
    }
  }

  const updated = programs.setMentorPrograms(mentor.companyId, mentor.id, ids);
  res.json({ success: true, mentor: updated });
}));

/**
 * A mentee's programme: { programId } ('' = not assigned).
 *
 * A mentee with an active mentorship or a pending request gets a 409
 * warning first; HR repeats with ?force=true. The existing mentorship
 * is not touched - it stays in the programme it was made in.
 */
router.put("/mentees/:id/program", requireApiKey, wrap(async (req, res) => {
  const mentee = ownRecord(req, res, mentees.get(req.params.id), "Mentee not found");
  if (!mentee) return;

  const raw = (req.body || {}).programId;
  if (raw !== undefined && raw !== null && typeof raw !== "string") {
    return res.status(400).json({ error: "programId must be a programme id or empty.", code: "bad_program_id" });
  }
  const programId = raw || "";

  if (programId) {
    const ok = checkProgramIds(req, res, [programId], mentee.programId ? [mentee.programId] : []);
    if (!ok) return;
  }

  if (programId !== (mentee.programId || "") && req.query.force !== "true") {
    const engagement = mentees.engagement(mentee.companyId, mentee.id);
    if (engagement.engaged) {
      return res.status(409).json({
        error: engagement.state === "matched"
          ? "This mentee has an active mentorship. It will stay in the programme it was made in."
          : "This mentee has a pending match request. It will stay in the programme it was made in.",
        code: "mentee_engaged",
        state: engagement.state
      });
    }
  }

  res.json({ success: true, mentee: programs.setMenteeProgram(mentee.id, programId) });
}));

module.exports = router;
