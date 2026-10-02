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
    mentorId: mentorA, menteeId: menteeA, mentorName: "Ayse Mentor", menteeName: "Ali Mentee",
    mentorEmail: "ayse@a.example", menteeEmail: "ali@a.example",
    developmentNeed: "Wants to grow as a team lead"
  })).mentorshipId;
  const meetingA = (await mk(A, `/mentorships/${msA}/meetings`, {
    meetingDate: "2026-09-01", title: "Kick-off", durationMinutes: "01:20",
    agenda: "PRIVATE AGENDA TEXT",
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
  // B's own mentorship - its workspace link is a valid token, but only
  // for B's workspace.
  const wsB = new URL((await mk(B, "/mentorships", {
    mentorId: mentorB, menteeId: menteeB, mentorName: "Bora Mentor", menteeName: "Banu Mentee",
    developmentNeed: "Wants to learn negotiation"
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
  check("A's closing date unchanged", ms && !ms.closingDate, ms?.closingDate || "");
  check("A's development plan unchanged", ms && (ms.goals || []).length === 0);
  check("A's meetings unchanged (1 note, action open)",
        ms && (ms.meetings || []).length === 1 && ms.meetings[0].actionItems?.[0]?.status === "open",
        ms ? `${(ms.meetings || []).length} note(s)` : "");

  const req = await api(A, "GET", `/match-request/${reqA}`);
  check("A's match request still exists", req.status === 200, `HTTP ${req.status}`);

  const listB = (await api(B, "GET", "/mentorships")).json || [];
  const reqB = (await api(B, "GET", "/match-requests")).json || [];
  check("nothing was created for B from A's records",
        listB.length === 1 && listB[0].id === msB && reqB.length === 0,
        `${listB.length} mentorship(s), ${reqB.length} request(s)`);

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

  await programmeChecks(server, { A, B, mentorA, menteeA, menteeA2, mentorB, menteeB, msA });
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
  const Database = require("better-sqlite3");
  const db = new Database(server.dbPath);
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
}

main().catch(err => {
  console.error("\n  TENANT TEST COULD NOT RUN:", err.message);
  process.exit(2);
});
