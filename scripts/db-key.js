/**
 * Creates a new database encryption key (64 hex characters).
 *
 *     npm run db-key
 *
 * Nothing is written anywhere: the key is only printed. Store it in a
 * password manager FIRST, then set it as DB_ENCRYPTION_KEY (on Render:
 * the service's Environment settings; locally: .env).
 *
 * If the key is lost the data cannot be recovered.
 */
const crypto = require("crypto");

const key = crypto.randomBytes(32).toString("hex");

console.log(`
  New database encryption key:

      DB_ENCRYPTION_KEY=${key}

  1) Store it in a password manager NOW. If it is lost, the database
     and its backups cannot be opened by anyone - including you.
  2) Set it as DB_ENCRYPTION_KEY in the server's environment.
  3) Never send it by e-mail or chat, and never commit it to git.
`);
