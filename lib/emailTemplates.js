/**
 * E-MAIL TEMPLATES - per organisation (V03).
 *
 * Every e-mail the system sends to mentors and mentees is built from a
 * template here: subject, title, body text and button label, in Turkish
 * and English. An organisation can change any of them (Admin > E-mails);
 * what it does not change uses the default below.
 *
 * The body is PLAIN TEXT: it is escaped, line breaks are kept, and
 * {variables} are filled in (their values are escaped too). The logo, the
 * button with the personal link and the footer are added by the mailer -
 * HR cannot remove the link.
 *
 * Stored: email_templates (company_id, template_key, lang) - only what an
 * organisation changed. Table created in db/migrate.js.
 */
const { db } = require("../db");

const LIMITS = { subject: 200, title: 200, body: 5000, button: 60 };

// Variable names. Turkish and English names (and Turkish names without
// Turkish letters) all work in both languages.
const VARS = {
  name:         { tr: "ad",           en: "name",         alias: [] },
  other:        { tr: "karşı_taraf",  en: "other",        alias: ["karsi_taraf"] },
  company:      { tr: "firma",        en: "company",      alias: [] },
  programme:    { tr: "program",      en: "programme",    alias: ["program"] },
  period:       { tr: "dönem",        en: "period",       alias: ["donem"] },
  group:        { tr: "grup",         en: "group",        alias: [] },
  participants: { tr: "katılımcılar", en: "participants", alias: ["katilimcilar"] }
};
const VAR_HELP = {
  name:         { tr: "Alıcının adı soyadı", en: "Recipient's name" },
  other:        { tr: "Karşı taraf (mentor, mentee ya da grup adı)", en: "The other side (mentor, mentee or group name)" },
  company:      { tr: "Firma adı", en: "Organisation name" },
  programme:    { tr: "Program adı (yoksa boş)", en: "Programme name (empty if none)" },
  period:       { tr: "Eşleşmenin süresi (başlangıç – bitiş)", en: "Duration of the match (start – end)" },
  group:        { tr: "Grup adı", en: "Group name" },
  participants: { tr: "Gruptaki katılımcılar", en: "Participants of the group" }
};

const WS_TR_END =
  "Aşağıdaki bağlantıdan ortak çalışma sayfanıza girebilirsiniz. Bu sayfada gelişim planını oluşturur, " +
  "her görüşmeden sonra toplantı notunu ve süresini kaydeder, aksiyonları takip eder ve bir sonraki görüşmeyi planlarsınız.\n\n" +
  "Sayfa giriş gerektirmez, yalnızca bu bağlantıyla açılır. Lütfen bağlantıyı başkalarıyla paylaşmayın.";
const WS_EN_END =
  "Use the link below to open your shared workspace. There you build the development plan, record a short note " +
  "and the duration after every meeting, follow up on actions and plan your next meeting.\n\n" +
  "No sign-in is needed - the page opens only with this link. Please do not share it with anyone else.";

const CI_TR = "{karşı_taraf} ile yürüttüğünüz mentorluk süreci için kısa bir ara dönem anketi doldurmanızı rica ediyoruz. " +
  "Birkaç soru, yaklaşık 2 dakika.\n\nBu bir kapanış anketi değildir; süreç devam ederken nasıl gittiğini anlamak içindir. " +
  "Cevaplarınızı yalnızca İnsan Kaynakları görür; {karşı_taraf} görmez.";
const CI_EN = "We would like you to fill in a short mid-term survey on your mentorship with {other}. " +
  "A few questions, about 2 minutes.\n\nThis is not the closing survey; it is to see how things are going while the mentorship runs. " +
  "Only HR sees your answers; {other} does not.";
const CS_TR = "{karşı_taraf} ile yürüttüğünüz mentorluk süreci tamamlandı. Emeğiniz için teşekkür ederiz.\n\n" +
  "Aşağıdaki bağlantıdan kısa bir değerlendirme anketi doldurmanızı rica ediyoruz. Doldurması yaklaşık 3-4 dakika sürüyor " +
  "ve programı geliştirmemize doğrudan katkı sağlıyor.\n\nCevaplarınızı yalnızca İnsan Kaynakları görür. " +
  "Karşı taraf bu ankete verdiğiniz yanıtları göremez.";
const CS_EN = "Your mentoring relationship with {other} has come to an end. Thank you for taking part.\n\n" +
  "Please take a moment to complete a short survey using the link below. It takes about 3-4 minutes " +
  "and directly helps us improve the programme.\n\nOnly Human Resources can see your answers. " +
  "The other party cannot see the responses you give in this survey.";

/** The templates, in the order HR sees them. */
const TEMPLATES = [
  { key: "invite_mentor", vars: ["company"],
    label: { tr: "Mentor kayıt daveti", en: "Mentor registration invitation" },
    tr: { subject: "{firma} - Mentor Kaydı Daveti", title: "Mentor Olarak Katılın", button: "Kayıt Formunu Aç",
          body: "{firma} mentorluk programına mentor olarak katılmanız için davet edildiniz.\n\n" +
                "Aşağıdaki bağlantıya tıklayarak kısa bir form doldurmanız yeterli. Giriş yapmanıza veya hesap oluşturmanıza gerek yok." },
    en: { subject: "{company} - Mentor Registration Invitation", title: "Join as a Mentor", button: "Open Registration Form",
          body: "You have been invited to join the {company} mentoring programme as a mentor.\n\n" +
                "Just click the link below and fill in a short form. No sign-in or account needed." } },

  { key: "invite_mentee", vars: ["company"],
    label: { tr: "Mentee kayıt daveti", en: "Mentee registration invitation" },
    tr: { subject: "{firma} - Mentee Kaydı Daveti", title: "Mentee Olarak Katılın", button: "Kayıt Formunu Aç",
          body: "{firma} mentorluk programına mentee olarak katılmanız için davet edildiniz.\n\n" +
                "Aşağıdaki bağlantıya tıklayarak kısa bir form doldurmanız yeterli. Giriş yapmanıza veya hesap oluşturmanıza gerek yok." },
    en: { subject: "{company} - Mentee Registration Invitation", title: "Join as a Mentee", button: "Open Registration Form",
          body: "You have been invited to join the {company} mentoring programme as a mentee.\n\n" +
                "Just click the link below and fill in a short form. No sign-in or account needed." } },

  { key: "workspace_mentor", vars: ["name", "other", "company", "programme", "period"],
    label: { tr: "Eşleşme ve Çalışma Sayfası - mentora", en: "Match and workspace - to the mentor" },
    tr: { subject: "Mentorluk eşleşmeniz: çalışma sayfanız hazır", title: "Mentorluk eşleşmeniz oluşturuldu", button: "Çalışma sayfasını aç",
          body: "Merhaba {ad},\n\n{karşı_taraf} ile mentorluk eşleşmeniz oluşturuldu; bu eşleşmede mentor sizsiniz.\n\n" +
                "Eşleşmenin süresi: {dönem}\n\n" + WS_TR_END },
    en: { subject: "Your mentorship match: your workspace is ready", title: "Your mentorship match has been created", button: "Open the workspace",
          body: "Hello {name},\n\nYou have been matched with {other}; you are the mentor in this match.\n\n" +
                "Duration of the match: {period}\n\n" + WS_EN_END } },

  { key: "workspace_mentee", vars: ["name", "other", "company", "programme", "period"],
    label: { tr: "Eşleşme ve Çalışma Sayfası - mentee'ye", en: "Match and workspace - to the mentee" },
    tr: { subject: "Mentorluk eşleşmeniz: çalışma sayfanız hazır", title: "Mentorluk eşleşmeniz oluşturuldu", button: "Çalışma sayfasını aç",
          body: "Merhaba {ad},\n\n{karşı_taraf} ile mentorluk eşleşmeniz oluşturuldu; {karşı_taraf} sizin mentorunuz olacak.\n\n" +
                "Eşleşmenin süresi: {dönem}\n\n" + WS_TR_END },
    en: { subject: "Your mentorship match: your workspace is ready", title: "Your mentorship match has been created", button: "Open the workspace",
          body: "Hello {name},\n\nYou have been matched with {other}, who will be your mentor.\n\n" +
                "Duration of the match: {period}\n\n" + WS_EN_END } },

  { key: "workspace_group_mentor", vars: ["name", "group", "participants", "company", "programme", "period"],
    label: { tr: "Grup eşleşmesi ve Çalışma Sayfası - mentora", en: "Group match and workspace - to the mentor" },
    tr: { subject: "Mentorluk eşleşmeniz: çalışma sayfanız hazır", title: "Mentorluk eşleşmeniz oluşturuldu", button: "Çalışma sayfasını aç",
          body: "Merhaba {ad},\n\n{grup} grubuyla mentorluk eşleşmeniz oluşturuldu; bu grubun mentoru sizsiniz.\n" +
                "Gruptaki katılımcılar: {katılımcılar}\n\nEşleşmenin süresi: {dönem}\n\n" + WS_TR_END },
    en: { subject: "Your mentorship match: your workspace is ready", title: "Your mentorship match has been created", button: "Open the workspace",
          body: "Hello {name},\n\nYou have been matched with the group {group}; you are the group's mentor.\n" +
                "Participants: {participants}\n\nDuration of the match: {period}\n\n" + WS_EN_END } },

  { key: "workspace_group_member", vars: ["name", "other", "group", "participants", "company", "programme", "period"],
    label: { tr: "Grup eşleşmesi ve Çalışma Sayfası - grup üyelerine", en: "Group match and workspace - to the members" },
    tr: { subject: "Mentorluk eşleşmeniz: çalışma sayfanız hazır", title: "Mentorluk eşleşmeniz oluşturuldu", button: "Çalışma sayfasını aç",
          body: "Merhaba {ad},\n\n{grup} grubunun bir üyesi olarak mentorluk eşleşmeniz oluşturuldu; grubun mentoru {karşı_taraf}.\n" +
                "Gruptaki katılımcılar: {katılımcılar}\n\nEşleşmenin süresi: {dönem}\n\n" + WS_TR_END },
    en: { subject: "Your mentorship match: your workspace is ready", title: "Your mentorship match has been created", button: "Open the workspace",
          body: "Hello {name},\n\nYou have been matched as a member of the group {group}; the group's mentor is {other}.\n" +
                "Participants: {participants}\n\nDuration of the match: {period}\n\n" + WS_EN_END } },

  { key: "checkin", vars: ["name", "other", "company", "programme"],
    label: { tr: "Ara Dönem Anketi - gönderim", en: "Mid-Term Survey - request" },
    tr: { subject: "Ara Dönem Anketi: mentorluk süreciniz nasıl gidiyor?", title: "Kısa bir ara dönem anketi", button: "Anketi aç",
          body: "Merhaba {ad},\n\n" + CI_TR },
    en: { subject: "Mid-Term Survey: how is your mentorship going?", title: "A short mid-term survey", button: "Open the survey",
          body: "Hello {name},\n\n" + CI_EN } },

  { key: "checkin_reminder", vars: ["name", "other", "company", "programme"],
    label: { tr: "Ara Dönem Anketi - hatırlatma", en: "Mid-Term Survey - reminder" },
    tr: { subject: "Hatırlatma - Ara Dönem Anketi: mentorluk süreciniz nasıl gidiyor?", title: "Ara dönem anketi için hatırlatma", button: "Anketi aç",
          body: "Merhaba {ad},\n\nAra dönem anketini henüz doldurmadığınızı görüyoruz. " + CI_TR },
    en: { subject: "Reminder - Mid-Term Survey: how is your mentorship going?", title: "A reminder about the mid-term survey", button: "Open the survey",
          body: "Hello {name},\n\nIt looks like you have not filled in the mid-term survey yet. " + CI_EN } },

  { key: "survey", vars: ["name", "other", "company", "programme"],
    label: { tr: "Kapanış Anketi - gönderim", en: "Closing Survey - request" },
    tr: { subject: "Mentorluk süreciniz tamamlandı - kısa bir anket", title: "Mentorluk süreciniz tamamlandı", button: "Anketi Doldur",
          body: "Merhaba {ad},\n\n" + CS_TR },
    en: { subject: "Your mentoring relationship has ended - a short survey", title: "Your mentoring relationship has ended", button: "Complete the Survey",
          body: "Hello {name},\n\n" + CS_EN } },

  { key: "survey_reminder", vars: ["name", "other", "company", "programme"],
    label: { tr: "Kapanış Anketi - hatırlatma", en: "Closing Survey - reminder" },
    tr: { subject: "Hatırlatma - Mentorluk süreciniz tamamlandı - kısa bir anket", title: "Kapanış anketi için hatırlatma", button: "Anketi Doldur",
          body: "Merhaba {ad},\n\nKapanış anketini henüz doldurmadığınızı görüyoruz. " + CS_TR },
    en: { subject: "Reminder - Your mentoring relationship has ended - a short survey", title: "A reminder about the closing survey", button: "Complete the Survey",
          body: "Hello {name},\n\nIt looks like you have not completed the closing survey yet. " + CS_EN } }
];
const BY_KEY = new Map(TEMPLATES.map(t => [t.key, t]));
const FIELDS = ["subject", "title", "body", "button"];
const LANGS = ["tr", "en"];

const escapeHtml = v => String(v ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function stored(companyId, key, lang) {
  return db.prepare(`SELECT subject, title, body, button, updated_at FROM email_templates
                      WHERE company_id = ? AND template_key = ? AND lang = ?`).get(companyId, key, lang) || null;
}

/** The template an organisation uses: its own change, else the default. */
function get(companyId, key, lang) {
  const t = BY_KEY.get(key);
  if (!t) throw new Error(`Unknown e-mail template: ${key}`);
  const l = lang === "en" ? "en" : "tr";
  const own = companyId ? stored(companyId, key, l) : null;
  return own
    ? { subject: own.subject, title: own.title, body: own.body, button: own.button, custom: true, updatedAt: own.updated_at }
    : { ...t[l], custom: false };
}

/** Everything the E-mails page needs. */
function list(companyId) {
  return TEMPLATES.map(t => ({
    key: t.key,
    label: t.label,
    variables: t.vars.map(v => ({ id: v, tr: VARS[v].tr, en: VARS[v].en, help: VAR_HELP[v] })),
    tr: get(companyId, t.key, "tr"),
    en: get(companyId, t.key, "en"),
    defaults: { tr: t.tr, en: t.en }
  }));
}

/** Checks HR's text. Returns { error, code } or { value }. */
function check(key, input) {
  if (!BY_KEY.has(key)) return { error: "Unknown e-mail template.", code: "unknown_template" };
  const value = {};
  for (const f of FIELDS) {
    const v = String((input || {})[f] ?? "").replace(/\r\n/g, "\n");
    const clean = f === "body" ? v.trim() : v.replace(/[\r\n]+/g, " ").trim();
    if (!clean) return { error: `The ${f} cannot be empty.`, code: "empty_field", field: f };
    if (clean.length > LIMITS[f]) return { error: `The ${f} is too long (max ${LIMITS[f]}).`, code: "too_long", field: f };
    value[f] = clean;
  }
  return { value };
}

function save(companyId, key, lang, input) {
  const c = check(key, input);
  if (c.error) return c;
  const l = lang === "en" ? "en" : "tr";
  db.prepare(`
    INSERT INTO email_templates (company_id, template_key, lang, subject, title, body, button, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id, template_key, lang) DO UPDATE SET
      subject = excluded.subject, title = excluded.title, body = excluded.body,
      button = excluded.button, updated_at = excluded.updated_at
  `).run(companyId, key, l, c.value.subject, c.value.title, c.value.body, c.value.button, new Date().toISOString());
  return { template: get(companyId, key, l) };
}

function reset(companyId, key, lang) {
  db.prepare(`DELETE FROM email_templates WHERE company_id = ? AND template_key = ? AND lang = ?`)
    .run(companyId, key, lang === "en" ? "en" : "tr");
  return get(companyId, key, lang);
}

/** Replaces {variables}; `esc` escapes each value (HTML) or not (subject). */
function fill(text, values, esc) {
  let out = String(text || "");
  for (const [id, names] of Object.entries(VARS)) {
    const v = values[id] == null ? "" : String(values[id]);
    for (const n of [names.tr, names.en, ...names.alias]) {
      out = out.split(`{${n}}`).join(esc ? escapeHtml(v) : v);
    }
  }
  return out;
}

/**
 * The e-mail parts, filled in. `values` uses the ids of VARS (name, other,
 * company, programme, period, group, participants). `override` (preview)
 * replaces the stored text.
 */
function render(companyId, key, lang, values = {}, override = null) {
  const tpl = override || get(companyId, key, lang);
  const html = s => fill(escapeHtml(s), values, true).replace(/\n/g, "<br>");
  return {
    subject: fill(tpl.subject, values, false).replace(/[\r\n]+/g, " ").trim(),
    title: html(tpl.title),
    body: html(tpl.body),
    button: html(tpl.button)
  };
}

/** Organisation name and programme name for the variables. */
function context(companyId, programId) {
  let company = "", programme = "";
  try {
    const c = db.prepare(`SELECT name FROM companies WHERE company_id = ?`).get(companyId);
    company = c ? c.name : "";
    if (programId) {
      const p = db.prepare(`SELECT name FROM programs WHERE id = ?`).get(programId);
      programme = p ? p.name : "";
    }
  } catch { /* the mail still goes out */ }
  return { company, programme };
}

module.exports = { TEMPLATES, LIMITS, LANGS, list, get, check, save, reset, render, context, has: k => BY_KEY.has(k) };
