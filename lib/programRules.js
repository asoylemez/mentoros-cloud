/**
 * PROGRAMME RULE FOR A NEW MATCH
 *
 * One place, used by every route that starts a match: AI suggestions
 * (POST /match), match requests (POST /match-request) and direct
 * mentorships (POST /mentorships). The browser only offers what is
 * allowed, but the browser can be bypassed - this check cannot.
 *
 *   Organisation WITHOUT programmes  -> no rule, as before ("" programme)
 *   Organisation WITH programmes     -> the mentee must be a REGISTERED
 *       mentee, placed in a programme that is still open (planned or
 *       running), and the mentor (when given) must be in that programme.
 *
 * Returns { programId, program } when the match is allowed. Otherwise it
 * writes the error response itself and returns null.
 *
 * Approving a request that was made while the programme was open is NOT
 * blocked later (the request already exists); only NEW matches are.
 */
const { programs } = require("../db/repos");

function programForMatch(res, companyId, menteeRecord, mentor = null) {
  if (!programs.companyHasPrograms(companyId)) {
    return { programId: "", program: null };
  }

  if (!menteeRecord) {
    res.status(400).json({
      error: "This organisation works with programmes: choose a registered mentee who is placed in a programme.",
      code: "program_mentee_required"
    });
    return null;
  }

  const program = menteeRecord.programId ? programs.get(menteeRecord.programId) : null;
  if (!program || program.companyId !== menteeRecord.companyId) {
    res.status(400).json({
      error: "This mentee is not placed in a programme yet. Place them in one in the Mentee Registry.",
      code: "program_not_assigned"
    });
    return null;
  }

  if (!programs.isOpen(program)) {
    res.status(400).json({
      error: program.status === "archived"
        ? `The programme "${program.name}" is archived: no new matches can be made in it.`
        : `The programme "${program.name}" has ended: no new matches can be made in it.`,
      code: "program_closed",
      programStatus: program.status,
      programName: program.name
    });
    return null;
  }

  if (mentor && !(mentor.programIds || []).includes(program.id)) {
    res.status(400).json({
      error: `This mentor is not in the mentee's programme "${program.name}".`,
      code: "mentor_not_in_program",
      programName: program.name
    });
    return null;
  }

  return { programId: program.id, program };
}

module.exports = { programForMatch };
