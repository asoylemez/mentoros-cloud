/**
 * Workspace (V07): personal links, waiting surveys, next meeting place.
 *
 *   npm run workspace-test
 *
 * Temporary server, temporary encrypted database and a local test mail
 * server. Checks: everyone gets their own workspace link; the page knows
 * who opened it; only the viewer's OWN survey carries its link; the old
 * shared link still works (status only); announcements open with personal
 * links; the next meeting place is saved and goes into the calendar invite.
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mentoros-workspace-"));
const SUPER_PW = crypto.randomBytes(12).toString("hex");
const ENV_BASE = {
  CLOUD: "false", DB_PATH: path.join(TMP, "workspace-test.db"), BACKUP_DIR: path.join(TMP, "backups"),
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



const qpd = raw => raw.replace(/=\r?\n/g, "").replace(/=3D/g, "=");
const linkIn = m => (qpd(m.raw).match(/mentorship_workspace\.html\?id=([a-z0-9]+)&(?:amp;)?token=([A-Za-z0-9_-]+)/) || []).slice(1);

async function run() {
  await start();
  const SA = await login("superadmin", SUPER_PW);
  const pw = crypto.randomBytes(9).toString("hex");
  await api(SA, "POST", "/companies", { companyId: "ws-a", name: "Alfa", password: pw });
  const A = await login("ws-a", pw);
  const sink = await startSink();
  const tok = (await api(null, "POST", "/admin/login", { password: SUPER_PW })).json?.token;
  await fetch(BASE + "/admin/smtp-config", { method: "PUT", headers: { "Content-Type": "application/json", "x-admin-token": tok },
    body: JSON.stringify({ host: "127.0.0.1", port: sink.port, secure: false, fromName: "T", fromEmail: "noreply@test.example" }) });
  try {
    const mk = async (u, b) => (await api(A, "POST", u, b)).json;
    const mentor = (await mk("/mentors", { fullName: "Mert Ak", email: "mert@a.example", capacity: 5 })).id;
    const ece = (await mk("/mentees", { fullName: "Ece Su", email: "ece@a.example", developmentNeeds: "x" })).id;
    const can = (await mk("/mentees", { fullName: "Can Er", email: "can@a.example", developmentNeeds: "x" })).id;
    const ali = (await mk("/mentees", { fullName: "Ali Ok", email: "ali@a.example", developmentNeeds: "x" })).id;
    const res1 = await mk("/mentorships", { mentorId: mentor, menteeId: ece, closingDate: "2030-12-31" });
    const ms = res1.mentorship, shared = new URL(res1.workspaceUrl).searchParams.get("token");
    const G = (await mk("/mentee-groups", { name: "Takım", memberIds: [can, ali] })).group.id;
    const gms = (await mk("/mentorships", { mentorId: mentor, groupId: G, closingDate: "2030-12-31" })).mentorship;
    const ws = (id, token) => api(null, "GET", `/public/workspace/${id}?token=${encodeURIComponent(token)}`);

    // --- 1. Personal links in the workspace e-mail -------------------------
    let n = sink.messages.length;
    await api(A, "POST", `/email/workspace/${ms.id}`, { target: "both", lang: "tr" });
    const mails = sink.messages.slice(n);
    const linkOf = addr => linkIn(mails.find(m => m.rcpt[0] === addr) || { raw: "" });
    const [, tMentor] = linkOf("mert@a.example"), [, tEce] = linkOf("ece@a.example");
    check("each person gets their own workspace link (not the shared one)",
          tMentor && tEce && tMentor !== tEce && tMentor !== shared && tEce !== shared, JSON.stringify([tMentor, tEce]));
    n = sink.messages.length;
    await api(A, "POST", `/email/workspace/${ms.id}`, { target: "mentee", lang: "tr" });
    check("sending again gives the same personal link", linkIn(sink.messages[n] || { raw: "" })[1] === tEce);

    let r = await ws(ms.id, tMentor);
    check("the page knows who opened it (mentor)", r.status === 200 && r.json?.viewer?.role === "mentor" && r.json.viewer.name === "Mert Ak");
    check("no token is sent back to the page", !("accessToken" in (r.json || {})));
    r = await ws(ms.id, shared);
    check("the old shared link still works (viewer unknown)", r.status === 200 && r.json?.viewer === null);
    check("a personal link of another workspace -> 403", (await ws(gms.id, tMentor)).status === 403);
    check("a wrong token -> 403", (await ws(ms.id, "nope")).status === 403);

    // --- 2. Waiting surveys -------------------------------------------------------
    await api(A, "POST", `/mentorships/${ms.id}/checkin`, { target: "both", language: "tr" });
    await api(A, "POST", `/mentorships/${ms.id}/survey`, { role: "mentee", language: "tr" });
    r = await ws(ms.id, tEce);
    const pend = r.json?.pendingSurveys || [];
    check("waiting surveys listed with type, role and date", pend.length === 3 &&
          pend.some(x => x.type === "checkin" && x.role === "mentor") && pend.some(x => x.type === "closing" && x.role === "mentee") && pend.every(x => x.sentAt));
    const mine = pend.filter(x => x.mine);
    check("the mentee's page: links only to the mentee's own surveys",
          mine.length === 2 && mine.every(x => x.role === "mentee" && x.url) && pend.filter(x => !x.mine).every(x => !x.url));
    const ciUrl = mine.find(x => x.type === "checkin").url;
    check("the link opens the mentee's own mid-term survey",
          (await api(null, "GET", `/public/checkin/${new URL("http://x" + ciUrl).searchParams.get("token")}`)).status === 200);
    r = await ws(ms.id, shared);
    check("shared link: status only, no survey links", (r.json?.pendingSurveys || []).length === 3 && r.json.pendingSurveys.every(x => !x.url && !x.mine));
    r = await ws(ms.id, tMentor);
    check("the mentor's page: only the mentor's link", (r.json?.pendingSurveys || []).filter(x => x.url).every(x => x.role === "mentor") &&
          r.json.pendingSurveys.filter(x => x.url).length === 1);
    let db = openDb();
    db.prepare(`UPDATE checkins SET status = 'completed', completed_at = ? WHERE mentorship_id = ? AND role = 'mentor'`).run(new Date().toISOString(), ms.id);
    db.close();
    r = await ws(ms.id, tMentor);
    check("an answered survey is no longer listed", (r.json?.pendingSurveys || []).length === 2 && !r.json.pendingSurveys.some(x => x.mine));

    // Group: each member sees only their own link
    n = sink.messages.length;
    await api(A, "POST", `/email/workspace/${gms.id}`, { target: "mentee", lang: "tr" });
    const gm = sink.messages.slice(n);
    const tCan = linkIn(gm.find(m => m.rcpt[0] === "can@a.example") || { raw: "" })[1];
    await api(A, "POST", `/mentorships/${gms.id}/checkin`, { target: "mentee", language: "tr" });
    r = await ws(gms.id, tCan);
    const gp = r.json?.pendingSurveys || [];
    check("group member: both members' surveys listed, only Can's has a link",
          r.json?.viewer?.name === "Can Er" && gp.length === 2 && gp.filter(x => x.url).length === 1 && gp.find(x => x.url).name === "Can Er");

    // --- 3. Announcements with a personal link ------------------------------------
    check("announcements open with a personal link", (await api(null, "GET", `/public/workspace/${ms.id}/announcements?token=${tEce}`)).status === 200);
    check("... and not with a wrong one", (await api(null, "GET", `/public/workspace/${ms.id}/announcements?token=nope`)).status === 403);

    // --- 4. Next meeting place -------------------------------------------------------
    n = sink.messages.length;
    r = await api(null, "POST", `/public/workspace/${ms.id}/meetings?token=${tEce}`, {
      meetingDate: "2026-11-01", title: "Görüşme", durationMinutes: "01:00", createdBy: "mentee",
      nextMeetingDate: "2026-12-01", nextMeetingTime: "14:30", nextMeetingLocation: "https://teams.example/join/abc\nikinci satir", language: "tr"
    });
    check("meeting saved with the next meeting place (one line)", r.status === 200 &&
          r.json?.meeting?.nextMeetingLocation === "https://teams.example/join/abc ikinci satir", JSON.stringify(r.json?.meeting?.nextMeetingLocation));
    const w = (await ws(ms.id, tEce)).json;
    check("the workspace shows the next meeting place", w?.nextMeetingLocation === "https://teams.example/join/abc ikinci satir" && w.nextMeetingDate === "2026-12-01");
    const inv = sink.messages.slice(n);
    const raw = inv.map(m => qpd(m.raw)).join("\n");
    check("calendar invite carries the place (LOCATION) to mentor and mentee",
          inv.length === 2 && /LOCATION:https:\/\/teams\.example\/join\/abc ikinci satir/.test(raw.replace(/\r?\n /g, "")) && /Yer \/ ba/.test(raw), String(inv.length));
    r = await api(null, "POST", `/public/workspace/${ms.id}/meetings?token=${tEce}`, {
      meetingDate: "2026-11-02", title: "Kısa", durationMinutes: "00:30", nextMeetingLocation: "Oda 3", language: "tr" });
    check("no next meeting date -> the place is not kept", r.json?.meeting?.nextMeetingLocation === "");
    r = await api(null, "POST", `/public/workspace/${ms.id}/meetings?token=${tEce}`, {
      meetingDate: "2026-11-03", title: "Uzun", durationMinutes: "00:30", nextMeetingDate: "2026-12-05", nextMeetingLocation: "x".repeat(800), language: "tr" });
    check("the place is cut to 500 characters", r.json?.meeting?.nextMeetingLocation?.length === 500);
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
  console.log(`  WORKSPACE TEST: ${results.length} checks - ${results.length - failed.length} passed, ${failed.length} failed`);
  console.log("============================================================\n");
  process.exit(failed.length ? 1 : 0);
})();
