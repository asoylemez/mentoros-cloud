/**
 * MentorOS Cloud - TENANT ISOLATION TEST
 *
 * Proves that one organisation can never read, change or delete another
 * organisation's records - not even when it knows the record id.
 *
 * SAFE BY DESIGN: this script never talks to a running or live server.
 * It starts its OWN server process on a free local port, with a brand-new
 * temporary database, a temporary super-admin password and no SMTP or AI
 * settings. Everything is deleted at the end. Running it on a developer
 * machine next to real data is harmless.
 *
 *     npm run tenant-test
 *
 * Exit code 0 = every check passed.
 */
const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const bcrypt = require("bcryptjs");

const ROOT = path.join(__dirname, "..");
const END_DATE = "2030-12-31";   // end date of test matches without a programme
// The temporary server runs ENCRYPTED, like the cloud.
const TEST_KEY = crypto.randomBytes(32).toString("hex");

/** Opens the temporary database directly, with the test key. */
function openDb(file) {
  const Database = require("better-sqlite3-multiple-ciphers");
  const db = new Database(file);
  db.pragma(`key='${TEST_KEY}'`);
  return db;
}
const results = [];

function check(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// ---------------------------------------------------------------------
// Temporary server
// ---------------------------------------------------------------------

async function startServer(extraEnv = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mentoros-tenant-"));
  const port = await freePort();
  const superPassword = crypto.randomBytes(12).toString("hex");

  // Explicit values win over anything in a local .env (dotenv never
  // overrides variables that are already set).
  const env = {
    ...process.env,
    PORT: String(port),
    CLOUD: "false",
    SITE_BASE_URL: `http://localhost:${port}`,
    DB_PATH: path.join(tmp, "tenant-test.db"),
    BACKUP_DIR: path.join(tmp, "backups"),
    AUTO_BACKUP: "false",
    SUPER_ADMIN_USER: "superadmin",
    ADMIN_PASSWORD_HASH: bcrypt.hashSync(superPassword, 10),
    SETTINGS_SECRET: crypto.randomBytes(32).toString("hex"),
    CUSTOMER_DEPLOYMENT: "true",       // ignore any AI key in the environment
    DB_ENCRYPTION_KEY: TEST_KEY,
    // The disk guard is checked on its own (section 15); here it must not
    // depend on how full the machine running the test is.
    DISK_LIMIT_PERCENT: "100",
    ...extraEnv,
    PII_SCRUBBING: "true"
  };

  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true
  });
  let log = "";
  let exited = null;      // exit code, once the server process has stopped
  let spawnError = null;
  child.stdout.on("data", d => { log += d; });
  child.stderr.on("data", d => { log += d; });
  child.on("exit", (code, signal) => { exited = code !== null ? `code ${code}` : `signal ${signal}`; });
  child.on("error", e => { spawnError = e; });

  const base = `http://127.0.0.1:${port}`;
  let lastError = "";
  const deadline = Date.now() + 30000;

  while (Date.now() < deadline && exited === null && !spawnError) {
    try {
      const r = await fetch(base + "/health");
      if (r.ok) return { child, base, tmp, superPassword, dbPath: env.DB_PATH };
      lastError = `/health answered HTTP ${r.status}`;
    } catch (e) {
      lastError = (e.cause && (e.cause.code || e.cause.message)) || e.message;
    }
    await new Promise(r => setTimeout(r, 250));
  }

  if (exited === null) child.kill();
  fs.rmSync(tmp, { recursive: true, force: true });

  const why = spawnError ? `the server process could not be started (${spawnError.message})`
    : exited !== null ? `the server process stopped (${exited})`
    : `the server process is running but did not answer ${base}/health within 30 s (last error: ${lastError || "none"})`;

  throw new Error(
    `Temporary server did not start: ${why}.\n` +
    `  Node ${process.version} on ${process.platform}, port ${port}, folder ${ROOT}\n` +
    `  ----- server output -----\n` +
    (log.trim() ? log : "  (the server printed nothing)\n") +
    `  -------------------------`
  );
}

// ---------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------

let BASE = "";

async function api(cookie, method, url, body) {
  const headers = { Accept: "application/json" };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const r = await fetch(BASE + url, {
    method, headers, redirect: "manual",
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = null;
  try { json = await r.json(); } catch { json = null; }
  return { status: r.status, json };
}

/** First Set-Cookie header (Headers.getSetCookie is missing on older Node). */
function firstSetCookie(r) {
  if (typeof r.headers.getSetCookie === "function") return r.headers.getSetCookie()[0] || "";
  return r.headers.get("set-cookie") || "";
}

async function login(username, password) {
  const r = await fetch(BASE + "/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const cookie = firstSetCookie(r).split(";")[0];
  if (r.status !== 200 || !cookie) throw new Error(`Sign-in failed for ${username}: HTTP ${r.status}`);
  return cookie;
}

// ---------------------------------------------------------------------
// The test
// ---------------------------------------------------------------------

async function main() {
  if (typeof fetch !== "function") {
    throw new Error(`Node ${process.version} is too old: this test needs Node 18 or newer (the project expects 20-22).`);
  }
  const server = await startServer();
  BASE = server.base;

  try {
    await run(server);
  } finally {
    server.child.kill();
    await new Promise(r => setTimeout(r, 300));
    fs.rmSync(server.tmp, { recursive: true, force: true });
  }

  const failed = results.filter(r => !r.passed);
  console.log("\n============================================================");
  console.log(`  TENANT TEST: ${results.length} checks - ${results.length - failed.length} passed, ${failed.length} failed`);
  console.log("============================================================\n");
  if (failed.length) {
    console.log("  FAILED:");
    for (const f of failed) console.log(`    - ${f.name}`);
    console.log("");
  }
  process.exit(failed.length ? 1 : 0);
}

async function run(server) {
  // --- 1. Accounts ---------------------------------------------------
  console.log("\n1) ACCOUNTS AND ROLES\n");

  const SA = await login("superadmin", server.superPassword);
  const pwA = crypto.randomBytes(9).toString("hex");
  const pwB = crypto.randomBytes(9).toString("hex");

  for (const [id, pw] of [["tenant-a", pwA], ["tenant-b", pwB]]) {
    const r = await api(SA, "POST", "/companies", { companyId: id, name: id, password: pw });
    if (r.status !== 200) throw new Error(`Could not create ${id}: HTTP ${r.status}`);
  }
  const A = await login("tenant-a", pwA);
  const B = await login("tenant-b", pwB);

  check("unauthenticated /mentors rejected", (await api(null, "GET", "/mentors")).status === 401);
  check("super admin has no organisation data (/mentors)", (await api(SA, "GET", "/mentors")).status === 401);
  check("organisation cannot list accounts (/companies)", (await api(A, "GET", "/companies")).status === 403);
  check("organisation cannot list backups (/backups)", (await api(A, "GET", "/backups")).status === 403);
  check("super admin can list accounts", (await api(SA, "GET", "/companies")).status === 200);

  // --- 2. Data of organisation A (and a little of B) ------------------
  const mk = async (cookie, url, body) => {
    const r = await api(cookie, "POST", url, body);
    if (r.status !== 200) throw new Error(`Setup ${url} failed: HTTP ${r.status} ${JSON.stringify(r.json)}`);
    return r.json;
  };

  const mentorA = (await mk(A, "/mentors", {
    fullName: "Ayse Mentor", email: "ayse@a.example", role: "Director", capacity: 3
  })).id;
  const menteeA = (await mk(A, "/mentees", {
    fullName: "Ali Mentee", email: "ali@a.example", role: "Analyst",
    developmentNeeds: "Wants to grow as a team lead"
  })).id;
  const menteeA2 = (await mk(A, "/mentees", {
    fullName: "Can Mentee", email: "can@a.example", role: "Engineer",
    developmentNeeds: "Wants to improve presentation skills"
  })).id;
  const msA = (await mk(A, "/mentorships", {
    mentorId: mentorA, menteeId: menteeA, closingDate: END_DATE
  })).mentorshipId;
  const meetingA = (await mk(A, `/mentorships/${msA}/meetings`, {
    meetingDate: "2026-09-01", title: "Kick-off", durationMinutes: "01:20",
    agenda: "PRIVATE AGENDA TEXT",
    actionItems: [{ text: "Read the plan", status: "open" }]
  })).meetingId;

  // An email attempt by A, so A has email history for this mentorship.
  // There is no SMTP: the attempt fails, but it is logged.
  await api(A, "POST", `/email/workspace/${msA}`, { target: "mentee" });

  const mentorB = (await mk(B, "/mentors", {
    fullName: "Bora Mentor", email: "bora@b.example", role: "Manager", capacity: 2
  })).id;
  const menteeB = (await mk(B, "/mentees", {
    fullName: "Banu Mentee", email: "banu@b.example", role: "Specialist",
    developmentNeeds: "Wants to learn negotiation"
  })).id;
  // B's own mentorship - its workspace link is a valid token, but only
  // for B's workspace.
  const wsB = new URL((await mk(B, "/mentorships", {
    mentorId: mentorB, menteeId: menteeB, closingDate: END_DATE
  })).workspaceUrl);
  const msB = wsB.searchParams.get("id");
  const tokenB = wsB.searchParams.get("token");

  // --- 3. Positive controls: A still reaches its own records ----------
  console.log("\n2) OWN RECORDS STILL WORK (positive control)\n");

  const own = [
    ["GET", `/mentors/${mentorA}`],
    ["GET", `/mentees/${menteeA}`],
    ["GET", `/mentorships/${msA}`],
    ["GET", `/mentorships/${msA}/meetings`],
    ["GET", `/mentorships/${msA}/surveys`]
  ];
  for (const [m, u] of own) {
    const r = await api(A, m, u);
    check(`A: ${m} ${u.replace(/[0-9a-f]{24}/g, ":id")} works`, r.status === 200, `HTTP ${r.status}`);
  }
  const histA = await api(A, "GET", `/email/history/${msA}`);
  check("A: own email history visible", histA.status === 200 && histA.json.length >= 1,
        `HTTP ${histA.status}, ${histA.json?.length} row(s)`);

  // AI routes: A passes the ownership check and only stops at "AI not configured".
  const devA = await api(A, "POST", "/development-plan", { mentorshipId: msA });
  check("A: development plan passes ownership (stops at AI setup)", devA.status === 503, `HTTP ${devA.status}`);

  // --- 4. Cross-tenant: B on A's records ------------------------------
  console.log("\n3) ORGANISATION B ON ORGANISATION A's RECORDS (must be 404)\n");

  const cross = [
    ["GET",    `/mentors/${mentorA}`],
    ["PATCH",  `/mentors/${mentorA}`, { role: "CHANGED BY B" }],
    ["GET",    `/mentees/${menteeA}`],
    ["PATCH",  `/mentees/${menteeA}`, { role: "CHANGED BY B" }],
    ["GET",    `/mentorships/${msA}`],
    ["PATCH",  `/mentorships/${msA}/status`, { status: "paused" }],
    ["PATCH",  `/mentorships/${msA}/closing-date`, { closingDate: "2030-01-01" }],
    ["PATCH",  `/mentorships/${msA}/development-plan`, { goals: ["CHANGED BY B"] }],
    ["GET",    `/mentorships/${msA}/meetings`],
    ["POST",   `/mentorships/${msA}/meetings`, { meetingDate: "2026-09-02", title: "B was here" }],
    ["PATCH",  `/mentorships/${msA}/meetings/${meetingA}/action`, { index: 0, status: "done" }],
    ["GET",    `/mentorships/${msA}/surveys`],
    ["POST",   `/mentorships/${msA}/survey`, { role: "mentee" }],
    ["POST",   `/email/workspace/${msA}`, { target: "both" }],
    // Records of A named in the REQUEST BODY
    ["POST",   "/mentorships", { mentorId: mentorA, menteeId: menteeB, closingDate: END_DATE }],
    ["POST",   "/mentorships", { mentorId: mentorB, menteeId: menteeA2, closingDate: END_DATE }],
    ["POST",   "/match", { menteeId: menteeA }],
    ["POST",   "/development-plan", { mentorshipId: msA }],
    ["POST",   "/guided-session", { mentorshipId: msA, step: 1 }],
    // Destructive calls last
    ["DELETE", `/mentorships/${msA}?force=true`],
    ["DELETE", `/mentees/${menteeA}`],
    ["DELETE", `/mentors/${mentorA}?force=true`]
  ];
  for (const [m, u, body] of cross) {
    const r = await api(B, m, u, body);
    const label = u.replace(/[0-9a-f]{24}/g, ":id");
    const extra = body && /mentorId|menteeId|mentorshipId/.test(JSON.stringify(body))
      ? ` (body: ${Object.keys(body).join(", ")})` : "";
    check(`B: ${m} ${label}${extra} -> 404`, r.status === 404, `HTTP ${r.status}`);
  }

  const histB = await api(B, "GET", `/email/history/${msA}`);
  check("B: A's email history not visible", histB.status === 200 && histB.json.length === 0,
        `HTTP ${histB.status}, ${histB.json?.length} row(s)`);

  // --- 4b. Workspace link of B on A's meeting ------------------------
  const pubAct = await api(null, "PATCH",
    `/public/workspace/${msB}/meetings/${meetingA}/action?token=${tokenB}`, { index: 0, status: "done" });
  check("B's workspace link cannot change A's meeting action -> 404", pubAct.status === 404, `HTTP ${pubAct.status}`);

  // --- 4c. Meeting tracking ------------------------------------------
  console.log("\n3b) MEETING TRACKING\n");

  const noDur = await api(A, "POST", `/mentorships/${msA}/meetings`, { meetingDate: "2026-09-05", title: "No duration" });
  check("HR API: meeting note without duration -> 400", noDur.status === 400 && noDur.json?.code === "duration_required",
        `HTTP ${noDur.status}`);
  const badDur = await api(A, "POST", `/mentorships/${msA}/meetings`, { meetingDate: "2026-09-05", title: "Bad", durationMinutes: "12:01" });
  check("HR API: duration over 12:00 -> 400", badDur.status === 400, `HTTP ${badDur.status}`);
  const wsNoDur = await api(null, "POST", `/public/workspace/${msB}/meetings?token=${tokenB}`, { meetingDate: "2026-09-05", title: "No duration" });
  check("workspace: meeting note without duration -> 400", wsNoDur.status === 400 && wsNoDur.json?.code === "duration_required",
        `HTTP ${wsNoDur.status}`);
  const wsOk = await api(null, "POST", `/public/workspace/${msB}/meetings?token=${tokenB}`, { meetingDate: "2026-09-06", title: "B meeting", durationMinutes: 45 });
  check("workspace: meeting note with duration saved", wsOk.status === 200 && wsOk.json?.meeting?.durationMinutes === 45,
        `HTTP ${wsOk.status}`);

  check("unauthenticated /meeting-tracking rejected", (await api(null, "GET", "/meeting-tracking")).status === 401);

  const trA = await api(A, "GET", "/meeting-tracking");
  const rowA = trA.json?.rows?.find(r => r.id === msA);
  check("A: tracking shows its mentorship with 1 meeting, 1 h 20 min",
        trA.status === 200 && rowA && rowA.meetingCount === 1 && rowA.totalMinutes === 80,
        rowA ? `${rowA.meetingCount} meeting(s), ${rowA.totalMinutes} min` : `HTTP ${trA.status}`);
  check("A: tracking counts only A (1 mentorship)", trA.json?.stats?.total === 1, `total ${trA.json?.stats?.total}`);
  const rawA = JSON.stringify(trA.json || {});
  check("A: tracking carries no meeting content (title, agenda, actions)",
        !rawA.includes("Kick-off") && !rawA.includes("PRIVATE AGENDA") && !rawA.includes("Read the plan"));

  const trB = await api(B, "GET", "/meeting-tracking");
  const rawB = JSON.stringify(trB.json || {});
  check("B: tracking shows nothing of A",
        trB.status === 200 && trB.json.stats.total === 1 && !rawB.includes(msA) && !rawB.includes("Ayse") && !rawB.includes("Ali Mentee"),
        `total ${trB.json?.stats?.total}`);
  check("B: tracking shows its own 45 min meeting",
        trB.json?.rows?.[0]?.totalMinutes === 45, `${trB.json?.rows?.[0]?.totalMinutes} min`);

  // --- 5. A's data is exactly as before -------------------------------
  console.log("\n4) ORGANISATION A's DATA IS UNTOUCHED\n");

  const mentor = (await api(A, "GET", `/mentors/${mentorA}`)).json;
  check("A's mentor still exists, unchanged", mentor?.role === "Director", mentor ? mentor.role : "deleted");

  const mentee = (await api(A, "GET", `/mentees/${menteeA}`)).json;
  check("A's mentee still exists, unchanged", mentee?.role === "Analyst", mentee ? mentee.role : "deleted");

  const ms = (await api(A, "GET", `/mentorships/${msA}`)).json;
  check("A's mentorship still active", ms?.status === "active", ms ? ms.status : "deleted");
  check("A's closing date unchanged", ms?.closingDate === END_DATE, ms?.closingDate || "");
  check("A's development plan unchanged", ms && (ms.goals || []).length === 0);
  check("A's meetings unchanged (1 note, action open)",
        ms && (ms.meetings || []).length === 1 && ms.meetings[0].actionItems?.[0]?.status === "open",
        ms ? `${(ms.meetings || []).length} note(s)` : "");

  const listB = (await api(B, "GET", "/mentorships")).json || [];
  check("nothing was created for B from A's records",
        listB.length === 1 && listB[0].id === msB, `${listB.length} mentorship(s)`);

  // --- 6. A's own changes still work ----------------------------------
  console.log("\n5) ORGANISATION A CAN STILL CHANGE ITS OWN RECORDS\n");

  const act = await api(A, "PATCH", `/mentorships/${msA}/meetings/${meetingA}/action`, { index: 0, status: "done" });
  check("A: toggles an action item of its own meeting", act.status === 200 && act.json?.meeting?.actionItems?.[0]?.status === "done",
        `HTTP ${act.status}`);

  const wrongMeeting = await api(A, "PATCH", `/mentorships/${msA}/meetings/${"0".repeat(24)}/action`, { index: 0, status: "done" });
  check("A: unknown meeting id under its mentorship -> 404", wrongMeeting.status === 404, `HTTP ${wrongMeeting.status}`);

  const upd = await api(A, "PATCH", `/mentors/${mentorA}`, { role: "Vice President" });
  check("A: updates its own mentor", upd.status === 200 && upd.json?.mentor?.role === "Vice President", `HTTP ${upd.status}`);

  await directMatchChecks(server, { A, B, mentorA, menteeA, menteeA2, mentorB, msA });

  const foreignProgramId = await programmeChecks(server, { A, B, mentorA, menteeA, menteeA2, mentorB, menteeB, msA });
  await programmeMatchingChecks(server, { SA, B, mentorB, foreignProgramId });
  await groupChecks(server, { SA, B });
  await groupMatchChecks(server, { SA, B, mentorB });
  await checkinChecks(server, { SA, B });
  await announcementChecks(server, { SA, B });
  await attachmentChecks(server, { SA, B });
  await reportChecks(server, { SA, B });

  // The data on disk is encrypted: no name used above appears in the
  // database file or its WAL.
  console.log("\n14) DATA AT REST\n");
  const bytes = ["", "-wal"].map(x => server.dbPath + x).filter(f => fs.existsSync(f)).map(f => fs.readFileSync(f));
  const head = bytes[0].subarray(0, 15).toString("latin1");
  check("the database file is encrypted (no SQLite header)", head !== "SQLite format 3", JSON.stringify(head));
  const leaked = ["Ayse Mentor", "ayse@a.example", "Feride Mentor", "Hedeflere"].filter(t => bytes.some(b => b.includes(t)));
  check("no name or e-mail readable in the file or its WAL", leaked.length === 0, leaked.join(", "));
}

// ---------------------------------------------------------------------
// DIRECT MATCH, NO APPROVAL FLOW (organisation without programmes)
// ---------------------------------------------------------------------

async function directMatchChecks(server, ids) {
  const { A, mentorA, menteeA, menteeA2, msA } = ids;
  console.log("\n5b) DIRECT MATCH (NO APPROVALS)\n");

  const match = body => api(A, "POST", "/mentorships", { language: "en", ...body });
  const noEnd = await match({ mentorId: mentorA, menteeId: menteeA2 });
  check("no programme: end date required -> 400", noEnd.status === 400 && noEnd.json?.code === "closing_date_required",
        `HTTP ${noEnd.status}`);
  const past = await match({ mentorId: mentorA, menteeId: menteeA2, closingDate: "2020-01-01" });
  check("no programme: end date in the past -> 400", past.status === 400 && past.json?.code === "closing_date_required",
        `HTTP ${past.status}`);
  const bad = await match({ mentorId: mentorA, menteeId: menteeA2, closingDate: "2030-02-30" });
  check("no programme: impossible date -> 400", bad.status === 400, `HTTP ${bad.status}`);

  const ok = await match({ mentorId: mentorA, menteeId: menteeA2, closingDate: END_DATE,
                           menteeName: "FAKE NAME", menteeEmail: "fake@evil.example" });
  const ms2 = ok.json?.mentorship;
  check("match opens the mentorship at once", ok.status === 200 && ms2?.status === "active" && !!ok.json?.workspaceUrl,
        `HTTP ${ok.status}`);
  check("... with the mentee's identity from the record (body ignored)",
        ms2?.menteeName === "Can Mentee" && ms2?.menteeEmail === "can@a.example", `${ms2?.menteeName} / ${ms2?.menteeEmail}`);
  check("... and HR's end date", ms2?.closingDate === END_DATE, ms2?.closingDate);

  const mentor2 = (await api(A, "POST", "/mentors", { fullName: "Ikinci Mentor", email: "m2@a.example", capacity: 2 })).json?.id;
  const twice = await match({ mentorId: mentor2, menteeId: menteeA, closingDate: END_DATE });
  check("a mentee with an active mentorship cannot get a second mentor -> 409",
        twice.status === 409 && twice.json?.code === "mentee_already_engaged", `HTTP ${twice.status}`);

  await api(A, "PATCH", `/mentorships/${ms2.id}/status`, { status: "completed" });
  const samePair = await match({ mentorId: mentorA, menteeId: menteeA2, closingDate: END_DATE });
  check("same mentor and mentee again (old mentorship exists) -> 409 pair_exists",
        samePair.status === 409 && samePair.json?.code === "pair_exists", `HTTP ${samePair.status}`);

  const list = (await api(A, "GET", "/mentorships")).json || [];
  const rowA = list.find(m => m.id === msA);
  check("mentorship list shows the match e-mail as not sent (failed attempt does not count)",
        rowA && rowA.workspaceEmailSentAt === "", JSON.stringify(rowA?.workspaceEmailSentAt));

  const page = await fetch(BASE + "/match_approval.html?id=x&type=mentor&token=y");
  const text = await page.text();
  check("an old approval link explains that it is no longer used",
        page.status === 200 && text.includes("artık kullanılmıyor") && text.includes("no longer used"));
}

// ---------------------------------------------------------------------
// MENTORING PROGRAMMES
// ---------------------------------------------------------------------

async function programmeChecks(server, ids) {
  const { A, B, mentorA, menteeA, menteeA2, mentorB, menteeB, msA } = ids;
  console.log("\n6) MENTORING PROGRAMMES\n");

  check("unauthenticated /programs rejected", (await api(null, "GET", "/programs")).status === 401);

  const mkProg = (cookie, body) => api(cookie, "POST", "/programs", body);
  const X = await mkProg(A, { name: "Leadership 2026", startDate: "2026-01-01", endDate: "2026-12-31", description: "Senior track" });
  const Y = await mkProg(A, { name: "Graduate programme", startDate: "2026-03-01", endDate: "2026-09-30" });
  check("A: creates two programmes", X.status === 200 && Y.status === 200, `HTTP ${X.status}/${Y.status}`);
  const pX = X.json?.program?.id, pY = Y.json?.program?.id;

  const bad = [
    [{ startDate: "2026-01-01", endDate: "2026-02-01" }, "name_required"],
    [{ name: "Z", startDate: "2026-05-01", endDate: "2026-04-01" }, "end_before_start"],
    [{ name: "Z", startDate: "2026-02-30", endDate: "2026-04-01" }, "dates_required"],
    [{ name: "leadership 2026", startDate: "2026-01-01", endDate: "2026-02-01" }, "name_taken"]
  ];
  for (const [body, code] of bad) {
    const r = await mkProg(A, body);
    check(`programme validation: ${code} -> 400`, r.status === 400 && r.json?.code === code, `HTTP ${r.status} ${r.json?.code}`);
  }

  // Organisation B cannot touch A's programmes
  const listB = (await api(B, "GET", "/programs")).json || [];
  check("B: does not see A's programmes", listB.length === 0, `${listB.length} programme(s)`);
  for (const [m, u, body] of [
    ["PATCH",  `/programs/${pX}`, { name: "CHANGED BY B" }],
    ["PATCH",  `/programs/${pX}`, { archived: true }],
    ["DELETE", `/programs/${pX}`],
    ["PUT",    `/mentors/${mentorB}/programs`, { programIds: [pX] }],
    ["PUT",    `/mentees/${menteeB}/program`, { programId: pX }],
    ["PUT",    `/mentors/${mentorA}/programs`, { programIds: [] }],
    ["PUT",    `/mentees/${menteeA2}/program`, { programId: "" }]
  ]) {
    const r = await api(B, m, u, body);
    check(`B: ${m} ${u.replace(/[0-9a-f]{24}/g, ":id")} -> 404`, r.status === 404, `HTTP ${r.status}`);
  }

  // Placing people
  const pm = await api(A, "PUT", `/mentors/${mentorA}/programs`, { programIds: [pX, pY] });
  check("A: mentor placed in two programmes",
        pm.status === 200 && pm.json?.mentor?.programIds?.length === 2, `HTTP ${pm.status}`);

  const engaged = await api(A, "PUT", `/mentees/${menteeA}/program`, { programId: pX });
  check("A: moving a mentee with an active mentorship warns first (409)",
        engaged.status === 409 && engaged.json?.code === "mentee_engaged", `HTTP ${engaged.status}`);
  const forced = await api(A, "PUT", `/mentees/${menteeA}/program?force=true`, { programId: pX });
  check("A: ... and is placed after confirming", forced.status === 200 && forced.json?.mentee?.programId === pX,
        `HTTP ${forced.status}`);
  const free = await api(A, "PUT", `/mentees/${menteeA2}/program`, { programId: pY });
  check("A: free mentee placed without warning", free.status === 200 && free.json?.mentee?.programId === pY,
        `HTTP ${free.status}`);

  const progs = (await api(A, "GET", "/programs")).json || [];
  const rx = progs.find(p => p.id === pX), ry = progs.find(p => p.id === pY);
  check("A: programme head counts are right",
        rx?.mentorCount === 1 && rx?.menteeCount === 1 && ry?.mentorCount === 1 && ry?.menteeCount === 1,
        `X ${rx?.mentorCount}/${rx?.menteeCount}, Y ${ry?.mentorCount}/${ry?.menteeCount}`);
  check("A: status is worked out from the dates", rx?.status === (new Date().toISOString().slice(0, 10) > "2026-12-31" ? "ended" : "active"),
        rx?.status);

  // Archive
  const arch = await api(A, "PATCH", `/programs/${pY}`, { archived: true });
  check("A: archives a programme", arch.status === 200 && arch.json?.program?.status === "archived", `HTTP ${arch.status}`);
  const keep = await api(A, "PUT", `/mentors/${mentorA}/programs`, { programIds: [pX, pY] });
  check("A: a mentor may stay in an archived programme", keep.status === 200, `HTTP ${keep.status}`);
  const mentorC = (await api(A, "POST", "/mentors", { fullName: "Cem Mentor", email: "cem@a.example", capacity: 1 })).json?.id;
  const addArch = await api(A, "PUT", `/mentors/${mentorC}/programs`, { programIds: [pY] });
  check("A: an archived programme cannot be newly assigned -> 400",
        addArch.status === 400 && addArch.json?.code === "program_archived", `HTTP ${addArch.status}`);

  // Direct database checks (this test owns the temporary database)
  const db = openDb(server.dbPath);
  try {
    // Deleting a mentor removes the programme membership (KVKK)
    await api(A, "PUT", `/mentors/${mentorC}/programs`, { programIds: [pX] });
    const before = db.prepare(`SELECT COUNT(*) n FROM program_mentors WHERE mentor_id = ?`).get(mentorC).n;
    await api(A, "DELETE", `/mentors/${mentorC}?force=true`);
    const after = db.prepare(`SELECT COUNT(*) n FROM program_mentors WHERE mentor_id = ?`).get(mentorC).n;
    check("deleting a mentor removes its programme membership", before === 1 && after === 0, `${before} -> ${after}`);

    // One mentorship per pair PER PROGRAMME
    const row = db.prepare(`SELECT * FROM mentorships WHERE id = ?`).get(msA);
    const clone = (id, programId) => db.prepare(`
      INSERT INTO mentorships (id, company_id, mentor_id, mentee_id, program_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'completed', ?, ?)`).run(id, row.company_id, row.mentor_id, row.mentee_id, programId, row.created_at, row.created_at);
    let samePairSameProgram = false;
    try { clone("dup".padEnd(24, "0"), row.program_id); } catch { samePairSameProgram = true; }
    check("the same pair cannot have two mentorships in the same programme", samePairSameProgram);
    let otherProgramOk = true;
    try { clone("oth".padEnd(24, "0"), pY); } catch { otherProgramOk = false; }
    check("the same pair can have a mentorship in another programme", otherProgramOk);

    // A programme in use cannot be deleted, only archived
    const inUse = await api(A, "DELETE", `/programs/${pY}`);
    check("a programme with a mentorship cannot be deleted -> 409",
          inUse.status === 409 && inUse.json?.code === "program_in_use", `HTTP ${inUse.status}`);
    db.prepare(`DELETE FROM mentorships WHERE id = ?`).run("oth".padEnd(24, "0"));
  } finally {
    db.close();
  }

  // Deleting an empty programme: people are kept
  const delX = await api(A, "DELETE", `/programs/${pX}`);
  const mentorAfter = (await api(A, "GET", `/mentors/${mentorA}`)).json;
  const menteeAfter = (await api(A, "GET", `/mentees/${menteeA}`)).json;
  check("A: deletes an empty programme", delX.status === 200, `HTTP ${delX.status}`);
  check("... the mentor is kept, without that programme",
        mentorAfter?.id === mentorA && !mentorAfter.programIds.includes(pX) && mentorAfter.programIds.includes(pY));
  check("... the mentee is kept, now not assigned", menteeAfter?.id === menteeA && menteeAfter.programId === "",
        JSON.stringify(menteeAfter?.programId));

  return pY;   // an (archived) programme of A, used as "another organisation's programme"
}

// ---------------------------------------------------------------------
// MATCHING INSIDE A PROGRAMME
// ---------------------------------------------------------------------

async function programmeMatchingChecks(server, ids) {
  const { SA, B, mentorB, foreignProgramId } = ids;
  console.log("\n7) MATCHING INSIDE A PROGRAMME\n");

  // A fresh organisation C that works with programmes.
  const pwC = crypto.randomBytes(9).toString("hex");
  await api(SA, "POST", "/companies", { companyId: "tenant-c", name: "tenant-c", password: pwC });
  const C = await login("tenant-c", pwC);
  const post = async (url, body) => (await api(C, "POST", url, body)).json;

  const P1 = (await post("/programs", { name: "P1 Leadership", startDate: "2026-01-01", endDate: "2026-12-31" })).program;
  const P2 = (await post("/programs", { name: "P2 Graduates", startDate: "2026-01-01", endDate: "2027-06-30" })).program;
  const P3 = (await post("/programs", { name: "P3 Old", startDate: "2025-01-01", endDate: "2025-06-30" })).program;
  check("C: programme statuses (running, running, ended)",
        P1?.status === "active" && P2?.status === "active" && P3?.status === "ended",
        `${P1?.status}/${P2?.status}/${P3?.status}`);

  const mentor = async (name, programIds) => {
    const id = (await post("/mentors", { fullName: name, email: `${name.toLowerCase()}@c.example`, role: "Director", capacity: 3 })).id;
    await api(C, "PUT", `/mentors/${id}/programs`, { programIds });
    return id;
  };
  const mentee = async (name, programId) => {
    const id = (await post("/mentees", { fullName: name, email: `${name.toLowerCase()}@c.example`, role: "Analyst",
                                        developmentNeeds: `${name} wants to grow` })).id;
    if (programId) await api(C, "PUT", `/mentees/${id}/program`, { programId });
    return id;
  };
  const m1 = await mentor("Mert", [P1.id]);
  const m2 = await mentor("Nazli", [P2.id]);
  const m3 = await mentor("Ozan", [P1.id, P2.id]);
  const e1 = await mentee("Ece", P1.id);
  const e2 = await mentee("Emre", "");
  const e3 = await mentee("Elif", P3.id);
  const e4 = await mentee("Eda", P1.id);
  const e5 = await mentee("Erol", P2.id);

  // Candidate lists
  const noProg = await api(C, "GET", "/matching-candidates");
  check("candidates without a programme -> 400 program_required",
        noProg.status === 400 && noProg.json?.code === "program_required", `HTTP ${noProg.status}`);
  const c1 = (await api(C, "GET", `/matching-candidates?programId=${P1.id}`)).json || {};
  const ids1 = x => (x || []).map(r => r.id).sort().join(",");
  check("candidates of P1: only P1's mentees", ids1(c1.mentees) === [e1, e4].sort().join(","),
        (c1.mentees || []).map(m => m.fullName).join(", "));
  check("candidates of P1: only P1's mentors", ids1(c1.mentors) === [m1, m3].sort().join(","),
        (c1.mentors || []).map(m => m.fullName).join(", "));
  const c3 = await api(C, "GET", `/matching-candidates?programId=${P3.id}`);
  check("candidates of an ended programme -> 400 program_closed",
        c3.status === 400 && c3.json?.code === "program_closed", `HTTP ${c3.status}`);
  const cf = await api(C, "GET", `/matching-candidates?programId=${foreignProgramId}`);
  check("candidates of another organisation's programme -> 404", cf.status === 404, `HTTP ${cf.status}`);

  // AI suggestions: the rule is checked before the AI (not configured here -> 503)
  const ai = async menteeId => api(C, "POST", "/match", { menteeId, language: "en" });
  const aiE2 = await ai(e2);
  check("AI match: mentee without a programme -> 400 program_not_assigned",
        aiE2.status === 400 && aiE2.json?.code === "program_not_assigned", `HTTP ${aiE2.status}`);
  const aiE3 = await ai(e3);
  check("AI match: mentee in an ended programme -> 400 program_closed",
        aiE3.status === 400 && aiE3.json?.code === "program_closed", `HTTP ${aiE3.status}`);
  const aiE1 = await ai(e1);
  check("AI match: placed mentee passes the rule (stops at AI setup)", aiE1.status === 503, `HTTP ${aiE1.status}`);
  const aiFree = await api(C, "POST", "/match", { developmentNeeds: "typed in", language: "en" });
  check("AI match: typed-in mentee in a programme organisation -> 400",
        aiFree.status === 400 && aiFree.json?.code === "program_mentee_required", `HTTP ${aiFree.status}`);

  // Direct matches (no approval flow)
  const match = (mentorId, menteeId, extra = {}) =>
    api(C, "POST", "/mentorships", { mentorId, menteeId, language: "en", ...extra });
  const wrong = await match(m2, e1);
  check("match: mentor not in the mentee's programme -> 400 mentor_not_in_program",
        wrong.status === 400 && wrong.json?.code === "mentor_not_in_program", `HTTP ${wrong.status}`);
  const typed = await match(m1, `mentee_${Date.now()}`, { menteeName: "Typed In", developmentNeed: "x" });
  check("match: typed-in mentee in a programme organisation -> 400",
        typed.status === 400 && typed.json?.code === "program_mentee_required", `HTTP ${typed.status}`);
  const r1 = await match(m1, e1, { closingDate: "2099-01-01" /* ignored with a programme */ });
  const ms1 = r1.json?.mentorship;
  check("match: mentor and mentee in the same programme -> mentorship opens", r1.status === 200 && !!ms1, `HTTP ${r1.status}`);
  check("match: in the mentee's programme, ends with the programme",
        ms1?.programId === P1.id && ms1?.closingDate === "2026-12-31", `${ms1?.programId} / ${ms1?.closingDate}`);
  check("match: identity comes from the records, not the body",
        ms1?.menteeName === "Ece" && ms1?.mentorName === "Mert" && ms1?.menteeEmail === "ece@c.example", ms1?.menteeName);
  const again = await match(m3, e1);
  check("match: a mentee with an active mentorship -> 409", again.status === 409 && again.json?.code === "mentee_already_engaged",
        `HTTP ${again.status}`);

  const dOk = await match(m3, e4, { programId: P2.id /* ignored */ });
  const ms4 = dOk.json?.mentorship;
  check("match: programme taken from the mentee, not the body",
        dOk.status === 200 && ms4?.programId === P1.id, `HTTP ${dOk.status} ${ms4?.programId === P2.id ? "(body programme used!)" : ""}`);

  const wsUrl = new URL(r1.json.workspaceUrl);
  const wsData = (await api(null, "GET", `/public/workspace/${wsUrl.searchParams.get("id")}?token=${wsUrl.searchParams.get("token")}`)).json;
  check("workspace shows the programme name", wsData?.programName === "P1 Leadership", wsData?.programName);

  const r5 = await match(m2, e5);
  check("match in P2", r5.status === 200, `HTTP ${r5.status}`);
  const e6 = await mentee("Ezgi", P2.id);
  await api(C, "PATCH", `/programs/${P2.id}`, { archived: true });
  const closedNew = await match(m2, e6);
  check("archived programme: new match refused -> 400 program_closed",
        closedNew.status === 400 && closedNew.json?.code === "program_closed", `HTTP ${closedNew.status}`);
  await api(C, "PATCH", `/programs/${P2.id}`, { archived: false });

  // The approval flow is gone
  check("old approval endpoints are gone (404)",
        (await api(C, "POST", "/match-request", { mentorId: m1, menteeId: e4 })).status === 404 &&
        (await api(C, "GET", "/match-requests")).status === 404 &&
        (await api(null, "GET", `/public/approval/${ms1?.id}?type=mentor&token=x`)).status === 404);

  // Meeting tracking filter
  const trP1 = (await api(C, "GET", `/meeting-tracking?programId=${P1.id}`)).json;
  const trP2 = (await api(C, "GET", `/meeting-tracking?programId=${P2.id}`)).json;
  const trNone = (await api(C, "GET", `/meeting-tracking?programId=none`)).json;
  const trAll = (await api(C, "GET", "/meeting-tracking")).json;
  check("meeting tracking filters by programme",
        trP1?.stats?.total === 2 && trP2?.stats?.total === 1 && trNone?.stats?.total === 0 && trAll?.stats?.total === 3,
        `P1 ${trP1?.stats?.total}, P2 ${trP2?.stats?.total}, none ${trNone?.stats?.total}, all ${trAll?.stats?.total}`);
  check("meeting tracking rows carry their programme",
        (trP1?.rows || []).every(r => r.programId === P1.id));

  // Mentor leaving a programme where they have an active mentorship
  const leave = await api(C, "PUT", `/mentors/${m3}/programs`, { programIds: [P2.id] });
  check("mentor leaving a programme with active mentorships warns first (409)",
        leave.status === 409 && leave.json?.code === "mentor_has_mentorships_in_program", `HTTP ${leave.status}`);
  const left = await api(C, "PUT", `/mentors/${m3}/programs?force=true`, { programIds: [P2.id] });
  const ms4After = (await api(C, "GET", `/mentorships/${ms4.id}`)).json;
  check("... after confirming, the mentorship keeps running in its programme",
        left.status === 200 && ms4After?.status === "active" && ms4After?.programId === P1.id,
        `${ms4After?.status} / ${ms4After?.programId === P1.id ? "P1" : ms4After?.programId}`);

  const delP1 = await api(C, "DELETE", `/programs/${P1.id}`);
  check("programme with mentorships cannot be deleted -> 409", delP1.status === 409, `HTTP ${delP1.status}`);

  // Organisation WITHOUT programmes: unchanged, typed-in mentees included
  const bTyped = await api(B, "POST", "/mentorships", { mentorId: mentorB, closingDate: END_DATE,
    menteeId: `mentee_${Date.now()}`, menteeName: "Typed In", menteeEmail: "typed@b.example", developmentNeed: "x" });
  check("no programmes: typed-in mentee can be matched", bTyped.status === 200, `HTTP ${bTyped.status}`);
  check("no programmes: the mentorship has no programme, ends on HR's date",
        bTyped.json?.mentorship?.programId === "" && bTyped.json?.mentorship?.closingDate === END_DATE,
        `${JSON.stringify(bTyped.json?.mentorship?.programId)} / ${bTyped.json?.mentorship?.closingDate}`);
  const bCand = await api(B, "GET", "/matching-candidates");
  check("no programmes: candidates without a programme id", bCand.status === 200 && bCand.json?.program === null, `HTTP ${bCand.status}`);
}

// ---------------------------------------------------------------------
// MENTEE GROUPS (stage 3a)
// ---------------------------------------------------------------------

async function groupChecks(server, ids) {
  const { SA, B } = ids;
  console.log("\n8) MENTEE GROUPS\n");

  check("unauthenticated /mentee-groups rejected", (await api(null, "GET", "/mentee-groups")).status === 401);

  const pwD = crypto.randomBytes(9).toString("hex");
  await api(SA, "POST", "/companies", { companyId: "tenant-d", name: "tenant-d", password: pwD });
  const D = await login("tenant-d", pwD);
  const post = async (cookie, url, body) => (await api(cookie, "POST", url, body)).json;

  const PX = (await post(D, "/programs", { name: "PX", startDate: "2026-01-01", endDate: "2026-12-31" })).program.id;
  const PY = (await post(D, "/programs", { name: "PY", startDate: "2026-01-01", endDate: "2026-12-31" })).program.id;
  const PZ = (await post(D, "/programs", { name: "PZ", startDate: "2026-01-01", endDate: "2026-12-31" })).program.id;
  await api(D, "PATCH", `/programs/${PZ}`, { archived: true });

  const mentee = async (cookie, name, programId) => {
    const id = (await post(cookie, "/mentees", { fullName: name, email: `${name.toLowerCase()}@d.example`, role: "Analyst",
                                               developmentNeeds: `${name} wants to grow` })).id;
    if (programId) await api(cookie, "PUT", `/mentees/${id}/program`, { programId });
    return id;
  };
  const many = [];
  for (let i = 1; i <= 11; i++) many.push(await mentee(D, `Uye${i}`, PX));
  const [a1, a2, a3] = many;
  const b1 = await mentee(D, "Baris", PY);
  const c1 = await mentee(D, "Ceren", PX);
  const mx = (await post(D, "/mentors", { fullName: "Mentor X", email: "mx@d.example", role: "Director", capacity: 5 })).id;
  await api(D, "PUT", `/mentors/${mx}/programs`, { programIds: [PX] });
  await api(D, "POST", "/mentorships", { mentorId: mx, menteeId: c1 });

  const mk = body => api(D, "POST", "/mentee-groups", body);
  const expect = async (label, body, status, code) => {
    const r = await mk(body);
    check(label, r.status === status && r.json?.code === code, `HTTP ${r.status} ${r.json?.code || ""}`);
  };
  await expect("group without a programme -> 400", { name: "G0", memberIds: [a1, a2] }, 400, "group_program_required");
  await expect("group with 1 member -> 400", { name: "G0", programId: PX, memberIds: [a1] }, 400, "group_size");
  await expect("group with 11 members -> 400", { name: "G0", programId: PX, memberIds: many }, 400, "group_size");
  await expect("member from another programme -> 400", { name: "G0", programId: PX, memberIds: [a1, b1] }, 400, "member_wrong_program");
  await expect("member with an individual mentorship -> 409", { name: "G0", programId: PX, memberIds: [a1, c1] }, 409, "member_engaged");
  await expect("group in an archived programme -> 400", { name: "G0", programId: PZ, memberIds: [a1, a2] }, 400, "program_archived");
  await expect("group without a name -> 400", { name: " ", programId: PX, memberIds: [a1, a2] }, 400, "group_name_required");

  const g1r = await mk({ name: "Yeni Yoneticiler", programId: PX, memberIds: [a1, a2] });
  const G1 = g1r.json?.group;
  check("creates a group of 2 in its programme", g1r.status === 200 && G1?.programId === PX && G1?.memberIds?.length === 2,
        `HTTP ${g1r.status}`);
  const a1rec = (await api(D, "GET", `/mentees/${a1}`)).json;
  check("a member shows its group", a1rec?.groupId === G1?.id && a1rec?.groupName === "Yeni Yoneticiler");
  await expect("a mentee can be in only one group -> 409", { name: "G2", programId: PX, memberIds: [a1, a3] }, 409, "member_in_other_group");
  await expect("group name is unique (any case) -> 400", { name: "yeni yoneticiler", programId: PX, memberIds: [a3, many[3]] }, 400, "group_name_taken");

  const lock = await api(D, "PATCH", `/mentee-groups/${G1.id}`, { programId: PY });
  check("a group's programme cannot change -> 400", lock.status === 400 && lock.json?.code === "group_program_locked", `HTTP ${lock.status}`);
  const grow = await api(D, "PATCH", `/mentee-groups/${G1.id}`, { memberIds: [a1, a2, a3] });
  check("adds a member", grow.status === 200 && grow.json?.group?.memberIds?.length === 3, `HTTP ${grow.status}`);
  const shrink = await api(D, "PATCH", `/mentee-groups/${G1.id}`, { name: "Yeni Yoneticiler 2026", memberIds: [a1, a3] });
  const a2rec = (await api(D, "GET", `/mentees/${a2}`)).json;
  check("removes a member and renames", shrink.status === 200 && shrink.json?.group?.name === "Yeni Yoneticiler 2026" && a2rec?.groupId === "",
        `HTTP ${shrink.status}`);

  // A group member is never matched alone (every route)
  const alone = [
    ["POST", "/mentorships", { mentorId: mx, menteeId: a1 }],
    ["POST", "/match", { menteeId: a1, language: "en" }]
  ];
  for (const [m, u, body] of alone) {
    const r = await api(D, m, u, body);
    check(`group member alone: ${m} ${u} -> 409`, r.status === 409 && r.json?.code === "mentee_in_group", `HTTP ${r.status} ${r.json?.code || ""}`);
  }
  const cand = (await api(D, "GET", `/matching-candidates?programId=${PX}`)).json;
  const a1c = (cand?.mentees || []).find(m => m.id === a1);
  check("matching list marks a group member as in a group", a1c?.engagement?.state === "in_group" && a1c?.engagement?.engaged === true,
        JSON.stringify(a1c?.engagement));
  const move = await api(D, "PUT", `/mentees/${a1}/program?force=true`, { programId: PY });
  check("a group member cannot change programme (even with force) -> 409",
        move.status === 409 && move.json?.code === "mentee_in_group", `HTTP ${move.status}`);

  const gc = (await api(D, "GET", `/mentee-groups/candidates?programId=${PX}`)).json;
  const st = id => (gc?.mentees || []).find(m => m.id === id);
  check("group candidates: only the programme's mentees, with their state",
        st(a1)?.groupId === G1.id && st(c1)?.state === "matched" && !st(b1),
        `${gc?.mentees?.length} listed`);

  // Organisation B cannot touch D's groups
  const listB = (await api(B, "GET", "/mentee-groups")).json || [];
  check("B: does not see D's groups", !listB.some(g => g.id === G1.id));
  for (const [m, u, body] of [
    ["PATCH",  `/mentee-groups/${G1.id}`, { name: "CHANGED BY B" }],
    ["DELETE", `/mentee-groups/${G1.id}`],
    ["POST",   "/mentee-groups", { name: "B steals", memberIds: [a1, a3] }]
  ]) {
    const r = await api(B, m, u, body);
    check(`B: ${m} ${u.replace(/[0-9a-f]{24}/g, ":id")} on D's records -> 404`, r.status === 404, `HTTP ${r.status}`);
  }
  const bm1 = await mentee(B, "Bm1", ""), bm2 = await mentee(B, "Bm2", "");
  const steal = await api(D, "POST", "/mentee-groups", { name: "D takes B", programId: PX, memberIds: [a2, bm1] });
  check("D cannot put B's mentee in a group -> 404", steal.status === 404, `HTTP ${steal.status}`);

  // Organisation without programmes
  const bg = await api(B, "POST", "/mentee-groups", { name: "B group", programId: PX, memberIds: [bm1, bm2] });
  check("no programmes: group without a programme (a sent programme is ignored)",
        bg.status === 200 && bg.json?.group?.programId === "", `HTTP ${bg.status}`);

  // KVKK: deleting a member removes the membership
  await api(D, "DELETE", `/mentees/${a3}`);
  const afterDel = (await api(D, "GET", "/mentee-groups")).json.find(g => g.id === G1.id);
  check("deleting a mentee removes them from the group", afterDel?.memberIds?.length === 1 && afterDel.memberIds[0] === a1,
        `${afterDel?.memberIds?.length} member(s)`);

  // Deleting the group frees the members
  const del = await api(D, "DELETE", `/mentee-groups/${G1.id}`);
  const free = await api(D, "POST", "/mentorships", { mentorId: mx, menteeId: a1 });
  check("deleting the group frees its members", del.status === 200 && free.status === 200, `HTTP ${del.status} / ${free.status}`);
}

// ---------------------------------------------------------------------
// GROUP MATCHING (stage 3b)
// ---------------------------------------------------------------------

async function groupMatchChecks(server, ids) {
  const { SA, B, mentorB } = ids;
  console.log("\n9) GROUP MATCHING\n");

  const pwE = crypto.randomBytes(9).toString("hex");
  await api(SA, "POST", "/companies", { companyId: "tenant-e", name: "tenant-e", password: pwE });
  const E = await login("tenant-e", pwE);
  const post = async (url, body) => (await api(E, "POST", url, body)).json;

  const PX = (await post("/programs", { name: "PX", startDate: "2026-01-01", endDate: "2026-12-31" })).program.id;
  const PY = (await post("/programs", { name: "PY", startDate: "2026-01-01", endDate: "2026-12-31" })).program.id;
  const mentor = async (name, programId, capacity = 3) => {
    const id = (await post("/mentors", { fullName: name, email: `${name.toLowerCase()}@e.example`, role: "Director", capacity })).id;
    await api(E, "PUT", `/mentors/${id}/programs`, { programIds: [programId] });
    return id;
  };
  const member = async name => {
    const id = (await post("/mentees", { fullName: name, email: `${name.toLowerCase()}@e.example`, role: "Analyst",
                                        developmentNeeds: `I am ${name} and I want to lead a team` })).id;
    await api(E, "PUT", `/mentees/${id}/program`, { programId: PX });
    return id;
  };
  const mx = await mentor("Mehmet", PX), mx2 = await mentor("Melek", PX), my = await mentor("Yusuf", PY);
  const u1 = await member("Umut"), u2 = await member("Ulas"), u3 = await member("Uygar");
  const u4 = await member("Ufuk"), u5 = await member("Utku");
  const G = (await post("/mentee-groups", { name: "Yeni Liderler", programId: PX, memberIds: [u1, u2, u3] })).group.id;
  const G2 = (await post("/mentee-groups", { name: "Kucuk Grup", programId: PX, memberIds: [u4, u5] })).group.id;

  const cand = (await api(E, "GET", `/matching-candidates?programId=${PX}`)).json;
  const gc = (cand?.groups || []).find(g => g.id === G);
  check("candidates list the programme's groups", gc?.matchable === true && gc?.memberCount === 3, JSON.stringify(gc && { m: gc.matchable, n: gc.memberCount }));

  const ai = await api(E, "POST", "/match", { groupId: G, language: "en" });
  check("AI match for a group passes the rules (stops at AI setup)", ai.status === 503, `HTTP ${ai.status}`);

  const match = body => api(E, "POST", "/mentorships", { language: "en", ...body });
  const wrong = await match({ mentorId: my, groupId: G });
  check("group match: mentor from another programme -> 400", wrong.status === 400 && wrong.json?.code === "mentor_not_in_program",
        `HTTP ${wrong.status}`);

  const ok = await match({ mentorId: mx, groupId: G });
  const gms = ok.json?.mentorship;
  check("group match opens ONE mentorship", ok.status === 200 && gms?.isGroup === true && gms?.groupId === G, `HTTP ${ok.status}`);
  check("... with the 3 members as a snapshot", (gms?.members || []).length === 3);
  check("... in the group's programme, ending with it", gms?.programId === PX && gms?.closingDate === "2026-12-31",
        `${gms?.programId === PX} / ${gms?.closingDate}`);
  check("... and a group need without member names",
        /Participant 1/.test(gms?.developmentNeed || "") && !/Umut|Ulas|Uygar/.test(gms?.developmentNeed || ""));
  const mxRec = (await api(E, "GET", `/mentors/${mx}`)).json;
  check("a group takes ONE place of the mentor's capacity", mxRec?.activeMenteeCount === 1, `${mxRec?.activeMenteeCount}`);

  const twice = await match({ mentorId: mx2, groupId: G });
  check("a group with an active mentorship cannot get a second mentor -> 409",
        twice.status === 409 && twice.json?.code === "group_already_matched", `HTTP ${twice.status}`);
  const alone = await match({ mentorId: mx2, menteeId: u1 });
  check("a member is not matched alone -> 409", alone.status === 409 && alone.json?.code === "mentee_in_group", `HTTP ${alone.status}`);

  // Organisation B cannot use E's group or see the group mentorship
  const bUse = await api(B, "POST", "/mentorships", { mentorId: mentorB, groupId: G, closingDate: END_DATE });
  check("B cannot match E's group -> 404", bUse.status === 404, `HTTP ${bUse.status}`);
  check("B cannot read E's group mentorship -> 404", (await api(B, "GET", `/mentorships/${gms.id}`)).status === 404);

  // Workspace: members by name only
  const ws = new URL(ok.json.workspaceUrl);
  const wsData = (await api(null, "GET", `/public/workspace/${ws.searchParams.get("id")}?token=${ws.searchParams.get("token")}`)).json;
  const wsRaw = JSON.stringify(wsData || {});
  check("workspace lists the members by name, without e-mail addresses",
        (wsData?.members || []).length === 3 && !wsRaw.includes("umut@e.example") && !wsRaw.includes("ulas@e.example"));

  // Meeting tracking marks the group
  const tr = (await api(E, "GET", `/meeting-tracking?programId=${PX}`)).json;
  const row = (tr?.rows || []).find(r => r.id === gms.id);
  check("meeting tracking marks the group row", row?.isGroup === true && row?.memberCount === 3);

  // Closing survey: one per member (no SMTP here: the surveys are made, sending fails)
  await api(E, "POST", `/mentorships/${gms.id}/survey`, { role: "mentee", language: "en" });
  const sv = (await api(E, "GET", `/mentorships/${gms.id}/surveys`)).json;
  check("closing survey: one entry per member", sv?.isGroup === true && (sv?.members || []).length === 3 &&
        sv.members.every(m => m.state === "pending"), JSON.stringify((sv?.members || []).map(m => m.state)));

  // Too small: a group that lost a member
  await api(E, "DELETE", `/mentees/${u5}`);
  const small = await match({ mentorId: mx2, groupId: G2 });
  check("a group with 1 member left cannot be matched -> 400", small.status === 400 && small.json?.code === "group_too_small",
        `HTTP ${small.status}`);

  // Deleting the group keeps the mentorship; members stay engaged
  await api(E, "DELETE", `/mentee-groups/${G}`);
  const after = (await api(E, "GET", `/mentorships/${gms.id}`)).json;
  check("deleting the group keeps the mentorship and its members", after?.status === "active" && (after?.members || []).length === 3);
  const freeNow = await match({ mentorId: mx2, menteeId: u1 });
  check("... and its members still cannot get another mentor -> 409",
        freeNow.status === 409 && freeNow.json?.code === "mentee_already_engaged", `HTTP ${freeNow.status}`);

  // KVKK: deleting a member, deleting the mentorship
  const db = openDb(server.dbPath);
  try {
    await api(E, "DELETE", `/mentees/${u2}`);
    const m2 = db.prepare(`SELECT COUNT(*) n FROM mentorship_members WHERE mentee_id = ?`).get(u2).n;
    const s2 = db.prepare(`SELECT COUNT(*) n FROM surveys WHERE member_id = ?`).get(u2).n;
    check("deleting a member removes them from the group mentorship and their survey", m2 === 0 && s2 === 0, `${m2} / ${s2}`);

    await api(E, "DELETE", `/mentorships/${gms.id}?force=true`);
    const sAll = db.prepare(`SELECT COUNT(*) n FROM surveys WHERE mentorship_id = ?`).get(gms.id).n;
    const mAll = db.prepare(`SELECT COUNT(*) n FROM mentorship_members WHERE mentorship_id = ?`).get(gms.id).n;
    check("deleting the mentorship removes its surveys and member rows", sAll === 0 && mAll === 0, `${sAll} / ${mAll}`);
  } finally {
    db.close();
  }
  const mxAfter = (await api(E, "GET", `/mentors/${mx}`)).json;
  check("... and gives the mentor's place back", mxAfter?.activeMenteeCount === 0, `${mxAfter?.activeMenteeCount}`);

  // --- Deleting an individually matched mentee (KVKK, option b) --------
  console.log("\n10) DELETING A MATCHED MENTEE\n");
  const u6 = await member("Ugur");
  const ind = (await match({ mentorId: mx2, menteeId: u6 })).json?.mentorship;
  await api(E, "POST", `/mentorships/${ind.id}/meetings`, { meetingDate: "2026-09-10", title: "First", durationMinutes: "00:45" });
  await api(E, "POST", `/mentorships/${ind.id}/survey`, { role: "mentee", language: "en" });   // no SMTP: survey made, e-mail fails
  await api(E, "POST", `/email/workspace/${ind.id}`, { target: "mentee", lang: "en" });        // logged as failed

  const db2 = openDb(server.dbPath);
  try {
    const before = {
      surveys: db2.prepare(`SELECT COUNT(*) n FROM surveys WHERE mentorship_id = ? AND role = 'mentee'`).get(ind.id).n,
      mails: db2.prepare(`SELECT COUNT(*) n FROM email_log WHERE recipient = ?`).get("ugur@e.example").n
    };
    await api(E, "DELETE", `/mentees/${u6}`);
    const msRow = (await api(E, "GET", `/mentorships/${ind.id}`)).json;
    check("the mentee is gone", (await api(E, "GET", `/mentees/${u6}`)).status === 404);
    check("their mentorship stays, with its meetings", msRow?.id === ind.id && (msRow.meetings || []).length === 1,
          `${msRow?.id === ind.id} / ${(msRow?.meetings || []).length} meeting(s)`);
    check("... but no longer names them",
          msRow?.menteeDeleted === true && msRow.menteeName === "" && msRow.menteeEmail === "" && msRow.developmentNeed === "",
          JSON.stringify({ n: msRow?.menteeName, e: msRow?.menteeEmail, d: msRow?.menteeDeleted }));
    const after = {
      surveys: db2.prepare(`SELECT COUNT(*) n FROM surveys WHERE mentorship_id = ? AND role = 'mentee'`).get(ind.id).n,
      mails: db2.prepare(`SELECT COUNT(*) n FROM email_log WHERE recipient = ?`).get("ugur@e.example").n
    };
    check("their closing survey and e-mail log are deleted",
          before.surveys === 1 && before.mails >= 1 && after.surveys === 0 && after.mails === 0,
          `surveys ${before.surveys}->${after.surveys}, mails ${before.mails}->${after.mails}`);
    const raw = JSON.stringify(db2.prepare(`SELECT * FROM mentorships WHERE id = ?`).get(ind.id));
    check("nothing in the mentorship row contains their name or e-mail", !/Ugur|ugur@e\.example/.test(raw));
  } finally {
    db2.close();
  }
}

// ---------------------------------------------------------------------
// CHECK-IN FEEDBACK
// ---------------------------------------------------------------------

async function checkinChecks(server, ids) {
  const { SA, B } = ids;
  console.log("\n11) CHECK-IN FEEDBACK\n");

  check("unauthenticated /checkin-questions rejected", (await api(null, "GET", "/checkin-questions")).status === 401);
  check("an unknown feedback link -> 404", (await api(null, "GET", "/public/checkin/nope")).status === 404);

  const pwF = crypto.randomBytes(9).toString("hex");
  await api(SA, "POST", "/companies", { companyId: "tenant-f", name: "tenant-f", password: pwF });
  const F = await login("tenant-f", pwF);
  const post = async (url, body) => (await api(F, "POST", url, body)).json;

  // Question set
  const def = (await api(F, "GET", "/checkin-questions")).json;
  check("default question set (6 questions)", def?.isDefault === true && def?.questions?.length === 6, `${def?.questions?.length}`);
  const empty = await api(F, "PUT", "/checkin-questions", { questions: [] });
  check("empty question set -> 400", empty.status === 400 && empty.json?.errors?.[0]?.code === "no_questions", `HTTP ${empty.status}`);
  const noText = await api(F, "PUT", "/checkin-questions", { questions: [{ type: "scale5", tr: "Fine" }, { type: "text", tr: " ", en: "" }] });
  check("question without text -> 400 at its position", noText.status === 400 &&
        noText.json?.errors?.some(e => e.index === 2 && e.code === "no_text"), JSON.stringify(noText.json?.errors));
  const custom = [
    { type: "scale5", tr: "Hedeflere doğru ilerliyoruz.", en: "We are making progress.", optional: false },
    { type: "yesno", tr: "İK desteği gerekli mi?", en: "Do you need HR support?", optional: false, support: true },
    { type: "text", tr: "Eklemek istediğiniz?", en: "Anything to add?", optional: true }
  ];
  const saved = await api(F, "PUT", "/checkin-questions", { questions: custom });
  const Q = saved.json?.questions || [];
  check("custom question set saved (ids assigned)", saved.status === 200 && Q.length === 3 && Q.every(q => /^[a-z0-9_]+$/.test(q.id)),
        `HTTP ${saved.status}`);
  const bQs = (await api(B, "GET", "/checkin-questions")).json;
  check("B does not get F's question set", bQs?.isDefault === true);

  // People
  const mentorId = (await post("/mentors", { fullName: "Feride Mentor", email: "feride@f.example", role: "Director", capacity: 3 })).id;
  const mentor2 = (await post("/mentors", { fullName: "Fikret Mentor", email: "fikret@f.example", role: "VP", capacity: 3 })).id;
  const mentee = async n => (await post("/mentees", { fullName: n, email: `${n.toLowerCase()}@f.example`, role: "Analyst", developmentNeeds: "x" })).id;
  const m1 = await mentee("Fulya"), g1 = await mentee("Ferit"), g2 = await mentee("Filiz");
  const ms = (await post("/mentorships", { mentorId, menteeId: m1, closingDate: END_DATE })).mentorship;
  const G = (await post("/mentee-groups", { name: "F grubu", memberIds: [g1, g2] })).group.id;
  const gms = (await post("/mentorships", { mentorId: mentor2, groupId: G, closingDate: END_DATE })).mentorship;

  // Sending (no SMTP here: rounds are made, the links come back)
  const both = await api(F, "POST", `/mentorships/${ms.id}/checkin`, { target: "both", language: "tr" });
  check("feedback to both: two rounds, links returned when e-mail fails",
        both.status === 502 && both.json?.failed?.length === 2 && both.json.failed.every(x => x.checkinUrl), `HTTP ${both.status}`);
  const again = await api(F, "POST", `/mentorships/${ms.id}/checkin`, { target: "mentee", language: "tr" });
  let list = (await api(F, "GET", `/mentorships/${ms.id}/checkins`)).json;
  const menteeRound = list?.rounds?.find(r => r.role === "mentee");
  check("asking an unanswered person again is a reminder (same round)",
        list?.rounds?.length === 2 && menteeRound?.reminderCount === 1, `${list?.rounds?.length} rounds, ${menteeRound?.reminderCount} reminder(s)`);

  check("B cannot ask feedback for F's mentorship -> 404",
        (await api(B, "POST", `/mentorships/${ms.id}/checkin`, { target: "both" })).status === 404);
  check("B cannot read F's feedback -> 404", (await api(B, "GET", `/mentorships/${ms.id}/checkins`)).status === 404);

  // The person's page
  const tokenOf = url => new URL(url).searchParams.get("token");
  const tMentee = tokenOf(both.json.failed.find(x => x.role === "mentee").checkinUrl);
  const tMentor = tokenOf(both.json.failed.find(x => x.role === "mentor").checkinUrl);
  const page = (await api(null, "GET", `/public/checkin/${tMentee}`)).json;
  check("the page shows the round's questions", page?.questions?.length === 3 && page.questions[0].tr === custom[0].tr);
  check("the page shares no e-mail addresses", !JSON.stringify(page || {}).includes("@f.example"));

  // Editing the set does not change a round already sent
  await api(F, "PUT", "/checkin-questions", { questions: [{ ...Q[0], tr: "DEĞİŞTİ" }, Q[1], Q[2]] });
  const pageAfter = (await api(null, "GET", `/public/checkin/${tMentee}`)).json;
  check("a round keeps its own copy of the questions", pageAfter?.questions?.[0]?.tr === custom[0].tr, pageAfter?.questions?.[0]?.tr);

  // Answering
  const miss = await api(null, "POST", `/public/checkin/${tMentee}`, { answers: { [Q[2].id]: "only optional" } });
  check("required answers missing -> 400", miss.status === 400 && miss.json?.code === "missing_answers", `HTTP ${miss.status}`);
  const okA = await api(null, "POST", `/public/checkin/${tMentee}`, { answers: { [Q[0].id]: 4, [Q[1].id]: "yes", [Q[2].id]: "Thanks" } });
  check("answers saved", okA.status === 200, `HTTP ${okA.status}`);
  check("an answered link cannot be sent twice -> 409",
        (await api(null, "POST", `/public/checkin/${tMentee}`, { answers: { [Q[0].id]: 1, [Q[1].id]: "no" } })).status === 409);
  check("the other person's round is untouched",
        (await api(null, "GET", `/public/checkin/${tMentor}`)).json?.status === "pending");

  list = (await api(F, "GET", `/mentorships/${ms.id}/checkins`)).json;
  const done = list?.rounds?.find(r => r.role === "mentee");
  check("HR sees the answers with \"needs support\"", done?.status === "completed" && done?.answers?.[Q[0].id] === 4 && done?.needsSupport === true);
  const card = ((await api(F, "GET", "/mentorships")).json || []).find(x => x.id === ms.id);
  check("the mentorship is marked \"needs support\"", card?.checkin?.needsSupport === true);
  const tr = (await api(F, "GET", "/meeting-tracking")).json;
  check("meeting tracking counts it", tr?.stats?.needsSupport === 1, `${tr?.stats?.needsSupport}`);

  // Group: one round per member
  const grp = await api(F, "POST", `/mentorships/${gms.id}/checkin`, { target: "mentee", language: "en" });
  const names = (grp.json?.failed || []).map(x => x.name).sort().join(",");
  check("group: one round per member", names === "Ferit,Filiz", names);

  // KVKK
  const db = openDb(server.dbPath);
  try {
    await api(F, "DELETE", `/mentees/${m1}`);
    const menteeRows = db.prepare(`SELECT COUNT(*) n FROM checkins WHERE mentorship_id = ? AND role = 'mentee'`).get(ms.id).n;
    const mentorRows = db.prepare(`SELECT COUNT(*) n FROM checkins WHERE mentorship_id = ? AND role = 'mentor'`).get(ms.id).n;
    check("deleting a mentee deletes their feedback, not the mentor's", menteeRows === 0 && mentorRows === 1, `${menteeRows} / ${mentorRows}`);
    await api(F, "DELETE", `/mentees/${g1}`);
    check("deleting a group member deletes only their feedback",
          db.prepare(`SELECT COUNT(*) n FROM checkins WHERE member_id = ?`).get(g1).n === 0 &&
          db.prepare(`SELECT COUNT(*) n FROM checkins WHERE member_id = ?`).get(g2).n === 1);
    await api(F, "DELETE", `/mentorships/${gms.id}?force=true`);
    check("deleting a mentorship deletes its feedback",
          db.prepare(`SELECT COUNT(*) n FROM checkins WHERE mentorship_id = ?`).get(gms.id).n === 0);
  } finally {
    db.close();
  }

  const reset = await api(F, "DELETE", "/checkin-questions");
  check("back to the default questions", reset.status === 200 && reset.json?.isDefault === true && reset.json?.questions?.length === 6);
}

// ---------------------------------------------------------------------
// ANNOUNCEMENTS (stage 4a) - with a local SMTP sink
// ---------------------------------------------------------------------

/**
 * A tiny SMTP server for this test only: accepts every message (and
 * refuses any recipient starting with "bounce@") and keeps them in memory.
 */
function startSink() {
  return new Promise(resolve => {
    const messages = [];
    const srv = net.createServer(sock => {
      let data = false, buf = "", msg = "", rcpt = [];
      sock.write("220 sink ESMTP\r\n");
      sock.on("data", chunk => {
        buf += chunk.toString("utf8");
        let i;
        while ((i = buf.indexOf("\r\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 2);
          if (data) {
            if (line === ".") { data = false; messages.push({ rcpt, raw: msg }); msg = ""; rcpt = []; sock.write("250 OK\r\n"); }
            else msg += line + "\n";
            continue;
          }
          const cmd = line.slice(0, 4).toUpperCase();
          if (cmd === "EHLO") sock.write("250-sink\r\n250 OK\r\n");
          else if (cmd === "HELO") sock.write("250 sink\r\n");
          else if (cmd === "RCPT") {
            const addr = (line.match(/<([^>]*)>/) || [])[1] || "";
            if (/^bounce@/i.test(addr)) sock.write("550 No such user\r\n");
            else { rcpt.push(addr); sock.write("250 OK\r\n"); }
          }
          else if (cmd === "DATA") { data = true; sock.write("354 go\r\n"); }
          else if (cmd === "QUIT") { sock.write("221 bye\r\n"); sock.end(); }
          else sock.write("250 OK\r\n");
        }
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve({ port: srv.address().port, messages, close: () => srv.close() }));
  });
}

/** Decodes a quoted-printable body enough to search it for text. */
const qp = raw => raw.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

async function announcementChecks(server, ids) {
  const { SA, B } = ids;
  console.log("\n13) ANNOUNCEMENTS\n");

  check("unauthenticated /announcements rejected", (await api(null, "GET", "/announcements")).status === 401);

  const pwG = crypto.randomBytes(9).toString("hex");
  await api(SA, "POST", "/companies", { companyId: "tenant-g", name: "G Holding", password: pwG });
  const G = await login("tenant-g", pwG);
  const post = async (url, body) => (await api(G, "POST", url, body)).json;

  const PX = (await post("/programs", { name: "PX", startDate: "2026-01-01", endDate: "2026-12-31" })).program.id;
  const PY = (await post("/programs", { name: "PY", startDate: "2026-01-01", endDate: "2026-12-31" })).program.id;
  const mentor = async (name, programId, status) => {
    const id = (await post("/mentors", { fullName: name, email: `${name.toLowerCase()}@g.example`, role: "Director", capacity: 3 })).id;
    await api(G, "PUT", `/mentors/${id}/programs`, { programIds: [programId] });
    if (status) await api(G, "PATCH", `/mentors/${id}`, { status });
    return id;
  };
  const mentee = async (name, programId, status) => {
    const id = (await post("/mentees", { fullName: name, email: `${name.toLowerCase()}@g.example`, role: "Analyst", developmentNeeds: "x" })).id;
    await api(G, "PUT", `/mentees/${id}/program`, { programId });
    if (status) await api(G, "PATCH", `/mentees/${id}`, { status });
    return id;
  };
  const m1 = await mentor("Gamze", PX), m2 = await mentor("Gokhan", PY), m3 = await mentor("Gulsen", PX, "inactive");
  const e1 = await mentee("Gul", PX), e2 = await mentee("Gurkan", PY), e3 = await mentee("Gizem", PX, "inactive");
  const e4 = await mentee("Gonul", PX), e5 = await mentee("Gani", PX);
  const msInd = (await post("/mentorships", { mentorId: m1, menteeId: e1 })).mentorship;
  const grp = (await post("/mentee-groups", { name: "G grubu", programId: PX, memberIds: [e4, e5] })).group.id;
  const msGrp = (await post("/mentorships", { mentorId: m1, groupId: grp })).mentorship;

  // Recipient selection
  const preview = async (selection, cookie = G) => api(cookie, "POST", "/announcements/preview-recipients", { selection });
  const names = r => (r.json?.recipients || []).map(x => x.name || x.email).sort().join(",");
  let r = await preview({ mentors: "programs", mentorProgramIds: [PX] });
  check("mentors of a programme (active only)", names(r) === "Gamze", names(r));
  r = await preview({ mentees: "all" });
  check("all active mentees", names(r) === "Gani,Gonul,Gul,Gurkan", names(r));
  r = await preview({ groupIds: [grp], menteeIds: [e4], extra: ["GONUL@g.example", "dis@x.example"] });
  check("each address once (group + person + typed-in)", r.json?.count === 3, names(r));
  r = await preview({ extra: "ok@x.example, not-an-address" });
  check("an invalid typed-in address -> 400", r.status === 400 && r.json?.code === "bad_addresses", `HTTP ${r.status}`);

  // Organisation B
  check("B cannot use G's programme in a selection -> 404",
        (await preview({ mentors: "programs", mentorProgramIds: [PX] }, B)).status === 404);
  check("B cannot use G's people in a selection -> 404", (await preview({ menteeIds: [e1] }, B)).status === 404);

  // Draft
  const draft = await api(G, "POST", "/announcements", {
    subject: "Program duyurusu", body: "Merhaba {ad},\nYarin kick-off var.",
    selection: { mentors: "all", mentees: "all", extra: ["dis@x.example", "bounce@x.example"] }, language: "tr" });
  const A1 = draft.json?.announcement;
  check("draft saved", draft.status === 200 && A1?.status === "draft", `HTTP ${draft.status}`);
  const edited = await api(G, "PUT", `/announcements/${A1.id}`, { ...draft.json.announcement, subject: "Program duyurusu {ad}" });
  check("draft edited", edited.json?.announcement?.subject === "Program duyurusu {ad}");
  for (const [m, u] of [["GET", `/announcements/${A1.id}`], ["PUT", `/announcements/${A1.id}`], ["POST", `/announcements/${A1.id}/send`],
                        ["DELETE", `/announcements/${A1.id}`]]) {
    const x = await api(B, m, u, m === "PUT" ? { subject: "B", body: "B", selection: {} } : undefined);
    check(`B: ${m} ${u.replace(/[0-9a-f]{24}/, ":id")} -> 404`, x.status === 404, `HTTP ${x.status}`);
  }
  const noSmtp = await api(G, "POST", `/announcements/${A1.id}/send`);
  check("sending without an e-mail server -> 400", noSmtp.status === 400 && noSmtp.json?.code === "smtp_not_configured", `HTTP ${noSmtp.status}`);

  // E-mail server (local sink) and the reply address
  const sink = await startSink();
  try {
    const tok = (await api(null, "POST", "/admin/login", { password: server.superPassword })).json?.token;
    const cfg = await fetch(BASE + "/admin/smtp-config", { method: "PUT", headers: { "Content-Type": "application/json", "x-admin-token": tok },
      body: JSON.stringify({ host: "127.0.0.1", port: sink.port, secure: false, fromName: "MentorOS Test", fromEmail: "noreply@test.example" }) });
    if (cfg.status !== 200) throw new Error("could not configure the test SMTP server");
    check("an invalid reply address -> 400", (await api(G, "PUT", "/announcement-settings", { replyTo: "nope" })).status === 400);
    await api(G, "PUT", "/announcement-settings", { replyTo: "ik@g.example" });

    const send = await api(G, "POST", `/announcements/${A1.id}/send`);
    check("send starts in the background (202)", send.status === 202 && send.json?.queued === 8, `HTTP ${send.status}, ${send.json?.queued}`);
    let a;
    for (let i = 0; i < 60; i++) {
      a = (await api(G, "GET", `/announcements/${A1.id}`)).json;
      if (a?.status === "sent") break;
      await new Promise(res => setTimeout(res, 250));
    }
    const st = a.recipients.reduce((o, x) => (o[x.status] = (o[x.status] || 0) + 1, o), {});
    check("all sent except the refused address", a.status === "sent" && st.sent === 7 && st.failed === 1, JSON.stringify(st));
    check("one e-mail per recipient", sink.messages.length === 7 && sink.messages.every(m => m.rcpt.length === 1), `${sink.messages.length}`);
    const toGamze = sink.messages.find(m => m.rcpt[0] === "gamze@g.example");
    const body = toGamze ? qp(toGamze.raw) : "";
    check("{ad} becomes the recipient's name (subject and body)", /Merhaba Gamze,/.test(body) && /Program duyurusu Gamze/.test(body));
    check("sender name is the organisation, replies go to HR",
          /From: "G Holding - MentorOS"/.test(body) && /Reply-To: ik@g\.example/i.test(body));
    const ext = sink.messages.find(m => m.rcpt[0] === "dis@x.example");
    check("typed-in address: {ad} left empty", ext && /Merhaba,/.test(qp(ext.raw)));
    check("a sent announcement cannot be edited -> 409",
          (await api(G, "PUT", `/announcements/${A1.id}`, { subject: "x", body: "x", selection: {} })).status === 409);
    check("... or sent twice -> 409", (await api(G, "POST", `/announcements/${A1.id}/send`)).status === 409);

    const re = await api(G, "POST", `/announcements/${A1.id}/resend-failed`);
    for (let i = 0; i < 40; i++) {
      a = (await api(G, "GET", `/announcements/${A1.id}`)).json;
      if (a?.status === "sent") break;
      await new Promise(res => setTimeout(res, 250));
    }
    check("failed ones can be sent again", re.json?.queued === 1 && a.status === "sent" && a.failedCount === 1);

    // Workspace: only announcements sent to EVERYONE in it
    const sendNow = async (subject, selection) => {
      const d = (await api(G, "POST", "/announcements", { subject, body: "x", selection })).json.announcement;
      await api(G, "POST", `/announcements/${d.id}/send`);
      for (let i = 0; i < 40; i++) {
        if ((await api(G, "GET", `/announcements/${d.id}`)).json?.status === "sent") break;
        await new Promise(res => setTimeout(res, 250));
      }
      return d.id;
    };
    await sendNow("Yalniz mentorlar", { mentors: "all" });
    await sendNow("Gamze ve Gul", { mentorIds: [m1], menteeIds: [e1] });
    const wsList = async ms => {
      const u = new URL(ms.workspaceUrl);
      return (await api(null, "GET", `/public/workspace/${u.searchParams.get("id")}/announcements?token=${u.searchParams.get("token")}`)).json || [];
    };
    const ind = (await wsList(msInd)).map(x => x.subject).sort().join(" | ");
    const gr = (await wsList(msGrp)).map(x => x.subject).sort().join(" | ");
    check("individual workspace: announcements sent to both of them", ind === "Gamze ve Gul | Program duyurusu", ind);
    check("group workspace: only the one sent to the mentor AND every member", gr === "Program duyurusu", gr);
    check("a workspace with a wrong token -> 403",
          (await api(null, "GET", `/public/workspace/${msInd.id}/announcements?token=wrong`)).status === 403);

    // KVKK
    const db = openDb(server.dbPath);
    try {
      await api(G, "DELETE", `/mentees/${e2}`);
      await api(G, "DELETE", `/mentors/${m2}?force=true`);
      const left = db.prepare(`SELECT COUNT(*) n FROM announcement_recipients WHERE person_id IN (?, ?)`).get(e2, m2).n;
      check("deleting a mentor or mentee removes them from recipient lists", left === 0, `${left}`);
      check("... the announcement stays", (await api(G, "GET", `/announcements/${A1.id}`)).status === 200);
      await api(G, "DELETE", `/announcements/${A1.id}`);
      check("deleting an announcement deletes its recipient list",
            db.prepare(`SELECT COUNT(*) n FROM announcement_recipients WHERE announcement_id = ?`).get(A1.id).n === 0);
    } finally {
      db.close();
    }
  } finally {
    sink.close();
  }
}

// ---------------------------------------------------------------------
// ANNOUNCEMENT ATTACHMENTS (stage 4b)
// ---------------------------------------------------------------------

async function upload(cookie, annId, name, bytes, base = BASE) {
  const r = await fetch(`${base}/announcements/${annId}/attachments?name=${encodeURIComponent(name)}`, {
    method: "POST", headers: { Cookie: cookie || "", "Content-Type": "application/octet-stream" }, body: bytes
  });
  let json = null; try { json = await r.json(); } catch { json = null; }
  return { status: r.status, json };
}

async function attachmentChecks(server, ids) {
  const { SA, B } = ids;
  console.log("\n15) ANNOUNCEMENT ATTACHMENTS\n");

  const pwH = crypto.randomBytes(9).toString("hex");
  await api(SA, "POST", "/companies", { companyId: "tenant-h", name: "H Ltd", password: pwH });
  const H = await login("tenant-h", pwH);
  const post = async (url, body) => (await api(H, "POST", url, body)).json;
  const m1 = (await post("/mentors", { fullName: "Hakan", email: "hakan@h.example", role: "Director", capacity: 3 })).id;
  const e1 = (await post("/mentees", { fullName: "Hale", email: "hale@h.example", role: "Analyst", developmentNeeds: "x" })).id;
  const ms = (await post("/mentorships", { mentorId: m1, menteeId: e1, closingDate: END_DATE })).mentorship;
  const A = (await post("/announcements", { subject: "Belgeler", body: "Ekte {ad}", selection: { mentorIds: [m1], menteeIds: [e1] } })).announcement;

  const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), crypto.randomBytes(2000)]);
  const ok = await upload(H, A.id, "../../gizli/plan.pdf", pdf);
  check("a PDF is attached (path stripped from its name)", ok.status === 200 && ok.json?.attachment?.filename === "plan.pdf",
        `HTTP ${ok.status} ${ok.json?.attachment?.filename}`);
  check("a file type that is not allowed -> 400", (await upload(H, A.id, "setup.exe", Buffer.from("MZ"))).json?.code === "type_not_allowed");
  check("an empty file -> 400", (await upload(H, A.id, "bos.pdf", Buffer.alloc(0))).json?.code === "empty_file");
  const big = await upload(H, A.id, "buyuk.pdf", Buffer.alloc(11 * 1024 * 1024, 1));
  check("a file over 10 MB -> 413", big.status === 413, `HTTP ${big.status}`);
  const nine = await upload(H, A.id, "dokuz.pdf", Buffer.alloc(9.5 * 1024 * 1024, 2));
  const over = await upload(H, A.id, "fazla.pdf", Buffer.alloc(600 * 1024, 3));
  check("an announcement's files are limited to 10 MB in total",
        nine.status === 200 && over.json?.code === "announcement_too_big", `${nine.status} / ${over.json?.code}`);
  await api(H, "DELETE", `/announcements/${A.id}/attachments/${nine.json.attachment.id}`);
  let n = 1;
  while (n < 10) { await upload(H, A.id, `f${n}.txt`, Buffer.from(`file ${n}`)); n++; }
  check("at most 10 files per announcement", (await upload(H, A.id, "f11.txt", Buffer.from("x"))).json?.code === "too_many_files");

  // Organisation B
  check("B cannot add a file to H's announcement -> 404", (await upload(B, A.id, "b.pdf", pdf)).status === 404);
  check("B cannot download H's file -> 404",
        (await api(B, "GET", `/announcements/${A.id}/attachments/${ok.json.attachment.id}`)).status === 404);

  // HR download
  const dl = await fetch(`${BASE}/announcements/${A.id}/attachments/${ok.json.attachment.id}`, { headers: { Cookie: H } });
  const got = Buffer.from(await dl.arrayBuffer());
  check("HR downloads the same bytes, as an attachment",
        got.equals(pdf) && /attachment/.test(dl.headers.get("content-disposition") || "") &&
        dl.headers.get("x-content-type-options") === "nosniff");

  // Sending with the files attached
  const sink = await startSink();
  try {
    const tok = (await api(null, "POST", "/admin/login", { password: server.superPassword })).json?.token;
    await fetch(BASE + "/admin/smtp-config", { method: "PUT", headers: { "Content-Type": "application/json", "x-admin-token": tok },
      body: JSON.stringify({ host: "127.0.0.1", port: sink.port, secure: false, fromName: "MentorOS Test", fromEmail: "noreply@test.example" }) });
    await api(H, "POST", `/announcements/${A.id}/send`);
    let a;
    for (let i = 0; i < 60; i++) {
      a = (await api(H, "GET", `/announcements/${A.id}`)).json;
      if (a?.status === "sent") break;
      await new Promise(res => setTimeout(res, 250));
    }
    const msg = sink.messages.find(m => m.rcpt[0] === "hale@h.example");
    const files = msg ? (msg.raw.match(/filename="?([^";\n]+)"?/g) || []).length : 0;
    check("every recipient's e-mail carries the files", a.status === "sent" && sink.messages.length === 2 && files >= 10,
          `${sink.messages.length} mails, ${files} file names`);
    check("files of a sent announcement cannot change -> 409",
          (await upload(H, A.id, "late.pdf", pdf)).status === 409 &&
          (await api(H, "DELETE", `/announcements/${A.id}/attachments/${ok.json.attachment.id}`)).status === 409);

    // Workspace download
    const u = new URL(ms.workspaceUrl), wid = u.searchParams.get("id"), wt = u.searchParams.get("token");
    const ws = (await api(null, "GET", `/public/workspace/${wid}/announcements?token=${wt}`)).json || [];
    check("the workspace lists the files", ws[0]?.attachments?.length === 10);
    const wdl = await fetch(`${BASE}/public/workspace/${wid}/announcements/${A.id}/attachments/${ok.json.attachment.id}?token=${wt}`);
    check("... and they download with the workspace link", wdl.status === 200 && Buffer.from(await wdl.arrayBuffer()).equals(pdf));
    check("... but not with a wrong token -> 403",
          (await fetch(`${BASE}/public/workspace/${wid}/announcements/${A.id}/attachments/${ok.json.attachment.id}?token=x`)).status === 403);
    const onlyMentor = (await post("/announcements", { subject: "Yalniz mentor", body: "x", selection: { mentorIds: [m1] } })).announcement;
    const om = await upload(H, onlyMentor.id, "mentor.pdf", pdf);
    await api(H, "POST", `/announcements/${onlyMentor.id}/send`);
    await new Promise(res => setTimeout(res, 1500));
    check("a file of an announcement the workspace does not show -> 404",
          (await fetch(`${BASE}/public/workspace/${wid}/announcements/${onlyMentor.id}/attachments/${om.json.attachment.id}?token=${wt}`)).status === 404);
  } finally {
    sink.close();
  }

  // Storage report
  const rep = await api(SA, "GET", "/storage-report");
  const hRow = (rep.json?.byCompany || []).find(c => c.companyId === "tenant-h");
  check("super admin sees disk and attachment space", rep.status === 200 && !!rep.json?.disk && hRow?.files === 11,
        `HTTP ${rep.status}, ${hRow?.files} file(s)`);
  check("an organisation cannot see the storage report -> 403", (await api(H, "GET", "/storage-report")).status === 403);

  // Deleting the organisation removes everything (KVKK)
  const db = openDb(server.dbPath);
  try {
    await api(SA, "DELETE", "/companies/tenant-h?force=true");
    const left = ["announcements", "announcement_attachments", "surveys", "checkins", "email_log", "mentorships", "mentees"]
      .map(t => [t, db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE company_id = ?`).get("tenant-h").n]).filter(([, n]) => n);
    check("deleting an organisation leaves none of its data behind", left.length === 0, JSON.stringify(left));
  } finally {
    db.close();
  }

  // Organisation limit and the disk guard: a second server with tiny limits
  const small = await startServer({ ATTACHMENT_COMPANY_LIMIT_MB: "1" });
  try {
    const sa = await (async () => {
      const r = await fetch(small.base + "/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "superadmin", password: small.superPassword }) });
      return (r.headers.getSetCookie()[0] || "").split(";")[0];
    })();
    await fetch(small.base + "/companies", { method: "POST", headers: { Cookie: sa, "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: "q", name: "Q", password: "QuotaPass123" }) });
    const lr = await fetch(small.base + "/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "q", password: "QuotaPass123" }) });
    const Q = (lr.headers.getSetCookie()[0] || "").split(";")[0];
    const mk = await fetch(small.base + "/announcements", { method: "POST", headers: { Cookie: Q, "Content-Type": "application/json" },
      body: JSON.stringify({ subject: "q", body: "q", selection: {} }) });
    const qa = (await mk.json()).announcement;
    const first = await upload(Q, qa.id, "a.pdf", Buffer.alloc(700 * 1024, 1), small.base);
    const second = await upload(Q, qa.id, "b.pdf", Buffer.alloc(700 * 1024, 2), small.base);
    check("the organisation's attachment space is enforced", first.status === 200 && second.json?.code === "company_quota_full",
          `${first.status} / ${second.json?.code}`);
  } finally {
    small.child.kill();
    await new Promise(r => setTimeout(r, 300));
    fs.rmSync(small.tmp, { recursive: true, force: true });
  }
  const full = await startServer({ DISK_LIMIT_PERCENT: "0.01" });
  try {
    const r = await fetch(full.base + "/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "superadmin", password: full.superPassword }) });
    const sa = (r.headers.getSetCookie()[0] || "").split(";")[0];
    await fetch(full.base + "/companies", { method: "POST", headers: { Cookie: sa, "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: "d", name: "D", password: "DiskPass12345" }) });
    const lr = await fetch(full.base + "/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "d", password: "DiskPass12345" }) });
    const D = (lr.headers.getSetCookie()[0] || "").split(";")[0];
    const mk = await fetch(full.base + "/announcements", { method: "POST", headers: { Cookie: D, "Content-Type": "application/json" },
      body: JSON.stringify({ subject: "d", body: "d", selection: {} }) });
    const da = (await mk.json()).announcement;
    const up = await upload(D, da.id, "a.pdf", pdf, full.base);
    check("a nearly full disk refuses new files (507)", up.status === 507 && up.json?.code === "disk_nearly_full", `HTTP ${up.status}`);
  } finally {
    full.child.kill();
    await new Promise(r => setTimeout(r, 300));
    fs.rmSync(full.tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------
// REPORTS
// ---------------------------------------------------------------------

async function reportChecks(server, ids) {
  const { SA, B } = ids;
  console.log("\n16) REPORTS\n");

  check("unauthenticated /reports/management rejected", (await api(null, "GET", "/reports/management")).status === 401);

  const pwR = crypto.randomBytes(9).toString("hex");
  await api(SA, "POST", "/companies", { companyId: "tenant-r", name: "R Rapor", password: pwR });
  const R = await login("tenant-r", pwR);
  const post = async (url, body) => (await api(R, "POST", url, body)).json;
  const P1 = (await post("/programs", { name: "R1", startDate: "2026-01-01", endDate: "2026-12-31" })).program.id;
  const P2 = (await post("/programs", { name: "R2", startDate: "2026-01-01", endDate: "2026-12-31" })).program.id;
  const mentor = async (name, pid, capacity, status) => {
    const id = (await post("/mentors", { fullName: name, email: `${name.split(" ")[0].toLowerCase()}@r.example`, role: "Director", capacity })).id;
    await api(R, "PUT", `/mentors/${id}/programs`, { programIds: [pid] });
    if (status) await api(R, "PATCH", `/mentors/${id}`, { status });
    return id;
  };
  const mentee = async (name, pid) => {
    const id = (await post("/mentees", { fullName: name, email: `${name.split(" ")[0].toLowerCase()}@r.example`, role: "Analyst", developmentNeeds: "x" })).id;
    if (pid) await api(R, "PUT", `/mentees/${id}/program`, { programId: pid });
    return id;
  };
  const r1 = await mentor("Rasim Rapormentor", P1, 3), r2 = await mentor("Ruya Rapormentor", P2, 2);
  await mentor("Remzi Rapormentor", P1, 4, "inactive");
  const a = await mentee("Asli Raporlu", P1); await mentee("Bora Raporlu", P1);
  const c = await mentee("Cem Raporlu", P2); await mentee("Dila Raporlu", "");
  const msA = (await post("/mentorships", { mentorId: r1, menteeId: a })).mentorship;
  const msC = (await post("/mentorships", { mentorId: r2, menteeId: c })).mentorship;
  for (const [ms, date, d] of [[msA, "2026-09-01", "01:00"], [msA, "2026-09-20", "00:30"], [msC, "2026-10-01", "00:45"]]) {
    await api(R, "POST", `/mentorships/${ms.id}/meetings`, { meetingDate: date, title: "x", durationMinutes: d });
  }

  const rep = async (kind, q = "") => (await api(R, "GET", `/reports/${kind}?lang=en${q}`)).json;
  const val = (d, label) => (d?.summary || []).find(x => x.label === label)?.value;

  let m = await rep("management");
  check("management: head counts", val(m, "Mentors") === 3 && val(m, "Active mentors") === 2 && val(m, "Mentees") === 4 &&
        val(m, "Matched mentees (active)") === 2, JSON.stringify(m?.summary?.slice(0, 6)));
  check("management: matches and meetings", val(m, "Matches") === 2 && val(m, "Meetings") === 3 &&
        val(m, "Total meeting time") === "2 h 15 min" && val(m, "Meetings without a length") === 0);
  check("management: capacity of active mentors", val(m, "Total mentor capacity") === 5 && val(m, "Capacity in use") === 2);
  m = await rep("management", `&programId=${P1}`);
  check("management: programme filter", val(m, "Mentors") === 2 && val(m, "Mentees") === 2 && val(m, "Matches") === 1 && val(m, "Meetings") === 2,
        `${val(m, "Mentors")}/${val(m, "Mentees")}/${val(m, "Matches")}/${val(m, "Meetings")}`);
  m = await rep("management", "&programId=none");
  check("management: \"no programme\" filter", val(m, "Mentees") === 1 && val(m, "Matches") === 0);
  m = await rep("management", "&from=2026-09-15");
  check("management: date filter (meetings in the range)", val(m, "Meetings") === 2, `${val(m, "Meetings")}`);
  check("management: no meeting content in the report", !JSON.stringify(m).includes('"x"'));

  // B
  const bRep = (await api(B, "GET", "/reports/management?lang=en")).json;
  check("B's report has none of R's people", !JSON.stringify(bRep || {}).includes("Rapormentor") && !JSON.stringify(bRep || {}).includes("Raporlu"));
  check("B cannot filter by R's programme -> 404", (await api(B, "GET", `/reports/management?programId=${P1}`)).status === 404);
  check("super admin has no organisation report -> 401", (await api(SA, "GET", "/reports/management")).status === 401);

  // Feedback and closing survey (the e-mails fail here; the rounds and surveys are made)
  const ci = (await api(R, "POST", `/mentorships/${msA.id}/checkin`, { target: "both", language: "en" })).json;
  const tokenOf = url => new URL(url).searchParams.get("token");
  const menteeLink = ci.failed.find(x => x.role === "mentee").checkinUrl;
  const page = (await api(null, "GET", `/public/checkin/${tokenOf(menteeLink)}`)).json;
  const ans = {};
  for (const q of page.questions) ans[q.id] = q.type === "scale5" ? 4 : q.type === "yesno" ? (q.support ? "yes" : "no") : "Asli Raporlu thinks it goes well";
  await api(null, "POST", `/public/checkin/${tokenOf(menteeLink)}`, { answers: ans });

  const sv = await api(R, "POST", `/mentorships/${msC.id}/survey`, { role: "mentee", language: "en" });
  const sTok = tokenOf(sv.json.surveyUrl);
  const def = (await api(null, "GET", `/public/survey/${sTok}`)).json.definition;
  const sa = {};
  for (const sec of def.sections) for (const q of sec.questions) {
    sa[q.id] = q.type === "scale5" ? 5 : q.type === "nps" ? 9 : q.type === "choice" ? (q.options?.[0]?.value || "yes") : "Cem Raporlu and Ruya Rapormentor were great";
  }
  await api(null, "POST", `/public/survey/${sTok}`, { answers: sa });

  const sr = await rep("surveys");
  check("survey results: feedback counts", val(sr, "Feedback rounds sent") === 2 && val(sr, "Feedback rounds answered") === 1 &&
        val(sr, "People asking for support (latest answer)") === 1, JSON.stringify(sr?.summary?.slice(0, 5)));
  check("survey results: closing survey counts", val(sr, "Closing surveys sent") === 1 && val(sr, "Closing surveys answered") === 1 &&
        val(sr, "NPS (net promoter score) — Mentee") === "100");
  const t = key => (sr?.tables || []).find(x => x.key === key);
  const comments = JSON.stringify(t("comments")?.rows || []);
  check("open answers are anonymous, names inside them masked",
        comments.length > 2 && !/Raporlu|Rapormentor/.test(comments), comments.slice(0, 120));
  const named = JSON.stringify(t("ci_detail")?.rows || []) + JSON.stringify(t("support")?.rows || []);
  check("on screen: named person-by-person answers", /Asli Raporlu/.test(named));
  const files = JSON.stringify(["support", "ci_detail", "cs_detail"].map(k => [t(k)?.exportColumns, t(k)?.exportRows]));
  check("for the files: no names, no matches, participants numbered",
        !/Raporlu|Rapormentor/.test(files) && /Participant 1/.test(files) && t("ci_detail")?.screenOnly === true);
  const mAll = await rep("management");
  const row = (mAll.tables.find(x => x.key === "matches")?.rows || []).find(r => r[0] === "Rasim Rapormentor");
  check("management: \"needs support\" column", row && row[row.length - 1] === "Yes", JSON.stringify(row));

  // Deleted mentee
  await api(R, "DELETE", `/mentees/${c}`);
  const after = await rep("management");
  const crow = (after.tables.find(x => x.key === "matches")?.rows || []).find(r => r[0] === "Ruya Rapormentor");
  check("a deleted mentee appears as \"(deleted mentee)\"", crow && crow[1] === "(deleted mentee)" && !JSON.stringify(after).includes("Cem Raporlu"),
        JSON.stringify(crow));
  check("... and their closing survey is gone from the results", val(await rep("surveys"), "Closing surveys sent") === 0);
}

main().catch(err => {
  console.error("\n  TENANT TEST COULD NOT RUN:", err.message);
  process.exit(2);
});
