/**
 * ====================================================================
 * CHECK-IN FEEDBACK - QUESTION SET  (per organisation)
 * ====================================================================
 *
 * One question set per organisation, used for BOTH the mentor and the
 * mentee. HR edits it on the "Feedback questions" page with its own
 * sign-in. Stored in the settings table under
 * "checkin_questions:<companyId>" as JSON; nothing stored = the defaults
 * below. (Ported from the on-prem version, where the set is global.)
 *
 * Every check-in round keeps a SNAPSHOT of the questions it was sent
 * with (checkins.questions), so editing or deleting a question here
 * never breaks the answers of earlier rounds.
 *
 * QUESTION
 *   { id, type, tr, en, optional, support }
 *     type     scale5 (1-5 agreement) | text | yesno
 *     tr / en  question text; at least one language is required. An
 *              empty one is stored empty and the pages show the other
 *     optional the person may leave it empty
 *     support  yesno only: a "Yes" answer marks the mentorship with a
 *              "needs support" flag on the HR dashboard
 *
 * IDS are generated once and never change - answers are stored by id.
 */
const crypto = require("crypto");
const settings = require("../db/settings");

const keyOf = companyId => `checkin_questions:${String(companyId || "")}`;
const TYPES = ["scale5", "text", "yesno"];
const LIMITS = { questions: 20, text: 300 };

const DEFAULTS = [
  { id: "progress", type: "scale5", optional: false, support: false,
    tr: "Mentorluk hedeflerine doğru ilerleme kaydediliyor.",
    en: "Progress is being made towards the mentoring goals." },
  { id: "regular", type: "scale5", optional: false, support: false,
    tr: "Görüşmelerimiz düzenli yapılıyor.",
    en: "Our meetings take place regularly." },
  { id: "relationship", type: "scale5", optional: false, support: false,
    tr: "Verimli bir çalışma ilişkisi kurduk.",
    en: "We have built a productive working relationship." },
  { id: "going_well", type: "text", optional: true, support: false,
    tr: "Şu ana kadar en faydalı bulduğunuz ya da iyi giden ne oldu?",
    en: "What has been most useful, or gone well, so far?" },
  { id: "obstacles", type: "text", optional: true, support: false,
    tr: "İlerlemeyi zorlaştıran bir şey var mı?",
    en: "Is anything making progress harder?" },
  { id: "hr_support", type: "yesno", optional: false, support: true,
    tr: "İnsan Kaynakları'ndan desteğe ihtiyacınız var mı?",
    en: "Do you need support from HR?" }
];

const clean = (v, max) =>
  String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

const newQuestionId = () => "q_" + crypto.randomBytes(5).toString("hex");

/**
 * Returns { questions, errors }. Errors carry the 1-based position so
 * the admin panel can point at the question to fix.
 */
function sanitize(input) {
  const list = Array.isArray(input) ? input : [];
  const errors = [];
  const out = [];
  const seen = new Set();

  if (!list.length) errors.push({ index: 0, code: "no_questions" });
  if (list.length > LIMITS.questions) errors.push({ index: 0, code: "too_many" });

  list.slice(0, LIMITS.questions).forEach((q, i) => {
    const pos = i + 1;
    const type = TYPES.includes(q && q.type) ? q.type : null;
    const tr = clean(q && q.tr, LIMITS.text);
    const en = clean(q && q.en, LIMITS.text);
    if (!type) { errors.push({ index: pos, code: "bad_type" }); return; }
    if (!tr && !en) { errors.push({ index: pos, code: "no_text" }); return; }

    let id = String((q && q.id) || "");
    if (!/^[a-z0-9_]{2,40}$/.test(id) || seen.has(id)) id = newQuestionId();
    seen.add(id);

    out.push({
      id,
      type,
      // An empty language stays empty here (so the admin panel shows it
      // as not filled in); pages fall back to the other language.
      tr,
      en,
      optional: !!(q && q.optional),
      support: type === "yesno" && !!(q && q.support)
    });
  });

  return { questions: out, errors };
}

function load(companyId) {
  let raw = null;
  try { raw = settings.get(keyOf(companyId), null); } catch { raw = null; }
  if (raw) {
    try {
      const { questions } = sanitize(JSON.parse(raw));
      if (questions.length) return { questions, isDefault: false };
    } catch { /* fall through to the defaults */ }
  }
  return { questions: DEFAULTS.map(q => ({ ...q })), isDefault: true };
}

function get(companyId) { return load(companyId).questions; }

function save(companyId, input) {
  const { questions, errors } = sanitize(input);
  if (errors.length) return { ok: false, errors };
  settings.set(keyOf(companyId), JSON.stringify(questions), { updatedBy: `company:${companyId}` });
  return { ok: true, questions };
}

function reset(companyId) {
  settings.remove(keyOf(companyId));
  return get(companyId);
}

/**
 * Validates answers against a snapshot. Returns { answers, missing,
 * needsSupport }. Unknown keys are dropped; text is trimmed and capped.
 */
function readAnswers(questions, input) {
  const src = input && typeof input === "object" ? input : {};
  const answers = {};
  const missing = [];
  let needsSupport = false;

  for (const q of questions) {
    const v = src[q.id];
    let value = null;
    if (q.type === "scale5") {
      const n = Number(v);
      if (Number.isInteger(n) && n >= 1 && n <= 5) value = n;
    } else if (q.type === "yesno") {
      if (v === "yes" || v === "no") value = v;
    } else {
      const t = String(v == null ? "" : v).replace(/\r\n?/g, "\n").trim().slice(0, 2000);
      if (t) value = t;
    }
    if (value === null) { if (!q.optional) missing.push(q.id); continue; }
    answers[q.id] = value;
    if (q.support && value === "yes") needsSupport = true;
  }
  return { answers, missing, needsSupport };
}

module.exports = { DEFAULTS, TYPES, LIMITS, sanitize, get, load, save, reset, readAnswers };
