/**
 * Several programmes per mentee (V02).
 *
 *   npm run multiprogram-test
 *
 * Temporary server + temporary encrypted database. Checks:
 *   - a mentee can be in several programmes
 *   - one active match per mentee PER PROGRAMME (parallel in others)
 *   - the match is made in the requested programme
 *   - groups: one per mentee per programme
 *   - removing a programme: warns when a match runs there, refused in a group
 *   - old data (single mentees.program_id) is moved, only once
 *   - management report: programme table, mentee table, counts
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mentoros-multiprog-"));
const SUPER_PW = crypto.randomBytes(12).toString("hex");
const ENV_BASE = {
  CLOUD: "false", DB_PATH: path.join(TMP, "multiprog-test.db"), BACKUP_DIR: path.join(TMP, "backups"),
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
  const pw = crypto.randomBytes(9).toString("hex");
  await api(SA, "POST", "/companies", { companyId: "multi", name: "multi", password: pw });
  const C = await login("multi", pw);
  const post = async (url, body) => (await api(C, "POST", url, body)).json;

  const P1 = (await post("/programs", { name: "P1 Leaders", startDate: "2026-01-01", endDate: "2027-12-31" })).program;
  const P2 = (await post("/programs", { name: "P2 Talent", startDate: "2026-01-01", endDate: "2027-12-31" })).program;
  const mentor = async (name, programIds) => {
    const id = (await post("/mentors", { fullName: name, email: `${name.toLowerCase()}@m.example`, role: "Director", capacity: 5 })).id;
    await api(C, "PUT", `/mentors/${id}/programs`, { programIds });
    return id;
  };
  const mentee = async (name, programIds) => {
    const id = (await post("/mentees", { fullName: name, email: `${name.toLowerCase()}@m.example`, role: "Analyst",
                                        department: "Finance", developmentNeeds: `${name} wants to grow` })).id;
    return { id, put: await api(C, "PUT", `/mentees/${id}/programs`, { programIds }) };
  };
  const m1 = await mentor("Mert", [P1.id]);
  const m2 = await mentor("Nazli", [P2.id]);
  const m3 = await mentor("Ozan", [P1.id, P2.id]);

  // --- 1. Several programmes -------------------------------------------
  const E1 = await mentee("Ece", [P1.id, P2.id]);
  const e1 = E1.id;
  check("a mentee can be put in two programmes", E1.put.status === 200 && E1.put.json?.mentee?.programIds?.length === 2,
        JSON.stringify(E1.put.json));
  const e2 = (await mentee("Emre", [P1.id, P2.id])).id;
  const e3 = (await mentee("Elif", [P1.id, P2.id])).id;
  const e4 = (await mentee("Eda", [P1.id, P2.id])).id;
  const e5 = (await mentee("Erol", [P1.id])).id;
  const progs = (await api(C, "GET", "/programs")).json || [];
  check("programme head counts count the mentee in each programme",
        progs.find(p => p.id === P1.id)?.menteeCount === 5 && progs.find(p => p.id === P2.id)?.menteeCount === 4);
  const cand = async pid => ((await api(C, "GET", `/matching-candidates?programId=${pid}`)).json?.mentees || []);
  check("the mentee is a candidate in both programmes",
        (await cand(P1.id)).some(m => m.id === e1) && (await cand(P2.id)).some(m => m.id === e1));

  // --- 2. Matches per programme ------------------------------------------
  const match = (mentorId, menteeId, programId) =>
    api(C, "POST", "/mentorships", { mentorId, menteeId, language: "en", ...(programId ? { programId } : {}) });
  let r = await match(m1, e1);
  check("match without a programme for a mentee in two -> 400 program_choose", r.status === 400 && r.json?.code === "program_choose");
  r = await api(C, "POST", "/match", { menteeId: e1, language: "en" });
  check("AI suggestions without a programme for a mentee in two -> 400 program_choose", r.status === 400 && r.json?.code === "program_choose");
  r = await match(m1, e1, P1.id);
  check("match in P1 opens, in P1", r.status === 200 && r.json?.mentorship?.programId === P1.id, `HTTP ${r.status}`);
  const msP1 = r.json?.mentorship?.id;
  r = await match(m3, e1, P1.id);
  check("a second match in the same programme -> 409", r.status === 409 && r.json?.code === "mentee_already_engaged");
  check("the mentee shows as matched in P1's candidates",
        (await cand(P1.id)).find(m => m.id === e1)?.engagement?.state === "matched");
  check("... and as free in P2's candidates", (await cand(P2.id)).find(m => m.id === e1)?.engagement?.state === "available");
  r = await match(m2, e1, P2.id);
  check("a parallel match in P2 opens", r.status === 200 && r.json?.mentorship?.programId === P2.id, `HTTP ${r.status}`);
  r = await match(m2, e5, P2.id);
  check("a programme the mentee is not in -> 400 program_not_assigned", r.status === 400 && r.json?.code === "program_not_assigned");
  r = await match(m1, e2, P2.id);
  check("a mentor not in the chosen programme -> 400 mentor_not_in_program", r.status === 400 && r.json?.code === "mentor_not_in_program");

  // --- 3. Groups ------------------------------------------------------------
  const group = (name, programId, memberIds) => api(C, "POST", "/mentee-groups", { name, programId, memberIds });
  r = await group("G1", P1.id, [e2, e3]);
  check("group in P1", r.status === 200, JSON.stringify(r.json));
  const g1 = r.json?.group?.id;
  r = await group("G2", P2.id, [e2, e3]);
  check("the same mentees can form a group in P2 too", r.status === 200, JSON.stringify(r.json));
  const g2 = r.json?.group?.id;
  r = await group("G3", P1.id, [e2, e4]);
  check("a second group in the same programme -> member_in_other_group", r.status === 409 && r.json?.code === "member_in_other_group", JSON.stringify(r.json));
  r = await group("G4", P2.id, [e1, e4]);
  check("a mentee matched in P2 cannot join a P2 group -> member_engaged", r.status === 409 && r.json?.code === "member_engaged", JSON.stringify(r.json));
  r = await match(m3, e2, P1.id);
  check("a group member cannot be matched alone in the group's programme -> 409", r.status === 409 && r.json?.code === "mentee_in_group");
  r = await group("G5", P1.id, [e4, e5]);
  const g5 = r.json?.group?.id;
  r = await match(m3, e4, P2.id);
  check("a P1 group member can be matched alone in P2", r.status === 200 && r.json?.mentorship?.programId === P2.id, `HTTP ${r.status}`);
  r = await api(C, "POST", "/mentorships", { mentorId: m3, groupId: g1, language: "en" });
  check("group match is made in the group's programme", r.status === 200 && r.json?.mentorship?.programId === P1.id, `HTTP ${r.status}`);
  const mee = (await api(C, "GET", `/mentees/${e2}`)).json;
  check("a mentee record lists all its groups", (mee?.groups || []).length === 2);

  // --- 4. Removing a programme ----------------------------------------
  r = await api(C, "PUT", `/mentees/${e2}/programs`, { programIds: [P2.id] });
  check("removing a programme where the mentee is in a group -> 409 mentee_in_group", r.status === 409 && r.json?.code === "mentee_in_group");
  r = await api(C, "PUT", `/mentees/${e1}/programs`, { programIds: [P2.id] });
  check("removing a programme with an active match warns first (409, names the programme)",
        r.status === 409 && r.json?.code === "mentee_engaged" && r.json?.programs?.[0]?.name === "P1 Leaders");
  r = await api(C, "PUT", `/mentees/${e1}/programs?force=true`, { programIds: [P2.id] });
  const msAfter = (await api(C, "GET", `/mentorships/${msP1}`)).json;
  check("... after confirming, removed; the P1 match keeps running in P1",
        r.status === 200 && r.json?.mentee?.programIds?.join() === P2.id && msAfter?.status === "active" && msAfter?.programId === P1.id);
  r = await api(C, "PUT", `/mentees/${e3}/programs`, { programIds: [P1.id, P2.id] });
  check("saving the same programmes again is fine", r.status === 200);

  // --- 5. Management report ---------------------------------------------
  const rep = async q => (await api(C, "GET", `/reports/management?lang=en${q || ""}`)).json;
  const all = await rep();
  const tb = (d, k) => d?.tables?.find(t => t.key === k);
  const sum = (d, label) => d?.summary?.find(s => s.label === label)?.value;
  check("report: programme table, one row per programme", tb(all, "programs")?.rows?.length === 2);
  const p1row = tb(all, "programs")?.rows?.find(x => x[0] === "P1 Leaders") || [];
  check("report: P1 row counts (3 mentors... 4 mentees, 3 matches)", p1row[2] === 2 && p1row[3] === 4 && p1row[4] === 2, JSON.stringify(p1row));
  check("report: 'all programmes' counts each mentee once", sum(all, "Mentees") === 5, String(sum(all, "Mentees")));
  const eceRow = tb(all, "mentees")?.rows?.find(x => x[1] === "Ece") || [];
  check("report: mentee row shows programmes and matches in every programme",
        eceRow[5] === "P2 Talent" && /P1 Leaders: Mert/.test(eceRow[6]) && /P2 Talent: Nazli/.test(eceRow[6]), JSON.stringify(eceRow));
  const p2 = await rep(`&programId=${P2.id}`);
  check("report filtered to P2: only P2's mentees", sum(p2, "Mentees") === 4 && tb(p2, "programs")?.rows?.length === 1);

  // --- 6. Old data: one mentees.program_id, before this version -------------
  await stop();
  let db = openDb();
  db.exec(`DROP TABLE program_mentees`);
  // Old group table shape (UNIQUE mentee_id), with only one group per mentee.
  db.exec(`DELETE FROM mentee_group_members WHERE group_id IN (SELECT id FROM mentee_groups WHERE name = 'G2');
           CREATE TABLE gm_old (group_id TEXT NOT NULL, mentee_id TEXT NOT NULL, company_id TEXT NOT NULL, added_at TEXT NOT NULL,
             PRIMARY KEY (group_id, mentee_id), UNIQUE (mentee_id),
             FOREIGN KEY (group_id) REFERENCES mentee_groups(id) ON DELETE CASCADE,
             FOREIGN KEY (mentee_id) REFERENCES mentees(id) ON DELETE CASCADE);
           INSERT INTO gm_old SELECT group_id, mentee_id, company_id, added_at FROM mentee_group_members;
           DROP TABLE mentee_group_members; ALTER TABLE gm_old RENAME TO mentee_group_members;`);
  db.prepare(`UPDATE mentees SET program_id = ? WHERE id = ?`).run(P1.id, e5);
  db.prepare(`UPDATE mentees SET program_id = ? WHERE id = ?`).run(P2.id, e1);
  db.close();
  await start();
  let C2 = await login("multi", pw);
  const get = async id => (await api(C2, "GET", `/mentees/${id}`)).json;
  check("old data: the single programme is moved", (await get(e5))?.programIds?.join() === P1.id && (await get(e1))?.programIds?.join() === P2.id);
  db = openDb();
  const left = db.prepare(`SELECT COUNT(*) n FROM mentees WHERE program_id != ''`).get().n;
  db.close();
  check("old data: the old column is emptied after the move", left === 0);
  // (e1: P2 only, active match there -> confirmed removal)
  const rm = await api(C2, "PUT", `/mentees/${e1}/programs?force=true`, { programIds: [] });
  await stop(); await start(); C2 = await login("multi", pw);
  check("a removed programme does not come back on the next start", rm.status === 200 && (await get(e1))?.programIds?.length === 0);
  check("old data: group memberships are kept after the table rebuild", ((await get(e2))?.groups || []).length === 1);
  for (const id of [e2, e3]) await api(C2, "PUT", `/mentees/${id}/programs`, { programIds: [P1.id, P2.id] });
  const g2again = await api(C2, "PATCH", `/mentee-groups/${g2}`, { memberIds: [e2, e3] });
  check("after the rebuild a mentee can again join a group in another programme", g2again.status === 200, JSON.stringify(g2again.json));
}

(async () => {
  try { await run(); }
  catch (e) { console.error("\n  ERROR: " + e.stack); results.push({ name: "run", ok: false }); }
  finally { await stop(); fs.rmSync(TMP, { recursive: true, force: true }); }
  const failed = results.filter(r => !r.ok);
  console.log("\n============================================================");
  console.log(`  MULTI-PROGRAMME TEST: ${results.length} checks - ${results.length - failed.length} passed, ${failed.length} failed`);
  console.log("============================================================\n");
  process.exit(failed.length ? 1 : 0);
})();
