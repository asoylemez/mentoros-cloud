/**
 * Survey management (V04): who answered, who did not, reminders.
 *
 *   npm run survey-management-test
 *
 * Temporary server, temporary encrypted database and a local test mail
 * server. Checks: the list (both survey types, person numbers, programme,
 * no answers), the 24-hour rule, no e-mail / inactive match, reminders to
 * selected people and to everyone waiting, organisation separation.
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mentoros-survmgmt-"));
const SUPER_PW = crypto.randomBytes(12).toString("hex");
const ENV_BASE = {
  CLOUD: "false", DB_PATH: path.join(TMP, "survmgmt-test.db"), BACKUP_DIR: path.join(TMP, "backups"),
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

function startSink() {
  return new Promise(resolve => {
    const messages = [];
    const srv = net.createServer(sock => {
      let data = false, buf = "", msg = "", rcpt = [];
      // The mail client may drop the connection abruptly (on Windows this
      // arrives as ECONNRESET, e.g. after a refused recipient). That is
      // normal for this test server; without a handler Node would stop the
      // whole test with "Unhandled 'error' event".
      sock.on("error", () => {});
      sock.write("220 sink ESMTP\r\n");
      sock.on("data", chunk => {
        buf += chunk.toString("utf8");
        let i;
        while ((i = buf.indexOf("\r\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 2);
          if (sock.destroyed) return;
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
    srv.on("error", () => {});
    srv.listen(0, "127.0.0.1", () => resolve({ port: srv.address().port, messages, close: () => srv.close() }));
  });
}

/** Decodes a quoted-printable body enough to search it for text. */

// Quoted-printable / base64 body parts -> readable UTF-8 text.
function decodeMail(raw) {
  let out = raw;
  const qpd = s => {
    s = s.replace(/=\r?\n/g, "");
    const bytes = [];
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "=" && /^[0-9A-F]{2}$/.test(s.substr(i + 1, 2))) { bytes.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
      else bytes.push(s.charCodeAt(i) & 0xff);
    }
    return Buffer.from(bytes).toString("utf8");
  };
  out = qpd(out);
  // base64 blocks (nodemailer uses them for some parts)
  out += "\n" + (raw.match(/(?:^[A-Za-z0-9+/=]{60,}\n)+/gm) || []).map(b => Buffer.from(b.replace(/\n/g, ""), "base64").toString("utf8")).join("\n");
  // encoded subject words
  out = out.replace(/=\?UTF-8\?([QB])\?([^?]*)\?=/gi, (_, enc, txt) =>
    enc.toUpperCase() === "B" ? Buffer.from(txt, "base64").toString("utf8") : qpd(txt.replace(/_/g, " ")));
  return out;
}
// Subject header straight from the raw message (folded lines joined, encoded words decoded).
function subjectOf(m) {
  const head = m.raw.split(/\n\n/)[0].replace(/\n[ \t]+/g, " ");
  const raw = (head.match(/^Subject: (.*)$/m) || [])[1] || "";
  return raw.replace(/\?=\s+=\?/g, "?==?").replace(/=\?UTF-8\?([QB])\?([^?]*)\?=/gi, (_, enc, txt) => {
    if (enc.toUpperCase() === "B") return Buffer.from(txt, "base64").toString("utf8");
    const t = txt.replace(/_/g, " ");
    const bytes = [];
    for (let i = 0; i < t.length; i++) {
      if (t[i] === "=" && /^[0-9A-F]{2}$/i.test(t.substr(i + 1, 2))) { bytes.push(parseInt(t.substr(i + 1, 2), 16)); i += 2; }
      else bytes.push(t.charCodeAt(i) & 0xff);
    }
    return Buffer.from(bytes).toString("utf8");
  }).trim();
}


async function run() {
  await start();
  const SA = await login("superadmin", SUPER_PW);
  const pw = { a: crypto.randomBytes(9).toString("hex"), b: crypto.randomBytes(9).toString("hex") };
  await api(SA, "POST", "/companies", { companyId: "sm-a", name: "Alfa", password: pw.a });
  await api(SA, "POST", "/companies", { companyId: "sm-b", name: "Beta", password: pw.b });
  let A = await login("sm-a", pw.a);
  let B = await login("sm-b", pw.b);
  const sink = await startSink();
  const tok = (await api(null, "POST", "/admin/login", { password: SUPER_PW })).json?.token;
  await fetch(BASE + "/admin/smtp-config", { method: "PUT", headers: { "Content-Type": "application/json", "x-admin-token": tok },
    body: JSON.stringify({ host: "127.0.0.1", port: sink.port, secure: false, fromName: "T", fromEmail: "noreply@test.example" }) });

  try {
    const mk = async (u, b) => (await api(A, "POST", u, b)).json;
    const P1 = (await mk("/programs", { name: "Liderlik", startDate: "2026-01-01", endDate: "2027-12-31" })).program;
    const mentor = (await mk("/mentors", { fullName: "Mert Ak", email: "mert@a.example", capacity: 5 })).id;
    await api(A, "PUT", `/mentors/${mentor}/programs`, { programIds: [P1.id] });
    const me = async (n, email) => { const id = (await mk("/mentees", { fullName: n, email, developmentNeeds: "x" })).id;
      await api(A, "PUT", `/mentees/${id}/programs`, { programIds: [P1.id] }); return id; };
    const e1 = await me("Ece Su", "ece@a.example"), e2 = await me("Can Er", "can@a.example"), e3 = await me("Ali Ok", "ali@a.example");
    const e4 = await me("Nur Yok", "");
    const ms1 = (await mk("/mentorships", { mentorId: mentor, menteeId: e1, programId: P1.id })).mentorship;
    const G = (await mk("/mentee-groups", { name: "Takım", programId: P1.id, memberIds: [e2, e3] })).group.id;
    const gms = (await mk("/mentorships", { mentorId: mentor, groupId: G })).mentorship;
    const ms4 = (await mk("/mentorships", { mentorId: mentor, menteeId: e4, programId: P1.id })).mentorship;

    await api(A, "POST", `/mentorships/${ms1.id}/checkin`, { target: "both", language: "tr" });     // 2
    await api(A, "POST", `/mentorships/${gms.id}/checkin`, { target: "both", language: "en" });     // 3
    await api(A, "POST", `/mentorships/${ms4.id}/checkin`, { target: "mentee", language: "tr" });   // 1 (no e-mail)
    await api(A, "POST", `/mentorships/${ms1.id}/survey`, { role: "mentee", language: "tr" });      // 1 closing
    let db = openDb();
    db.prepare(`UPDATE checkins SET status = 'completed', completed_at = ?, answers = '{"q":"SECRET ANSWER"}' WHERE mentorship_id = ? AND role = 'mentee'`)
      .run(new Date().toISOString(), ms1.id);
    db.close();

    // --- 1. The list --------------------------------------------------------
    check("unauthenticated -> 401", (await api(null, "GET", "/survey-management")).status === 401);
    let L = (await api(A, "GET", "/survey-management")).json;
    const rows = L?.rows || [];
    check("one row per person per survey (6 mid-term + 1 closing)", rows.length === 7 &&
          rows.filter(r => r.type === "checkin").length === 6 && rows.filter(r => r.type === "closing").length === 1, String(rows.length));
    const eceCi = rows.find(r => r.type === "checkin" && r.name === "Ece Su");
    check("answered row: completed, with person number and programme",
          eceCi?.status === "completed" && /^\d{4}$/.test(eceCi.sicilNo) && eceCi.programName === "Liderlik" && !eceCi.canRemind);
    check("the answers are never in the list", !JSON.stringify(L).includes("SECRET ANSWER") && !rows.some(r => "answers" in r));
    check("group members are listed one by one with their own number",
          rows.filter(r => r.group && r.role === "mentee").length === 2 && rows.filter(r => r.group && r.role === "mentee").every(r => r.sicilNo));
    check("just sent -> cannot be reminded yet (too_soon, next time given)",
          rows.filter(r => r.status === "pending" && r.blocker === "too_soon").length === 5 &&
          rows.every(r => r.blocker !== "too_soon" || r.nextReminderAt));
    check("no e-mail address -> no_email", rows.find(r => r.name === "Nur Yok")?.blocker === "no_email");
    check("B sees none of A's surveys", ((await api(B, "GET", "/survey-management")).json?.rows || []).length === 0);

    const remind = (c, items) => api(c, "POST", "/survey-management/remind", { items });
    const key = r => ({ type: r.type, id: r.id });
    let n = sink.messages.length;
    let r = await remind(A, rows.filter(x => x.status === "pending").map(key));
    check("reminding within 24 hours: nothing sent, all skipped",
          r.json?.sent?.length === 0 && r.json.skipped.length === 6 && sink.messages.length === n);

    // --- 2. After 24 hours ------------------------------------------------------
    await stop();
    db = openDb();
    const old = new Date(Date.now() - 25 * 3600e3).toISOString();
    db.prepare(`UPDATE checkins SET sent_at = ?`).run(old);
    db.prepare(`UPDATE surveys SET sent_at = ?`).run(old);
    db.close();
    await start();
    A = await login("sm-a", pw.a);
    B = await login("sm-b", pw.b);   // sessions do not survive a restart
    L = (await api(A, "GET", "/survey-management")).json;
    const can = L.rows.filter(x => x.canRemind);
    check("after 24 hours: the 5 pending people with e-mail can be reminded", can.length === 5, String(can.length));

    // B cannot remind A's surveys
    n = sink.messages.length;
    r = await remind(B, can.map(key));
    check("another organisation's ids: not found, nothing sent", r.json?.skipped?.every(x => x.reason === "not_found") && sink.messages.length === n);

    // Selected: the closing survey only
    const closing = can.find(x => x.type === "closing");
    r = await remind(A, [key(closing)]);
    const m = sink.messages[sink.messages.length - 1];
    check("remind selected: one e-mail, the closing survey reminder with the same link",
          r.json?.sent?.length === 1 && sink.messages.length === n + 1 && m.rcpt[0] === "ece@a.example" &&
          /Subject: =\?UTF-8\?Q\?Hat/.test(m.raw) && /survey\.html\?token=/.test(m.raw.replace(/=\r?\n/g, "").replace(/=3D/g, "=")));

    // Everyone waiting (the closing one again is now within 24 hours)
    n = sink.messages.length;
    r = await remind(A, can.map(key));
    check("remind everyone waiting: 4 sent, the one just reminded skipped",
          r.json?.sent?.length === 4 && r.json.skipped.length === 1 && r.json.skipped[0].reason === "too_soon" && sink.messages.length === n + 4,
          JSON.stringify({ s: r.json?.sent?.length, k: r.json?.skipped }));
    const enMail = sink.messages.slice(n).find(x => x.rcpt[0] === "can@a.example");
    check("a reminder goes in the language the survey was sent in (EN)", enMail && /Reminder - Mid-Term Survey/.test(enMail.raw.replace(/=\r?\n/g, "")));
    L = (await api(A, "GET", "/survey-management")).json;
    check("reminders are counted per person", L.rows.filter(x => x.reminderCount === 1).length === 5 && L.rows.every(x => !x.canRemind));

    // --- 3. Rules -------------------------------------------------------------------
    db = openDb();
    db.prepare(`UPDATE checkins SET sent_at = ?, last_reminded_at = ''`).run(old);
    db.prepare(`UPDATE mentorships SET status = 'completed' WHERE id = ?`).run(gms.id);
    db.close();
    L = (await api(A, "GET", "/survey-management")).json;
    check("mid-term survey of a match that is no longer active -> mentorship_not_active",
          L.rows.filter(x => x.type === "checkin" && x.group && x.status === "pending").every(x => x.blocker === "mentorship_not_active"));
    check("too many at once -> 400", (await remind(A, Array.from({ length: 301 }, (_, i) => ({ type: "checkin", id: "x" + i })))).status === 400);
    check("nothing chosen -> 400", (await remind(A, [])).status === 400);
    const page = await fetch(BASE + "/survey_management.html", { headers: { Cookie: A }, redirect: "manual" });
    check("the page opens for HR", page.status === 200);
  } finally {
    sink.close();
  }
}

(async () => {
  try { await run(); }
  catch (e) { console.error("\n  ERROR: " + e.stack); results.push({ name: "run", ok: false }); }
  finally { await stop(); fs.rmSync(TMP, { recursive: true, force: true }); }
  const failed = results.filter(r => !r.ok);
  console.log("\n============================================================");
  console.log(`  SURVEY MANAGEMENT TEST: ${results.length} checks - ${results.length - failed.length} passed, ${failed.length} failed`);
  console.log("============================================================\n");
  process.exit(failed.length ? 1 : 0);
})();
