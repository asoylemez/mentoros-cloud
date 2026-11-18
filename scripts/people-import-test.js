/**
 * People import from Excel (V11).
 *
 *   npm run people-import-test
 *
 * Temporary server + temporary encrypted database. Checks the template,
 * the preview (writes nothing), the checks on every row, the import
 * itself (one transaction, KVKK statement required), "skip" and "fill"
 * for people already registered, programme placement, organisation
 * isolation - and above all that EXISTING DATA DOES NOT CHANGE: every
 * row of every table is compared before and after.
 */
const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const bcrypt = require("bcryptjs");

const ROOT = path.join(__dirname, "..");
const xlsx = require(path.join(ROOT, "lib", "xlsx"));
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mentoros-import-"));
const SUPER_PW = crypto.randomBytes(12).toString("hex");
const ENV_BASE = {
  CLOUD: "false", DB_PATH: path.join(TMP, "import-test.db"), BACKUP_DIR: path.join(TMP, "backups"),
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
async function upload(cookie, url, buf) {
  const headers = { Accept: "application/json", "Content-Type": "application/octet-stream" };
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(BASE + url, { method: "POST", headers, body: buf });
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

/** Every row of every table (people_imports aside), as text - to prove nothing else changed. */
const TABLES = ["companies", "mentors", "mentees", "programs", "program_mentors", "program_mentees",
  "mentorships", "surveys", "checkins", "mentee_groups", "mentee_group_members", "settings"];
function snapshot(filter) {
  const db = openDb();
  const out = {};
  const have = new Set(db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r => r.name));
  for (const t of TABLES) {
    if (!have.has(t)) continue;
    out[t] = new Map(db.prepare(`SELECT * FROM ${t}`).all()
      .map(r => [JSON.stringify(r.id ?? [r.program_id, r.mentor_id, r.mentee_id, r.group_id, r.key, r.company_id]), r])
      .filter(([, r]) => !filter || filter(t, r))
      // The organisation's person-number counter goes up with every new
      // person by design; it is checked on its own, not here.
      .map(([k, r]) => [k, JSON.stringify(t === "companies" ? { ...r, sicil_seq: undefined } : r)]));
  }
  db.close();
  return out;
}
/** Rows of `before` that are missing or different in `after`. */
function changedRows(before, after) {
  const diff = [];
  for (const [t, rows] of Object.entries(before)) {
    for (const [k, v] of rows) if (after[t].get(k) !== v) diff.push(`${t} ${k}`);
  }
  return diff;
}

/** A filled template, built like Excel would save it. */
function book(mentorRows, menteeRows, opts = {}) {
  const mh = opts.mentorHead || ["Mentor", "Sicil", "Ad Soyad", "E-posta", "Rol/Unvan", "Departman", "Kıdem",
    "Uzmanlık fonksiyon alanları", "Uzman olduğunuz sektörler", "Kapasite (Kaç Mentee ile çalışmak ister)"];
  const eh = opts.menteeHead || ["Mentee", "Sicil", "Ad Soyad", "E-posta", "Rol/Unvan", "Departman", "Kıdem",
    "Gelişmek istediği alanlar", "Gelişim ihtiyacı açıklaması"];
  const sheets = [];
  if (mentorRows) sheets.push({ name: "Mentor", rows: [mh, ...mentorRows] });
  if (menteeRows) sheets.push({ name: "Mentee", rows: [eh, ...menteeRows] });
  sheets.push({ name: "Açıklama", rows: [["Ad Soyad", "E-posta"], ["Örnek Kişi", "ornek@firma.com"]] });
  return xlsx.write(sheets);
}

async function run() {
  await start();
  const SA = await login("superadmin", SUPER_PW);
  const pw = { a: crypto.randomBytes(9).toString("hex"), b: crypto.randomBytes(9).toString("hex") };
  await api(SA, "POST", "/companies", { companyId: "im-a", name: "Alfa", password: pw.a });
  await api(SA, "POST", "/companies", { companyId: "im-b", name: "Beta", password: pw.b });
  const A = await login("im-a", pw.a);
  const B = await login("im-b", pw.b);
  const post = async (c, u, b) => (await api(c, "POST", u, b)).json;

  // ---- existing data -------------------------------------------------
  const oldMentor = await post(A, "/mentors", { fullName: "Oya Tan", email: "oya@alfa.example", role: "Direktör",
    functionalAreas: ["Marketing"], capacity: 3, kvkkConsent: true });
  const oldMentee = await post(A, "/mentees", { fullName: "Ece Su", email: "ece@alfa.example", developmentNeeds: "Sunum becerisi",
    kvkkConsent: true });
  const oldMentee2 = await post(A, "/mentees", { fullName: "Ali Ok", email: "ali@alfa.example", kvkkConsent: true });
  // The match first: once programmes exist, a match must name one.
  const ms = (await post(A, "/mentorships", { mentorId: oldMentor.id, menteeId: oldMentee.id, closingDate: "2030-12-31" })).mentorship;
  const prog = (await post(A, "/programs", { name: "2027 Programı", startDate: "2027-01-01", endDate: "2027-12-31" })).program
            || (await api(A, "GET", "/programs")).json[0];
  await post(B, "/mentors", { fullName: "Beta Kişi", email: "yeni.mentor@alfa.example", capacity: 2 });   // same e-mail, other organisation
  // Organisation B has an own option; it must not appear in A's template.
  await api(B, "PUT", "/registration-forms", { config: { options: { functionalAreas: { custom: [{ tr: "Beta Özel Alan", en: "Beta Special" }] } } } });
  check("setup: existing people, programme and a match", oldMentor.id && oldMentee.id && prog && prog.id && ms && ms.id,
    JSON.stringify({ prog, ms }).slice(0, 200));

  // ---- template ------------------------------------------------------
  const tplRes = await fetch(BASE + "/people-import/template?lang=tr", { headers: { Cookie: A } });
  const tpl = Buffer.from(await tplRes.arrayBuffer());
  const sheets = xlsx.read(tpl);
  check("template: an .xlsx with Mentor, Mentee, Seçenekler, Açıklama",
    tplRes.status === 200 && sheets.map(s => s.name).join("|") === "Mentor|Mentee|Seçenekler|Açıklama", sheets.map(s => s.name).join("|"));
  check("template: the Mentor sheet has the agreed columns",
    sheets[0].rows[0].join("|") === "Mentor|Sicil|Ad Soyad|E-posta|Rol/Unvan|Departman|Kıdem|Uzmanlık fonksiyon alanları|Uzman olduğunuz sektörler|Kapasite (Kaç Mentee ile çalışmak ister)",
    sheets[0].rows[0].join("|"));
  check("template: the Mentee sheet has the agreed columns",
    sheets[1].rows[0].join("|") === "Mentee|Sicil|Ad Soyad|E-posta|Rol/Unvan|Departman|Kıdem|Gelişmek istediği alanlar|Gelişim ihtiyacı açıklaması",
    sheets[1].rows[0].join("|"));
  const optCol = sheets[2].rows.map(r => r[1]).join("|");
  check("template: options in Turkish; another organisation's own option is not in it",
    optCol.includes("Strateji") && optCol.includes("Ticari / Satış") && !optCol.includes("Beta"), optCol.slice(0, 120));
  const tplEn = xlsx.read(Buffer.from(await (await fetch(BASE + "/people-import/template?lang=en", { headers: { Cookie: A } })).arrayBuffer()));
  check("template: English version", tplEn.map(s => s.name).join("|") === "Mentor|Mentee|Options|Instructions"
    && tplEn[0].rows[0][2] === "Full name", tplEn.map(s => s.name).join("|"));
  const tplNoSession = await fetch(BASE + "/people-import/template?lang=tr");
  check("template: no session -> 401", tplNoSession.status === 401);
  // The template uploaded empty: nothing to import, no error.
  const emptyPrev = await upload(A, "/people-import/preview", tpl);
  check("the empty template reads as 0 people (rows with only 'Mentor' are skipped)",
    emptyPrev.status === 200 && emptyPrev.json.summary.total === 0, JSON.stringify(emptyPrev.json).slice(0, 200));

  // ---- the file ------------------------------------------------------
  const file = book([
    ["Mentor", "", "Yeni Mentor", "yeni.mentor@alfa.example", "Satış Direktörü", "Satış", "6", "Strateji; Bilinmeyen Alan", "Perakende, Teknoloji", "2"],
    ["Mentor", "", "Selin Ay", "selin@alfa.example", "", "", "abc", "", "", "abc"],
    ["Mentor", "0099", "Kerem Göz", "kerem@alfa.example", "", "", "10+ yıl", "Dijital & IT", "", "50"],
    ["Mentor", "", "Oya Tan Kopya", "OYA@alfa.example", "Yeni Unvan", "Pazarlama", "", "", "", ""],        // existing (case differs)
    ["Mentor", "", "", "isimsiz@alfa.example", "", "", "", "", "", ""],                                     // no name
    ["Mentor", "", "Hatalı E-posta", "hatali-eposta", "", "", "", "", "", ""],                               // bad e-mail
    ["Mentor", "", "Ayşe Yılmaz", "ayse.yilmaz@example.com", "İK Uzmanı", "", "", "", "", ""],               // example row
    ["Mentor", "", "Selin Tekrar", "SELIN@alfa.example", "", "", "", "", "", ""],                            // duplicate in file
    ["Mentee", "", "Yanlış Sayfa", "yanlis@alfa.example", "", "", "", "", "", ""],                           // role mismatch
    ["Mentor"], ["Mentor"]                                                                                  // empty template rows
  ], [
    ["Mentee", "", "Yeni Mentee", "yeni.mentee@alfa.example", "Uzman", "Finans", "2–4 yıl", "Finans & P&L", "Bütçe yönetimini öğrenmek"],
    ["Mentee", "", "Yeni Mentor", "yeni.mentor@alfa.example", "Satış Direktörü", "Satış", "", "Strateji", "Liderlik"],   // also a mentee
    ["Mentee", "", "Ece Su", "ece@alfa.example", "Analist", "Finans", "", "Pazarlama", "BAŞKA METİN"],                  // existing
    ["Mentee", "", "Ali Ok", "ali@alfa.example", "Mühendis", "", "", "Operasyon", "Proje yönetimi"]                       // existing, empty fields
  ]);

  const before = snapshot();
  const prev = await upload(A, "/people-import/preview", file);
  const after = snapshot();
  check("preview: HTTP 200", prev.status === 200, JSON.stringify(prev.json).slice(0, 300));
  check("preview writes NOTHING (every row of every table identical)", changedRows(before, after).length === 0
    && [...after.mentors.keys()].length === [...before.mentors.keys()].length, changedRows(before, after).join(", "));
  const s = prev.json.summary;
  check("preview summary: 3 new mentors, 2 new mentees, 3 skipped, 5 errors",
    s.newMentors === 3 && s.newMentees === 2 && s.skip === 3 && s.errors === 5, JSON.stringify(s));
  const row = (sheet, n) => prev.json.rows.find(r => r.sheet === sheet && r.row === n);
  const codes = r => (r ? r.messages.map(m => m.code) : []);
  check("checks: missing name, bad e-mail, example row, duplicate, wrong sheet",
    codes(row("Mentor", 6)).includes("name_missing") && codes(row("Mentor", 7)).includes("email_bad")
    && codes(row("Mentor", 8)).includes("email_example") && codes(row("Mentor", 9)).includes("email_dup")
    && codes(row("Mentor", 10)).includes("role_mismatch"),
    JSON.stringify(prev.json.rows.filter(r => r.status === "error").map(r => [r.row, codes(r)])));
  check("warnings: unknown tenure, capacity not understood / too big, typed person no. ignored, option not in list",
    codes(row("Mentor", 3)).includes("tenure_unknown") && codes(row("Mentor", 3)).includes("capacity_bad")
    && codes(row("Mentor", 4)).includes("capacity_max") && codes(row("Mentor", 4)).includes("sicil_ignored")
    && codes(row("Mentor", 2)).includes("options_extra"), JSON.stringify([codes(row("Mentor", 2)), codes(row("Mentor", 3)), codes(row("Mentor", 4))]));
  check("messages come in Turkish and English", row("Mentor", 6).messages[0].tr && row("Mentor", 6).messages[0].en);
  check("existing mentor (e-mail in another case) is found and skipped",
    row("Mentor", 5).status === "skip" && codes(row("Mentor", 5)).includes("exists_skip"), JSON.stringify(row("Mentor", 5)));

  // ---- commit needs the KVKK statement --------------------------------
  const noAttest = await upload(A, `/people-import/commit?existing=skip&programId=${prog.id}`, file);
  check("commit without the KVKK statement -> 400 and nothing written",
    noAttest.status === 400 && noAttest.json.code === "kvkk_required" && changedRows(before, snapshot()).length === 0);
  const badProg = await upload(A, `/people-import/commit?attest=1&programId=nope`, file);
  check("unknown programme -> 400 and nothing written", badProg.status === 400 && badProg.json.code === "bad_program"
    && changedRows(before, snapshot()).length === 0);
  const noSession = await upload(null, "/people-import/commit?attest=1", file);
  check("no session -> 401", noSession.status === 401);

  // ---- commit (skip) -------------------------------------------------
  const com = await upload(A, `/people-import/commit?existing=skip&attest=1&programId=${prog.id}&name=liste.xlsx`, file);
  check("commit: 3 mentors + 2 mentees created, 3 skipped, 5 errors left out",
    com.status === 200 && com.json.result.created.mentor === 3 && com.json.result.created.mentee === 2
    && com.json.result.skipped === 3 && com.json.result.errors === 5, JSON.stringify(com.json));
  const afterCommit = snapshot();
  check("EXISTING DATA UNCHANGED after the import (every earlier row identical)",
    changedRows(before, afterCommit).length === 0, changedRows(before, afterCommit).join(", "));

  let db = openDb();
  const m = db.prepare(`SELECT * FROM mentors WHERE company_id = 'im-a' AND email = 'yeni.mentor@alfa.example'`).get();
  const e = db.prepare(`SELECT * FROM mentees WHERE company_id = 'im-a' AND email = 'yeni.mentor@alfa.example'`).get();
  const ne = db.prepare(`SELECT * FROM mentees WHERE company_id = 'im-a' AND email = 'yeni.mentee@alfa.example'`).get();
  const kerem = db.prepare(`SELECT * FROM mentors WHERE email = 'kerem@alfa.example'`).get();
  const selin = db.prepare(`SELECT * FROM mentors WHERE email = 'selin@alfa.example'`).get();
  check("new mentor: fields saved as the form saves them",
    m && m.role === "Satış Direktörü" && m.department === "Satış" && m.tenure === "5–7 years"
    && m.functional_areas === '["Strategy"]' && m.functional_areas_extra === "Bilinmeyen Alan"
    && m.industries === '["Retail","Technology"]' && m.capacity === 2 && m.status === "active",
    JSON.stringify(m));
  check("new mentee: fields saved", ne && ne.role === "Uzman" && ne.department === "Finans" && ne.tenure === "2–4 years"
    && ne.dev_functional_areas === '["Finance & P&L"]' && ne.development_needs === "Bütçe yönetimini öğrenmek", JSON.stringify(ne));
  check("capacity: not understood -> 1, too big -> 20", selin.capacity === 1 && kerem.capacity === 20 && kerem.tenure === "10+ years");
  check("person-number counter now at 7 (3 existing + 4 new people)",
    db.prepare(`SELECT sicil_seq FROM companies WHERE company_id = 'im-a'`).get().sicil_seq === 7);
  check("person numbers: continue after the existing ones; mentor+mentee share one", m.sicil_no === "0004" && e.sicil_no === m.sicil_no
    && ne.sicil_no > "0004" && kerem.sicil_no !== "0099", JSON.stringify([m.sicil_no, e.sicil_no, ne.sicil_no, kerem.sicil_no]));
  check("imported people are marked (source = import, import id) and have no consent of their own",
    m.source === "import" && ne.source === "import" && m.import_id && m.import_id === ne.import_id && m.kvkk_consent === 0);
  const inProg = db.prepare(`SELECT COUNT(*) n FROM program_mentors WHERE program_id = ?`).get(prog.id).n
               + db.prepare(`SELECT COUNT(*) n FROM program_mentees WHERE program_id = ?`).get(prog.id).n;
  check("new people placed in the chosen programme (5), existing ones not", inProg === 5
    && !db.prepare(`SELECT 1 FROM program_mentors WHERE mentor_id = ?`).get(oldMentor.id), String(inProg));
  const log = db.prepare(`SELECT * FROM people_imports WHERE company_id = 'im-a'`).all();
  check("the upload is recorded with the KVKK statement", log.length === 1 && log[0].kvkk_attested === 1
    && log[0].file_name === "liste.xlsx" && JSON.parse(log[0].counts).created.mentor === 3);
  const bRows = db.prepare(`SELECT COUNT(*) n FROM mentors WHERE company_id = 'im-b'`).get().n
              + db.prepare(`SELECT COUNT(*) n FROM mentees WHERE company_id = 'im-b'`).get().n;
  check("the other organisation is untouched (same e-mail there stays separate)", bRows === 1);
  db.close();

  const list = (await api(A, "GET", "/mentors")).json;
  check("registry API shows department and the import mark",
    list.some(x => x.email === "yeni.mentor@alfa.example" && x.source === "import" && x.department === "Satış"));
  const hist = (await api(A, "GET", "/people-import/history")).json;
  check("history lists the upload", Array.isArray(hist) && hist.length === 1 && hist[0].counts.created.mentee === 2);

  // ---- same file again: nothing new -----------------------------------
  const again = await upload(A, `/people-import/commit?existing=skip&attest=1`, file);
  check("the same file again creates nobody (everyone is already registered)",
    again.status === 200 && again.json.result.created.mentor === 0 && again.json.result.created.mentee === 0,
    JSON.stringify(again.json));

  // ---- fill mode -----------------------------------------------------
  const beforeFill = snapshot();
  const fillFile = book([
    ["Mentor", "", "Oya Tan", "oya@alfa.example", "BAŞKA UNVAN", "Pazarlama", "8", "Strateji", "Enerji", "9"]
  ], [
    ["Mentee", "", "Ece Su", "ece@alfa.example", "Analist", "Finans", "", "Pazarlama", "BAŞKA METİN"],
    ["Mentee", "", "Ali Ok", "ali@alfa.example", "Mühendis", "Üretim", "1", "Operasyon", "Proje yönetimi"]
  ]);
  const fprev = await upload(A, "/people-import/preview?existing=fill", fillFile);
  check("fill preview: 3 rows will get only their empty fields", fprev.json.summary.fill === 3, JSON.stringify(fprev.json.summary));
  check("fill preview writes nothing", changedRows(beforeFill, snapshot()).length === 0);
  const fcom = await upload(A, "/people-import/commit?existing=fill&attest=1", fillFile);
  check("fill commit: 3 filled, nobody created", fcom.status === 200 && fcom.json.result.filled === 3
    && fcom.json.result.created.mentor === 0, JSON.stringify(fcom.json));
  db = openDb();
  const oya = db.prepare(`SELECT * FROM mentors WHERE id = ?`).get(oldMentor.id);
  const ece = db.prepare(`SELECT * FROM mentees WHERE id = ?`).get(oldMentee.id);
  const ali = db.prepare(`SELECT * FROM mentees WHERE id = ?`).get(oldMentee2.id);
  const oyaBefore = JSON.parse(beforeFill.mentors.get(JSON.stringify(oldMentor.id)));
  check("fill: filled values are written ONLY where the system was empty",
    oya.role === "Direktör" && oya.department === "Pazarlama" && oya.tenure === "8–10 years"
    && oya.functional_areas === '["Marketing"]' && oya.industries === '["Energy"]',
    JSON.stringify({ role: oya.role, dep: oya.department, fa: oya.functional_areas, ind: oya.industries }));
  check("fill: name, e-mail, person no., capacity, status and consent never change",
    oya.full_name === oyaBefore.full_name && oya.email === oyaBefore.email && oya.sicil_no === oyaBefore.sicil_no
    && oya.capacity === 3 && oya.status === oyaBefore.status && oya.kvkk_consent === 1);
  check("fill: a mentee's existing development need is kept, empty fields filled",
    ece.development_needs === "Sunum becerisi" && ece.role === "Analist" && ece.dev_functional_areas === '["Marketing"]'
    && ali.development_needs === "Proje yönetimi" && ali.tenure === "Less than 2 years" && ali.department === "Üretim",
    JSON.stringify({ ece: [ece.development_needs, ece.role], ali: [ali.development_needs, ali.tenure] }));
  const fillDiff = changedRows(beforeFill, snapshot());
  check("fill: only those 3 records changed", fillDiff.length === 3
    && fillDiff.every(d => [oldMentor.id, oldMentee.id, oldMentee2.id].some(id => d.includes(id))), fillDiff.join(", "));
  const msRow = db.prepare(`SELECT * FROM mentorships WHERE id = ?`).get(ms.id);
  check("the running match is untouched", msRow && msRow.status === "active" && msRow.mentor_id === oldMentor.id);
  db.close();

  // ---- bad files -----------------------------------------------------
  const notX = await upload(A, "/people-import/preview", Buffer.from("ad,soyad\nx,y"));
  check("a CSV / non-xlsx file -> clear error", notX.status === 400 && notX.json.code === "not_xlsx" && notX.json.errorTr);
  const noSheets = await upload(A, "/people-import/preview", xlsx.write([{ name: "Liste", rows: [["Ad"], ["x"]] }]));
  check("an Excel file without Mentor / Mentee sheets -> clear error", noSheets.status === 400 && noSheets.json.code === "no_sheets");
  const noHead = await upload(A, "/people-import/preview", xlsx.write([{ name: "Mentor", rows: [["A", "B"], ["x", "y"]] }]));
  check("a Mentor sheet without the headers -> clear error", noHead.status === 400 && noHead.json.code === "headers_missing");
  const many = [];
  for (let i = 0; i < 1001; i++) many.push(["Mentee", "", `Kişi ${i}`, `kisi${i}@alfa.example`]);
  const tooMany = await upload(A, "/people-import/preview", book(null, many));
  check("more than 1,000 people -> refused", tooMany.status === 400 && tooMany.json.code === "too_many");
  const big = await upload(A, "/people-import/preview", Buffer.alloc(6 * 1024 * 1024, 1));
  check("a file over 5 MB -> refused", big.status === 413 || (big.status === 400 && big.json.code === "file_too_large"), String(big.status));
  // Headers in English and in another order are found by name.
  const enFile = xlsx.write([{ name: "Mentee", rows: [["E-mail", "Full name", "Development need (description)"], ["en.order@alfa.example", "Order Test", "x"]] }]);
  const enPrev = await upload(A, "/people-import/preview", enFile);
  check("English headers in another order are read", enPrev.status === 200 && enPrev.json.rows[0].status === "new"
    && enPrev.json.rows[0].fullName === "Order Test", JSON.stringify(enPrev.json).slice(0, 200));

  await stop();

  // ---- all or nothing (in-process, same database) ----------------------
  Object.assign(process.env, ENV_BASE);
  const peopleImport = require(path.join(ROOT, "lib", "peopleImport"));
  const repos = require(path.join(ROOT, "db", "repos"));
  const beforeTx = snapshot();
  const seqBeforeTx = (() => { const d = openDb(); const v = d.prepare(`SELECT sicil_seq FROM companies WHERE company_id = 'im-a'`).get().sicil_seq; d.close(); return v; })();
  const real = repos.mentees.create;
  let calls = 0;
  repos.mentees.create = (...a) => { if (++calls === 2) throw new Error("simulated failure"); return real(...a); };
  let threw = false;
  try {
    peopleImport.commit("im-a", book(null, [
      ["Mentee", "", "Tx Bir", "tx1@alfa.example"], ["Mentee", "", "Tx İki", "tx2@alfa.example"], ["Mentee", "", "Tx Üç", "tx3@alfa.example"]
    ]), { kvkkAttested: true });
  } catch { threw = true; }
  repos.mentees.create = real;
  const afterTx = snapshot();
  const txRows = [...afterTx.mentees.values()].filter(v => v.includes("tx1@alfa.example")).length;
  check("a failure halfway rolls EVERYTHING back (no half import)", threw && txRows === 0
    && changedRows(beforeTx, afterTx).length === 0 && [...afterTx.mentees.keys()].length === [...beforeTx.mentees.keys()].length);
  const seqOf = () => { const d = openDb(); const v = d.prepare(`SELECT sicil_seq FROM companies WHERE company_id = 'im-a'`).get().sicil_seq; d.close(); return v; };
  check("the person-number counter is rolled back too", seqOf() === seqBeforeTx, `${seqBeforeTx} -> ${seqOf()}`);
}

run()
  .catch(err => { console.error(err); check("test ran without crashing", false, err.message); })
  .finally(async () => {
    await stop();
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
    const failed = results.filter(r => !r.ok).length;
    console.log(`\n  ${results.length - failed}/${results.length} checks passed`);
    process.exit(failed ? 1 : 0);
  });
