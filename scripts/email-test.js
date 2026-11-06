/**
 * E-mail templates per organisation + reminders (V03).
 *
 *   npm run email-test
 *
 * Temporary server, temporary encrypted database and a local test mail
 * server (nothing leaves this computer). Checks:
 *   - each organisation edits only its own texts; defaults otherwise
 *   - validation, preview, reset
 *   - the e-mails really sent use the texts, with variables filled in
 *     and HR's text escaped
 *   - mid-term and closing survey reminders use their own texts and are
 *     limited to one per 24 hours
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mentoros-email-"));
const SUPER_PW = crypto.randomBytes(12).toString("hex");
const ENV_BASE = {
  CLOUD: "false", DB_PATH: path.join(TMP, "email-test.db"), BACKUP_DIR: path.join(TMP, "backups"),
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
  await api(SA, "POST", "/companies", { companyId: "mail-a", name: "Alfa Holding", password: pw.a });
  await api(SA, "POST", "/companies", { companyId: "mail-b", name: "Beta AS", password: pw.b });
  const A = await login("mail-a", pw.a), B = await login("mail-b", pw.b);

  const sink = await startSink();
  const tok = (await api(null, "POST", "/admin/login", { password: SUPER_PW })).json?.token;
  const cfg = await fetch(BASE + "/admin/smtp-config", { method: "PUT", headers: { "Content-Type": "application/json", "x-admin-token": tok },
    body: JSON.stringify({ host: "127.0.0.1", port: sink.port, secure: false, fromName: "MentorOS Test", fromEmail: "noreply@test.example" }) });
  if (cfg.status !== 200) throw new Error("could not configure the test mail server");
  const last = () => sink.messages[sink.messages.length - 1];
  const to = addr => sink.messages.filter(m => m.rcpt[0] === addr);

  try {
    // --- 1. List, validation, isolation -----------------------------------
    check("unauthenticated -> 401", (await api(null, "GET", "/email-templates")).status === 401);
    const list = (await api(A, "GET", "/email-templates")).json?.templates || [];
    check("10 templates, all default at first", list.length === 10 && list.every(x => !x.tr.custom && !x.en.custom), String(list.length));
    check("the mid-term survey is named 'Ara Dönem Anketi'", list.find(x => x.key === "checkin")?.tr.subject.startsWith("Ara Dönem Anketi"));

    const put = (c, key, lang, body) => api(c, "PUT", `/email-templates/${key}/${lang}`, body);
    const base = { subject: "S", title: "T", body: "B", button: "Btn" };
    check("empty body -> 400 empty_field", (await put(A, "invite_mentee", "tr", { ...base, body: "  " })).json?.code === "empty_field");
    check("too long subject -> 400 too_long", (await put(A, "invite_mentee", "tr", { ...base, subject: "x".repeat(201) })).json?.code === "too_long");
    check("unknown template -> 404", (await put(A, "nope", "tr", base)).status === 404);
    check("unknown language -> 400", (await put(A, "invite_mentee", "de", base)).status === 400);

    let r = await put(A, "invite_mentee", "tr", { subject: "ZZ Davet {firma}", title: "ZZ Başlık", body: "Merhaba ZZBODY {firma}\n<b>kalin degil</b>", button: "ZZ Buton" });
    check("A saves its mentee invitation", r.status === 200 && r.json?.template?.custom === true);
    const listB = (await api(B, "GET", "/email-templates")).json?.templates || [];
    check("B still has the default text (per organisation)", listB.find(x => x.key === "invite_mentee")?.tr.custom === false);

    const pv = (await api(A, "POST", "/email-templates/invite_mentee/tr/preview", { subject: "P {firma}", title: "T", body: "Hi {ad} <script>x</script>", button: "B" })).json;
    check("preview: variables filled, HR's HTML escaped",
          pv?.subject === "P Alfa Holding" && pv.html.includes("&lt;script&gt;") && !pv.html.includes("<script>x"), pv?.subject);

    // --- 2. Invitations really sent ------------------------------------------
    await api(A, "POST", "/email/invite", { emails: "aday@a.example", lang: "tr", form: "mentee" });
    await api(B, "POST", "/email/invite", { emails: "aday@b.example", lang: "tr", form: "mentee" });
    const ia = decodeMail(to("aday@a.example")[0]?.raw || ""), ib = to("aday@b.example")[0];
    check("A's invitation uses A's text, {firma} filled", subjectOf(to("aday@a.example")[0] || { raw: "" }) === "ZZ Davet Alfa Holding" &&
          ia.includes("ZZBODY Alfa Holding") && ia.includes("ZZ Buton"), subjectOf(to("aday@a.example")[0] || { raw: "" }));
    check("HR's text is escaped in the real e-mail", ia.includes("&lt;b&gt;kalin degil&lt;/b&gt;"));
    check("the registration link is still in the e-mail", /mentee_register\.html\?invite=/.test(ia));
    check("B's invitation uses the default text", ib && subjectOf(ib) === "Beta AS - Mentee Kaydı Daveti", ib && subjectOf(ib));

    // --- 3. Match / workspace e-mail -----------------------------------------
    const mk = async (u, b) => (await api(A, "POST", u, b)).json;
    const mentor = (await mk("/mentors", { fullName: "Mert Ak", email: "mert@a.example", capacity: 2 })).id;
    const mentee = (await mk("/mentees", { fullName: "Ece Su", email: "ece@a.example", developmentNeeds: "x" })).id;
    const ms = (await mk("/mentorships", { mentorId: mentor, menteeId: mentee, closingDate: "2030-12-31" })).mentorship;
    await put(A, "workspace_mentee", "en", { subject: "Match for {name}", title: "Hi", body: "ZZWS {name} with {other} during {period} at {company}", button: "Go" });
    await api(A, "POST", `/email/workspace/${ms.id}`, { target: "both", lang: "en" });
    const wsMentee = to("ece@a.example").find(m => /Match for/.test(subjectOf(m)));
    const wsMentor = to("mert@a.example")[0];
    check("workspace e-mail to the mentee: custom EN text, variables filled",
          wsMentee && subjectOf(wsMentee) === "Match for Ece Su" && /ZZWS Ece Su with Mert Ak during .*2030 at Alfa Holding/.test(decodeMail(wsMentee.raw)),
          wsMentee ? decodeMail(wsMentee.raw).match(/ZZWS[^<]*/)?.[0] : "no mail");
    check("workspace e-mail to the mentor: default mentor text", wsMentor && subjectOf(wsMentor) === "Your mentorship match: your workspace is ready" &&
          /you are the mentor in this match/.test(decodeMail(wsMentor.raw)));
    check("the workspace link is in the e-mail", wsMentee && /mentorship_workspace\.html\?id=/.test(decodeMail(wsMentee.raw)));

    // --- 4. Mid-term survey + reminder --------------------------------------
    await put(A, "checkin_reminder", "tr", { subject: "ZZ Hatırlatma {ad}", title: "T", body: "ZZREM {karşı_taraf}", button: "Aç" });
    let n = sink.messages.length;
    await api(A, "POST", `/mentorships/${ms.id}/checkin`, { target: "mentee", language: "tr" });
    check("mid-term survey request: default TR text", sink.messages.length === n + 1 && subjectOf(last()).startsWith("Ara Dönem Anketi:"), subjectOf(last()));
    r = await api(A, "POST", `/mentorships/${ms.id}/checkin`, { target: "mentee", language: "tr" });
    check("asking again within 24 hours: nothing sent (reminder_too_soon)",
          r.json?.skipped?.[0]?.code === "reminder_too_soon" && sink.messages.length === n + 1);
    await stop();
    let db = openDb();
    db.prepare(`UPDATE checkins SET sent_at = ? WHERE mentorship_id = ?`).run(new Date(Date.now() - 25 * 3600e3).toISOString(), ms.id);
    db.close();
    await start();
    const A2 = await login("mail-a", pw.a);
    // (the server restarted: the mail settings stay, the test mail server is the same)
    n = sink.messages.length;
    r = await api(A2, "POST", `/mentorships/${ms.id}/checkin`, { target: "mentee", language: "tr" });
    check("after 24 hours: reminder sent with the reminder text",
          r.json?.sent?.[0]?.reminder === true && sink.messages.length === n + 1 && subjectOf(last()) === "ZZ Hatırlatma Ece Su" &&
          decodeMail(last().raw).includes("ZZREM Mert Ak"), subjectOf(last()));

    // --- 5. Closing survey + reminder ----------------------------------------
    n = sink.messages.length;
    r = await api(A2, "POST", `/mentorships/${ms.id}/survey`, { role: "mentee", language: "tr" });
    check("closing survey request: default text with the name", r.status === 200 && subjectOf(last()) === "Mentorluk süreciniz tamamlandı - kısa bir anket" &&
          decodeMail(last().raw).includes("Merhaba Ece Su"), subjectOf(last()));
    r = await api(A2, "POST", `/mentorships/${ms.id}/survey`, { role: "mentee", language: "tr" });
    check("closing survey again within 24 hours -> 429 reminder_too_soon", r.status === 429 && r.json?.code === "reminder_too_soon" && sink.messages.length === n + 1);
    await stop();
    db = openDb();
    db.prepare(`UPDATE surveys SET sent_at = ? WHERE mentorship_id = ?`).run(new Date(Date.now() - 25 * 3600e3).toISOString(), ms.id);
    db.close();
    await start();
    const A3 = await login("mail-a", pw.a);
    r = await api(A3, "POST", `/mentorships/${ms.id}/survey`, { role: "mentee", language: "tr" });
    check("after 24 hours: closing survey reminder (reminder text, same link)",
          r.status === 200 && r.json?.reused === true && subjectOf(last()).startsWith("Hatırlatma - Mentorluk süreciniz tamamlandı"), subjectOf(last()));
    db = openDb();
    const sv = db.prepare(`SELECT reminder_count, last_reminded_at FROM surveys WHERE mentorship_id = ? AND role = 'mentee'`).get(ms.id);
    db.close();
    check("the reminder is counted on the survey", sv.reminder_count === 1 && !!sv.last_reminded_at);

    // --- 6. Reset ----------------------------------------------------------------
    r = await api(A3, "DELETE", "/email-templates/invite_mentee/tr");
    check("back to default", r.status === 200 && r.json?.template?.custom === false && r.json.template.subject === "{firma} - Mentee Kaydı Daveti");
    await api(A3, "POST", "/email/invite", { emails: "aday2@a.example", lang: "tr", form: "mentee" });
    check("after reset the default text is sent again", subjectOf(to("aday2@a.example")[0] || { raw: "" }) === "Alfa Holding - Mentee Kaydı Daveti");
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
  console.log(`  E-MAIL TEST: ${results.length} checks - ${results.length - failed.length} passed, ${failed.length} failed`);
  console.log("============================================================\n");
  process.exit(failed.length ? 1 : 0);
})();
