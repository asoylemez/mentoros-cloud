const { db, newId, now, slugify } = require("../db");
const { mentors, mentees, menteeGroups, programs, companies, mentorships } = require("../db/repos");
const mailer = require("../mail/mailer");

/**
 * ====================================================================
 * ANNOUNCEMENTS  (stage 4a - without attachments)
 * ====================================================================
 *
 * HR writes an announcement like an e-mail (subject + plain-text body,
 * {ad} = the recipient's name), picks who gets it and sends it. Every
 * recipient gets their OWN e-mail. Sending runs in the background: the
 * page shows the progress, closing the browser does not stop it, and a
 * restart picks up where it stopped (resumeUnfinished).
 *
 * Who gets it (`selection`, all optional):
 *   mentors: "none" | "all" | "programs"   + mentorProgramIds
 *   mentees: "none" | "all" | "programs"   + menteeProgramIds
 *   groupIds   - every member of these mentee groups
 *   mentorIds / menteeIds - people picked one by one
 *   extra      - typed-in addresses (at most 200)
 * Only ACTIVE mentors and mentees are included; the same address is
 * written to once.
 */

const SUBJECT_MAX = 200;
const BODY_MAX = 20000;
const EXTRA_MAX = 200;

const validEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || ""));
const ids = v => (Array.isArray(v) ? [...new Set(v.filter(x => typeof x === "string" && x))] : []);

/** Keeps only known fields of a selection, in the right shape. */
function cleanSelection(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const scope = v => (["all", "programs"].includes(v) ? v : "none");
  return {
    mentors: scope(s.mentors),
    mentorProgramIds: ids(s.mentorProgramIds),
    mentees: scope(s.mentees),
    menteeProgramIds: ids(s.menteeProgramIds),
    groupIds: ids(s.groupIds),
    mentorIds: ids(s.mentorIds),
    menteeIds: ids(s.menteeIds),
    extra: [...new Set((Array.isArray(s.extra) ? s.extra : String(s.extra || "").split(/[\s,;]+/))
      .map(e => String(e).trim().toLowerCase()).filter(Boolean))]
  };
}

/**
 * Checks that every id in a selection belongs to the organisation.
 * Returns { error, code } or { selection }.
 */
function checkSelection(companyId, raw) {
  const s = cleanSelection(raw);
  const cid = slugify(companyId);
  const own = rec => rec && rec.companyId === cid;

  for (const pid of [...s.mentorProgramIds, ...s.menteeProgramIds]) {
    if (!own(programs.get(pid))) return { error: "Programme not found", code: "not_found" };
  }
  for (const gid of s.groupIds) if (!own(menteeGroups.get(gid))) return { error: "Group not found", code: "not_found" };
  for (const id of s.mentorIds) if (!own(mentors.get(id))) return { error: "Mentor not found", code: "not_found" };
  for (const id of s.menteeIds) if (!own(mentees.get(id))) return { error: "Mentee not found", code: "not_found" };

  const bad = s.extra.filter(e => !validEmail(e));
  if (bad.length) return { error: "Some addresses are not valid.", code: "bad_addresses", addresses: bad };
  if (s.extra.length > EXTRA_MAX) return { error: `At most ${EXTRA_MAX} typed-in addresses.`, code: "too_many_addresses" };
  return { selection: s };
}

/** The people a (checked) selection reaches: [{ type, id, name, email }], one per address. */
function resolve(companyId, selection) {
  const s = cleanSelection(selection);
  const out = new Map();                 // lower-case e-mail -> recipient
  const add = (type, id, name, email) => {
    const key = String(email || "").trim().toLowerCase();
    if (!validEmail(key) || out.has(key)) return;
    out.set(key, { type, id, name: name || "", email: String(email).trim() });
  };
  const activeMentors = mentors.listByCompany(companyId).filter(m => m.status === "active");
  const activeMentees = mentees.listByCompany(companyId).filter(m => m.status === "active");

  if (s.mentors === "all") activeMentors.forEach(m => add("mentor", m.id, m.fullName, m.email));
  if (s.mentors === "programs") {
    activeMentors.filter(m => (m.programIds || []).some(p => s.mentorProgramIds.includes(p)))
      .forEach(m => add("mentor", m.id, m.fullName, m.email));
  }
  if (s.mentees === "all") activeMentees.forEach(m => add("mentee", m.id, m.fullName, m.email));
  if (s.mentees === "programs") {
    activeMentees.filter(m => s.menteeProgramIds.includes(m.programId))
      .forEach(m => add("mentee", m.id, m.fullName, m.email));
  }
  for (const gid of s.groupIds) {
    const g = menteeGroups.get(gid);
    if (!g) continue;
    for (const m of g.members) if (m.status === "active") add("mentee", m.id, m.fullName, m.email);
  }
  for (const id of s.mentorIds) {
    const m = activeMentors.find(x => x.id === id);
    if (m) add("mentor", m.id, m.fullName, m.email);
  }
  for (const id of s.menteeIds) {
    const m = activeMentees.find(x => x.id === id);
    if (m) add("mentee", m.id, m.fullName, m.email);
  }
  for (const e of s.extra) add("external", "", "", e);
  return [...out.values()];
}

// ---------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------

function hydrate(row) {
  if (!row) return null;
  let selection = {};
  try { selection = JSON.parse(row.selection || "{}"); } catch { selection = {}; }
  return {
    id: row.id, companyId: row.company_id, subject: row.subject, body: row.body,
    status: row.status, selection: cleanSelection(selection), language: row.language,
    sentCount: row.sent_count, failedCount: row.failed_count,
    createdAt: row.created_at, updatedAt: row.updated_at, sentAt: row.sent_at
  };
}

const announcements = {
  SUBJECT_MAX, BODY_MAX, EXTRA_MAX,

  get(id) {
    return hydrate(db.prepare(`SELECT * FROM announcements WHERE id = ?`).get(id));
  },

  listByCompany(companyId) {
    return db.prepare(`
      SELECT a.*,
        (SELECT COUNT(*) FROM announcement_recipients r WHERE r.announcement_id = a.id) AS total,
        (SELECT COUNT(*) FROM announcement_recipients r WHERE r.announcement_id = a.id AND r.status = 'pending') AS pending
        FROM announcements a WHERE a.company_id = ? ORDER BY a.created_at DESC
    `).all(slugify(companyId)).map(r => ({ ...hydrate(r), total: r.total, pending: r.pending }));
  },

  /** Subject/body check and trim. Returns { error, code } or { subject, body }. */
  checkText(subject, body, { forSending = false } = {}) {
    const s = String(subject || "").replace(/\s+/g, " ").trim();
    const b = String(body || "").replace(/\r\n?/g, "\n");
    if (s.length > SUBJECT_MAX) return { error: `The subject can be at most ${SUBJECT_MAX} characters.`, code: "subject_too_long" };
    if (b.length > BODY_MAX) return { error: `The message can be at most ${BODY_MAX} characters.`, code: "body_too_long" };
    if (forSending && !s) return { error: "Write a subject.", code: "subject_required" };
    if (forSending && !b.trim()) return { error: "Write a message.", code: "body_required" };
    return { subject: s, body: b };
  },

  saveDraft(companyId, id, { subject, body, selection, language }) {
    const ts = now();
    if (!id) {
      id = newId();
      db.prepare(`
        INSERT INTO announcements (id, company_id, subject, body, status, selection, language, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)
      `).run(id, slugify(companyId), subject, body, JSON.stringify(selection), language === "en" ? "en" : "tr", ts, ts);
    } else {
      db.prepare(`
        UPDATE announcements SET subject = ?, body = ?, selection = ?, language = ?, updated_at = ?
         WHERE id = ? AND status = 'draft'
      `).run(subject, body, JSON.stringify(selection), language === "en" ? "en" : "tr", ts, id);
    }
    return announcements.get(id);
  },

  remove(id) {
    db.prepare(`DELETE FROM announcements WHERE id = ?`).run(id);   // recipients: ON DELETE CASCADE
  },

  recipients(id) {
    return db.prepare(`
      SELECT id, person_type AS type, person_id AS personId, full_name AS name, email, status, error, sent_at AS sentAt
        FROM announcement_recipients WHERE announcement_id = ? ORDER BY full_name COLLATE NOCASE, email
    `).all(id);
  },

  /** Writes the recipient rows and marks the announcement as sending. */
  queue(id, list) {
    const ts = now();
    db.transaction(() => {
      const add = db.prepare(`
        INSERT INTO announcement_recipients (id, announcement_id, person_type, person_id, full_name, email, status)
        VALUES (?, ?, ?, ?, ?, ?, 'pending')
      `);
      for (const r of list) add.run(newId(), id, r.type, r.id || "", r.name || "", r.email);
      db.prepare(`UPDATE announcements SET status = 'sending', updated_at = ?, sent_at = ? WHERE id = ?`).run(ts, ts, id);
    })();
  },

  /** Failed recipients go back to the queue. Returns how many. */
  requeueFailed(id) {
    const n = db.prepare(`UPDATE announcement_recipients SET status = 'pending', error = '' WHERE announcement_id = ? AND status = 'failed'`)
      .run(id).changes;
    if (n) db.prepare(`UPDATE announcements SET status = 'sending', updated_at = ? WHERE id = ?`).run(now(), id);
    return n;
  },

  /**
   * Announcements a workspace shows: those sent to EVERYONE in it - the
   * mentor and the mentee, or the mentor and every group member. One
   * sent to one side only stays in e-mail (decision 1b).
   */
  forMentorship(ms) {
    const people = [["mentor", ms.mentorId]];
    if (ms.groupId) for (const m of ms.members || []) people.push(["mentee", m.id]);
    else if (!ms.menteeDeleted && ms.menteeId && !String(ms.menteeId).startsWith("mentee_")) people.push(["mentee", ms.menteeId]);
    if (people.length < 2) return [];

    const rows = db.prepare(`
      SELECT a.id, a.subject, a.body, a.sent_at AS sentAt,
             GROUP_CONCAT(r.person_type || ':' || r.person_id) AS reached
        FROM announcements a JOIN announcement_recipients r ON r.announcement_id = a.id
       WHERE a.company_id = ? AND a.status IN ('sending', 'sent') AND r.person_id != ''
       GROUP BY a.id ORDER BY a.sent_at DESC
    `).all(ms.companyId);

    return rows.filter(a => {
      const reached = new Set(String(a.reached || "").split(","));
      return people.every(([t, id]) => reached.has(`${t}:${id}`));
    }).map(a => ({
      id: a.id,
      subject: mailer.personalise(a.subject, "").trim(),
      body: mailer.personalise(a.body, ""),
      sentAt: a.sentAt
    }));
  }
};

// ---------------------------------------------------------------------
// Background sending
// ---------------------------------------------------------------------

const running = new Set();             // announcement ids being sent in this process

function refreshCounts(id) {
  const c = db.prepare(`
    SELECT SUM(status = 'sent') AS sent, SUM(status = 'failed') AS failed, SUM(status = 'pending') AS pending
      FROM announcement_recipients WHERE announcement_id = ?
  `).get(id);
  db.prepare(`UPDATE announcements SET sent_count = ?, failed_count = ?, updated_at = ? WHERE id = ?`)
    .run(c.sent || 0, c.failed || 0, now(), id);
  return c;
}

/**
 * Sends the pending recipients of one announcement, one e-mail at a
 * time, in the background. Safe to call twice: a second call while one
 * is running does nothing.
 */
function startSending(id) {
  if (running.has(id)) return;
  running.add(id);

  const work = async () => {
    try {
      const a = announcements.get(id);
      if (!a) return;
      const company = companies.get(a.companyId) || {};
      const next = db.prepare(`
        SELECT * FROM announcement_recipients WHERE announcement_id = ? AND status = 'pending' LIMIT 1
      `);
      let r;
      while ((r = next.get(id))) {
        try {
          await mailer.sendAnnouncement({
            to: r.email, name: r.full_name, subject: a.subject, body: a.body,
            companyName: company.name || "", replyTo: company.replyTo || "",
            companyId: a.companyId, refId: a.id, lang: a.language
          });
          db.prepare(`UPDATE announcement_recipients SET status = 'sent', error = '', sent_at = ? WHERE id = ?`).run(now(), r.id);
        } catch (err) {
          db.prepare(`UPDATE announcement_recipients SET status = 'failed', error = ? WHERE id = ?`)
            .run(String(err.message || "send failed").slice(0, 300), r.id);
        }
        refreshCounts(id);
      }
      refreshCounts(id);
      db.prepare(`UPDATE announcements SET status = 'sent', updated_at = ? WHERE id = ?`).run(now(), id);
    } catch (err) {
      console.error(`  ! Announcement ${id} could not be sent:`, err.message);
    } finally {
      running.delete(id);
    }
  };
  setImmediate(work);
}

/** On start-up: announcements left half-sent by a restart carry on. */
function resumeUnfinished() {
  const rows = db.prepare(`SELECT id FROM announcements WHERE status = 'sending'`).all();
  for (const { id } of rows) startSending(id);
  if (rows.length) console.log(`  Announcements: ${rows.length} unfinished sending resumed`);
}

module.exports = { announcements, cleanSelection, checkSelection, resolve, startSending, resumeUnfinished, validEmail };
