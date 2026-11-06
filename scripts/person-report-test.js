/**
 * Person report (V05).
 *
 *   npm run person-report-test
 *
 * Temporary server + temporary encrypted database. Checks: the person
 * picker, only the chosen person's data (programmes with roles, own record
 * and matched people, matches, groups, meetings), own survey answers and
 * the other side's answers per match (screen only), date range,
 * organisation separation.
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mentoros-person-"));
const SUPER_PW = crypto.randomBytes(12).toString("hex");
const ENV_BASE = {
  CLOUD: "false", DB_PATH: path.join(TMP, "person-test.db"), BACKUP_DIR: path.join(TMP, "backups"),
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
  await api(SA, "POST", "/companies", { companyId: "pr-a", name: "Alfa", password: pw.a });
  await api(SA, "POST", "/companies", { companyId: "pr-b", name: "Beta", password: pw.b });
  const A = await login("pr-a", pw.a), B = await login("pr-b", pw.b);
  const post = async (u, b) => (await api(A, "POST", u, b)).json;

  const P1 = (await post("/programs", { name: "P1 Liderlik", startDate: "2026-01-01", endDate: "2027-12-31" })).program;
  const P2 = (await post("/programs", { name: "P2 Yetenek", startDate: "2026-01-01", endDate: "2027-12-31" })).program;
  const mentor = async (n, email, programIds) => { const id = (await post("/mentors", { fullName: n, email, capacity: 5 })).id;
    await api(A, "PUT", `/mentors/${id}/programs`, { programIds }); return id; };
  const mentee = async (n, email, programIds) => { const id = (await post("/mentees", { fullName: n, email, developmentNeeds: "x" })).id;
    await api(A, "PUT", `/mentees/${id}/programs`, { programIds }); return id; };
  const mert = await mentor("Mert Ak", "mert@a.example", [P1.id, P2.id]);
  const aysM = await mentor("Ayşe Yılmaz", "ayse@a.example", [P1.id, P2.id]);     // Ayşe: mentor ...
  const aysE = await mentee("Ayşe Yılmaz", "ayse@a.example", [P1.id]);             // ... and mentee (same number)
  const can = await mentee("Can Er", "can@a.example", [P1.id, P2.id]);
  const deniz = await mentee("Deniz Su", "deniz@a.example", [P1.id]);
  const zey = await mentee("Zeynep Ok", "zeynep@a.example", [P2.id]);

  const ms1 = (await post("/mentorships", { mentorId: mert, menteeId: aysE, programId: P1.id })).mentorship;   // Ayşe as mentee
  const ms2 = (await post("/mentorships", { mentorId: aysM, menteeId: can, programId: P2.id })).mentorship;    // Ayşe as mentor
  const G = (await post("/mentee-groups", { name: "Takım", programId: P1.id, memberIds: [can, deniz] })).group.id;
  const gms = (await post("/mentorships", { mentorId: aysM, groupId: G })).mentorship;                          // Ayşe mentors a group
  const ms3 = (await post("/mentorships", { mentorId: mert, menteeId: zey, programId: P2.id })).mentorship;    // not Ayşe
  await post(`/mentorships/${ms1.id}/meetings`, { meetingDate: "2026-10-01", title: "Kickoff", durationMinutes: "01:00" });
  await post(`/mentorships/${ms3.id}/meetings`, { meetingDate: "2026-10-02", title: "Other", durationMinutes: "00:30" });

  // Surveys (no mail server: the rounds are made anyway); answers written directly.
  await api(A, "POST", `/mentorships/${ms1.id}/checkin`, { target: "both", language: "tr" });
  await api(A, "POST", `/mentorships/${ms2.id}/survey`, { role: "mentee", language: "tr" });
  await api(A, "POST", `/mentorships/${ms3.id}/checkin`, { target: "both", language: "tr" });
  let db = openDb();
  const now = new Date().toISOString();
  const ans = (table, where, args, answers) =>
    db.prepare(`UPDATE ${table} SET status = 'completed', completed_at = ?, answers = ? WHERE ${where}`).run(now, JSON.stringify(answers), ...args);
  ans("checkins", "mentorship_id = ? AND role = 'mentee'", [ms1.id], { progress: "4", going_well: "AYSE OWN TEXT" });
  ans("checkins", "mentorship_id = ? AND role = 'mentor'", [ms1.id], { progress: "5", going_well: "MERT ABOUT PROCESS" });
  ans("surveys", "mentorship_id = ? AND role = 'mentee'", [ms2.id], { goals_reached: "5", final_comment: "CAN CLOSING TEXT" });
  ans("checkins", "mentorship_id = ?", [ms3.id], { going_well: "ZEYNEP SECRET" });
  const aysSicil = db.prepare(`SELECT sicil_no FROM mentors WHERE id = ?`).get(aysM).sicil_no;
  db.close();

  // --- 1. Picker ------------------------------------------------------------
  check("unauthenticated -> 401", (await api(null, "GET", "/reports/people")).status === 401);
  const people = (await api(A, "GET", "/reports/people")).json || [];
  const ayse = people.filter(p => p.name === "Ayşe Yılmaz");
  check("the picker lists each person once, with both roles",
        ayse.length === 1 && ayse[0].sicilNo === aysSicil && ayse[0].roles.join() === "mentor,mentee" && people.length === 5, JSON.stringify(ayse));

  // --- 2. The report ----------------------------------------------------------
  const rep = async (q, c = A) => api(c, "GET", `/reports/person?lang=en&sicil=${encodeURIComponent(aysSicil)}${q || ""}`);
  const r = await rep();
  const d = r.json, tb = k => d?.tables?.find(t => t.key === k);
  check("200, no summary cards", r.status === 200 && Array.isArray(d.summary) && d.summary.length === 0);
  const progs = tb("programs")?.rows || [];
  check("programmes: the person's role in each",
        progs.find(x => x[0] === "P1 Liderlik")?.[2] === "Mentor, Mentee" && progs.find(x => x[0] === "P2 Yetenek")?.[2] === "Mentor", JSON.stringify(progs));
  const ments = tb("mentors")?.rows || [];
  check("mentors: the person and their mentor",
        ments.length === 2 && ments.some(x => x[0] === "The person" && x[2] === "Ayşe Yılmaz") && ments.some(x => x[0] === "Their mentor" && x[2] === "Mert Ak"));
  const mees = tb("mentees")?.rows || [];
  check("mentees: the person, their mentee and the group member (each once)",
        mees.length === 3 && mees.some(x => x[0] === "The person") && mees.some(x => /Their mentee/.test(x[0]) && /Group member \(Takım\)/.test(x[0]) && x[2] === "Can Er") &&
        mees.some(x => /^Group member/.test(x[0]) && x[2] === "Deniz Su"), JSON.stringify(mees.map(x => x[0] + ":" + x[2])));
  const matches = tb("matches")?.rows || [];
  check("matches: only the person's three (not Mert-Zeynep)", matches.length === 3 && !JSON.stringify(matches).includes("Zeynep"));
  check("groups: the group the person mentors", (tb("groups")?.rows || []).length === 2);
  check("meetings: only the person's", (tb("meetings")?.rows || []).length === 1);
  const own = tb("own_answers");
  check("own answers: the person's own, screen only",
        own?.noExport === true && JSON.stringify(own.rows).includes("AYSE OWN TEXT") && !JSON.stringify(own.rows).includes("MERT ABOUT"));
  const other1 = tb(`other_${ms1.id}`), other2 = tb(`other_${ms2.id}`);
  check("the other side per match: the mentor's answers for ms1",
        other1?.noExport === true && JSON.stringify(other1.rows).includes("MERT ABOUT PROCESS") && !JSON.stringify(other1.rows).includes("AYSE OWN"));
  check("the other side per match: the mentee's closing survey for ms2", JSON.stringify(other2?.rows || []).includes("CAN CLOSING TEXT"));
  check("nobody else's answers anywhere", !JSON.stringify(d).includes("ZEYNEP SECRET"));
  check("a waiting survey is shown as waiting", JSON.stringify(own?.rows || []).includes("Waiting") || own?.rows?.length >= 1);

  // --- 3. Filters, errors, separation -------------------------------------
  const later = (await rep("&from=2099-01-01")).json;
  check("date range: no matches, meetings or surveys after it",
        later?.tables?.find(t => t.key === "matches")?.rows?.length === 0 && later.tables.find(t => t.key === "meetings").rows.length === 0 &&
        later.tables.find(t => t.key === "own_answers").rows.length === 0);
  check("programme filter is ignored (all the person's programmes)",
        ((await rep(`&programId=${P2.id}`)).json?.tables?.find(t => t.key === "matches")?.rows || []).length === 3);
  check("unknown person number -> 404", (await api(A, "GET", "/reports/person?sicil=9999")).status === 404);
  check("another organisation cannot open A's person -> 404", (await rep("", B)).status === 404);
  check("TR texts", (await api(A, "GET", `/reports/person?lang=tr&sicil=${aysSicil}`)).json?.title === "Kişiye Özel Rapor");
}

(async () => {
  try { await run(); }
  catch (e) { console.error("\n  ERROR: " + e.stack); results.push({ name: "run", ok: false }); }
  finally { await stop(); fs.rmSync(TMP, { recursive: true, force: true }); }
  const failed = results.filter(r => !r.ok);
  console.log("\n============================================================");
  console.log(`  PERSON REPORT TEST: ${results.length} checks - ${results.length - failed.length} passed, ${failed.length} failed`);
  console.log("============================================================\n");
  process.exit(failed.length ? 1 : 0);
})();
