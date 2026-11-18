/**
 * ====================================================================
 * PEOPLE IMPORT  (V11 - Admin -> Import people)
 * ====================================================================
 *
 * HR downloads an Excel template (a Mentor sheet and a Mentee sheet),
 * fills in what it knows about the people and uploads it. Nothing is
 * saved on upload: analyze() checks every row and the screen shows what
 * WOULD happen. Only commit() writes, and it:
 *
 *   - checks the file again (stateless: the screen sends the same file),
 *   - writes everything in ONE database transaction - all rows or none,
 *   - only INSERTS new people,
 *   - for people whose e-mail is already registered in that role:
 *       mode "skip" (default)  nothing is changed,
 *       mode "fill"            only fields that are EMPTY in the system
 *                              are filled (the SQL itself checks it, so a
 *                              value typed in meanwhile is never overwritten);
 *                              name, e-mail, person number, capacity and
 *                              status are never changed,
 *   - requires HR's statement that the people were informed (KVKK) and
 *     records it with the upload (people_imports).
 *
 * New people get their person number exactly as a form registration
 * does (the same mentors.create / mentees.create). Imported people carry
 * source = 'import'; the registry lists mark them.
 */
const { db, newId, now, slugify, parseArray } = require("../db");
const { mentors, mentees } = require("../db/repos");
const sicil = require("../db/sicil");
const formConfig = require("./formConfig");
const xlsx = require("./xlsx");

const LIMITS = { people: 1000, fileBytes: 5 * 1024 * 1024, capacityMax: 20 };
const TEXT_MAX = { fullName: 120, title: 120, department: 120, developmentNeeds: 2000, extra: 500 };

// ---------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------

/** "İK & İnsan" -> "ikinsan": case, Turkish letters, spaces and signs do not matter. */
function norm(s) {
  return String(s == null ? "" : s)
    .replace(/[İIı]/g, "i").toLocaleLowerCase("tr")
    .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

const clean = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max || 100000);

const TENURE = [
  { value: "Less than 2 years", tr: "2 yıldan az", en: "Less than 2 years" },
  { value: "2–4 years", tr: "2–4 yıl", en: "2–4 years" },
  { value: "5–7 years", tr: "5–7 yıl", en: "5–7 years" },
  { value: "8–10 years", tr: "8–10 yıl", en: "8–10 years" },
  { value: "10+ years", tr: "10+ yıl", en: "10+ years" }
];

/** A tenure as typed ("5–7 yıl", "5-7 years", "6", "3,5 yıl", "12+") -> the form's value, or "". */
function parseTenure(raw) {
  const t = clean(raw);
  if (!t) return "";
  const k = norm(t.replace(/[–—]/g, "-"));
  for (const o of TENURE) {
    if ([o.value, o.tr, o.en].some(x => norm(x.replace(/[–—]/g, "-")) === k)) return o.value;
  }
  const m = /(\d+(?:[.,]\d+)?)/.exec(t);
  if (!m) return "";
  const n = Number(m[1].replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 60) return "";
  if (n >= 10 && /\+|üzeri|uzeri|over|more|fazla/i.test(t)) return "10+ years";
  if (n < 2) return "Less than 2 years";
  if (n < 5) return "2–4 years";
  if (n < 8) return "5–7 years";
  if (n <= 10) return "8–10 years";
  return "10+ years";
}

const tenureLabel = (value, lang) => (TENURE.find(o => o.value === value) || {})[lang] || value;

/** Options of one list as the organisation's form shows them. */
function optionsOf(companyId, listId) {
  const def = formConfig.schema.LISTS[listId];
  const own = (formConfig.get(companyId).options || {})[listId] || { hidden: [], custom: [] };
  const hidden = new Set(own.hidden || []);
  return [...def.builtins.filter(o => !hidden.has(o.value)), ...(own.custom || [])];
}

/**
 * "Strateji; Pazarlama, Bilinmeyen" -> { values: ["Strategy", "Marketing"], extra: ["Bilinmeyen"] }.
 * Separators: ; or a new line; a part that matches nothing is split again at commas.
 */
function matchOptions(raw, options) {
  const index = new Map();
  for (const o of options) for (const k of [o.value, o.tr, o.en]) if (k) index.set(norm(k), o.value);
  const values = [], extra = [];
  const take = part => {
    const p = clean(part);
    if (!p) return true;
    const v = index.get(norm(p));
    if (v) { if (!values.includes(v)) values.push(v); return true; }
    return false;
  };
  for (const part of String(raw == null ? "" : raw).split(/[;\n\r]+/)) {
    if (take(part)) continue;
    const bits = part.split(",");
    if (bits.length > 1 && bits.every(b => !clean(b) || index.has(norm(b)))) { bits.forEach(take); continue; }
    const p = clean(part);
    if (p && !extra.includes(p)) extra.push(p);
  }
  return { values, extra };
}

// ---------------------------------------------------------------------
// The template's columns (TR and EN). Headers are found by name, so a
// column moved, renamed slightly or left out still reads right.
// ---------------------------------------------------------------------

const COMMON_HEAD = [
  { key: "roleMark", style: "navy", width: 10, exact: ["mentor", "mentee", "rol", "role", "tur", "type", "kisituru"] },
  { key: "sicil", tr: "Sicil", en: "Person no.", style: "grey", width: 10, cellStyle: "text", prefix: ["sicil", "personno", "personnumber"] },
  { key: "fullName", tr: "Ad Soyad", en: "Full name", style: "navy", width: 24, prefix: ["adsoyad", "adisoyadi", "fullname", "isimsoyisim", "isim"], exact: ["name", "ad"] },
  { key: "email", tr: "E-posta", en: "E-mail", style: "navy", width: 30, prefix: ["eposta", "email", "mail"] },
  { key: "title", tr: "Rol/Unvan", en: "Role / Title", style: "navy", width: 24, prefix: ["rolunvan", "unvan", "roletitle", "title", "jobtitle", "gorev", "pozisyon", "position"] },
  { key: "department", tr: "Departman", en: "Department", style: "navy", width: 22, prefix: ["departman", "department", "bolum", "birim"] },
  { key: "tenure", tr: "Kıdem", en: "Tenure", style: "navy", width: 16, prefix: ["kidem", "tenure"] }
];
const COLUMNS = {
  mentor: [
    ...COMMON_HEAD,
    { key: "areas", tr: "Uzmanlık fonksiyon alanları", en: "Functional areas of expertise", style: "blue", width: 40, prefix: ["uzmanlikfonksiyon", "fonksiyon", "functional", "uzmanlikalan"] },
    { key: "industries", tr: "Uzman olduğunuz sektörler", en: "Industries of expertise", style: "blue", width: 34, prefix: ["uzmanoldugunuzsektor", "sektor", "industr"] },
    { key: "capacity", tr: "Kapasite (Kaç Mentee ile çalışmak ister)", en: "Capacity (how many mentees)", style: "blue", width: 20, prefix: ["kapasite", "capacity"] }
  ],
  mentee: [
    ...COMMON_HEAD,
    { key: "areas", tr: "Gelişmek istediği alanlar", en: "Development areas", style: "copper", width: 40, prefix: ["gelismekistedigi", "gelisimalan", "developmentarea", "fonksiyon", "functional"] },
    { key: "needs", tr: "Gelişim ihtiyacı açıklaması", en: "Development need (description)", style: "copper", width: 48, prefix: ["gelisimihtiyac", "developmentneed", "ihtiyac", "need"] }
  ]
};
const ROLE_NAME = { mentor: "Mentor", mentee: "Mentee" };

function headerKey(role, header) {
  const h = norm(header);
  if (!h) return null;
  for (const c of COLUMNS[role]) {
    if ((c.exact || []).includes(h)) return c.key;
    if ((c.prefix || []).some(p => h.startsWith(p))) return c.key;
  }
  return null;
}

function sheetRole(sheet) {
  const n = norm(sheet.name);
  if (n.startsWith("mentor")) return "mentor";
  if (n.startsWith("mentee")) return "mentee";
  const a1 = norm((sheet.rows[0] || [])[0]);
  if (a1 === "mentor" || a1 === "mentee") return a1;
  return null;
}

// ---------------------------------------------------------------------
// Messages: every message in both languages, the screen picks one.
// ---------------------------------------------------------------------

const M = {
  name_missing: () => ({ tr: "Ad Soyad boş.", en: "Full name is empty." }),
  name_long: () => ({ tr: `Ad Soyad en fazla ${TEXT_MAX.fullName} karakter olabilir.`, en: `Full name can be at most ${TEXT_MAX.fullName} characters.` }),
  email_missing: () => ({ tr: "E-posta boş.", en: "E-mail is empty." }),
  email_bad: e => ({ tr: `Geçerli bir e-posta değil: ${e}`, en: `Not a valid e-mail: ${e}` }),
  email_example: () => ({ tr: "Örnek satır (example.com adresi); içeri aktarılmaz.", en: "Example row (example.com address); not imported." }),
  email_dup: r => ({ tr: `Bu e-posta dosyada ${r}. satırda zaten var.`, en: `This e-mail is already on row ${r} of the file.` }),
  role_mismatch: (v, s) => ({ tr: `Satırda "${v}" yazıyor ama ${s} sayfasında.`, en: `The row says "${v}" but is on the ${s} sheet.` }),
  exists_skip: s => ({ tr: `Bu e-posta zaten ${s} olarak kayıtlı; atlanacak, bilgileri değişmez.`, en: `This e-mail is already registered as ${s}; it will be skipped and nothing changes.` }),
  exists_fill: f => ({ tr: `Zaten kayıtlı; yalnızca boş alanları doldurulacak: ${f.tr}.`, en: `Already registered; only its empty fields will be filled: ${f.en}.` }),
  exists_nothing: () => ({ tr: "Zaten kayıtlı; doldurulacak boş alanı yok, değişiklik olmayacak.", en: "Already registered; no empty field to fill, nothing changes." }),
  sicil_ignored: (typed, sys) => ({ tr: `Sicil sütunu yok sayıldı ("${typed}"). Sicil numarasını sistem verir${sys ? `; bu kişinin sicili ${sys}` : ""}.`, en: `The person-no. column was ignored ("${typed}"). The system gives the number${sys ? `; this person's is ${sys}` : ""}.` }),
  tenure_unknown: v => ({ tr: `Kıdem tanınmadı ("${v}"); boş bırakılacak.`, en: `Tenure not recognised ("${v}"); left empty.` }),
  options_extra: (v, list) => ({ tr: `Listede olmayan ${list.tr}: ${v}. "Diğer" olarak kaydedilecek.`, en: `Not in the ${list.en} list: ${v}. Saved as "other".` }),
  capacity_bad: v => ({ tr: `Kapasite anlaşılmadı ("${v}"); 1 kabul edildi.`, en: `Capacity not understood ("${v}"); 1 is used.` }),
  capacity_max: () => ({ tr: `Kapasite en fazla ${LIMITS.capacityMax} olabilir; ${LIMITS.capacityMax} kabul edildi.`, en: `Capacity can be at most ${LIMITS.capacityMax}; ${LIMITS.capacityMax} is used.` }),
  text_cut: (f) => ({ tr: `${f.tr} çok uzun; kısaltıldı.`, en: `${f.en} is too long; it was shortened.` })
};
const msg = (level, code, ...a) => ({ level, code, ...M[code](...a) });

const FIELD = {
  title: { tr: "Rol/Unvan", en: "Role / Title" },
  department: { tr: "Departman", en: "Department" },
  tenure: { tr: "Kıdem", en: "Tenure" },
  areasMentor: { tr: "Fonksiyon alanları", en: "Functional areas" },
  industries: { tr: "Sektörler", en: "Industries" },
  areasMentee: { tr: "Gelişim alanları", en: "Development areas" },
  needs: { tr: "Gelişim ihtiyacı", en: "Development need" }
};
const LIST_NAME = {
  areas: { tr: "fonksiyon alanı", en: "functional area" },
  industries: { tr: "sektör", en: "industry" }
};

class ImportError extends Error {
  constructor(code, tr, en) { super(en); this.code = code; this.tr = tr; this.en = en; }
}

// ---------------------------------------------------------------------
// Reading the file
// ---------------------------------------------------------------------

function readPeople(buffer) {
  if (!buffer || !buffer.length) throw new ImportError("no_file", "Dosya boş.", "The file is empty.");
  if (buffer.length > LIMITS.fileBytes) throw new ImportError("file_too_large", "Dosya en fazla 5 MB olabilir.", "The file can be at most 5 MB.");
  let sheets;
  try { sheets = xlsx.read(buffer); }
  catch (e) {
    if (e.code === "too_large") throw new ImportError("file_too_large", "Dosya çok büyük.", "The file is too large.");
    throw new ImportError("not_xlsx", "Dosya okunamadı. Excel'de .xlsx olarak kaydedip tekrar deneyin.", "The file could not be read. Save it as .xlsx in Excel and try again.");
  }

  const rows = [];
  const found = [];
  for (const sheet of sheets) {
    const role = sheetRole(sheet);
    if (!role) continue;
    found.push(role);
    const head = sheet.rows[0] || [];
    const colOf = {};
    head.forEach((h, i) => { const k = headerKey(role, h); if (k && colOf[k] == null) colOf[k] = i; });
    if (colOf.fullName == null || colOf.email == null) {
      throw new ImportError("headers_missing",
        `"${sheet.name}" sayfasında Ad Soyad ve E-posta başlıkları bulunamadı. Şablonu indirip onu doldurun.`,
        `The "${sheet.name}" sheet has no Full name and E-mail headers. Download the template and fill it in.`);
    }
    for (let r = 1; r < sheet.rows.length; r++) {
      const cells = sheet.rows[r] || [];
      const get = k => (colOf[k] == null ? "" : String(cells[colOf[k]] ?? ""));
      const data = {};
      for (const c of COLUMNS[role]) data[c.key] = get(c.key);
      // A row with only the role / person number filled in is an empty row of the template.
      const content = COLUMNS[role].some(c => c.key !== "roleMark" && c.key !== "sicil" && clean(data[c.key]));
      if (!content) continue;
      rows.push({ sheet: sheet.name, row: r + 1, role, data });
    }
  }
  if (!found.length) {
    throw new ImportError("no_sheets", "Dosyada Mentor ya da Mentee sayfası yok. Şablonu indirip onu doldurun.",
      "The file has no Mentor or Mentee sheet. Download the template and fill it in.");
  }
  if (rows.length > LIMITS.people) {
    throw new ImportError("too_many", `Tek seferde en fazla ${LIMITS.people} kişi aktarılabilir; dosyada ${rows.length} kişi var. Dosyayı bölün.`,
      `At most ${LIMITS.people} people can be imported at once; the file has ${rows.length}. Split the file.`);
  }
  return rows;
}

// ---------------------------------------------------------------------
// Checking (no writes)
// ---------------------------------------------------------------------

const EXAMPLE_DOMAIN = /@(example\.(com|org|net)|ornek\.com|test\.com)$/i;
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;

function analyzeRows(companyId, rows, opts) {
  const cid = slugify(companyId);
  const mode = opts.existing === "fill" ? "fill" : "skip";
  const lists = { areas: optionsOf(cid, "functionalAreas"), industries: optionsOf(cid, "industries") };
  const seen = { mentor: new Map(), mentee: new Map() };

  return rows.map(src => {
    const { role, data } = src;
    const out = { sheet: src.sheet, row: src.row, role, messages: [], status: "new", fields: {} };
    const errors = [], warns = [];

    const mark = clean(data.roleMark);
    if (mark && !["mentor", "mentee"].includes(norm(mark))) {
      // Something else written in the role column: harmless, ignored.
    } else if (mark && norm(mark) !== role) {
      errors.push(msg("error", "role_mismatch", mark, ROLE_NAME[role]));
    }

    let fullName = clean(data.fullName);
    if (!fullName) errors.push(msg("error", "name_missing"));
    else if (fullName.length > TEXT_MAX.fullName) errors.push(msg("error", "name_long"));
    out.fullName = fullName;

    const email = clean(data.email).replace(/^mailto:/i, "");
    out.email = email;
    if (!email) errors.push(msg("error", "email_missing"));
    else if (!EMAIL_RE.test(email) || email.length > 254) errors.push(msg("error", "email_bad", email));
    else if (EXAMPLE_DOMAIN.test(email)) errors.push(msg("error", "email_example"));
    else {
      const key = email.toLowerCase();
      if (seen[role].has(key)) errors.push(msg("error", "email_dup", seen[role].get(key)));
      else seen[role].set(key, src.row);
    }

    // Values -> the form's fields
    const f = {};
    const cut = (v, max, label) => { const c = clean(v); if (c.length > max) { warns.push(msg("warning", "text_cut", label)); return c.slice(0, max); } return c; };
    f.title = cut(data.title, TEXT_MAX.title, FIELD.title);
    f.department = cut(data.department, TEXT_MAX.department, FIELD.department);
    const tenureRaw = clean(data.tenure);
    f.tenure = parseTenure(tenureRaw);
    if (tenureRaw && !f.tenure) warns.push(msg("warning", "tenure_unknown", tenureRaw));

    const areas = matchOptions(data.areas, lists.areas);
    if (areas.extra.length) warns.push(msg("warning", "options_extra", areas.extra.join("; "), LIST_NAME.areas));
    f.areas = areas.values;
    f.areasExtra = areas.extra.join("; ").slice(0, TEXT_MAX.extra);

    if (role === "mentor") {
      const ind = matchOptions(data.industries, lists.industries);
      if (ind.extra.length) warns.push(msg("warning", "options_extra", ind.extra.join("; "), LIST_NAME.industries));
      f.industries = ind.values;
      f.industriesExtra = ind.extra.join("; ").slice(0, TEXT_MAX.extra);
      const capRaw = clean(data.capacity);
      let cap = 1;
      if (capRaw) {
        const n = Number(capRaw.replace(",", "."));
        if (!Number.isFinite(n) || n < 1 || Math.trunc(n) !== n) warns.push(msg("warning", "capacity_bad", capRaw));
        else if (n > LIMITS.capacityMax) { warns.push(msg("warning", "capacity_max")); cap = LIMITS.capacityMax; }
        else cap = n;
      }
      f.capacity = cap;
    } else {
      f.needs = cut(String(data.needs || "").replace(/\r\n?/g, "\n").trim(), TEXT_MAX.developmentNeeds, FIELD.needs);
    }
    out.fields = f;

    // Already registered?
    const typedSicil = clean(data.sicil);
    if (!errors.length && email) {
      const table = role === "mentor" ? "mentors" : "mentees";
      const existing = db.prepare(
        `SELECT * FROM ${table} WHERE company_id = ? AND lower(trim(email)) = ? ORDER BY created_at LIMIT 1`
      ).get(cid, email.toLowerCase());
      const systemSicil = existing ? existing.sicil_no : sicil.findByEmail(cid, email);
      if (typedSicil && norm(typedSicil).replace(/^0+/, "") !== String(systemSicil || "").replace(/^0+/, "")) {
        warns.push(msg("warning", "sicil_ignored", typedSicil, systemSicil));
      }
      out.sicilNo = systemSicil || "";
      if (existing) {
        out.existingId = existing.id;
        if (mode === "skip") {
          out.status = "skip";
          warns.unshift(msg("info", "exists_skip", ROLE_NAME[role]));
        } else {
          out.fill = fillPlan(role, existing, f);
          if (out.fill.length) {
            out.status = "fill";
            const names = out.fill.map(x => FIELD[x.label]);
            warns.unshift(msg("info", "exists_fill", { tr: names.map(n => n.tr).join(", "), en: names.map(n => n.en).join(", ") }));
          } else {
            out.status = "unchanged";
            warns.unshift(msg("info", "exists_nothing"));
          }
        }
      }
    } else if (typedSicil && !errors.length) {
      warns.push(msg("warning", "sicil_ignored", typedSicil, ""));
    }

    if (errors.length) out.status = "error";
    out.messages = [...errors, ...warns];
    return out;
  });
}

/**
 * What "fill" would write for an existing person: only fields EMPTY in
 * the system and given in the file. A list counts as empty only when
 * both the list and its "other" text are empty.
 */
function fillPlan(role, ex, f) {
  const plan = [];
  const empty = v => String(v == null ? "" : v).trim() === "";
  const emptyList = (col, extraCol) => parseArray(ex[col]).length === 0 && empty(ex[extraCol]);
  if (empty(ex.role) && f.title) plan.push({ label: "title", set: { role: f.title } });
  if (empty(ex.department) && f.department) plan.push({ label: "department", set: { department: f.department } });
  if (empty(ex.tenure) && f.tenure) plan.push({ label: "tenure", set: { tenure: f.tenure } });
  if (role === "mentor") {
    if ((f.areas.length || f.areasExtra) && emptyList("functional_areas", "functional_areas_extra")) {
      plan.push({ label: "areasMentor", set: { functional_areas: JSON.stringify(f.areas), functional_areas_extra: f.areasExtra }, list: ["functional_areas", "functional_areas_extra"] });
    }
    if ((f.industries.length || f.industriesExtra) && emptyList("industries", "industries_extra")) {
      plan.push({ label: "industries", set: { industries: JSON.stringify(f.industries), industries_extra: f.industriesExtra }, list: ["industries", "industries_extra"] });
    }
  } else {
    if ((f.areas.length || f.areasExtra) && emptyList("dev_functional_areas", "dev_areas_extra")) {
      plan.push({ label: "areasMentee", set: { dev_functional_areas: JSON.stringify(f.areas), dev_areas_extra: f.areasExtra }, list: ["dev_functional_areas", "dev_areas_extra"] });
    }
    if (empty(ex.development_needs) && f.needs) plan.push({ label: "needs", set: { development_needs: f.needs } });
  }
  return plan;
}

function summarize(rows) {
  const c = { total: rows.length, newMentors: 0, newMentees: 0, fill: 0, skip: 0, unchanged: 0, errors: 0, warnings: 0 };
  for (const r of rows) {
    if (r.status === "new") r.role === "mentor" ? c.newMentors++ : c.newMentees++;
    else if (r.status === "fill") c.fill++;
    else if (r.status === "skip") c.skip++;
    else if (r.status === "unchanged") c.unchanged++;
    else if (r.status === "error") c.errors++;
    if (r.status !== "error" && r.messages.some(m => m.level === "warning")) c.warnings++;
  }
  return c;
}

function checkProgram(companyId, programId) {
  if (!programId) return "";
  const p = db.prepare(`SELECT id, archived FROM programs WHERE id = ? AND company_id = ?`).get(String(programId), slugify(companyId));
  if (!p || p.archived) {
    throw new ImportError("bad_program", "Seçilen program bulunamadı ya da arşivde.", "The selected programme was not found or is archived.");
  }
  return p.id;
}

/** Upload check: what would happen. Writes nothing. */
function analyze(companyId, buffer, opts = {}) {
  checkProgram(companyId, opts.programId);
  const rows = analyzeRows(companyId, readPeople(buffer), opts);
  return { summary: summarize(rows), rows: rows.map(publicRow), limits: LIMITS };
}

const publicRow = r => ({
  sheet: r.sheet, row: r.row, role: r.role, fullName: r.fullName, email: r.email,
  sicilNo: r.sicilNo || "", status: r.status, messages: r.messages
});

// ---------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------

const FILL_SQL_COLUMNS = new Set(["role", "department", "tenure", "functional_areas", "functional_areas_extra",
  "industries", "industries_extra", "dev_functional_areas", "dev_areas_extra", "development_needs"]);

function commit(companyId, buffer, opts = {}) {
  if (opts.kvkkAttested !== true) {
    throw new ImportError("kvkk_required", "İçeri aktarmadan önce KVKK aydınlatma beyanını onaylayın.",
      "Confirm the privacy-notice statement before importing.");
  }
  const cid = slugify(companyId);
  const programId = checkProgram(cid, opts.programId);
  const people = readPeople(buffer);
  const importId = newId();
  const ts = now();

  const run = db.transaction(() => {
    // Checked again INSIDE the transaction: what is written is what the
    // database holds at this moment, not what it held at the preview.
    const rows = analyzeRows(cid, people, opts);
    const result = { importId, created: { mentor: 0, mentee: 0 }, filled: 0, skipped: 0, unchanged: 0, errors: 0, programAdded: 0 };

    for (const r of rows) {
      if (r.status === "error") { result.errors++; continue; }
      if (r.status === "skip") { result.skipped++; continue; }
      if (r.status === "unchanged") { result.unchanged++; continue; }
      const table = r.role === "mentor" ? "mentors" : "mentees";

      if (r.status === "fill") {
        let changed = 0;
        for (const step of r.fill) {
          const cols = Object.keys(step.set);
          if (!cols.every(c => FILL_SQL_COLUMNS.has(c))) throw new Error("unexpected column in import");
          // The WHERE repeats the "is it empty" check in SQL: a value that
          // appeared since the preview is never overwritten.
          const guard = step.list
            ? `COALESCE(${step.list[0]}, '') IN ('', '[]') AND COALESCE(${step.list[1]}, '') = ''`
            : `COALESCE(${cols[0]}, '') = ''`;
          const params = {};
          const sets = cols.map((c, i) => { params["v" + i] = step.set[c]; return `${c} = @v${i}`; }).join(", ");
          changed += db.prepare(`UPDATE ${table} SET ${sets}, updated_at = @ts WHERE id = @id AND company_id = @cid AND ${guard}`)
            .run({ ...params, ts, id: r.existingId, cid }).changes;
        }
        changed ? result.filled++ : result.unchanged++;
        continue;
      }

      // New person - the same path as a registration form.
      const f = r.fields;
      let rec;
      if (r.role === "mentor") {
        rec = mentors.create(cid, {
          fullName: r.fullName, email: r.email, role: f.title, tenure: f.tenure,
          functionalAreas: f.areas, functionalAreasExtra: f.areasExtra,
          industries: f.industries, industriesExtra: f.industriesExtra,
          capacity: f.capacity, kvkkConsent: false, submittedAt: ts
        });
        db.prepare(`UPDATE mentors SET department = ?, source = 'import', import_id = ? WHERE id = ?`).run(f.department, importId, rec.id);
        if (programId) result.programAdded += db.prepare(`INSERT OR IGNORE INTO program_mentors (program_id, mentor_id, company_id, added_at) VALUES (?, ?, ?, ?)`).run(programId, rec.id, cid, ts).changes;
      } else {
        rec = mentees.create(cid, {
          fullName: r.fullName, email: r.email, role: f.title, department: f.department, tenure: f.tenure,
          devFunctionalAreas: f.areas, devAreasExtra: f.areasExtra, developmentNeeds: f.needs,
          kvkkConsent: false, submittedAt: ts
        });
        db.prepare(`UPDATE mentees SET source = 'import', import_id = ? WHERE id = ?`).run(importId, rec.id);
        if (programId) result.programAdded += db.prepare(`INSERT OR IGNORE INTO program_mentees (program_id, mentee_id, company_id, added_at) VALUES (?, ?, ?, ?)`).run(programId, rec.id, cid, ts).changes;
      }
      result.created[r.role]++;
    }

    db.prepare(`INSERT INTO people_imports (id, company_id, file_name, existing_mode, program_id, kvkk_attested, counts, created_at)
                VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
      .run(importId, cid, clean(opts.fileName, 200), opts.existing === "fill" ? "fill" : "skip", programId, JSON.stringify(result), ts);
    return result;
  });
  return run();
}

// ---------------------------------------------------------------------
// The template
// ---------------------------------------------------------------------

const TEMPLATE_ROWS = 200;      // rows with the role filled in and styles
const VALID_ROWS = 1001;        // drop-down lists reach this row

const TEXT = {
  tr: {
    options: "Seçenekler", help: "Açıklama",
    optTenure: "Kıdem", optAreas: "Fonksiyon alanları (mentor uzmanlığı ve mentee gelişim alanı)", optIndustries: "Sektörler (mentor)",
    helpTitle: "Kişileri içeri aktarma şablonu",
    lines: [
      "1. Mentor'ları Mentor sayfasına, mentee'leri Mentee sayfasına yazın. Her satır bir kişidir.",
      "2. Zorunlu sütunlar: Ad Soyad ve E-posta. Diğer sütunlar isteğe bağlıdır; bilmediğinizi boş bırakın.",
      "3. Sicil sütununu boş bırakın: sicil numarasını sistem verir. Kişi sistemde zaten kayıtlıysa mevcut sicili korunur.",
      "4. Aynı kişi hem mentor hem mentee olacaksa iki sayfaya da aynı e-posta ile yazın; sicil numarası tek kalır.",
      "5. Birden fazla fonksiyon alanı veya sektörü noktalı virgülle ayırın, örneğin: Strateji; Pazarlama. Geçerli değerler Seçenekler sayfasındadır. Listede olmayan bir değer \"diğer\" olarak kaydedilir.",
      "6. Kıdem ve Kapasite için hücredeki açılır listeyi kullanın. Kapasite boşsa 1 kabul edilir.",
      "7. E-postası sistemde zaten kayıtlı olan kişiler varsayılan olarak atlanır; mevcut bilgileri değiştirilmez.",
      "8. Tek seferde en fazla 1.000 kişi aktarılabilir. Dosyayı .xlsx olarak kaydedin.",
      "9. Yükledikten sonra önce bir önizleme görürsünüz; onaylamadan hiçbir kayıt yapılmaz.",
      "10. Aşağıdaki örnekler yalnızca bu sayfadadır. Mentor ve Mentee sayfalarına örnek satır yazmayın."
    ],
    example: "Örnek"
  },
  en: {
    options: "Options", help: "Instructions",
    optTenure: "Tenure", optAreas: "Functional areas (mentor expertise and mentee development area)", optIndustries: "Industries (mentor)",
    helpTitle: "People import template",
    lines: [
      "1. Write mentors on the Mentor sheet and mentees on the Mentee sheet. One row per person.",
      "2. Required columns: Full name and E-mail. The other columns are optional; leave empty what you do not know.",
      "3. Leave the Person no. column empty: the system gives the number. Someone already registered keeps their number.",
      "4. Someone who will be both a mentor and a mentee goes on both sheets with the same e-mail; they keep one person number.",
      "5. Separate several functional areas or industries with semicolons, e.g. Strategy; Marketing. The valid values are on the Options sheet. A value not on the list is saved as \"other\".",
      "6. Use the drop-down list in the cell for Tenure and Capacity. An empty capacity means 1.",
      "7. People whose e-mail is already registered are skipped by default; their details do not change.",
      "8. At most 1,000 people at once. Save the file as .xlsx.",
      "9. After uploading you first see a preview; nothing is saved until you confirm.",
      "10. The examples below are on this sheet only. Do not write example rows on the Mentor and Mentee sheets."
    ],
    example: "Example"
  }
};

function template(companyId, lang) {
  const L = lang === "en" ? "en" : "tr";
  const T = TEXT[L];
  const label = o => o[L] || o.value;
  const areas = optionsOf(companyId, "functionalAreas").map(label);
  const industries = optionsOf(companyId, "industries").map(label);
  const tenure = TENURE.map(o => o[L]);

  const roleSheet = role => {
    const cols = COLUMNS[role];
    const header = cols.map(c => ({ v: c.key === "roleMark" ? ROLE_NAME[role] : c[L], s: c.style }));
    const rows = [header];
    for (let i = 1; i <= TEMPLATE_ROWS; i++) rows.push([ROLE_NAME[role]]);
    const at = key => xlsx._colName(cols.findIndex(c => c.key === key));
    const validations = [
      { sqref: `${at("roleMark")}2:${at("roleMark")}${VALID_ROWS}`, type: "list", list: [ROLE_NAME[role]] },
      { sqref: `${at("tenure")}2:${at("tenure")}${VALID_ROWS}`, type: "list", list: tenure,
        error: L === "tr" ? "Listeden seçin." : "Choose from the list." }
    ];
    if (role === "mentor") {
      validations.push({ sqref: `${at("capacity")}2:${at("capacity")}${VALID_ROWS}`, type: "whole", min: 1, max: LIMITS.capacityMax,
        error: L === "tr" ? `1 ile ${LIMITS.capacityMax} arasında bir tam sayı yazın.` : `Type a whole number from 1 to ${LIMITS.capacityMax}.` });
    }
    const colStyles = {};
    cols.forEach((c, i) => { if (c.cellStyle) colStyles[i] = c.cellStyle; });
    return { name: ROLE_NAME[role], rows, widths: cols.map(c => c.width), freeze: true, headerHeight: 32,
             colStyles, styleRows: TEMPLATE_ROWS + 1, validations, tabSelected: role === "mentor" };
  };

  const longest = Math.max(tenure.length, areas.length, industries.length);
  const optRows = [[{ v: T.optTenure, s: "navy" }, { v: T.optAreas, s: "navy" }, { v: T.optIndustries, s: "navy" }]];
  for (let i = 0; i < longest; i++) optRows.push([tenure[i] || "", areas[i] || "", industries[i] || ""]);

  const exMentor = L === "tr"
    ? ["Mentor", "", "Ayşe Yılmaz", "ayse.yilmaz@firmaniz.com", "Satış Direktörü", "Satış", tenure[3], `${areas[0] || ""}; ${areas[8] || ""}`, industries[1] || "", 2]
    : ["Mentor", "", "Jane Smith", "jane.smith@yourcompany.com", "Sales Director", "Sales", tenure[3], `${areas[0] || ""}; ${areas[8] || ""}`, industries[1] || "", 2];
  const exMentee = L === "tr"
    ? ["Mentee", "", "Can Demir", "can.demir@firmaniz.com", "Satış Uzmanı", "Satış", tenure[1], areas[0] || "", "Müşteri görüşmelerinde ikna becerimi geliştirmek istiyorum."]
    : ["Mentee", "", "Tom Brown", "tom.brown@yourcompany.com", "Sales Specialist", "Sales", tenure[1], areas[0] || "", "I want to get better at persuading customers in meetings."];
  const helpRows = [[{ v: T.helpTitle, s: "title" }], [""]];
  T.lines.forEach(l => helpRows.push([l]));        // not wrapped: the text runs on over the empty cells
  helpRows.push([""], [{ v: `${T.example}: Mentor`, s: "bold" }]);
  helpRows.push(COLUMNS.mentor.map(c => ({ v: c.key === "roleMark" ? "Mentor" : c[L], s: c.style })), exMentor);
  helpRows.push([""], [{ v: `${T.example}: Mentee`, s: "bold" }]);
  helpRows.push(COLUMNS.mentee.map(c => ({ v: c.key === "roleMark" ? "Mentee" : c[L], s: c.style })), exMentee);

  return xlsx.write([
    roleSheet("mentor"),
    roleSheet("mentee"),
    { name: T.options, rows: optRows, widths: [20, 46, 30], freeze: true },
    { name: T.help, rows: helpRows, widths: COLUMNS.mentor.map(c => c.width) }
  ]);
}

/** The latest uploads of an organisation (for the page's history). */
function history(companyId, limit = 10) {
  return db.prepare(`SELECT id, file_name, existing_mode, program_id, counts, created_at FROM people_imports
                      WHERE company_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(slugify(companyId), limit)
    .map(r => ({ id: r.id, fileName: r.file_name, existingMode: r.existing_mode, programId: r.program_id,
                 counts: JSON.parse(r.counts || "{}"), createdAt: r.created_at }));
}

module.exports = { analyze, commit, template, history, ImportError, LIMITS, _parseTenure: parseTenure, _matchOptions: matchOptions, _norm: norm, tenureLabel };
