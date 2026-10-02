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

async function startServer() {
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
    PII_SCRUBBING: "true"
  };

  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"]
  });
  let log = "";
  child.stdout.on("data", d => { log += d; });
  child.stderr.on("data", d => { log += d; });

  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(base + "/health");
      if (r.ok) return { child, base, tmp, superPassword };
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 250));
  }
  child.kill();
  throw new Error("Temporary server did not start.\n" + log);
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

async function login(username, password) {
  const r = await fetch(BASE + "/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const cookie = (r.headers.getSetCookie()[0] || "").split(";")[0];
  if (r.status !== 200 || !cookie) throw new Error(`Sign-in failed for ${username}: HTTP ${r.status}`);
  return cookie;
}

// ---------------------------------------------------------------------
// The test
// ---------------------------------------------------------------------

async function main() {
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
    mentorId: mentorA, menteeId: menteeA, mentorName: "Ayse Mentor", menteeName: "Ali Mentee",
    mentorEmail: "ayse@a.example", menteeEmail: "ali@a.example",
    developmentNeed: "Wants to grow as a team lead"
  })).mentorshipId;
  const meetingA = (await mk(A, `/mentorships/${msA}/meetings`, {
    meetingDate: "2026-09-01", title: "Kick-off",
    actionItems: [{ text: "Read the plan", status: "open" }]
  })).meetingId;
  const reqA = (await mk(A, "/match-request", {
    mentorId: mentorA, mentorName: "Ayse Mentor", menteeId: menteeA2
  })).requestId;

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

  // --- 3. Positive controls: A still reaches its own records ----------
  console.log("\n2) OWN RECORDS STILL WORK (positive control)\n");

  const own = [
    ["GET", `/mentors/${mentorA}`],
    ["GET", `/mentees/${menteeA}`],
    ["GET", `/mentorships/${msA}`],
    ["GET", `/mentorships/${msA}/meetings`],
    ["GET", `/match-request/${reqA}`],
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
    ["GET",    `/match-request/${reqA}`],
    ["POST",   `/email/approval/${reqA}`, { target: "both" }],
    ["POST",   `/email/workspace/${msA}`, { target: "both" }],
    // Records of A named in the REQUEST BODY
    ["POST",   "/mentorships", { mentorId: mentorA, menteeId: menteeB }],
    ["POST",   "/mentorships", { mentorId: mentorB, menteeId: menteeA }],
    ["POST",   "/match", { menteeId: menteeA }],
    ["POST",   "/match-request", { mentorId: mentorA, mentorName: "x", menteeId: menteeB }],
    ["POST",   "/match-request", { mentorId: mentorB, mentorName: "x", menteeId: menteeA }],
    ["POST",   "/development-plan", { mentorshipId: msA }],
    ["POST",   "/guided-session", { mentorshipId: msA, step: 1 }],
    // Destructive calls last
    ["DELETE", `/match-request/${reqA}`],
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

  // --- 5. A's data is exactly as before -------------------------------
  console.log("\n4) ORGANISATION A's DATA IS UNTOUCHED\n");

  const mentor = (await api(A, "GET", `/mentors/${mentorA}`)).json;
  check("A's mentor still exists, unchanged", mentor?.role === "Director", mentor ? mentor.role : "deleted");

  const mentee = (await api(A, "GET", `/mentees/${menteeA}`)).json;
  check("A's mentee still exists, unchanged", mentee?.role === "Analyst", mentee ? mentee.role : "deleted");

  const ms = (await api(A, "GET", `/mentorships/${msA}`)).json;
  check("A's mentorship still active", ms?.status === "active", ms ? ms.status : "deleted");
  check("A's closing date unchanged", ms && !ms.closingDate, ms?.closingDate || "");
  check("A's development plan unchanged", ms && (ms.goals || []).length === 0);
  check("A's meetings unchanged (1 note, action open)",
        ms && (ms.meetings || []).length === 1 && ms.meetings[0].actionItems?.[0]?.status === "open",
        ms ? `${(ms.meetings || []).length} note(s)` : "");

  const req = await api(A, "GET", `/match-request/${reqA}`);
  check("A's match request still exists", req.status === 200, `HTTP ${req.status}`);

  const msB = (await api(B, "GET", "/mentorships")).json || [];
  const reqB = (await api(B, "GET", "/match-requests")).json || [];
  check("nothing was created for B from A's records", msB.length === 0 && reqB.length === 0,
        `${msB.length} mentorship(s), ${reqB.length} request(s)`);

  // --- 6. A's own changes still work ----------------------------------
  console.log("\n5) ORGANISATION A CAN STILL CHANGE ITS OWN RECORDS\n");

  const act = await api(A, "PATCH", `/mentorships/${msA}/meetings/${meetingA}/action`, { index: 0, status: "done" });
  check("A: toggles an action item of its own meeting", act.status === 200 && act.json?.meeting?.actionItems?.[0]?.status === "done",
        `HTTP ${act.status}`);

  const wrongMeeting = await api(A, "PATCH", `/mentorships/${msA}/meetings/${"0".repeat(24)}/action`, { index: 0, status: "done" });
  check("A: unknown meeting id under its mentorship -> 404", wrongMeeting.status === 404, `HTTP ${wrongMeeting.status}`);

  const upd = await api(A, "PATCH", `/mentors/${mentorA}`, { role: "Vice President" });
  check("A: updates its own mentor", upd.status === 200 && upd.json?.mentor?.role === "Vice President", `HTTP ${upd.status}`);

  const del = await api(A, "DELETE", `/match-request/${reqA}`);
  check("A: deletes its own match request", del.status === 200, `HTTP ${del.status}`);
}

main().catch(err => {
  console.error("\n  TENANT TEST COULD NOT RUN:", err.message);
  process.exit(2);
});
