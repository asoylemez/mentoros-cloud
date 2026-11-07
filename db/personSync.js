const { db } = require("./index");

/**
 * PERSON DETAILS -> COPIES (V08)
 *
 * When a match, a survey or an event invitation is made, the person's name
 * and e-mail are COPIED into it (so history stays readable and mails go to
 * the right place). When HR changes a mentor's or mentee's name or e-mail
 * in the registry, the copies are brought up to date here:
 *
 *   name   -> everywhere, finished items included (e.g. a new surname
 *             after marriage shows in old matches and reports too)
 *   e-mail -> only where mail can still go: ACTIVE matches (and their
 *             group members), UNANSWERED surveys, PENDING match requests,
 *             events that have not happened yet. Finished items keep the
 *             address they were sent to.
 *
 * Not changed: sent announcements, the e-mail log, personal workspace and
 * survey links (same links, new address). The person number never changes.
 */

const today = () => new Date().toISOString().slice(0, 10);

/**
 * role: "mentor" | "mentee"; before/after: the registry record before and
 * after HR's change. Returns what was updated (counts).
 */
function syncPerson(companyId, role, before, after) {
  const id = before.id;
  const nameChanged = (after.fullName || "") !== (before.fullName || "") && !!String(after.fullName || "").trim();
  const emailChanged = String(after.email || "").trim().toLowerCase() !== String(before.email || "").trim().toLowerCase();
  const out = { namedMatches: 0, activeMatches: 0, pendingSurveys: 0, upcomingEvents: 0 };
  if (!nameChanged && !emailChanged) return out;

  const name = after.fullName || "", email = String(after.email || "").trim();
  const run = (sql, ...args) => db.prepare(sql).run(...args).changes;

  db.transaction(() => {
    if (role === "mentor") {
      if (nameChanged) {
        out.namedMatches += run(`UPDATE mentorships SET mentor_name = ? WHERE company_id = ? AND mentor_id = ?`, name, companyId, id);
        run(`UPDATE match_requests SET mentor_name = ? WHERE company_id = ? AND mentor_id = ?`, name, companyId, id);
        run(`UPDATE checkins SET recipient_name = ? WHERE company_id = ? AND role = 'mentor'
               AND mentorship_id IN (SELECT id FROM mentorships WHERE mentor_id = ?)`, name, companyId, id);
        run(`UPDATE surveys SET recipient_name = ? WHERE company_id = ? AND role = 'mentor'
               AND mentorship_id IN (SELECT id FROM mentorships WHERE mentor_id = ?)`, name, companyId, id);
      }
      if (emailChanged) {
        out.activeMatches += run(`UPDATE mentorships SET mentor_email = ? WHERE company_id = ? AND mentor_id = ? AND status = 'active'`, email, companyId, id);
        run(`UPDATE match_requests SET mentor_email = ? WHERE company_id = ? AND mentor_id = ? AND status = 'pending'`, email, companyId, id);
        out.pendingSurveys += run(`UPDATE checkins SET recipient_email = ? WHERE company_id = ? AND role = 'mentor' AND status = 'pending'
               AND mentorship_id IN (SELECT id FROM mentorships WHERE mentor_id = ?)`, email, companyId, id);
        out.pendingSurveys += run(`UPDATE surveys SET recipient_email = ? WHERE company_id = ? AND role = 'mentor' AND status = 'pending'
               AND mentorship_id IN (SELECT id FROM mentorships WHERE mentor_id = ?)`, email, companyId, id);
      }
    } else {
      // The mentee's surveys: individual (member_id empty) or as a group member.
      const mine = `role = 'mentee' AND (member_id = ? OR (COALESCE(member_id, '') = ''
                      AND mentorship_id IN (SELECT id FROM mentorships WHERE mentee_id = ?)))`;
      if (nameChanged) {
        out.namedMatches += run(`UPDATE mentorships SET mentee_name = ? WHERE company_id = ? AND mentee_id = ?`, name, companyId, id);
        out.namedMatches += run(`UPDATE mentorship_members SET full_name = ? WHERE mentee_id = ?
               AND mentorship_id IN (SELECT id FROM mentorships WHERE company_id = ?)`, name, id, companyId);
        run(`UPDATE match_requests SET mentee_name = ? WHERE company_id = ? AND mentee_id = ?`, name, companyId, id);
        run(`UPDATE checkins SET recipient_name = ? WHERE company_id = ? AND ${mine}`, name, companyId, id, id);
        run(`UPDATE surveys SET recipient_name = ? WHERE company_id = ? AND ${mine}`, name, companyId, id, id);
      }
      if (emailChanged) {
        out.activeMatches += run(`UPDATE mentorships SET mentee_email = ? WHERE company_id = ? AND mentee_id = ? AND status = 'active'`, email, companyId, id);
        out.activeMatches += run(`UPDATE mentorship_members SET email = ? WHERE mentee_id = ?
               AND mentorship_id IN (SELECT id FROM mentorships WHERE company_id = ? AND status = 'active')`, email, id, companyId);
        run(`UPDATE match_requests SET mentee_email = ? WHERE company_id = ? AND mentee_id = ? AND status = 'pending'`, email, companyId, id);
        out.pendingSurveys += run(`UPDATE checkins SET recipient_email = ? WHERE company_id = ? AND status = 'pending' AND ${mine}`, email, companyId, id, id);
        out.pendingSurveys += run(`UPDATE surveys SET recipient_email = ? WHERE company_id = ? AND status = 'pending' AND ${mine}`, email, companyId, id, id);
      }
    }

    // Event invitations (the same for both roles).
    if (nameChanged) {
      run(`UPDATE event_participants SET full_name = ? WHERE company_id = ? AND person_type = ? AND person_id = ?`, name, companyId, role, id);
    }
    if (emailChanged && email) {
      // OR IGNORE: one address per event - if the new address is already
      // invited to that event, that row is left as it is.
      out.upcomingEvents += run(`UPDATE OR IGNORE event_participants SET email = ? WHERE company_id = ? AND person_type = ? AND person_id = ?
               AND event_id IN (SELECT id FROM events WHERE event_date >= ?)`, email, companyId, role, id, today());
    }
  })();
  return out;
}

module.exports = { syncPerson };
