/**
 * AI executive summary (V06).
 *
 *   npm run ai-summary-test
 *
 * Temporary server, temporary encrypted database and a FAKE local AI
 * server (no real AI call, no cost). Checks: what is sent to the AI (no
 * names, e-mails, person numbers, free-text answers), the summary is kept
 * and shown, AI switched off, not configured, organisation separation.
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
            overview: "Program genel olarak iyi gidiyor <b>.",
            highlights: ["14 mentor kayıtlı", "4 aktif eşleşme"],
            strengths: ["Mentor kapasitesi yeterli"],
            risks: ["Eşleşmemiş mentee oranı yüksek"],
            programmes: [{ programme: "P1 Liderlik", assessment: "İyi ilerliyor." }],
            actions: [{ priority: "high", action: "Eşleşmemiş mentee'leri eşleştirin." }, { priority: "weird", action: "Kontrol" }]
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mentoros-aisum-"));
const SUPER_PW = crypto.randomBytes(12).toString("hex");
const ENV_BASE = {
  CLOUD: "false", DB_PATH: path.join(TMP, "aisum-test.db"), BACKUP_DIR: path.join(TMP, "backups"),
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
  await api(SA, "POST", "/companies", { companyId: "ai-a", name: "Alfa", password: pw.a });
  await api(SA, "POST", "/companies", { companyId: "ai-b", name: "Beta", password: pw.b });
  const A = await login("ai-a", pw.a), B = await login("ai-b", pw.b);
  const post = async (u, b) => (await api(A, "POST", u, b)).json;

  const P1 = (await post("/programs", { name: "P1 Liderlik", startDate: "2026-01-01", endDate: "2027-12-31" })).program;
  const mentor = (await post("/mentors", { fullName: "Zerrin Benzersizad", email: "zerrin@a.example", capacity: 1 })).id;
  await api(A, "PUT", `/mentors/${mentor}/programs`, { programIds: [P1.id] });
  const mentee = (await post("/mentees", { fullName: "Kerem Eşsizsoyad", email: "kerem@a.example", developmentNeeds: "x" })).id;
  await api(A, "PUT", `/mentees/${mentee}/programs`, { programIds: [P1.id] });
  const ms = (await post("/mentorships", { mentorId: mentor, menteeId: mentee, programId: P1.id })).mentorship;
  await api(A, "POST", `/mentorships/${ms.id}/checkin`, { target: "mentee", language: "tr" });
  let db = openDb();
  db.prepare(`UPDATE checkins SET status = 'completed', completed_at = ?, answers = ? WHERE mentorship_id = ?`)
    .run(new Date().toISOString(), JSON.stringify({ progress: "4", going_well: "GIZLI SERBEST METIN Zerrin harika" }), ms.id);
  const sicils = db.prepare(`SELECT sicil_no FROM mentors UNION SELECT sicil_no FROM mentees`).all().map(r => r.sicil_no);
  db.close();

  // --- 1. Before AI is set up ----------------------------------------------
  check("unauthenticated -> 401", (await api(null, "GET", "/reports/ai-summary")).status === 401);
  let g = (await api(A, "GET", "/reports/ai-summary")).json;
  check("no summary yet, AI on for the organisation", g?.aiEnabled === true && g.last === null);
  let r = await api(A, "POST", "/reports/ai-summary", { lang: "tr" });
  check("AI not configured -> 503 AI_NOT_CONFIGURED", r.status === 503 && r.json?.code === "AI_NOT_CONFIGURED", `HTTP ${r.status}`);

  // --- 2. What goes to the AI ------------------------------------------------
  const inp = (await api(A, "GET", "/reports/ai-summary/input?lang=tr")).json;
  const sent = JSON.stringify(inp);
  check("input: figures in sections (management, risk, survey, events)", (inp?.sections || []).length >= 4 && /Mentor/.test(sent));
  check("input: no names, e-mails, person numbers or free text",
        !/Zerrin|Benzersizad|Kerem|Eşsizsoyad|@a\.example|GIZLI SERBEST/.test(sent) && !sicils.some(x => new RegExp(`\\b${x}\\b`).test(inp.text)),
        sent.slice(0, 200));
  check("input: programme names are included", /P1 Liderlik/.test(sent));

  // --- 3. Generate with the (fake) AI ------------------------------------------
  const tok = (await api(null, "POST", "/admin/login", { password: SUPER_PW })).json?.token;
  const cfg = await fetch(BASE + "/admin/ai-config", { method: "PUT", headers: { "Content-Type": "application/json", "x-admin-token": tok },
    body: JSON.stringify({ provider: "anthropic", model: "claude-test-model", anthropicApiKey: "sk-ant-test-0000000000" }) });
  check("test AI connection configured", cfg.status === 200, `HTTP ${cfg.status}`);
  r = await api(A, "POST", "/reports/ai-summary", { lang: "tr", programId: P1.id });
  const prompt = JSON.stringify(aiRequests[aiRequests.length - 1] || {});
  check("summary generated", r.status === 200 && r.json?.summary?.summary?.overview?.startsWith("Program genel"), JSON.stringify(r.json).slice(0, 200));
  check("one request to the AI, with the executive_summary tool", aiRequests.length === 1 && /executive_summary/.test(prompt));
  check("the real request has no names, e-mails or free text",
        !/Zerrin|Benzersizad|Kerem|Eşsizsoyad|@a\.example|GIZLI SERBEST/.test(prompt), prompt.slice(0, 200));
  const rec = r.json.summary;
  check("unknown priority falls back to medium", rec.summary.actions[1].priority === "medium");
  check("the figures used are kept with the summary", Array.isArray(rec.input) && rec.input.length >= 4 && rec.filters.programId === P1.id);
  g = (await api(A, "GET", "/reports/ai-summary")).json;
  check("the last summary is kept (opening the page makes no AI call)", g.last?.createdAt === rec.createdAt && aiRequests.length === 1);
  check("another organisation does not see it", (await api(B, "GET", "/reports/ai-summary")).json?.last === null);
  check("another organisation's programme -> 404", (await api(B, "POST", "/reports/ai-summary", { lang: "tr", programId: P1.id })).status === 404);
  r = await api(A, "POST", "/reports/ai-summary", { lang: "en" });
  check("generating again replaces it (EN)", r.status === 200 && (await api(A, "GET", "/reports/ai-summary")).json.last.lang === "en");

  // --- 4. AI switched off for the organisation ----------------------------------
  db = openDb();
  db.prepare(`UPDATE companies SET ai_enabled = 0 WHERE company_id = 'ai-a'`).run();
  db.close();
  r = await api(A, "POST", "/reports/ai-summary", { lang: "tr" });
  check("AI off -> 403 ai_disabled, no AI call", r.status === 403 && r.json?.code === "ai_disabled" && aiRequests.length === 2);
  check("AI off is reported to the page", (await api(A, "GET", "/reports/ai-summary")).json?.aiEnabled === false);
  } finally { fakeAi.close(); }
}

(async () => {
  try { await run(); }
  catch (e) { console.error("\n  ERROR: " + e.stack); results.push({ name: "run", ok: false }); }
  finally { await stop(); fs.rmSync(TMP, { recursive: true, force: true }); }
  const failed = results.filter(r => !r.ok);
  console.log("\n============================================================");
  console.log(`  AI SUMMARY TEST: ${results.length} checks - ${results.length - failed.length} passed, ${failed.length} failed`);
  console.log("============================================================\n");
  process.exit(failed.length ? 1 : 0);
})();
