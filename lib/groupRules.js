const { menteeGroups, mentees } = require("../db/repos");
const { ownRecord } = require("../routes/_helpers");

/**
 * A MENTEE GROUP THAT CAN BE MATCHED NOW
 *
 * Used by the AI suggestions (POST /match) and by the match itself
 * (POST /mentorships). Writes the error response and returns null when
 * the group cannot be matched:
 *   - not the organisation's own (404, like a missing one)
 *   - fewer than 2 members left (members may have been deleted since)
 *   - already in an active mentorship (a group has one mentor at a time)
 * Otherwise returns the group with `memberRecords` (hydrated mentees).
 * The programme rule is checked separately (lib/programRules.js).
 */
function loadMatchableGroup(req, res, companyId, groupId) {
  const group = ownRecord(req, res, menteeGroups.get(String(groupId)), "Group not found");
  if (!group) return null;

  if (group.members.length < menteeGroups.MIN) {
    res.status(400).json({
      error: `A group needs at least ${menteeGroups.MIN} members to be matched.`,
      code: "group_too_small"
    });
    return null;
  }

  if (group.activeMentorship) {
    res.status(409).json({
      error: `This group already has an active mentorship with ${group.activeMentorship.mentorName || "a mentor"}.`,
      code: "group_already_matched",
      mentorName: group.activeMentorship.mentorName,
      mentorshipId: group.activeMentorship.id
    });
    return null;
  }

  group.memberRecords = group.memberIds.map(id => mentees.get(id)).filter(Boolean);
  return group;
}

module.exports = { loadMatchableGroup };
