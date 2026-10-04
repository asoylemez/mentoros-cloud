/**
 * EMERGENCY ONLY: writes a DECRYPTED COPY of the database.
 *
 *     npm run db-decrypt
 *
 * Needs DB_ENCRYPTION_KEY and DB_PATH as the server has them. The live
 * database is NOT touched: the copy is written next to it as
 * "<db>.decrypted". Use it only to go back to a version of MentorOS that
 * cannot read encrypted files - and delete the copy as soon as it is no
 * longer needed: it holds everything in plain text.
 *
 * Stop the server first, so the copy includes the latest writes.
 */
require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const cipher = require("../lib/dbCipher");

const DB_FILE = path.resolve(process.env.DB_PATH || "./data/mentoros.db");
const OUT = `${DB_FILE}.decrypted`;

if (!cipher.enabled()) {
  console.error("\n  DB_ENCRYPTION_KEY is not set - nothing to decrypt with.\n");
  process.exit(1);
}
if (!fs.existsSync(DB_FILE)) {
  console.error(`\n  Database not found: ${DB_FILE}\n`);
  process.exit(1);
}
if (cipher.isPlaintext(DB_FILE)) {
  console.error(`\n  The database is not encrypted: ${DB_FILE}\n`);
  process.exit(1);
}

// A consistent single-file copy (encrypted, same key), then rekey the
// COPY to an empty key = plaintext. Rekey does not work in WAL mode.
fs.rmSync(OUT, { force: true });
const src = cipher.open(DB_FILE, { readonly: true });
try {
  src.prepare("VACUUM INTO ?").run(OUT);
} finally {
  src.close();
}
const copy = cipher.open(OUT);
const before = cipher.tableCounts(copy);
copy.pragma("journal_mode = DELETE");
copy.rekey(Buffer.alloc(0));
copy.close();

const check = new cipher.Database(OUT, { readonly: true });
const after = cipher.tableCounts(check);
check.close();

const same = Object.keys(before).every(t => before[t] === after[t]);
if (!cipher.isPlaintext(OUT) || !same) {
  fs.rmSync(OUT, { force: true });
  console.error("\n  Decryption could not be verified; the copy was deleted.\n");
  process.exit(1);
}

console.log(`
  Decrypted copy written (plaintext - handle with care):
      ${OUT}

  Delete it as soon as you no longer need it.
`);
