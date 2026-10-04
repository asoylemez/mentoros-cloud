/**
 * MentorOS Cloud - DATABASE ENCRYPTION TEST
 *
 * Plays the real upgrade on temporary servers and a temporary database
 * (never a running or live server):
 *
 *   1) a PLAINTEXT database with data and an old plaintext backup
 *   2) first start WITH a key  -> converted, verified, backup deleted
 *   3) the data is all there; nothing readable in the file
 *   4) second start            -> no conversion, works
 *   5) wrong key               -> refuses to start, file untouched
 *   6) CLOUD=true without key  -> refuses to start
 *   7) a downloaded backup is encrypted; db-decrypt gives a readable copy
 *
 *     npm run encryption-test
 */
const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");
const bcrypt = require("bcryptjs");

const ROOT = path.join(__dirname, "..");
const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mentoros-enc-"));
const DB = path.join(TMP, "mentoros.db");
const BACKUPS = path.join(TMP, "yedekler");
const KEY = crypto.randomBytes(32).toString("hex");
const SUPER = crypto.randomBytes(10).toString("hex");
const BASE_ENV = {
  CLOUD: "false",
  DB_PATH: DB,
  BACKUP_DIR: BACKUPS,
  AUTO_BACKUP: "false",
  SUPER_ADMIN_USER: "superadmin",
  ADMIN_PASSWORD_HASH: bcrypt.hashSync(SUPER, 10),
  SETTINGS_SECRET: crypto.randomBytes(32).toString("hex"),
  CUSTOMER_DEPLOYMENT: "true",
  DB_ENCRYPTION_KEY: ""
};

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

/** Starts the server; resolves { child, base, log } once /health answers, or { exited, log }. */
async function start(extraEnv) {
  const port = await freePort();
  const env = { ...process.env, ...BASE_ENV, ...extraEnv, PORT: String(port), SITE_BASE_URL: `http://localhost:${port}` };
  const child = spawn(process.execPath, ["server.js"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let log = "", exited = null;
  child.stdout.on("data", d => { log += d; });
  child.stderr.on("data", d => { log += d; });
  child.on("exit", code => { exited = code; });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && exited === null) {
    try { if ((await fetch(base + "/health")).ok) return { child, base, get log() { return log; } }; } catch { /* not yet */ }
    await new Promise(r => setTimeout(r, 250));
  }
  if (exited === null) child.kill();
  await new Promise(r => setTimeout(r, 300));
  return { exited: exited === null ? "timeout" : exited, log };
}

async function stop(server) {
  server.child.kill();
  await new Promise(r => server.child.on("exit", r));
}

async function login(base, username, password) {
  const r = await fetch(base + "/login", { method: "POST", headers: { "Content-Type": "application/json" },
                                           body: JSON.stringify({ username, password }) });
  return (r.headers.getSetCookie ? r.headers.getSetCookie()[0] : r.headers.get("set-cookie") || "").split(";")[0];
}
async function call(base, cookie, method, url, body) {
  const r = await fetch(base + url, { method, headers: { Cookie: cookie, "Content-Type": "application/json" },
                                      body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch { json = null; }
  return { status: r.status, json };
}

const fileHas = (file, text) => fs.existsSync(file) && fs.readFileSync(file).includes(text);
const plaintext = file => fs.existsSync(file) && fs.readFileSync(file).subarray(0, 15).toString("latin1") === "SQLite format 3";

async function main() {
  // 1) Plaintext database with data -----------------------------------
  console.log("\n1) PLAINTEXT DATABASE (as before this release)\n");
  let s = await start({});
  check("server starts without a key (local)", !!s.child, s.exited !== undefined ? s.log : "");
  const SA = await login(s.base, "superadmin", SUPER);
  await call(s.base, SA, "POST", "/companies", { companyId: "enc", name: "Enc", password: "EncPass12345" });
  const C = await login(s.base, "enc", "EncPass12345");
  for (let i = 1; i <= 25; i++) {
    await call(s.base, C, "POST", "/mentors", { fullName: `Gizli Mentor ${i}`, email: `gizli${i}@enc.example`, role: "Director", capacity: 2 });
  }
  check("health says: not encrypted", (await (await fetch(s.base + "/health")).json()).databaseEncrypted === false);
  await stop(s);
  check("the plaintext file shows names", plaintext(DB) && (fileHas(DB, "Gizli Mentor 7") || fileHas(DB + "-wal", "Gizli Mentor 7")));

  // An old plaintext backup on disk, like the daily ones
  const oldBackup = path.join(BACKUPS, "2026-10-01T03-00-00-oto");
  fs.mkdirSync(oldBackup, { recursive: true });
  fs.copyFileSync(DB, path.join(oldBackup, "mentoros.db"));

  // 2) First start with the key -----------------------------------------
  console.log("\n2) FIRST START WITH THE KEY\n");
  s = await start({ DB_ENCRYPTION_KEY: KEY });
  check("server starts and converts", !!s.child && /database encrypted and verified/.test(s.log), (s.log.match(/encryption:.*$/gm) || []).join(" | "));
  check("the old plaintext backup is deleted", !fs.existsSync(oldBackup) && /plaintext backup\(s\) deleted/.test(s.log));
  check("no plaintext safety copy is left", !fs.existsSync(DB + ".before-encryption"));
  check("health says: encrypted", (await (await fetch(s.base + "/health")).json()).databaseEncrypted === true);

  // 3) The data is all there; nothing readable ----------------------------
  const C2 = await login(s.base, "enc", "EncPass12345");
  const list = (await call(s.base, C2, "GET", "/mentors")).json || [];
  check("all 25 mentors are still there", list.length === 25, `${list.length}`);
  await call(s.base, C2, "POST", "/mentors", { fullName: "Yeni Sonra", email: "yeni@enc.example", role: "VP", capacity: 1 });
  const SA2 = await login(s.base, "superadmin", SUPER);
  const snap = await fetch(s.base + "/backups/snapshot", { method: "POST", headers: { Cookie: SA2 } });
  const snapFile = path.join(TMP, "downloaded.db");
  fs.writeFileSync(snapFile, Buffer.from(await snap.arrayBuffer()));
  check("a downloaded backup is encrypted", snap.status === 200 && !plaintext(snapFile) && !fileHas(snapFile, "Gizli Mentor 7"),
        `HTTP ${snap.status}`);
  await stop(s);
  check("nothing readable in the file or its WAL",
        !plaintext(DB) && !fileHas(DB, "Gizli Mentor") && !fileHas(DB + "-wal", "Gizli Mentor") && !fileHas(DB + "-wal", "Yeni Sonra"));

  // 4) Second start: no conversion -----------------------------------------
  console.log("\n3) LATER STARTS\n");
  s = await start({ DB_ENCRYPTION_KEY: KEY });
  check("second start: no conversion, works", !!s.child && !/encrypting/.test(s.log));
  const C3 = await login(s.base, "enc", "EncPass12345");
  check("data written after the conversion is there", ((await call(s.base, C3, "GET", "/mentors")).json || []).length === 26);
  await stop(s);

  // 5) Wrong key; 6) cloud without key ---------------------------------------
  const sizeBefore = fs.statSync(DB).size;
  s = await start({ DB_ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex") });
  check("wrong key: the server refuses to start", s.exited !== undefined && /key does not match/.test(s.log),
        String(s.exited));
  if (s.child) await stop(s);
  check("... and the file is untouched", fs.statSync(DB).size === sizeBefore && !plaintext(DB));

  s = await start({ CLOUD: "true", DB_ENCRYPTION_KEY: "" });
  check("CLOUD=true without a key: refuses to start", s.exited !== undefined && /DB_ENCRYPTION_KEY is not set/.test(s.log),
        String(s.exited));
  if (s.child) await stop(s);

  s = await start({ DB_ENCRYPTION_KEY: "not-a-hex-key" });
  check("a malformed key: refuses to start", s.exited !== undefined && /64 hexadecimal/.test(s.log), String(s.exited));
  if (s.child) await stop(s);

  // 7) Emergency decryption -------------------------------------------------
  console.log("\n4) EMERGENCY DECRYPTION\n");
  const dec = spawnSync(process.execPath, ["scripts/db-decrypt.js"], {
    cwd: ROOT, env: { ...process.env, ...BASE_ENV, DB_ENCRYPTION_KEY: KEY }, encoding: "utf8"
  });
  const out = DB + ".decrypted";
  check("db-decrypt writes a readable copy", dec.status === 0 && plaintext(out) && fileHas(out, "Yeni Sonra"),
        dec.status === 0 ? "" : dec.stderr || dec.stdout);
  check("... and leaves the live database encrypted", !plaintext(DB));
}

main()
  .catch(err => { console.error("\n  ENCRYPTION TEST COULD NOT RUN:", err.message); results.push({ passed: false, name: "run" }); })
  .finally(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
    const failed = results.filter(r => !r.passed);
    console.log("\n============================================================");
    console.log(`  ENCRYPTION TEST: ${results.length} checks - ${results.length - failed.length} passed, ${failed.length} failed`);
    console.log("============================================================\n");
    if (failed.length) { console.log("  FAILED:"); for (const f of failed) console.log(`    - ${f.name}`); console.log(""); }
    process.exit(failed.length ? 1 : 0);
  });
