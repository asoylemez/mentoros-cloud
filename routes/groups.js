const express = require("express");

const { menteeGroups, mentees, programs } = require("../db/repos");
const { requireApiKey, requireCompany, ownRecord, wrap } = require("./_helpers");

const router = express.Router();

/**
 * ====================================================================
 * MENTEE GROUPS  (HR, signed-in organisation only) - stage 3a
 * ====================================================================
 *
 * HR builds groups of mentees in the Mentee Registry. A group is later
 * matched with one mentor (stage 3b). The rules live in
 * db/repos.js -> menteeGroups; every id that arrives is checked with
 * ownRecord() (another organisation's record answers 404).
 */

router.get("/mentee-groups", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  res.json(menteeGroups.listByCompany(companyId));
}));

/**
 * Mentees HR can pick for a group (?programId= with programmes), each
 * with what would stop them joining: in another group, or matched /
 * pending individually. Busy mentees are listed, not hidden.
 */
router.get("/mentee-groups/candidates", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  let programId = "";
  if (programs.companyHasPrograms(companyId)) {
    const program = ownRecord(req, res, programs.get(String(req.query.programId || "")), "Programme not found");
    if (!program) return;
    programId = program.id;
  }

  const list = mentees.listByCompany(companyId)
    .filter(m => (m.programId || "") === programId)
    .map(m => {
      const e = mentees.engagement(companyId, m.id);
      return {
        id: m.id, fullName: m.fullName, role: m.role || "", status: m.status,
        groupId: m.groupId, groupName: m.groupName,
        state: e.state, mentorName: e.mentorName || ""
      };
    });
  res.json({ programId, min: menteeGroups.MIN, max: menteeGroups.MAX, mentees: list });
}));

/**
 * The member list sent by the browser -> hydrated mentee records of the
 * organisation. Null after writing the error response.
 */
function loadMembers(req, res, memberIds) {
  if (!Array.isArray(memberIds) || memberIds.some(x => typeof x !== "string")) {
    res.status(400).json({ error: "memberIds must be a list of mentee ids.", code: "bad_member_ids" });
    return null;
  }
  const list = [];
  for (const id of [...new Set(memberIds.filter(Boolean))]) {
    const mentee = ownRecord(req, res, mentees.get(id), "Mentee not found");
    if (!mentee) return null;
    list.push(mentee);
  }
  return list;
}

function refuse(res, result) {
  const { ok, ...body } = result;
  return res.status(result.code === "group_size" || result.code === "member_wrong_program" ? 400 : 409).json(body);
}

/** { name, programId, memberIds } */
router.post("/mentee-groups", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const body = req.body || {};

  const n = menteeGroups.checkName(companyId, body.name);
  if (n.error) return res.status(400).json(n);

  // Programme: required when the organisation has programmes, must be its
  // own and not archived; must be empty when it has none.
  let programId = "";
  if (programs.companyHasPrograms(companyId)) {
    if (!body.programId) {
      return res.status(400).json({ error: "Choose the group's programme.", code: "group_program_required" });
    }
    const program = ownRecord(req, res, programs.get(String(body.programId)), "Programme not found");
    if (!program) return;
    if (program.archived) {
      return res.status(400).json({ error: "An archived programme cannot get new groups.", code: "program_archived" });
    }
    programId = program.id;
  }

  const list = loadMembers(req, res, body.memberIds);
  if (!list) return;
  const check = menteeGroups.checkMembers(companyId, null, list, programId);
  if (!check.ok) return refuse(res, check);

  const group = menteeGroups.create(companyId, { name: n.name, programId, memberIds: list.map(m => m.id) });
  res.json({ success: true, group });
}));

/** { name?, memberIds? } - the programme cannot be changed. */
router.patch("/mentee-groups/:id", requireApiKey, wrap(async (req, res) => {
  const group = ownRecord(req, res, menteeGroups.get(req.params.id), "Group not found");
  if (!group) return;
  const body = req.body || {};

  if (body.programId !== undefined && (body.programId || "") !== group.programId) {
    return res.status(400).json({
      error: "A group's programme cannot be changed. Delete the group and create it in the other programme.",
      code: "group_program_locked"
    });
  }

  const change = {};
  if (body.name !== undefined) {
    const n = menteeGroups.checkName(group.companyId, body.name, group.id);
    if (n.error) return res.status(400).json(n);
    change.name = n.name;
  }
  if (body.memberIds !== undefined) {
    const list = loadMembers(req, res, body.memberIds);
    if (!list) return;
    const check = menteeGroups.checkMembers(group.companyId, group, list, group.programId);
    if (!check.ok) return refuse(res, check);
    change.memberIds = list.map(m => m.id);
  }

  res.json({ success: true, group: menteeGroups.update(group.id, change) });
}));

/**
 * Deletes the group; its members stay as mentees and become free.
 * (Stage 3b adds: a group with a pending match request cannot be deleted.)
 */
router.delete("/mentee-groups/:id", requireApiKey, wrap(async (req, res) => {
  const group = ownRecord(req, res, menteeGroups.get(req.params.id), "Group not found");
  if (!group) return;
  menteeGroups.remove(group.id);
  res.json({ success: true, message: "Group deleted" });
}));

module.exports = router;
