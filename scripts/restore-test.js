/**
 * MentorOS Cloud - RESTORE AT START-UP TEST (RESTORE_FILE)
 *
 * Plays the emergency guide on temporary servers and a temporary,
 * encrypted database (never a running or live server):
 *
 *   1) a downloaded backup is restored with RESTORE_FILE
 *   2) a restart with RESTORE_FILE still set does NOT restore again
 *   3) the previous database is kept and can be restored back (undo)
 *   4) a daily backup from the backup folder can be restored
 *   5) wrong key / missing file / not a MentorOS file: nothing changes,
 *      the server still starts
 *
 *     npm run restore-test
 */
const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const bcrypt = require("bcryptjs");

const ROOT = path.join(__dirname, "..");
const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mentoros-restore-"));
const DATA = path.join(TMP, "data");
const DB = path.join(DATA, "mentoros.db");
const BACKUPS = path.join(DATA, "yedekler");
const UPLOADS = path.join(DATA, "geri-yukle");
const KEY = crypto.randomBytes(32).toString("hex");
const SUPER = crypto.randomBytes(10).toString("hex");
const BASE_ENV = {
  CLOUD: "true",
  DB_PATH: DB,
  BACKUP_DIR: BACKUPS,
  AUTO_BACKUP: "false",
  SUPER_ADMIN_USER: "superadmin",
  ADMIN_PASSWORD_HASH: bcrypt.hashSync(SUPER, 10),
  SETTINGS_SECRET: crypto.randomBytes(32).toString("hex"),
  CUSTOMER_DEPLOYMENT: "true",
  SECURE_COOKIES: "false",
  DISK_LIMIT_PERCENT: "100",
  DB_ENCRYPTION_KEY: KEY,
  RESTORE_FILE: ""
};

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

async function start(extraEnv = {}) {
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
  if (!server.child) return;
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
async function mentorCount(s) {
  const C = await login(s.base, "rst", "RstPass12345");
  return ((await call(s.base, C, "GET", "/mentors")).json || []).length;
}
async function addMentors(s, from, to) {
  const C = await login(s.base, "rst", "RstPass12345");
  for (let i = from; i <= to; i++) {
    await call(s.base, C, "POST", "/mentors", { fullName: `Mentor ${i}`, email: `m${i}@rst.example`, role: "Director", capacity: 2 });
  }
}
const safetyDirs = () => fs.readdirSync(DATA).filter(n => n.startsWith("geri-yukleme-oncesi-"));

async function main() {
  fs.mkdirSync(UPLOADS, { recursive: true });

  // Data: 5 mentors, a downloaded backup, then 3 more mentors ------------
  console.log("\n1) RESTORE A DOWNLOADED BACKUP\n");
  let s = await start();
  check("server starts (encrypted, no RESTORE_FILE)", !!s.child, s.log);
  const SA = await login(s.base, "superadmin", SUPER);
  await call(s.base, SA, "POST", "/companies", { companyId: "rst", name: "Restore AS", password: "RstPass12345" });
  await addMentors(s, 1, 5);
  const snap = await fetch(s.base + "/backups/snapshot", { method: "POST", headers: { Cookie: SA } });
  const downloaded = path.join(UPLOADS, "mentoros-yedek-indirilen.db");
  fs.writeFileSync(downloaded, Buffer.from(await snap.arrayBuffer()));
  await addMentors(s, 6, 8);
  check("before: 8 mentors live, the downloaded backup has 5", (await mentorCount(s)) === 8 && snap.status === 200);
  await stop(s);
  const downloadedHash = crypto.createHash("sha256").update(fs.readFileSync(downloaded)).digest("hex");

  s = await start({ RESTORE_FILE: downloaded });
  check("start with RESTORE_FILE: the backup is restored", !!s.child && /BACKUP RESTORED/.test(s.log),
        (s.log.match(/restore:.*$|RESTORE NOT DONE.*$/gm) || []).join(" | "));
  check("the log shows before / now counts", /before : .*mentors 8/.test(s.log) && /now {4}: .*mentors 5/.test(s.log));
  check("the data is the backup's (5 mentors), sign-in works", (await mentorCount(s)) === 5);
  check("database is still encrypted", (await (await fetch(s.base + "/health")).json()).databaseEncrypted === true);
  const dirs1 = safetyDirs();
  check("the previous database is kept in geri-yukleme-oncesi-*",
        dirs1.length === 1 && fs.existsSync(path.join(DATA, dirs1[0], "mentoros.db")), dirs1.join(","));
  check("a marker file is written next to the backup", fs.existsSync(downloaded + ".restored"));
  check("the uploaded backup file itself is unchanged",
        crypto.createHash("sha256").update(fs.readFileSync(downloaded)).digest("hex") === downloadedHash);
  await addMentors(s, 9, 9);   // 6 mentors now
  await stop(s);

  // 2) Restart with RESTORE_FILE still set: no second restore ---------------
  console.log("\n2) RESTART WITH RESTORE_FILE STILL SET\n");
  s = await start({ RESTORE_FILE: downloaded });
  check("not restored again; server starts", !!s.child && /RESTORE NOT DONE: .*already restored/.test(s.log));
  check("data written after the restore is kept (6 mentors)", (await mentorCount(s)) === 6);
  check("no second safety copy", safetyDirs().length === 1);
  await stop(s);

  // 3) Undo: restore the database that was moved aside ----------------------
  console.log("\n3) UNDO - RESTORE THE PREVIOUS DATABASE\n");
  const previous = path.join(DATA, dirs1[0], "mentoros.db");
  s = await start({ RESTORE_FILE: previous });
  check("the moved-aside database restores back (8 mentors again)", !!s.child && /BACKUP RESTORED/.test(s.log) && (await mentorCount(s)) === 8);
  await stop(s);

  // 4) A daily backup from the backup folder ---------------------------------
  console.log("\n4) A DAILY BACKUP FROM THE SERVER'S BACKUP FOLDER\n");
  // Same function the server's daily schedule calls (lib/backup-core.js).
  require("child_process").spawnSync(process.execPath, ["-e", "require('./lib/backup-core').createBackup('oto')"],
    { cwd: ROOT, env: { ...process.env, ...BASE_ENV }, encoding: "utf8" });
  const daily = fs.existsSync(BACKUPS) ? fs.readdirSync(BACKUPS).filter(n => fs.existsSync(path.join(BACKUPS, n, "mentoros.db"))) : [];
  check("a daily backup exists in the backup folder", daily.length >= 1, daily.join(","));
  if (daily.length) {
    s = await start();
    await addMentors(s, 10, 11);   // 10 live
    await stop(s);
    s = await start({ RESTORE_FILE: path.join(BACKUPS, daily[0], "mentoros.db") });
    check("the daily backup restores (8 mentors)", !!s.child && /BACKUP RESTORED/.test(s.log) && (await mentorCount(s)) === 8);
    await stop(s);
  }

  // 5) Refusals: nothing changes, the server still starts --------------------
  console.log("\n5) WRONG KEY, MISSING FILE, NOT A MENTOROS FILE\n");
  const dirsBefore = safetyDirs().length;

  {
    // A backup encrypted with ANOTHER key
    const { Database } = require("../lib/dbCipher");
    const f = path.join(UPLOADS, "baska-anahtar.db");
    const db = new Database(f);
    db.pragma(`key='${crypto.randomBytes(32).toString("hex")}'`);
    db.exec("CREATE TABLE companies (x); INSERT INTO companies VALUES (1);");
    db.close();
    s = await start({ RESTORE_FILE: f });
    check("backup with another key: refused, server starts", !!s.child && /RESTORE NOT DONE: DB_ENCRYPTION_KEY does not open/.test(s.log),
          (s.log.match(/RESTORE NOT DONE.*$/m) || [""])[0]);
    check("... current data untouched (8 mentors)", (await mentorCount(s)) === 8);
    await stop(s);
  }
  s = await start({ RESTORE_FILE: path.join(UPLOADS, "yok.db") });
  check("missing file: refused, server starts", !!s.child && /RESTORE NOT DONE: file not found/.test(s.log));
  await stop(s);
  {
    const { Database } = require("../lib/dbCipher");
    const f = path.join(UPLOADS, "baska-uygulama.db");
    const db = new Database(f);
    db.pragma(`key='${KEY}'`);
    db.exec("CREATE TABLE notes (x);");
    db.close();
    s = await start({ RESTORE_FILE: f });
    check("not a MentorOS file: refused, server starts", !!s.child && /RESTORE NOT DONE: this file is not a MentorOS backup/.test(s.log),
          (s.log.match(/RESTORE NOT DONE.*$/m) || [""])[0]);
    check("... current data untouched (8 mentors)", (await mentorCount(s)) === 8);
    await stop(s);
  }
  s = await start({ RESTORE_FILE: DB });
  check("RESTORE_FILE pointing at the live database: refused", !!s.child && /RESTORE NOT DONE: RESTORE_FILE points to the live database/.test(s.log));
  await stop(s);
  check("no safety copies were made by the refused attempts", safetyDirs().length === dirsBefore);
  check("no temporary files left behind", !fs.readdirSync(DATA).some(n => n.includes("restore-check")));
}

main()
  .catch(err => { console.error("\n  RESTORE TEST COULD NOT RUN:", err.stack || err.message); results.push({ passed: false, name: "run" }); })
  .finally(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
    const failed = results.filter(r => !r.passed);
    console.log("\n============================================================");
    console.log(`  RESTORE TEST: ${results.length} checks - ${results.length - failed.length} passed, ${failed.length} failed`);
    console.log("============================================================\n");
    if (failed.length) { console.log("  FAILED:"); for (const f of failed) console.log(`    - ${f.name}`); console.log(""); }
    process.exit(failed.length ? 1 : 0);
  });
