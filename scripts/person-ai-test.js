/**
 * Person AI summary (V09).
 *
 *   npm run person-ai-test
 *
 * Temporary server, temporary encrypted database and a FAKE local AI
 * server (no real AI call). Checks what is sent about a person (no names,
 * e-mails, person numbers, free-text answers or meeting notes; scores,
 * dates and development texts with names masked), keeping the last
 * summary per person, AI off, organisation separation, deletion.
 */
const http = require("http");
let FAKE_AI_URL = "";
const aiRequests = [];
function startFakeAi() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let body = "";
      req.on("data", c => { body += c; });
      req.on("end", () => {
        let json = {};
        try { json = JSON.parse(body); } catch {}
        aiRequests.push(json);
        const tool = (json.tools || [])[0] || {};
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          id: "msg_test", type: "message", role: "assistant", model: json.model || "x",
          stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 100, output_tokens: 50 },
          content: [{ type: "tool_use", id: "tu_1", name: tool.name, input: {
            overview: "Katılımcı bir eşleşmede mentee.", engagement: "2 toplantı yapılmış.",
            surveys: "Ara dönem anketinde ilerleme 4/5.", attention: ["Son toplantının üzerinden zaman geçmiş."],
            actions: ["Mentorla kısa bir görüşme planlayın.", "Hatırlatma gönderin."]
          } }]
        }));
      });
    });
    srv.listen(0, "127.0.0.1", () => { FAKE_AI_URL = `http://127.0.0.1:${srv.address().port}`; resolve(srv); });
  });
}
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mentoros-personai-"));
const SUPER_PW = crypto.randomBytes(12).toString("hex");
const ENV_BASE = {
  CLOUD: "false", DB_PATH: path.join(TMP, "personai-test.db"), BACKUP_DIR: path.join(TMP, "backups"),
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
    env: { ...process.env, ...ENV_BASE, PORT: String(port), SITE_BASE_URL: `http://localhost:${port}`, ANTHROPIC_BASE_URL: FAKE_AI_URL }
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
  const fakeAi = await startFakeAi();
  try {
  await start();
  const SA = await login("superadmin", SUPER_PW);
  const pw = { a: crypto.randomBytes(9).toString("hex"), b: crypto.randomBytes(9).toString("hex") };
  await api(SA, "POST", "/companies", { companyId: "pa-a", name: "Alfa", password: pw.a });
  await api(SA, "POST", "/companies", { companyId: "pa-b", name: "Beta", password: pw.b });
  const A = await login("pa-a", pw.a), B = await login("pa-b", pw.b);
  const post = async (u, b) => (await api(A, "POST", u, b)).json;

  const mentor = (await post("/mentors", { fullName: "Zerrin Benzersizad", email: "zerrin@a.example", role: "Direktör", capacity: 2 })).id;
  const mentee = (await post("/mentees", { fullName: "Kerem Eşsizsoyad", email: "kerem@a.example", role: "Uzman", department: "Finans",
                                           developmentNeeds: "Zerrin Benzersizad gibi liderlik becerisi kazanmak" })).id;
  const ms = (await post("/mentorships", { mentorId: mentor, menteeId: mentee, closingDate: "2030-12-31" })).mentorship;
  await post(`/mentorships/${ms.id}/meetings`, { meetingDate: "2026-10-01", title: "GIZLI BASLIK", durationMinutes: "01:00", discussed: "GIZLI TOPLANTI NOTU" });
  await post(`/mentorships/${ms.id}/meetings`, { meetingDate: "2026-10-20", title: "Ikinci", durationMinutes: "00:45" });
  await api(A, "POST", `/mentorships/${ms.id}/checkin`, { target: "both", language: "tr" });
  await api(A, "POST", `/mentorships/${ms.id}/survey`, { role: "mentor", language: "tr" });
  let db = openDb();
  db.prepare(`UPDATE mentorships SET goals = ? WHERE id = ?`).run(JSON.stringify(["Kerem ekip liderliği yapsın"]), ms.id);
  db.prepare(`UPDATE checkins SET status = 'completed', completed_at = ?, answers = ? WHERE mentorship_id = ? AND role = 'mentee'`)
    .run(new Date().toISOString(), JSON.stringify({ progress: "4", going_well: "GIZLI SERBEST METIN", needs_support: "yes" }), ms.id);
  db.prepare(`UPDATE surveys SET status = 'completed', completed_at = ?, answers = ? WHERE mentorship_id = ? AND role = 'mentor'`)
    .run(new Date().toISOString(), JSON.stringify({ nps: "9", final_comment: "MENTOR GIZLI YORUM" }), ms.id);
  const sicil = db.prepare(`SELECT sicil_no FROM mentees WHERE id = ?`).get(mentee).sicil_no;
  const mentorSicil = db.prepare(`SELECT sicil_no FROM mentors WHERE id = ?`).get(mentor).sicil_no;
  db.close();
  const FORBIDDEN = /Zerrin|Benzersizad|Kerem|Eşsizsoyad|@a\.example|GIZLI/;

  // --- 1. What goes to the AI --------------------------------------------------
  check("unauthenticated -> 401", (await api(null, "GET", `/reports/person/ai-summary?sicil=${sicil}`)).status === 401);
  check("unknown person -> 404", (await api(A, "GET", "/reports/person/ai-summary/input?sicil=9999")).status === 404);
  const text = (await api(A, "GET", `/reports/person/ai-summary/input?sicil=${sicil}&lang=tr`)).json?.text || "";
  check("input: role, department, match, meetings, dates", /mentee/.test(text) && /Finans/.test(text) && /Eşleşme 1/.test(text) &&
        /Toplantı sayısı \(tarih aralığında\): 2/.test(text) && /Toplam toplantı süresi \(dakika\): 105/.test(text) && /Son toplantı: 2026-10-20/.test(text), text.slice(0, 300));
  check("input: scores and yes/no answers, own and the other side's",
        /kişinin kendi cevabı/.test(text) && /eşleştiği kişinin cevabı/.test(text) && /4\/5/.test(text) && /9\/10/.test(text), text);
  check("input: development need and plan goals, names masked", /liderlik becerisi/.test(text) && /ekip liderliği/.test(text));
  check("input: no names, e-mails, free text, meeting notes or titles", !FORBIDDEN.test(text), (text.match(FORBIDDEN) || [])[0]);
  check("input: no person numbers", !new RegExp(`\\b(${sicil}|${mentorSicil})\\b`).test(text));
  check("the person number sent twice still works (the page sends it with the filters)",
        (await api(A, "GET", `/reports/person/ai-summary/input?sicil=${sicil}&lang=tr&sicil=${sicil}`)).status === 200);
  check("another organisation cannot read it", (await api(B, "GET", `/reports/person/ai-summary/input?sicil=${sicil}`)).status === 404);

  // --- 2. Generate -------------------------------------------------------------------
  let r = await api(A, "POST", "/reports/person/ai-summary", { sicil, lang: "tr" });
  check("AI not configured -> 503", r.status === 503 && r.json?.code === "AI_NOT_CONFIGURED");
  const tok = (await api(null, "POST", "/admin/login", { password: SUPER_PW })).json?.token;
  await fetch(BASE + "/admin/ai-config", { method: "PUT", headers: { "Content-Type": "application/json", "x-admin-token": tok },
    body: JSON.stringify({ provider: "anthropic", model: "claude-test-model", anthropicApiKey: "sk-ant-test-0000000000" }) });
  r = await api(A, "POST", "/reports/person/ai-summary", { sicil, lang: "tr" });
  const sent = JSON.stringify(aiRequests[aiRequests.length - 1] || {});
  check("summary generated", r.status === 200 && r.json?.summary?.summary?.overview === "Katılımcı bir eşleşmede mentee." &&
        r.json.summary.summary.actions.length === 2, JSON.stringify(r.json).slice(0, 200));
  check("the real AI request: person_summary tool, nothing personal", /person_summary/.test(sent) && !FORBIDDEN.test(sent) &&
        !new RegExp(`\\b(${sicil}|${mentorSicil})\\b`).test(JSON.parse(sent).messages?.[0]?.content || ""));
  let g = (await api(A, "GET", `/reports/person/ai-summary?sicil=${sicil}`)).json;
  check("kept per person (opening makes no AI call)", g?.aiEnabled && g.last?.sicil === sicil && aiRequests.length === 1);
  check("another person has none", (await api(A, "GET", `/reports/person/ai-summary?sicil=${mentorSicil}`)).json?.last === null);
  check("another organisation does not see it", (await api(B, "GET", `/reports/person/ai-summary?sicil=${sicil}`)).json?.last === null);
  check("another organisation cannot generate for A's person -> 404", (await api(B, "POST", "/reports/person/ai-summary", { sicil })).status === 404);

  // --- 3. AI off, deletion -------------------------------------------------------------
  db = openDb(); db.prepare(`UPDATE companies SET ai_enabled = 0 WHERE company_id = 'pa-a'`).run(); db.close();
  r = await api(A, "POST", "/reports/person/ai-summary", { sicil, lang: "tr" });
  check("AI off -> 403, no AI call", r.status === 403 && r.json?.code === "ai_disabled" && aiRequests.length === 1);
  await api(A, "DELETE", `/mentees/${mentee}`);
  db = openDb();
  const left = db.prepare(`SELECT COUNT(*) n FROM ai_person_summaries WHERE sicil_no = ?`).get(sicil).n;
  db.close();
  check("deleting the person deletes their AI summary (KVKK)", left === 0);
  } finally { fakeAi.close(); }
}

(async () => {
  try { await run(); }
  catch (e) { console.error("\n  ERROR: " + e.stack); results.push({ name: "run", ok: false }); }
  finally { await stop(); fs.rmSync(TMP, { recursive: true, force: true }); }
  const failed = results.filter(r => !r.ok);
  console.log("\n============================================================");
  console.log(`  PERSON AI TEST: ${results.length} checks - ${results.length - failed.length} passed, ${failed.length} failed`);
  console.log("============================================================\n");
  process.exit(failed.length ? 1 : 0);
})();
