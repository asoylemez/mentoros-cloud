/**
 * AI EXECUTIVE SUMMARY (V06)
 *
 * The system works out the numbers (the same ones as the Management,
 * Survey and Events reports, for the chosen date range and programme);
 * the AI only WRITES about them. What goes to the AI:
 *   - counts, rates, averages, NPS - and the organisation's programme names
 *   - survey question texts with their aggregated results
 * What never goes: names, e-mails, person numbers, matches, free-text
 * answers (participants are told that only HR sees their answers).
 * Known person names are masked once more before sending (scrub), and the
 * AI client blocks any e-mail address (assertClean).
 *
 * The organisation's last summary is kept (ai_summaries, db/migrate.js),
 * so opening the page costs nothing; HR regenerates it on purpose.
 */
const { db, slugify } = require("../db");
const reports = require("./reports");
const { mentors, mentees, mentorships } = require("../db/repos");
const { scrub } = require("../ai/privacy");

const TXT = {
  tr: {
    sMgmt: "Yönetim göstergeleri", sProgs: "Programlar", sRisk: "Ek risk göstergeleri", sSurvey: "Anket göstergeleri",
    sCi: "Ara dönem anketi - soru bazında", sCsMentee: "Kapanış anketi - mentee cevapları", sCsMentor: "Kapanış anketi - mentor cevapları",
    sEvents: "Etkinlik göstergeleri",
    noMeeting30: "Son 30 günde toplantısı olmayan aktif eşleşme", fullMentors: "Kapasitesi dolu aktif mentor",
    range: "Tarih aralığı", programme: "Program"
  },
  en: {
    sMgmt: "Management figures", sProgs: "Programmes", sRisk: "Additional risk figures", sSurvey: "Survey figures",
    sCi: "Mid-term survey - by question", sCsMentee: "Closing survey - mentee answers", sCsMentor: "Closing survey - mentor answers",
    sEvents: "Event figures",
    noMeeting30: "Active matches without a meeting in the last 30 days", fullMentors: "Active mentors at full capacity",
    range: "Date range", programme: "Programme"
  }
};

/** The figures for the AI, as sections. Nothing personal. */
function buildInput(companyId, query) {
  const lang = query.lang === "en" ? "en" : "tr";
  const X = TXT[lang];
  const q = { ...query, lang };
  const m = reports.management(companyId, q);
  const s = reports.surveyResults(companyId, q);
  const e = reports.eventsReport(companyId, q);
  const tb = (rep, key) => (rep.tables || []).find(t => t.key === key);

  const sections = [
    { title: X.sMgmt, items: m.summary.map(x => ({ label: x.label, value: x.value })) }
  ];
  const progs = tb(m, "programs");
  if (progs && progs.rows.length) sections.push({ title: X.sProgs, table: { columns: progs.columns, rows: progs.rows } });

  // Extra risk figures (current state, in the chosen programme).
  const f = reports.filters(q);
  const cid = slugify(companyId);
  const inProg = ms => !f.programId || (f.programId === "none" ? !ms.programId : ms.programId === f.programId);
  const active = mentorships.listByCompany(cid).filter(ms => ms.status === "active" && inProg(ms));
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const recent = new Set(db.prepare(`SELECT DISTINCT mentorship_id FROM meetings WHERE meeting_date >= ?`).all(since).map(r => r.mentorship_id));
  const progMentors = mentors.listByCompany(cid).filter(x => x.status === "active" &&
    (!f.programId || (f.programId === "none" ? !(x.programIds || []).length : (x.programIds || []).includes(f.programId))));
  sections.push({ title: X.sRisk, items: [
    { label: X.noMeeting30, value: active.filter(ms => !recent.has(ms.id)).length },
    { label: X.fullMentors, value: progMentors.filter(x => (Number(x.capacity) || 0) > 0 && (x.activeMenteeCount || 0) >= Number(x.capacity)).length }
  ] });

  sections.push({ title: X.sSurvey, items: s.summary.map(x => ({ label: x.label, value: x.value })) });
  for (const [key, title] of [["ci_sum", X.sCi], ["cs_mentee", X.sCsMentee], ["cs_mentor", X.sCsMentor]]) {
    const t = tb(s, key);
    if (t && t.rows.length) sections.push({ title, table: { columns: t.columns, rows: t.rows } });
  }
  sections.push({ title: X.sEvents, items: e.summary.map(x => ({ label: x.label, value: x.value })) });

  return { lang, subtitle: m.subtitle, sections };
}

/** Sections -> the text the AI reads; known names masked once more. */
function toText(companyId, input) {
  const lines = [input.subtitle, ""];
  for (const sec of input.sections) {
    lines.push(`## ${sec.title}`);
    if (sec.items) for (const it of sec.items) lines.push(`- ${it.label}: ${it.value}`);
    if (sec.table) {
      lines.push(sec.table.columns.join(" | "));
      for (const r of sec.table.rows) lines.push(r.join(" | "));
    }
    lines.push("");
  }
  const cid = slugify(companyId);
  const names = [
    ...mentors.listByCompany(cid).map(x => x.fullName),
    ...mentees.listByCompany(cid).map(x => x.fullName)
  ].filter(Boolean);
  return scrub(lines.join("\n"), names);
}

const SYSTEM = {
  tr: "Sen bir İK analitiği uzmanısın. Bir kurumsal mentorluk programı için üst yönetime kısa bir yönetici özeti yazıyorsun. " +
      "YALNIZCA sana verilen sayıları kullan; hiçbir sayı uydurma, tahmin etme. Veri yetersizse bunu açıkça söyle. " +
      "Kişilerden söz etme. Açık, somut ve iş dünyası dilinde Türkçe yaz. Cümleler kısa olsun. " +
      "Riskleri ve önerilen aksiyonları sayılara dayandır.",
  en: "You are an HR analytics expert writing a short executive summary of a corporate mentoring programme for senior management. " +
      "Use ONLY the figures you are given; never invent or estimate a number. If the data is not enough, say so plainly. " +
      "Do not mention individuals. Write clear, concrete business English with short sentences. " +
      "Base the risks and the recommended actions on the figures."
};

const SCHEMA = {
  type: "object",
  properties: {
    overview: { type: "string", description: "3-4 sentences: the overall state of the programme." },
    highlights: { type: "array", items: { type: "string" }, description: "3-6 key figures, each with its number." },
    strengths: { type: "array", items: { type: "string" }, description: "1-5 strengths." },
    risks: { type: "array", items: { type: "string" }, description: "1-6 risks or points that need attention." },
    programmes: { type: "array", items: { type: "object", properties: {
      programme: { type: "string" }, assessment: { type: "string", description: "1-2 sentences." } },
      required: ["programme", "assessment"] }, description: "One entry per programme in the data (empty if there are none)." },
    actions: { type: "array", items: { type: "object", properties: {
      priority: { type: "string", enum: ["high", "medium", "low"] }, action: { type: "string" } },
      required: ["priority", "action"] }, description: "3-5 concrete recommended actions, most important first." }
  },
  required: ["overview", "highlights", "strengths", "risks", "programmes", "actions"]
};

const running = new Set();      // one generation per organisation at a time

async function generate(companyId, query) {
  const cid = slugify(companyId);
  if (running.has(cid)) {
    const err = new Error("A summary is already being generated for this organisation.");
    err.code = "summary_running";
    throw err;
  }
  running.add(cid);
  try {
    const input = buildInput(cid, query);
    const prompt = (input.lang === "en"
      ? "Write the executive summary from these figures of the mentoring programme.\n\n"
      : "Mentorluk programının aşağıdaki göstergelerinden yönetici özetini yaz.\n\n") + toText(cid, input);
    const { generateStructured } = require("../ai/client");
    const out = await generateStructured({
      system: SYSTEM[input.lang], prompt, toolName: "executive_summary", schema: SCHEMA, maxTokens: 3000
    });
    const clean = v => String(v ?? "").trim();
    const summary = {
      overview: clean(out.overview),
      highlights: (out.highlights || []).map(clean).filter(Boolean).slice(0, 8),
      strengths: (out.strengths || []).map(clean).filter(Boolean).slice(0, 8),
      risks: (out.risks || []).map(clean).filter(Boolean).slice(0, 8),
      programmes: (out.programmes || []).map(p => ({ programme: clean(p.programme), assessment: clean(p.assessment) }))
        .filter(p => p.programme || p.assessment).slice(0, 20),
      actions: (out.actions || []).map(a => ({ priority: ["high", "medium", "low"].includes(a.priority) ? a.priority : "medium", action: clean(a.action) }))
        .filter(a => a.action).slice(0, 8)
    };
    const record = {
      lang: input.lang,
      filters: { from: query.from || "", to: query.to || "", programId: query.programId || "" },
      subtitle: input.subtitle,
      input: input.sections,
      summary,
      createdAt: new Date().toISOString()
    };
    db.prepare(`
      INSERT INTO ai_summaries (company_id, record, created_at) VALUES (?, ?, ?)
      ON CONFLICT(company_id) DO UPDATE SET record = excluded.record, created_at = excluded.created_at
    `).run(cid, JSON.stringify(record), record.createdAt);
    return record;
  } finally {
    running.delete(cid);
  }
}

function last(companyId) {
  const row = db.prepare(`SELECT record FROM ai_summaries WHERE company_id = ?`).get(slugify(companyId));
  try { return row ? JSON.parse(row.record) : null; } catch { return null; }
}

module.exports = { buildInput, toText, generate, last };
