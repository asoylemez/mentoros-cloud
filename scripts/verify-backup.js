/**
 * ====================================================================
 * VERIFY A DOWNLOADED BACKUP (read-only)
 * ====================================================================
 *
 *   npm run verify-backup -- "C:\path\to\mentoros-backup.db"
 *
 * Checks, WITHOUT starting the server and WITHOUT sending anything:
 *   1. DB_ENCRYPTION_KEY opens the backup file,
 *   2. the data inside is readable (counts per organisation),
 *   3. SETTINGS_SECRET decrypts the stored secrets (SMTP password etc.).
 *
 * The two keys are read from environment variables of THIS terminal
 * window only - nothing is written to disk, and the values are never
 * printed. The downloaded file itself is never changed: the check runs
 * on a temporary copy that is deleted at the end.
 *
 * Why not simply start the server on the backup? A started server would
 * resume unfinished announcement / event mailings with the SMTP settings
 * stored in the backup, i.e. it could send REAL e-mails from a test.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const file = process.argv[2];
const line = "  " + "-".repeat(60);

function fail(msg) {
  console.error(`\n  X ${msg}\n`);
  process.exit(1);
}

if (!file) fail('Give the backup file:  npm run verify-backup -- "C:\\path\\backup.db"');
if (!fs.existsSync(file)) fail(`File not found: ${file}`);
if (!process.env.DB_ENCRYPTION_KEY) fail("DB_ENCRYPTION_KEY is not set in this terminal window (see the instructions).");

let cipher;
try {
  cipher = require("../lib/dbCipher");        // validates the key format
} catch (err) {
  fail(err.message);
}

// Work on a temporary copy: opening a database can create -wal/-shm files
// next to it, and the downloaded backup must stay exactly as it is.
const tmp = path.join(os.tmpdir(), `mentoros-verify-${process.pid}.db`);
fs.copyFileSync(file, tmp);
const cleanup = () => {
  for (const f of [tmp, tmp + "-wal", tmp + "-shm"]) { try { fs.unlinkSync(f); } catch { /* gone */ } }
};

let db;
try {
  console.log(`\n  Backup: ${path.basename(file)}  (${(fs.statSync(file).size / 1048576).toFixed(1)} MB)`);
  console.log(line);

  if (cipher.isPlaintext(tmp)) {
    console.log("  ! This file is NOT encrypted (plain SQLite).");
  }
  try {
    db = cipher.open(tmp, { readonly: true });
    db.prepare("SELECT count(*) FROM sqlite_master").get();
  } catch (err) {
    cleanup();
    fail("DB_ENCRYPTION_KEY does NOT open this backup. Check that you copied the value from Render exactly.");
  }
  console.log("  OK  DB_ENCRYPTION_KEY opens the backup.");

  const has = t => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
  const count = (t, cid) => has(t)
    ? db.prepare(`SELECT count(*) AS n FROM ${t}${cid ? " WHERE company_id = ?" : ""}`).get(...(cid ? [cid] : [])).n
    : "-";

  // --- Data per organisation -------------------------------------------
  const companies = db.prepare("SELECT company_id, name FROM companies ORDER BY name").all();
  console.log(`  OK  Data is readable: ${companies.length} organisation(s).\n`);
  console.log("      Organisation                 Mentors  Mentees  Matches");
  for (const c of companies) {
    const name = String(c.name || c.company_id).slice(0, 28).padEnd(28);
    console.log(`      ${name} ${String(count("mentors", c.company_id)).padStart(7)}  ${String(count("mentees", c.company_id)).padStart(7)}  ${String(count("mentorships", c.company_id)).padStart(7)}`);
  }
  const last = has("mentorships")
    ? db.prepare("SELECT max(updated_at) AS t FROM mentorships").get().t : null;
  console.log(`\n      Meetings: ${count("meetings")}   Announcements: ${count("announcements")}   Events: ${count("events")}`);
  if (last) console.log(`      Latest change to a mentorship: ${String(last).slice(0, 16).replace("T", " ")}`);

  // --- SETTINGS_SECRET ---------------------------------------------------
  // Same scheme as db/settings.js: AES-256-GCM, key = sha256(SETTINGS_SECRET).
  console.log("");
  const secretRows = has("settings")
    ? db.prepare("SELECT key, value FROM settings WHERE encrypted = 1 AND value IS NOT NULL AND value <> ''").all()
    : [];
  if (!secretRows.length) {
    console.log("  --  No encrypted settings in this backup: SETTINGS_SECRET is not needed for it.");
  } else if (!process.env.SETTINGS_SECRET) {
    console.log(`  !   SETTINGS_SECRET is not set: ${secretRows.length} stored secret(s) (e.g. SMTP password) were not checked.`);
  } else {
    const key = crypto.createHash("sha256").update(process.env.SETTINGS_SECRET).digest();
    let ok = 0;
    for (const r of secretRows) {
      try {
        const [iv, tag, data] = String(r.value).split(".").map(s => Buffer.from(s, "base64"));
        const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
        d.setAuthTag(tag);
        Buffer.concat([d.update(data), d.final()]);   // value is never printed
        ok++;
      } catch { /* wrong secret or damaged value */ }
    }
    if (ok === secretRows.length) {
      console.log(`  OK  SETTINGS_SECRET decrypts all ${ok} stored secret(s) (SMTP password etc.).`);
    } else {
      console.log(`  X   SETTINGS_SECRET decrypts ${ok} of ${secretRows.length} stored secret(s).`);
      console.log("      The data would restore, but SMTP / AI settings would have to be entered again.");
    }
  }
  console.log(line);
  console.log("  The backup file was not changed. Nothing was sent.\n");
} finally {
  if (db) db.close();
  cleanup();
}
