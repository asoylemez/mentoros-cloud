const { db } = require("./index");

/**
 * Mevcut veritabanlarina eksik sutunlari ekler.
 * SQLite'ta "ALTER TABLE ... ADD COLUMN" varsa hata verir, o yuzden
 * once kontrol ediyoruz.
 */
function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`)
    .all()
    .some(c => c.name === column);
}

function run() {
  if (!columnExists("companies", "invite_token")) {
    db.exec(`ALTER TABLE companies ADD COLUMN invite_token TEXT`);
    console.log("  migration: companies.invite_token eklendi");
  }

  // Firma erisiminin bitis tarihi (bir yillik sifre gecerliligi).
  // Super admin: kullanici adinin girildigi hali + gorulebilir sifre
  for (const col of ["login_name", "password_enc"]) {
    if (!columnExists("companies", col)) {
      db.exec(`ALTER TABLE companies ADD COLUMN ${col} TEXT DEFAULT ''`);
      console.log(`  migration: companies.${col} eklendi`);
    }
  }

  if (!columnExists("companies", "expires_at")) {
    db.exec(`ALTER TABLE companies ADD COLUMN expires_at TEXT DEFAULT ''`);
    console.log("  migration: companies.expires_at eklendi");
  }

  if (!columnExists("mentorships", "access_token")) {
    db.exec(`ALTER TABLE mentorships ADD COLUMN access_token TEXT`);
    console.log("  migration: mentorships.access_token eklendi");
  }

  // Yonetici onayi (mentee'nin yoneticisi) - onay surecinin ilk kapisi.
  for (const [col, ddl] of [
    ["manager_name",     "TEXT DEFAULT ''"],
    ["manager_email",    "TEXT DEFAULT ''"],
    ["manager_token",    "TEXT"],
    ["manager_approval", "TEXT NOT NULL DEFAULT 'not_required'"]
  ]) {
    if (!columnExists("match_requests", col)) {
      db.exec(`ALTER TABLE match_requests ADD COLUMN ${col} ${ddl}`);
      console.log(`  migration: match_requests.${col} eklendi`);
    }
  }

  // Red gerekcesi
  for (const [col, ddl] of [
    ["rejected_by",        "TEXT DEFAULT ''"],
    ["rejection_category", "TEXT DEFAULT ''"],
    ["rejection_note",     "TEXT DEFAULT ''"],
    ["rejected_at",        "TEXT DEFAULT ''"]
  ]) {
    if (!columnExists("match_requests", col)) {
      db.exec(`ALTER TABLE match_requests ADD COLUMN ${col} ${ddl}`);
      console.log(`  migration: match_requests.${col} eklendi`);
    }
  }

  // Sonraki gorusme saati (davet + gosterim icin). Tarih zaten vardi.
  if (!columnExists("mentorships", "next_meeting_time")) {
    db.exec(`ALTER TABLE mentorships ADD COLUMN next_meeting_time TEXT DEFAULT ''`);
    console.log("  migration: mentorships.next_meeting_time eklendi");
  }
  if (!columnExists("meetings", "next_meeting_time")) {
    db.exec(`ALTER TABLE meetings ADD COLUMN next_meeting_time TEXT DEFAULT ''`);
    console.log("  migration: meetings.next_meeting_time eklendi");
  }

  // Meeting length in minutes (HR meeting tracking). NULL = not recorded:
  // notes saved before the duration became required.
  if (!columnExists("meetings", "duration_minutes")) {
    db.exec(`ALTER TABLE meetings ADD COLUMN duration_minutes INTEGER`);
    console.log("  migration: meetings.duration_minutes added");
  }

  // Calisma alaninin kapanacagi tarih (IK belirler; bilgi amacli).
  if (!columnExists("mentorships", "closing_date")) {
    db.exec(`ALTER TABLE mentorships ADD COLUMN closing_date TEXT DEFAULT ''`);
    console.log("  migration: mentorships.closing_date eklendi");
  }

  // Mentee kayit formu: yeni alanlar (mentor formuyla ayni yapida).
  const menteeCols = {
    band: "TEXT DEFAULT ''",
    country: "TEXT DEFAULT ''",
    region: "TEXT DEFAULT ''",
    tenure: "TEXT DEFAULT ''",
    dev_functional_areas: "TEXT DEFAULT '[]'",
    dev_areas_extra: "TEXT DEFAULT ''",
    challenge: "TEXT DEFAULT ''",
    competencies_to_develop: "TEXT DEFAULT '[]'",
    comp_extra: "TEXT DEFAULT ''",
    expectations: "TEXT DEFAULT ''",
    formats: "TEXT DEFAULT '[]'",
    hours_per_month: "TEXT DEFAULT ''",
    preferred_mentor_profile: "TEXT DEFAULT '[]'",
    manager_name: "TEXT DEFAULT ''",
    manager_email: "TEXT DEFAULT ''",
    message: "TEXT DEFAULT ''",
    kvkk_consent: "INTEGER NOT NULL DEFAULT 0",
    status: "TEXT NOT NULL DEFAULT 'active'",
    submitted_at: "TEXT DEFAULT ''"
  };
  // Mentor kayit formu: listede olmayan fonksiyon alani / sektor icin
  // serbest metin (mentee formundaki dev_areas_extra ile ayni mantik).
  for (const col of ["functional_areas_extra", "industries_extra"]) {
    if (!columnExists("mentors", col)) {
      db.exec(`ALTER TABLE mentors ADD COLUMN ${col} TEXT DEFAULT ''`);
      console.log(`  migration: mentors.${col} eklendi`);
    }
  }

  for (const [col, def] of Object.entries(menteeCols)) {
    if (!columnExists("mentees", col)) {
      db.exec(`ALTER TABLE mentees ADD COLUMN ${col} ${def}`);
      console.log(`  migration: mentees.${col} eklendi`);
    }
  }

  // KVKK onayi mentor kaydinda da saklanir.
  if (!columnExists("mentors", "kvkk_consent")) {
    db.exec(`ALTER TABLE mentors ADD COLUMN kvkk_consent INTEGER NOT NULL DEFAULT 0`);
    console.log("  migration: mentors.kvkk_consent eklendi");
  }


  // Denetim kaydi artik kalici (once sadece bellekteydi).
  const hasAudit = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='ai_audit'`
  ).get();

  if (!hasAudit) {
    db.exec(`
      CREATE TABLE ai_audit (
        id            TEXT PRIMARY KEY,
        timestamp     TEXT NOT NULL,
        operation     TEXT NOT NULL,
        provider      TEXT,
        model         TEXT,
        prompt_sent   TEXT,
        duration_ms   INTEGER,
        input_tokens  INTEGER,
        output_tokens INTEGER,
        ok            INTEGER NOT NULL DEFAULT 1,
        error         TEXT
      );
      CREATE INDEX idx_audit_time ON ai_audit(timestamp DESC);
    `);
    console.log("  migration: ai_audit tablosu eklendi");
  }

  const hasEmailLog = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='email_log'`
  ).get();

  if (!hasEmailLog) {
    db.exec(`
      CREATE TABLE email_log (
        id           TEXT PRIMARY KEY,
        company_id   TEXT NOT NULL,
        kind         TEXT NOT NULL,
        recipient    TEXT NOT NULL,
        subject      TEXT DEFAULT '',
        ref_id       TEXT DEFAULT '',
        ok           INTEGER NOT NULL DEFAULT 1,
        error        TEXT,
        sent_at      TEXT NOT NULL
      );
      CREATE INDEX idx_email_ref ON email_log(ref_id);
      CREATE INDEX idx_email_company ON email_log(company_id, sent_at DESC);
    `);
    console.log("  migration: email_log tablosu eklendi");
  }

  migratePrograms();
  migrateMenteeGroups();
}

/**
 * MENTEE GROUPS  (one mentor with a group of mentees - stage 3a: the groups)
 *
 *   mentee_groups         a named group, inside one programme ('' when the
 *                         organisation has no programmes). The programme
 *                         cannot be changed after the group is created.
 *   mentee_group_members  who is in it. A mentee is in at most ONE group
 *                         (UNIQUE mentee_id). Deleting a mentee or a group
 *                         removes the rows (ON DELETE CASCADE).
 */
function migrateMenteeGroups() {
  const has = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='mentee_groups'`
  ).get();
  if (has) return;

  db.exec(`
    CREATE TABLE mentee_groups (
      id          TEXT PRIMARY KEY,
      company_id  TEXT NOT NULL,
      program_id  TEXT NOT NULL DEFAULT '',
      name        TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      FOREIGN KEY (company_id) REFERENCES companies(company_id) ON DELETE CASCADE
    );
    CREATE INDEX idx_mentee_groups_company ON mentee_groups(company_id);
    CREATE UNIQUE INDEX idx_mentee_groups_name ON mentee_groups(company_id, name COLLATE NOCASE);

    CREATE TABLE mentee_group_members (
      group_id    TEXT NOT NULL,
      mentee_id   TEXT NOT NULL,
      company_id  TEXT NOT NULL,
      added_at    TEXT NOT NULL,
      PRIMARY KEY (group_id, mentee_id),
      UNIQUE (mentee_id),
      FOREIGN KEY (group_id)  REFERENCES mentee_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (mentee_id) REFERENCES mentees(id)       ON DELETE CASCADE
    );
  `);
  console.log("  migration: mentee group tables added");
}

/**
 * MENTORING PROGRAMMES
 *
 * An organisation can run several programmes ("Leadership 2026",
 * "Graduate programme"), each with a start and an end date.
 *   - a mentor can be in SEVERAL programmes  -> program_mentors
 *   - a mentee is in ONE programme           -> mentees.program_id
 *   - a match request / mentorship remembers the programme it was made
 *     in                                     -> *.program_id
 * '' (empty) = not assigned to a programme. An organisation without
 * programmes works exactly as before.
 */
function migratePrograms() {
  const hasPrograms = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='programs'`
  ).get();

  if (!hasPrograms) {
    db.exec(`
      CREATE TABLE programs (
        id           TEXT PRIMARY KEY,
        company_id   TEXT NOT NULL,
        name         TEXT NOT NULL,
        description  TEXT NOT NULL DEFAULT '',
        start_date   TEXT NOT NULL,              -- YYYY-MM-DD
        end_date     TEXT NOT NULL,              -- YYYY-MM-DD
        archived     INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        FOREIGN KEY (company_id) REFERENCES companies(company_id) ON DELETE CASCADE
      );
      CREATE INDEX idx_programs_company ON programs(company_id);
      CREATE UNIQUE INDEX idx_programs_name ON programs(company_id, name COLLATE NOCASE);
    `);
    console.log("  migration: programs table added");
  }

  const hasProgramMentors = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='program_mentors'`
  ).get();

  if (!hasProgramMentors) {
    db.exec(`
      CREATE TABLE program_mentors (
        program_id   TEXT NOT NULL,
        mentor_id    TEXT NOT NULL,
        company_id   TEXT NOT NULL,
        added_at     TEXT NOT NULL,
        PRIMARY KEY (program_id, mentor_id),
        FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE CASCADE,
        FOREIGN KEY (mentor_id)  REFERENCES mentors(id)  ON DELETE CASCADE
      );
      CREATE INDEX idx_program_mentors_mentor ON program_mentors(mentor_id);
    `);
    console.log("  migration: program_mentors table added");
  }

  for (const table of ["mentees", "match_requests", "mentorships"]) {
    if (!columnExists(table, "program_id")) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN program_id TEXT NOT NULL DEFAULT ''`);
      console.log(`  migration: ${table}.program_id added`);
    }
  }

  // One mentorship per mentor-mentee pair PER PROGRAMME (was: per
  // organisation). Otherwise a pair matched in programme X could never
  // be matched again in programme Y. The index is managed only here -
  // schema.sql no longer creates the old one.
  const oldIndex = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_ms_unique_pair'`
  ).get();
  if (oldIndex) {
    db.exec(`DROP INDEX idx_ms_unique_pair`);
    console.log("  migration: mentorships unique pair index removed (now per programme)");
  }
  const newIndex = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_ms_unique_pair_program'`
  ).get();
  if (!newIndex) {
    db.exec(`CREATE UNIQUE INDEX idx_ms_unique_pair_program
               ON mentorships(company_id, mentor_id, mentee_id, program_id)`);
    console.log("  migration: mentorships unique pair-per-programme index added");
  }
}

module.exports = { run };
