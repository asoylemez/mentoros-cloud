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

  // Kurulum kimligi / deneme takibi
  const hasInstall = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='install'`
  ).get();

  if (!hasInstall) {
    db.exec(`
      CREATE TABLE install (
        id           INTEGER PRIMARY KEY CHECK (id = 1),
        installed_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
    `);
    console.log("  migration: install tablosu eklendi");
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
}

module.exports = { run };
