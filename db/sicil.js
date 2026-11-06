const { db } = require("./index");

/**
 * Person number ("sicil no") - one per PERSON per organisation.
 *
 * - Numbers start at 0001 in every organisation and only go up.
 * - The person is identified by e-mail (trimmed, case-insensitive): a
 *   mentor who also registers as a mentee keeps the same number.
 * - A number is never changed and never given to anyone else. The
 *   organisation's counter (companies.sicil_seq) is not lowered when a
 *   person is deleted. Deleted people's e-mails are NOT kept (KVKK), so
 *   someone deleted who registers again gets a new number.
 * - A record without an e-mail always gets its own new number.
 *
 * Columns are added in db/migrate.js.
 */

const pad = n => String(n).padStart(4, "0");
const emailKey = email => String(email || "").trim().toLowerCase();

/** Highest number in use or ever handed out in the organisation. */
function lastNumber(companyId) {
  const seq = db.prepare(`SELECT sicil_seq FROM companies WHERE company_id = ?`).get(companyId);
  const used = db.prepare(`
    SELECT MAX(CAST(sicil_no AS INTEGER)) AS n FROM (
      SELECT sicil_no FROM mentors WHERE company_id = ? AND sicil_no != ''
      UNION ALL
      SELECT sicil_no FROM mentees WHERE company_id = ? AND sicil_no != ''
    )`).get(companyId, companyId);
  return Math.max(Number(seq && seq.sicil_seq) || 0, Number(used && used.n) || 0);
}

/** The number an e-mail already has in this organisation (either role), or "". */
function findByEmail(companyId, email) {
  const key = emailKey(email);
  if (!key) return "";
  const row = db.prepare(`
    SELECT sicil_no FROM (
      SELECT sicil_no, created_at FROM mentors
       WHERE company_id = ? AND sicil_no != '' AND lower(trim(email)) = ?
      UNION ALL
      SELECT sicil_no, created_at FROM mentees
       WHERE company_id = ? AND sicil_no != '' AND lower(trim(email)) = ?
    ) ORDER BY created_at LIMIT 1`).get(companyId, key, companyId, key);
  return row ? row.sicil_no : "";
}

/** Number for a new record: the person's existing one, otherwise the next. */
function assign(companyId, email) {
  const existing = findByEmail(companyId, email);
  if (existing) return existing;
  const next = lastNumber(companyId) + 1;
  db.prepare(`UPDATE companies SET sicil_seq = ? WHERE company_id = ?`).run(next, companyId);
  return pad(next);
}

/**
 * Is this e-mail already registered in this role ("mentor" / "mentee")?
 * exceptId: the record being edited (it may keep its own e-mail).
 */
function emailTaken(companyId, role, email, exceptId = "") {
  const key = emailKey(email);
  if (!key) return false;
  const table = role === "mentor" ? "mentors" : "mentees";
  return !!db.prepare(
    `SELECT 1 FROM ${table} WHERE company_id = ? AND lower(trim(email)) = ? AND id != ? LIMIT 1`
  ).get(companyId, key, exceptId || "");
}

/**
 * Gives a number to every record that has none (existing data, restored
 * old backups). Per organisation, mentors and mentees together, oldest
 * registration first. Safe to run on every start.
 */
function backfill() {
  const rows = db.prepare(`
    SELECT 'mentors' AS tbl, id, company_id, email, created_at FROM mentors WHERE COALESCE(sicil_no, '') = ''
    UNION ALL
    SELECT 'mentees' AS tbl, id, company_id, email, created_at FROM mentees WHERE COALESCE(sicil_no, '') = ''
    ORDER BY company_id, created_at, tbl, id`).all();
  if (!rows.length) return 0;

  const setNo = {
    mentors: db.prepare(`UPDATE mentors SET sicil_no = ? WHERE id = ?`),
    mentees: db.prepare(`UPDATE mentees SET sicil_no = ? WHERE id = ?`)
  };
  db.transaction(() => {
    for (const r of rows) setNo[r.tbl].run(assign(r.company_id, r.email), r.id);
  })();
  return rows.length;
}

module.exports = { assign, findByEmail, emailTaken, backfill, emailKey, pad };
