/**
 * Name / e-mail change -> copies (V08).
 *
 *   npm run person-sync-test
 *
 * Temporary server + temporary encrypted database. When HR changes a
 * mentor's or mentee's name or e-mail, checks that: the name changes in
 * every match (finished ones too), group membership and survey; the
 * e-mail changes only in active matches, waiting surveys and upcoming
 * events; finished items keep the old address; the person number stays.
 */
const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const bcrypt = require("bcryptjs");

const ROOT = path.join(__dirname, "..");
const KEY = crypto.randomBytes(32).toString("hex");
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? "  -> " + detail : ""}`);
};

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer(); s.unref(); s.on("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mentoros-sync-"));
const SUPER_PW = crypto.randomBytes(12).toString("hex");
const ENV_BASE = {
  CLOUD: "false", DB_PATH: path.join(TMP, "sync-test.db"), BACKUP_DIR: path.join(TMP, "backups"),
  AUTO_BACKUP: "false", SUPER_ADMIN_USER: "superadmin", ADMIN_PASSWORD_HASH: bcrypt.hashSync(SUPER_PW, 10),
  SETTINGS_SECRET: crypto.randomBytes(32).toString("hex"), CUSTOMER_DEPLOYMENT: "true",
  DB_ENCRYPTION_KEY: KEY, DISK_LIMIT_PERCENT: "100", PII_SCRUBBING: "true"
};

let BASE = "", server = null, serverLog = "";
async function start() {
  const port = await freePort();
  serverLog = "";
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    env: { ...process.env, ...ENV_BASE, PORT: String(port), SITE_BASE_URL: `http://localhost:${port}` }
  });
  child.stdout.on("data", d => { serverLog += d; });
  child.stderr.on("data", d => { serverLog += d; });
  BASE = `http://127.0.0.1:${port}`;
  for (const until = Date.now() + 30000; Date.now() < until;) {
    try { if ((await fetch(BASE + "/health")).ok) { server = child; return; } } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  child.kill();
  throw new Error("Temporary server did not start:\n" + serverLog);
}
async function stop() {
  if (!server) return;
  const s = server; server = null;
  await new Promise(r => { s.once("exit", r); s.kill(); });
}

async function api(cookie, method, url, body) {
  const headers = { Accept: "application/json" };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const r = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
async function login(username, password) {
  const r = await fetch(BASE + "/login", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }) });
  const raw = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie()[0] : r.headers.get("set-cookie");
  if (r.status !== 200 || !raw) throw new Error(`Sign-in failed for ${username}: HTTP ${r.status}`);
  return raw.split(";")[0];
}

function openDb() {
  const Database = require("better-sqlite3-multiple-ciphers");
  const db = new Database(ENV_BASE.DB_PATH);
  db.pragma(`key='${KEY}'`);
  return db;
}




async function run() {
  await start();
  const SA = await login("superadmin", SUPER_PW);
  const pw = { a: crypto.randomBytes(9).toString("hex"), b: crypto.randomBytes(9).toString("hex") };
  await api(SA, "POST", "/companies", { companyId: "sy-a", name: "Alfa", password: pw.a });
  await api(SA, "POST", "/companies", { companyId: "sy-b", name: "Beta", password: pw.b });
  const A = await login("sy-a", pw.a);
  const post = async (u, b) => (await api(A, "POST", u, b)).json;

  const mert = (await post("/mentors", { fullName: "Mert Ak", email: "mert@a.example", capacity: 5 })).id;
  const ece = (await post("/mentees", { fullName: "Ece Su", email: "ece@a.example", developmentNeeds: "x" })).id;
  const can = (await post("/mentees", { fullName: "Can Er", email: "can@a.example", developmentNeeds: "x" })).id;
  const ali = (await post("/mentees", { fullName: "Ali Ok", email: "ali@a.example", developmentNeeds: "x" })).id;
  const oya = (await post("/mentors", { fullName: "Oya Tan", email: "oya@a.example", capacity: 5 })).id;
  const deniz = (await post("/mentees", { fullName: "Deniz Su", email: "deniz@a.example", developmentNeeds: "x" })).id;

  // Old, finished matches (one with an answered survey) and a running one.
  // (The same mentor-mentee pair cannot be matched twice: different mentors.)
  const msOld = (await post("/mentorships", { mentorId: oya, menteeId: ece, closingDate: "2030-12-31" })).mentorship;
  const msOld2 = (await post("/mentorships", { mentorId: mert, menteeId: deniz, closingDate: "2030-12-31" })).mentorship;
  await api(A, "POST", `/mentorships/${msOld.id}/survey`, { role: "mentee", language: "tr" });
  let db = openDb();
  db.prepare(`UPDATE mentorships SET status = 'completed' WHERE id IN (?, ?)`).run(msOld.id, msOld2.id);
  db.prepare(`UPDATE surveys SET status = 'completed', completed_at = ? WHERE mentorship_id = ?`).run(new Date().toISOString(), msOld.id);
  db.close();
  const msNow = (await post("/mentorships", { mentorId: mert, menteeId: ece, closingDate: "2030-12-31" })).mentorship;
  await api(A, "POST", `/mentorships/${msNow.id}/checkin`, { target: "both", language: "tr" });
  const G = (await post("/mentee-groups", { name: "Takım", memberIds: [can, ali] })).group.id;
  const gms = (await post("/mentorships", { mentorId: mert, groupId: G, closingDate: "2030-12-31" })).mentorship;
  await api(A, "POST", `/mentorships/${gms.id}/checkin`, { target: "mentee", language: "tr" });

  // Events: one coming up, one in the past (written directly; invitations are not the point here).
  db = openDb();
  const ev = (id, date) => db.prepare(`INSERT INTO events (id, company_id, title, event_date, start_time, ics_uid, created_at, updated_at)
                                       VALUES (?, 'sy-a', 'Etkinlik', ?, '10:00', ?, ?, ?)`).run(id, date, id + "@t", "2026-01-01", "2026-01-01");
  const evp = (id, ev, type, pid, name, email) => db.prepare(`INSERT INTO event_participants (id, event_id, company_id, person_type, person_id, full_name, email, token, created_at)
                                       VALUES (?, ?, 'sy-a', ?, ?, ?, ?, ?, '2026-01-01')`).run(id, ev, type, pid, name, email, "tk" + id);
  ev("evFuture", "2099-06-01"); ev("evPast", "2020-06-01");
  evp("p1", "evFuture", "mentee", ece, "Ece Su", "ece@a.example");
  evp("p2", "evPast", "mentee", ece, "Ece Su", "ece@a.example");
  evp("p3", "evFuture", "mentor", mert, "Mert Ak", "mert@a.example");
  const sicilBefore = db.prepare(`SELECT sicil_no FROM mentees WHERE id = ?`).get(ece).sicil_no;
  db.close();

  // --- 1. Mentee: new surname and new e-mail --------------------------------
  let r = await api(A, "PATCH", `/mentees/${ece}`, { fullName: "Ece Su Yılmaz", email: "ece.yilmaz@a.example" });
  check("saved, with a summary of what else was updated", r.status === 200 && r.json?.synced &&
        r.json.synced.namedMatches === 2 && r.json.synced.activeMatches === 1 && r.json.synced.pendingSurveys === 1 && r.json.synced.upcomingEvents === 1,
        JSON.stringify(r.json?.synced));
  db = openDb();
  const ms = id => db.prepare(`SELECT * FROM mentorships WHERE id = ?`).get(id);
  check("name: changed in the running AND the finished match", ms(msNow.id).mentee_name === "Ece Su Yılmaz" && ms(msOld.id).mentee_name === "Ece Su Yılmaz");
  check("e-mail: changed in the running match only", ms(msNow.id).mentee_email === "ece.yilmaz@a.example" && ms(msOld.id).mentee_email === "ece@a.example");
  const ci = db.prepare(`SELECT * FROM checkins WHERE mentorship_id = ? AND role = 'mentee'`).get(msNow.id);
  const svOld = db.prepare(`SELECT * FROM surveys WHERE mentorship_id = ?`).get(msOld.id);
  check("waiting survey: new name and new e-mail", ci.recipient_name === "Ece Su Yılmaz" && ci.recipient_email === "ece.yilmaz@a.example");
  check("answered survey: new name, old e-mail kept", svOld.recipient_name === "Ece Su Yılmaz" && svOld.recipient_email === "ece@a.example");
  const p = id => db.prepare(`SELECT * FROM event_participants WHERE id = ?`).get(id);
  check("upcoming event: new e-mail; past event: old e-mail (both new name)",
        p("p1").email === "ece.yilmaz@a.example" && p("p2").email === "ece@a.example" && p("p1").full_name === "Ece Su Yilmaz".replace("Yilmaz", "Yılmaz") && p("p2").full_name === "Ece Su Yılmaz");
  check("the mentor's copies are not touched", ms(msNow.id).mentor_email === "mert@a.example" && p("p3").email === "mert@a.example");
  check("the person number does not change", db.prepare(`SELECT sicil_no FROM mentees WHERE id = ?`).get(ece).sicil_no === sicilBefore);
  db.close();
  const ws = (await api(A, "GET", "/mentorships")).json.find(x => x.id === msNow.id);
  check("the HR list shows the new name on the match", ws?.menteeName === "Ece Su Yılmaz");

  // --- 2. Group member --------------------------------------------------------------
  r = await api(A, "PATCH", `/mentees/${can}`, { email: "can.er@a.example" });
  db = openDb();
  const mem = db.prepare(`SELECT * FROM mentorship_members WHERE mentorship_id = ? AND mentee_id = ?`).get(gms.id, can);
  const gci = db.prepare(`SELECT * FROM checkins WHERE mentorship_id = ? AND member_id = ?`).get(gms.id, can);
  const aliCi = db.prepare(`SELECT * FROM checkins WHERE mentorship_id = ? AND member_id = ?`).get(gms.id, ali);
  db.close();
  check("group member: e-mail changed in the group match and the waiting survey",
        mem.email === "can.er@a.example" && gci.recipient_email === "can.er@a.example" && r.json?.synced?.activeMatches === 1);
  check("the other group member is not touched", aliCi.recipient_email === "ali@a.example");

  // --- 3. Mentor -----------------------------------------------------------------------
  r = await api(A, "PATCH", `/mentors/${mert}`, { fullName: "Mert Ak Demir", email: "mert.demir@a.example" });
  db = openDb();
  const mci = db.prepare(`SELECT * FROM checkins WHERE mentorship_id = ? AND role = 'mentor'`).get(msNow.id);
  check("mentor: name in all 3 matches (finished one too), e-mail in the 2 running ones",
        r.json?.synced?.namedMatches === 3 && r.json.synced.activeMatches === 2 &&
        ms(msOld2.id).mentor_name === "Mert Ak Demir" && ms(msOld2.id).mentor_email === "mert@a.example" &&
        ms(gms.id).mentor_email === "mert.demir@a.example", JSON.stringify(r.json?.synced));
  check("mentor: waiting survey and upcoming event get the new e-mail",
        mci.recipient_email === "mert.demir@a.example" && p("p3").email === "mert.demir@a.example");
  db.close();

  // --- 4. Nothing to do / other cases -----------------------------------------------
  r = await api(A, "PATCH", `/mentors/${mert}`, { role: "Director" });
  check("no name / e-mail change -> nothing updated", Object.values(r.json?.synced || {}).every(v => v === 0));
  r = await api(A, "PATCH", `/mentors/${mert}`, { email: "MERT.DEMIR@a.example" });
  check("only upper/lower case differs -> not a change", Object.values(r.json?.synced || {}).every(v => v === 0));
  const B = await login("sy-b", pw.b);
  check("another organisation cannot change A's mentee", (await api(B, "PATCH", `/mentees/${ece}`, { email: "x@b.example" })).status === 404);
}

(async () => {
  try { await run(); }
  catch (e) { console.error("\n  ERROR: " + e.stack); results.push({ name: "run", ok: false }); }
  finally { await stop(); fs.rmSync(TMP, { recursive: true, force: true }); }
  const failed = results.filter(r => !r.ok);
  console.log("\n============================================================");
  console.log(`  PERSON SYNC TEST: ${results.length} checks - ${results.length - failed.length} passed, ${failed.length} failed`);
  console.log("============================================================\n");
  process.exit(failed.length ? 1 : 0);
})();
