/**
 * ====================================================================
 * RESTORE A BACKUP AT START-UP  (environment variable RESTORE_FILE)
 * ====================================================================
 *
 * Why at start-up: the database runs in WAL mode, so next to
 * mentoros.db there are -wal and -shm files while the app is running.
 * Copying a backup over the file of a RUNNING app mixes the old WAL
 * into the new file and can corrupt it. Here nothing has opened the
 * database yet, so the swap is safe. (On Render a service with a disk
 * stops the old instance before the new one starts.)
 *
 * HOW (emergency guide: GERI-YUKLEME-KILAVUZU.md):
 *   1. Put the backup on the server's disk, e.g.
 *        /var/data/geri-yukle/mentoros-yedek-....db     (uploaded with scp)
 *        /var/data/yedekler/<name>/mentoros.db          (a daily backup)
 *   2. Set RESTORE_FILE=<that path> in the Environment settings.
 *      Saving restarts the service and the backup is restored.
 *   3. Remove RESTORE_FILE again.
 *
 * WHAT HAPPENS:
 *   - the backup is checked on a temporary copy: it must open with
 *     DB_ENCRYPTION_KEY, pass the integrity check and contain the tables;
 *   - the current database (with its -wal/-shm) is MOVED, not deleted,
 *     to <data folder>/geri-yukleme-oncesi-<time>/ - nothing is lost;
 *   - the checked copy takes its place; the row counts are logged;
 *   - a marker file "<backup>.restored" is written, so a later restart
 *     with RESTORE_FILE still set does NOT restore the same file again.
 *
 * IF ANYTHING IS WRONG (file missing, wrong key, damaged file, already
 * used) nothing is changed: the server starts on the current database
 * and the reason is written to the log in capitals.
 */
const fs = require("fs");
const path = require("path");
const cipher = require("./dbCipher");

const TABLES = ["companies", "mentors", "mentees", "mentorships"];

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function rm(file) {
  try { fs.unlinkSync(file); } catch { /* not there */ }
}

/** Opens a file with the key when it is encrypted, plain when it is not. */
function openForCheck(file) {
  if (cipher.isPlaintext(file)) return new cipher.Database(file);
  return cipher.open(file);
}

function counts(db) {
  const out = {};
  for (const t of TABLES) out[t] = db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n;
  return out;
}

const fmt = c => TABLES.map(t => `${t} ${c[t]}`).join(", ");

/**
 * Runs before the database is opened. Returns a short result object
 * (also used by the tests); never throws - a failed restore must not
 * keep the service down.
 */
function restoreOnBoot(dbPath, log = console.log) {
  const wanted = String(process.env.RESTORE_FILE || "").trim();
  if (!wanted) return { done: false, reason: "not-requested" };

  const src = path.resolve(wanted);
  const marker = `${src}.restored`;
  const say = msg => log(`  restore: ${msg}`);
  const refuse = (reason, msg) => {
    log("");
    log(`  !!! RESTORE NOT DONE: ${msg}`);
    log("  !!! The server starts on the CURRENT database. Nothing was changed.");
    log("");
    return { done: false, reason };
  };

  if (fs.existsSync(marker)) {
    return refuse("already-restored",
      `${src} was already restored (${fs.readFileSync(marker, "utf8").trim()}). Remove RESTORE_FILE from the Environment settings.`);
  }
  if (!fs.existsSync(src)) return refuse("not-found", `file not found: ${src}`);
  if (src === path.resolve(dbPath)) return refuse("same-file", "RESTORE_FILE points to the live database itself.");

  say(`checking ${src} ...`);
  const tmp = `${dbPath}.restore-check`;
  rm(tmp); rm(`${tmp}-wal`); rm(`${tmp}-shm`);
  fs.copyFileSync(src, tmp);
  // A database moved aside by an earlier restore may still have its WAL
  // (the newest writes) next to it: take it along, the checkpoint below
  // merges it into the file.
  if (fs.existsSync(`${src}-wal`)) fs.copyFileSync(`${src}-wal`, `${tmp}-wal`);

  let restored;
  try {
    const db = openForCheck(tmp);
    try {
      const check = db.pragma("integrity_check", { simple: true });
      if (check !== "ok") throw new Error(`integrity check failed: ${check}`);
      restored = counts(db);
      db.pragma("wal_checkpoint(TRUNCATE)");
    } finally {
      db.close();
    }
  } catch (err) {
    rm(tmp); rm(`${tmp}-wal`); rm(`${tmp}-shm`);
    const why = /key does not match|file is not a database/i.test(err.message)
      ? "DB_ENCRYPTION_KEY does not open this backup (was it taken with another key?)."
      : /no such table/i.test(err.message)
        ? "this file is not a MentorOS backup (tables missing)."
        : err.message;
    return refuse("check-failed", why);
  }
  rm(`${tmp}-wal`); rm(`${tmp}-shm`);
  say(`backup is valid: ${fmt(restored)}`);

  // Move the current database aside (same disk: a rename, nothing copied).
  const dataDir = path.dirname(path.resolve(dbPath));
  const safetyDir = path.join(dataDir, `geri-yukleme-oncesi-${stamp()}`);
  const moved = [];
  let current = null;
  try {
    if (fs.existsSync(dbPath)) {
      try {
        const db = cipher.open(dbPath, { readonly: true });
        try { current = counts(db); } finally { db.close(); }
      } catch { /* current database unreadable - that may be why we restore */ }
    }
    fs.mkdirSync(safetyDir, { recursive: true });
    for (const suffix of ["", "-wal", "-shm"]) {
      const f = dbPath + suffix;
      if (fs.existsSync(f)) {
        const to = path.join(safetyDir, path.basename(f));
        fs.renameSync(f, to);
        moved.push([to, f]);
      }
    }
    fs.renameSync(tmp, dbPath);
  } catch (err) {
    // Put everything back exactly as it was.
    for (const [to, from] of moved.reverse()) { try { fs.renameSync(to, from); } catch { /* best effort */ } }
    rm(tmp);
    try { fs.rmdirSync(safetyDir); } catch { /* not empty or gone */ }
    return refuse("swap-failed", `could not swap the files (${err.message}).`);
  }

  const when = new Date().toISOString();
  try {
    fs.writeFileSync(marker, `restored on ${when}\n`);
  } catch (err) {
    say(`WARNING: could not write ${marker} (${err.message}) - REMOVE RESTORE_FILE NOW, otherwise the next restart restores it again.`);
  }

  log("");
  log("  ============================================================");
  log(`  BACKUP RESTORED from ${src}`);
  if (current) log(`    before : ${fmt(current)}`);
  log(`    now    : ${fmt(restored)}`);
  log(`    the previous database is kept in ${safetyDir}`);
  log("  -> Remove RESTORE_FILE from the Environment settings.");
  log("  ============================================================");
  log("");
  return { done: true, safetyDir, before: current, now: restored };
}

module.exports = { restoreOnBoot };
