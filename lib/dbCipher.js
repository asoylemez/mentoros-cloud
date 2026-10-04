const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3-multiple-ciphers");

/**
 * ====================================================================
 * DATABASE ENCRYPTION  (SQLite3 Multiple Ciphers, ChaCha20-Poly1305)
 * ====================================================================
 *
 * The whole database file - and its backups - are encrypted. Without the
 * key, a copy of the file is just "file is not a database".
 *
 * THE KEY: environment variable DB_ENCRYPTION_KEY, 64 hex characters
 * (create one with `npm run db-key`). On Render it is set under
 * Environment; it is NEVER written to the disk next to the data.
 *
 *   CLOUD=true  -> the key is REQUIRED: without it the server does not
 *                  start (no accidental plaintext in production)
 *   CLOUD=false -> local development: without a key the database stays
 *                  plaintext and a warning is printed
 *
 * IF THE KEY IS LOST, THE DATA CANNOT BE RECOVERED. There is deliberately
 * no recovery path - otherwise the encryption would mean nothing.
 *
 * FIRST START WITH A KEY on a plaintext database: it is converted in
 * place, ONCE, before anything else opens it (encryptExistingFile).
 */

const SQLITE_MAGIC = Buffer.from("SQLite format 3\0", "latin1");

function readKey() {
  const raw = String(process.env.DB_ENCRYPTION_KEY || "").trim();
  if (!raw) return "";
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      "DB_ENCRYPTION_KEY must be 64 hexadecimal characters.\n" +
      "  Create one with:  npm run db-key"
    );
  }
  return raw.toLowerCase();
}

const KEY = readKey();
const enabled = () => !!KEY;

/** True when the file exists and starts with the plaintext SQLite header. */
function isPlaintext(file) {
  if (!fs.existsSync(file) || fs.statSync(file).size < 16) return false;
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    return head.equals(SQLITE_MAGIC);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Opens a database file with the key (when there is one). Every place
 * that opens a database file goes through here - the app, backups,
 * restore and the scripts - so none of them forgets the key.
 */
function open(file, options = {}) {
  const db = new Database(file, options);
  if (KEY) {
    db.pragma(`key='${KEY}'`);      // KEY is validated hex: safe to inline
  }
  try {
    db.prepare("SELECT COUNT(*) AS n FROM sqlite_master").get();
  } catch (err) {
    db.close();
    if (/not a database/i.test(err.message)) {
      throw new Error(
        KEY
          ? `The database could not be opened with DB_ENCRYPTION_KEY: the key does not match this file (${file}).`
          : `The database is encrypted but DB_ENCRYPTION_KEY is not set (${file}).`
      );
    }
    throw err;
  }
  return db;
}

function tableCounts(db) {
  const out = {};
  for (const { name } of db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
  ).all()) {
    out[name] = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n;
  }
  return out;
}

function removeQuietly(file) {
  try { fs.rmSync(file, { force: true }); } catch { /* ignore */ }
}

/**
 * Encrypts a PLAINTEXT database file in place, once.
 *
 *   1) integrity check and row counts of every table (plaintext)
 *   2) checkpoint the WAL into the main file, take a safety copy
 *   3) switch to the classic journal and rekey - REKEY FAILS IN WAL MODE
 *      ("SQL logic error"); the app switches back to WAL on open
 *   4) reopen WITH the key: integrity check, same row counts, header no
 *      longer plaintext
 *   5) success: the plaintext safety copy is deleted
 *      failure: the safety copy is put back and an error is thrown -
 *      the server does not start, no data is lost
 *
 * Runs before the app opens the database, while nothing else writes
 * (on Render a service with a disk stops the old instance first); the
 * file is also held in EXCLUSIVE locking mode during the rekey.
 */
function encryptExistingFile(file, log = console.log) {
  if (!KEY) throw new Error("No DB_ENCRYPTION_KEY - nothing to encrypt with.");
  log(`  encryption: plaintext database found, encrypting ${file} ...`);

  let before;
  {
    const plain = new Database(file);
    try {
      const check = plain.pragma("integrity_check", { simple: true });
      if (check !== "ok") throw new Error(`integrity check failed before encryption: ${check}`);
      plain.pragma("wal_checkpoint(TRUNCATE)");
      before = tableCounts(plain);
    } finally {
      plain.close();
    }
  }

  const safety = `${file}.before-encryption`;
  fs.copyFileSync(file, safety);

  const restore = reason => {
    fs.copyFileSync(safety, file);
    removeQuietly(`${file}-wal`);
    removeQuietly(`${file}-shm`);
    removeQuietly(safety);
    return new Error(
      `Database encryption failed and was undone (${reason}). The database is unchanged and still plaintext.`
    );
  };

  try {
    const db = new Database(file);
    try {
      db.pragma("locking_mode = EXCLUSIVE");
      db.pragma("journal_mode = DELETE");
      db.rekey(Buffer.from(KEY));
    } finally {
      db.close();
    }
  } catch (err) {
    throw restore(err.message);
  }

  try {
    if (isPlaintext(file)) throw new Error("the file is still plaintext");
    const enc = open(file);
    try {
      const check = enc.pragma("integrity_check", { simple: true });
      if (check !== "ok") throw new Error(`integrity check after encryption: ${check}`);
      const after = tableCounts(enc);
      const diff = Object.keys(before).filter(t => before[t] !== after[t]);
      if (diff.length) throw new Error(`row counts differ in ${diff.join(", ")}`);
    } finally {
      enc.close();
    }
  } catch (err) {
    throw restore(err.message);
  }

  removeQuietly(safety);
  const rows = Object.values(before).reduce((a, b) => a + b, 0);
  log(`  encryption: database encrypted and verified (${Object.keys(before).length} tables, ${rows} rows)`);
}

/**
 * Deletes plaintext backups (backup folders whose mentoros.db is not
 * encrypted). Used once, right after the conversion.
 */
function deletePlaintextBackups(backupDir, log = console.log) {
  if (!fs.existsSync(backupDir)) return 0;
  let removed = 0;
  for (const name of fs.readdirSync(backupDir)) {
    const file = path.join(backupDir, name, "mentoros.db");
    if (isPlaintext(file)) {
      fs.rmSync(path.join(backupDir, name), { recursive: true, force: true });
      removed++;
    }
  }
  if (removed) log(`  encryption: ${removed} plaintext backup(s) deleted`);
  return removed;
}

/** Copies .env WITHOUT the key line, so a backup never carries its own key. */
function copyEnvWithoutKey(source, target) {
  const lines = fs.readFileSync(source, "utf8").split(/\r?\n/)
    .filter(l => !/^\s*DB_ENCRYPTION_KEY\s*=/.test(l));
  fs.writeFileSync(target, lines.join("\n"));
}

/**
 * Restores a backed-up .env (which has no key) over the current one,
 * KEEPING the current DB_ENCRYPTION_KEY line - otherwise a restore would
 * leave the encrypted database without its key.
 */
function restoreEnvKeepingKey(backupEnv, targetEnv) {
  const current = fs.existsSync(targetEnv) ? fs.readFileSync(targetEnv, "utf8").split(/\r?\n/) : [];
  const keyLine = current.find(l => /^\s*DB_ENCRYPTION_KEY\s*=/.test(l));
  const lines = fs.readFileSync(backupEnv, "utf8").split(/\r?\n/)
    .filter(l => !/^\s*DB_ENCRYPTION_KEY\s*=/.test(l));
  if (keyLine) lines.push(keyLine);
  fs.writeFileSync(targetEnv, lines.join("\n"));
}

module.exports = { Database, enabled, isPlaintext, open, encryptExistingFile, deletePlaintextBackups,
                   copyEnvWithoutKey, restoreEnvKeepingKey, tableCounts };
