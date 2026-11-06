/**
 * Person number (sicil no) test.
 *
 *   npm run sicil-test
 *
 * Starts a temporary server with a temporary encrypted database (your
 * data is never touched) and checks:
 *   - numbers start at 0001 per organisation and go up
 *   - one number per e-mail (mentor + mentee = same person)
 *   - the same role cannot be registered twice with one e-mail
 *   - numbers never change and are never given again
 *   - existing data (database without the columns) is numbered on start
 *   - the management report shows the numbers
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mentoros-sicil-"));
const SUPER_PW = crypto.randomBytes(12).toString("hex");
const ENV_BASE = {
  CLOUD: "false", DB_PATH: path.join(TMP, "sicil-test.db"), BACKUP_DIR: path.join(TMP, "backups"),
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

// Every field the shipped registration forms can require.
const MENTOR = {
  role: "Director", functionalAreas: ["Strategy"], behaviouralCompetencies: ["Coaching"],
  technicalCompetencies: ["Data analysis"], industries: ["Banking"], experienceAreas: ["Leadership"],
  menteeLevels: ["Specialist"], formats: ["Online"], languages: ["Turkish"], motivations: ["Giving back"],
  careerBio: "Twenty years in banking.", capacity: 2, hoursPerMonth: "4", availability: "Available",
  tenure: "10+", country: "Türkiye", kvkkConsent: true
};
const MENTEE = {
  role: "Analyst", department: "Finance", devFunctionalAreas: ["Strategy"], developmentNeeds: "Grow as a lead",
  competenciesToDevelop: ["Coaching"], goals: "Lead a team", expectations: "Regular meetings", challenge: "Time",
  formats: ["Online"], languages: ["Turkish"], hoursPerMonth: "2", tenure: "1-3", country: "Türkiye",
  preferredMentorProfile: ["Director"], kvkkConsent: true
};

async function run() {
  await start();
  const SA = await login("superadmin", SUPER_PW);
  const pw = { a: crypto.randomBytes(9).toString("hex"), b: crypto.randomBytes(9).toString("hex") };
  for (const id of ["sicil-a", "sicil-b"]) {
    const r = await api(SA, "POST", "/companies", { companyId: id, name: id, password: pw[id.slice(-1)] });
    if (r.status !== 200) throw new Error(`Could not create ${id}: HTTP ${r.status}`);
  }
  const A = await login("sicil-a", pw.a);
  const B = await login("sicil-b", pw.b);
  const token = cookie => api(cookie, "GET", "/invite-link")
    .then(r => new URL(r.json.inviteUrl).searchParams.get("invite"));
  const tokA = await token(A), tokB = await token(B);

  const reg = async (tok, role, body) => {
    const r = await api(null, "POST", `/public/invite/${tok}/${role}s`, { ...(role === "mentor" ? MENTOR : MENTEE), ...body });
    return r;
  };
  const sicilOf = async (cookie, role, id) => (await api(cookie, "GET", `/${role}s/${id}`)).json?.sicilNo;

  // --- 1. Registration forms --------------------------------------------
  let r = await reg(tokA, "mentor", { fullName: "Ayşe Yılmaz", email: "ayse@sicil.example" });
  if (r.status !== 200) throw new Error("Mentor registration failed: " + JSON.stringify(r.json));
  const m1 = r.json.id;
  check("first person of the organisation gets 0001", await sicilOf(A, "mentor", m1) === "0001");
  check("the registration answer does not show the number (only the id)", !("sicilNo" in r.json));

  r = await reg(tokA, "mentee", { fullName: "Bora Kaya", email: "bora@sicil.example" });
  const e1 = r.json?.id;
  check("next person gets 0002", await sicilOf(A, "mentee", e1) === "0002");

  r = await reg(tokA, "mentee", { fullName: "Ayşe Yılmaz", email: "  AYSE@Sicil.example " });
  const e2 = r.json?.id;
  check("mentor registering as mentee keeps her number (e-mail case/spaces ignored)",
        r.status === 200 && await sicilOf(A, "mentee", e2) === "0001");

  r = await reg(tokA, "mentor", { fullName: "Ayşe Yılmaz", email: "ayse@sicil.example" });
  check("second mentor registration with the same e-mail is refused (409)",
        r.status === 409 && r.json?.code === "already_registered");
  r = await reg(tokA, "mentee", { fullName: "Bora K.", email: "BORA@sicil.example" });
  check("second mentee registration with the same e-mail is refused (409)",
        r.status === 409 && r.json?.code === "already_registered");

  r = await reg(tokA, "mentor", { fullName: "Ayşe Yılmaz", email: "ayse.other@sicil.example" });
  const m2 = r.json?.id;
  check("same name, different e-mail = different person (0003)", await sicilOf(A, "mentor", m2) === "0003");

  // --- 2. HR (signed in) ------------------------------------------------
  r = await api(A, "POST", "/mentees", { fullName: "No Mail One" });
  const e3 = r.json?.id;
  r = await api(A, "POST", "/mentees", { fullName: "No Mail Two" });
  const e4 = r.json?.id;
  check("records without e-mail each get their own number (0004, 0005)",
        await sicilOf(A, "mentee", e3) === "0004" && await sicilOf(A, "mentee", e4) === "0005");

  r = await api(A, "POST", "/mentors", { fullName: "Copy", email: "Ayse@sicil.example" });
  check("HR cannot add a second mentor with the same e-mail (409)", r.status === 409 && r.json?.code === "already_registered");

  r = await api(A, "PATCH", `/mentees/${e1}`, { email: "bora.new@sicil.example", sicilNo: "9999" });
  check("changing the e-mail keeps the number; the number cannot be set by hand",
        r.status === 200 && await sicilOf(A, "mentee", e1) === "0002");
  r = await api(A, "PATCH", `/mentees/${e1}`, { email: "ayse@sicil.example" });
  check("HR cannot give a mentee the e-mail of another mentee (409)", r.status === 409);
  r = await api(A, "PATCH", `/mentees/${e1}`, { email: "bora.new@sicil.example", role: "Lead" });
  check("saving a record with its own e-mail is allowed", r.status === 200);

  // Deleting never frees a number
  await api(A, "DELETE", `/mentees/${e4}`);
  r = await reg(tokA, "mentee", { fullName: "Cem Demir", email: "cem@sicil.example" });
  const e5 = r.json?.id;
  check("a deleted person's number is not given again (next is 0006)", await sicilOf(A, "mentee", e5) === "0006");

  // --- 3. Per organisation ----------------------------------------------
  r = await reg(tokB, "mentor", { fullName: "Ayşe Yılmaz", email: "ayse@sicil.example" });
  check("another organisation starts at 0001 (same e-mail allowed there)",
        r.status === 200 && await sicilOf(B, "mentor", r.json.id) === "0001");

  // --- 4. Lists and report ----------------------------------------------
  const list = (await api(A, "GET", "/mentees")).json || [];
  check("the mentee list carries the numbers", list.length === 4 && list.every(m => /^\d{4}$/.test(m.sicilNo)));
  await api(A, "POST", "/mentorships", { mentorId: m1, menteeId: e1, closingDate: "2030-12-31" });
  const rep = (await api(A, "GET", "/reports/management?lang=tr")).json;
  const tb = key => rep?.tables?.find(t => t.key === key);
  check("report: mentors table starts with 'Sicil No'", tb("mentors")?.columns[0] === "Sicil No" &&
        tb("mentors").rows.some(row => row[0] === "0001" && row[1] === "Ayşe Yılmaz"));
  const mrow = tb("matches")?.rows[0] || [];
  check("report: match row has mentor and mentee numbers", mrow[0] === "0001" && mrow[2] === "0002", JSON.stringify(mrow));
  const repEn = (await api(A, "GET", "/reports/management?lang=en")).json;
  check("report (EN): column is 'Person No.'", repEn?.tables?.[0]?.columns[0] === "Person No.");

  // --- 5. Existing data: a database from before this version -------------
  await stop();
  let db = openDb();
  db.exec(`DROP INDEX IF EXISTS idx_mentors_sicil; DROP INDEX IF EXISTS idx_mentees_sicil;
           ALTER TABLE mentors DROP COLUMN sicil_no; ALTER TABLE mentees DROP COLUMN sicil_no;
           ALTER TABLE companies DROP COLUMN sicil_seq;`);
  db.close();
  await start();
  check("start-up log reports the numbering", /person numbers given to \d+ record/.test(serverLog));
  db = openDb();
  const rows = db.prepare(`
    SELECT 'mentor' AS role, email, sicil_no, created_at FROM mentors WHERE company_id = 'sicil-a'
    UNION ALL SELECT 'mentee', email, sicil_no, created_at FROM mentees WHERE company_id = 'sicil-a'
    ORDER BY created_at`).all();
  db.close();
  const key = e => String(e || "").trim().toLowerCase();
  const nums = [...new Set(rows.map(x => x.sicil_no))].sort();
  check("old data: every record has a 4-digit number", rows.length === 6 && rows.every(x => /^\d{4}$/.test(x.sicil_no)));
  // 6 records, 5 people (Ayşe is mentor + mentee); the deleted record is gone.
  check("old data: numbers are 0001..0005 with no gap", nums.join() === ["0001", "0002", "0003", "0004", "0005"].join(), nums.join());
  check("old data: oldest registration is 0001", rows[0].sicil_no === "0001");
  const byMail = new Map();
  let same = true;
  for (const x of rows.filter(x => key(x.email))) {
    if (byMail.has(key(x.email)) && byMail.get(key(x.email)) !== x.sicil_no) same = false;
    byMail.set(key(x.email), x.sicil_no);
  }
  check("old data: mentor and mentee with one e-mail share a number", same && rows.filter(x => key(x.email) === "ayse@sicil.example").length === 2);

  const A2 = await login("sicil-a", pw.a);
  r = await reg(tokA, "mentor", { fullName: "Deniz Ak", email: "deniz@sicil.example" });
  check("after the migration, a new person gets the next number (0006)", await sicilOf(A2, "mentor", r.json?.id) === "0006");
}

(async () => {
  try { await run(); }
  catch (e) { console.error("\n  ERROR: " + e.message); results.push({ name: "run", ok: false }); }
  finally { await stop(); fs.rmSync(TMP, { recursive: true, force: true }); }
  const failed = results.filter(r => !r.ok);
  console.log("\n============================================================");
  console.log(`  SICIL TEST: ${results.length} checks - ${results.length - failed.length} passed, ${failed.length} failed`);
  console.log("============================================================\n");
  process.exit(failed.length ? 1 : 0);
})();
