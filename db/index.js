const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const config = require("../config");
const cipher = require("../lib/dbCipher");
const backupCore = require("../lib/backup-core");

// --- Baglanti ---------------------------------------------------------

const dbPath = path.resolve(config.dbPath);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

// ---------------------------------------------------------------------
// Encryption (lib/dbCipher.js). In the cloud the key is required; a
// plaintext database is converted ONCE, before anything else opens it,
// and the plaintext backups are deleted right after.
// ---------------------------------------------------------------------
if (config.cloud && !cipher.enabled()) {
  throw new Error(
    "DB_ENCRYPTION_KEY is not set. In the cloud (CLOUD=true) the database must be encrypted.\n" +
    "  Create a key with `npm run db-key`, store it safely and set it in the Environment settings."
  );
}
if (cipher.enabled() && cipher.isPlaintext(dbPath)) {
  cipher.encryptExistingFile(dbPath);
  cipher.deletePlaintextBackups(backupCore.BACKUP_DIR);
}
if (!cipher.enabled()) {
  console.warn("  ! DB_ENCRYPTION_KEY is not set: the database is NOT encrypted (local development only).");
}

const db = cipher.open(dbPath);
const encrypted = cipher.enabled();

db.pragma("journal_mode = WAL");   // eszamanli okuma/yazma icin
db.pragma("foreign_keys = ON");    // FK'ler gercekten uygulansin

// --- Sema ------------------------------------------------------------

const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
db.exec(schema);

// --- Yardimcilar ------------------------------------------------------

/** Sirali, tahmin edilemez id. */
function newId() {
  return crypto.randomBytes(12).toString("hex");
}

/** Onay linkleri icin kriptografik token. */
function newToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function now() {
  return new Date().toISOString();
}

/** "Acme Holding A.S." -> "acme-holding-a-s" */
function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** DB'den okunan JSON metin alanini diziye cevirir. */
function parseArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Diziyi DB'ye yazilacak JSON metne cevirir. */
function toJson(value) {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value === undefined || value === null || value === "") return "[]";
  return JSON.stringify([value]);
}

/** snake_case -> camelCase (DB satiri -> API cevabi) */
function camelize(row) {
  if (!row) return null;
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    out[camel] = value;
  }
  return out;
}

/**
 * Kapasite alani eskiden string olabiliyordu ("2-3 mentee" gibi) ve
 * Number() -> NaN dondugu icun butun mentorlar sessizce -50 ceza
 * aliyordu. Artik her girdi guvenli bir tam sayiya zorlaniyor.
 */
function parseCapacity(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  const match = String(value ?? "").match(/\d+/);
  if (!match) return 1;                       // makul varsayilan
  return Math.max(0, parseInt(match[0], 10));
}

module.exports = {
  db,
  encrypted,
  newId,
  newToken,
  now,
  slugify,
  parseArray,
  toJson,
  camelize,
  parseCapacity
};
