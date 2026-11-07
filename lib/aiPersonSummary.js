/**
 * PERSON AI SUMMARY (V09) - inside the Person Report.
 *
 * A short, development-focused summary about ONE person, for HR. The
 * system gathers the facts; the AI only writes about them. What goes to
 * the AI:
 *   - the person's role(s), job title, department, programme names
 *   - per match (numbered, no names): role in it, type, status, dates,
 *     meeting count / total time / days since the last meeting
 *   - survey status and the answers that are NOT free text (scores,
 *     yes/no, choices) - the person's own and the other side's
 *   - the development need (registration form) and the development plan
 *     goals of the workspace - names masked (scrub), as in matching
 * What never goes: names, e-mails, person numbers, free-text survey
 * answers, meeting notes. assertClean in the AI client blocks e-mails.
 *
 * The last summary per person is kept (ai_person_summaries); opening the
 * report costs nothing. It is SCREEN ONLY (derived from survey answers),
 * like the survey answers in the Person Report.
 */
const { db, slugify } = require("../db");
const reports = require("./reports");
const { mentors, mentees, mentorships, programs } = require("../db/repos");
const { flatQuestions } = require("./surveyQuestions");
const { scrub } = require("../ai/privacy");

const TXT = {
  tr: {
    person: "Kişi", roles: "Rolleri", mentor: "mentor", mentee: "mentee", jobTitle: "Unvan", dept: "Departman",
    status: "Kayıt durumu", progs: "Programları", none: "yok", devNeed: "Gelişim ihtiyacı (kayıt formu)",
    match: "Eşleşme", roleIn: "Kişinin bu eşleşmedeki rolü", type: "Tür", individual: "bireysel",
    group: "grup ({n} üye)", programme: "Program", msStatus: "Durum", started: "Başlangıç", closing: "Kapanış",
    daysToClose: "Kapanışa kalan gün", meetings: "Toplantı sayısı (tarih aralığında)", minutes: "Toplam toplantı süresi (dakika)",
    lastMeeting: "Son toplantı", daysSince: "Son toplantıdan bu yana geçen gün", perMonth: "Aylık ortalama toplantı",
    goals: "Gelişim planı - hedefler", areas: "Gelişim planı - gelişim alanları", criteria: "Gelişim planı - başarı kriterleri",
    surveys: "Anketler", own: "kişinin kendi cevabı", other: "eşleştiği kişinin cevabı", checkin: "Ara Dönem Anketi",
    closingS: "Kapanış Anketi", sent: "gönderim", answered: "yanıt", waiting: "yanıt bekleniyor", range: "Tarih aralığı",
    noMatches: "Kişinin bu tarih aralığında eşleşmesi yok."
  },
  en: {
    person: "Person", roles: "Roles", mentor: "mentor", mentee: "mentee", jobTitle: "Job title", dept: "Department",
    status: "Record status", progs: "Programmes", none: "none", devNeed: "Development need (registration form)",
    match: "Match", roleIn: "The person's role in this match", type: "Type", individual: "one-to-one",
    group: "group ({n} members)", programme: "Programme", msStatus: "Status", started: "Started", closing: "Closing",
    daysToClose: "Days to closing", meetings: "Meetings (in the date range)", minutes: "Total meeting time (minutes)",
    lastMeeting: "Last meeting", daysSince: "Days since the last meeting", perMonth: "Average meetings per month",
    goals: "Development plan - goals", areas: "Development plan - development areas", criteria: "Development plan - success criteria",
    surveys: "Surveys", own: "the person's own answer", other: "the other side's answer", checkin: "Mid-Term Survey",
    closingS: "Closing Survey", sent: "sent", answered: "answered", waiting: "waiting for an answer", range: "Date range",
    noMatches: "The person has no match in this date range."
  }
};

const parse = (txt, fb) => { try { return txt ? JSON.parse(txt) : fb; } catch { return fb; } };
const day = v => String(v || "").slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
const list = v => (Array.isArray(v) ? v : parse(v, [])).map(x => String(x || "").trim()).filter(Boolean);

/** Non-free-text answers of one survey row, as "question: answer" lines. */
function answerLines(row, lang, qsOverride) {
  const answers = parse(row.answers, null);
  if (!answers) return [];
  const qs = qsOverride || parse(row.questions, []);
  const lines = [];
  for (const q of qs) {
    if (!q || q.type === "text") continue;               // free text never goes to the AI
    const v = answers[q.id];
    if (v === undefined || v === null || String(v).trim() === "") continue;
    const label = q.q || (lang === "en" ? (q.en || q.tr) : (q.tr || q.en)) || q.id;
    lines.push(`${label}: ${reports.answerText(q, v, lang)}`);
  }
  return lines;
}

/** Everything about the person for the AI - no names, e-mails, numbers. Null if no such person. */
function buildInput(companyId, query) {
  const cid = slugify(companyId);
  const f = reports.filters({ ...query, programId: "" });
  const lang = f.lang, X = TXT[lang];
  const sicil = String([].concat(query.sicil || "")[0] || "").trim();     // one value even if sent twice
  const myMentors = sicil ? mentors.listByCompany(cid).filter(m => m.sicilNo === sicil) : [];
  const myMentees = sicil ? mentees.listByCompany(cid).filter(m => m.sicilNo === sicil) : [];
  if (!myMentors.length && !myMentees.length) return null;
  const mentorIds = new Set(myMentors.map(m => m.id)), menteeIds = new Set(myMentees.map(m => m.id));
  const progName = new Map(programs.listByCompany(cid).map(p => [p.id, p.name]));
  const pn = id => progName.get(id) || "";
  const me = myMentees[0] || myMentors[0];
  const today = new Date().toISOString().slice(0, 10);

  const lines = [`${X.range}: ${f.from || "…"} – ${f.to || "…"}`, "", `## ${X.person}`];
  lines.push(`- ${X.roles}: ${[myMentors.length ? X.mentor : "", myMentees.length ? X.mentee : ""].filter(Boolean).join(", ")}`);
  lines.push(`- ${X.jobTitle}: ${me.role || X.none}`);
  if (myMentees[0]) lines.push(`- ${X.dept}: ${myMentees[0].department || X.none}`);
  lines.push(`- ${X.status}: ${me.status}`);
  const progs = new Set([...myMentors, ...myMentees].flatMap(p => p.programIds || []));
  lines.push(`- ${X.progs}: ${[...progs].map(pn).filter(Boolean).join(", ") || X.none}`);
  if (myMentees[0] && myMentees[0].developmentNeeds) lines.push(`- ${X.devNeed}: ${myMentees[0].developmentNeeds}`);

  const endOf = ms => (ms.status === "active" ? today : day(ms.closingDate) || day(ms.updatedAt));
  const asMentor = ms => mentorIds.has(ms.mentorId);
  const asMentee = ms => menteeIds.has(ms.menteeId) || (ms.members || []).some(x => menteeIds.has(x.id));
  const ms = mentorships.listByCompany(cid)
    .filter(m => (asMentor(m) || asMentee(m)) && (!f.to || day(m.createdAt) <= f.to) && (!f.from || endOf(m) >= f.from))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  if (!ms.length) lines.push("", X.noMatches);

  const inRange = d => (!f.from || day(d) >= f.from) && (!f.to || day(d) <= f.to);
  ms.forEach((m, i) => {
    const meets = db.prepare(`SELECT meeting_date AS d, duration_minutes AS min FROM meetings WHERE mentorship_id = ? ORDER BY meeting_date`)
      .all(m.id).filter(r => inRange(r.d));
    const last = meets.length ? day(meets[meets.length - 1].d) : "";
    const months = Math.max(1, daysBetween(day(m.createdAt), m.status === "active" ? today : endOf(m)) / 30);
    lines.push("", `## ${X.match} ${i + 1}`);
    lines.push(`- ${X.roleIn}: ${asMentor(m) ? X.mentor : X.mentee}`);
    lines.push(`- ${X.type}: ${m.groupId ? X.group.replace("{n}", (m.members || []).length) : X.individual}`);
    lines.push(`- ${X.programme}: ${pn(m.programId) || X.none}`);
    lines.push(`- ${X.msStatus}: ${m.status}`);
    lines.push(`- ${X.started}: ${day(m.createdAt)}`);
    if (m.closingDate) {
      lines.push(`- ${X.closing}: ${day(m.closingDate)}`);
      if (m.status === "active") lines.push(`- ${X.daysToClose}: ${daysBetween(today, day(m.closingDate))}`);
    }
    lines.push(`- ${X.meetings}: ${meets.length}`);
    lines.push(`- ${X.minutes}: ${meets.reduce((a, r) => a + (Number(r.min) || 0), 0)}`);
    lines.push(`- ${X.perMonth}: ${(meets.length / months).toFixed(1)}`);
    if (last) {
      lines.push(`- ${X.lastMeeting}: ${last}`);
      if (m.status === "active") lines.push(`- ${X.daysSince}: ${daysBetween(last, today)}`);
    }
    const goals = list(m.goals), areas = list(m.developmentAreas), crit = list(m.successCriteria);
    if (goals.length) lines.push(`- ${X.goals}: ${goals.join("; ")}`);
    if (areas.length) lines.push(`- ${X.areas}: ${areas.join("; ")}`);
    if (crit.length) lines.push(`- ${X.criteria}: ${crit.join("; ")}`);

    // Surveys of this match: the person's own, then the other side's.
    const isMine = r => r.role === "mentor" ? asMentor(m) : (r.member_id ? menteeIds.has(r.member_id) : menteeIds.has(m.menteeId));
    const isOther = r => !isMine(r) && (asMentor(m) ? r.role === "mentee" : r.role === "mentor");
    const rows = [
      ...db.prepare(`SELECT * FROM checkins WHERE mentorship_id = ? ORDER BY sent_at`).all(m.id).map(r => ({ ...r, kind: "checkin" })),
      ...db.prepare(`SELECT * FROM surveys WHERE mentorship_id = ? ORDER BY sent_at`).all(m.id).map(r => ({ ...r, kind: "closing" }))
    ].filter(r => inRange(r.sent_at) && (isMine(r) || isOther(r)));
    if (rows.length) lines.push(`- ${X.surveys}:`);
    let otherNo = 0;
    for (const r of rows) {
      const who = isMine(r) ? X.own : `${X.other}${m.groupId && !asMentee(m) ? ` ${++otherNo}` : ""}`;
      const head = `${r.kind === "checkin" ? X.checkin : X.closingS} (${who}; ${X.sent} ${day(r.sent_at)}` +
                   `${r.status === "completed" ? `; ${X.answered} ${day(r.completed_at)}` : `; ${X.waiting}`})`;
      lines.push(`  - ${head}`);
      if (r.status === "completed") {
        const qs = r.kind === "closing" ? flatQuestions(r.role, lang) : null;
        for (const a of answerLines(r, lang, qs)) lines.push(`    - ${a}`);
      }
    }
  });

  // Mask every known person name once more (free texts: need, plan).
  const names = [...mentors.listByCompany(cid), ...mentees.listByCompany(cid)].map(x => x.fullName).filter(Boolean);
  return { lang, sicil, name: me.fullName || "", text: scrub(lines.join("\n"), names) };
}

const SYSTEM = {
  tr: "Sen bir İK uzmanısın. Bir kurumsal mentorluk programındaki TEK bir katılımcı için İK'ya kısa, gelişim odaklı bir özet yazıyorsun. " +
      "YALNIZCA verilen bilgileri kullan; bilgi uydurma, tahmin etme. Veri yoksa ya da yetersizse bunu açıkça söyle. " +
      "Kişiyi yargılama ve performans notu verme; amaç süreci desteklemek. Kişinin adını bilmiyorsun, 'katılımcı' de. " +
      "Kısa ve somut Türkçe cümleler kur.",
  en: "You are an HR professional writing a short, development-focused summary for HR about ONE participant of a corporate mentoring programme. " +
      "Use ONLY the information given; do not invent or guess. If data is missing or thin, say so plainly. " +
      "Do not judge the person or rate their performance; the aim is to support the process. You do not know their name: say 'the participant'. " +
      "Write short, concrete English sentences."
};

const SCHEMA = {
  type: "object",
  properties: {
    overview: { type: "string", description: "2-3 sentences: role(s), programmes and matches of the participant." },
    engagement: { type: "string", description: "Meetings: how many, how often, how long, since when none - 2-3 sentences." },
    surveys: { type: "string", description: "What the scores and choices of the participant and of the other side show - 2-3 sentences; say if there are none." },
    attention: { type: "array", items: { type: "string" }, description: "0-5 points that need attention, each based on the data." },
    actions: { type: "array", items: { type: "string" }, description: "2-4 supportive next steps for HR." }
  },
  required: ["overview", "engagement", "surveys", "attention", "actions"]
};

const running = new Set();

async function generate(companyId, query) {
  const cid = slugify(companyId);
  const input = buildInput(cid, query);
  if (!input) return null;
  const key = `${cid}:${input.sicil}`;
  if (running.has(key)) {
    const err = new Error("A summary is already being generated for this person.");
    err.code = "summary_running";
    throw err;
  }
  running.add(key);
  try {
    const { generateStructured } = require("../ai/client");
    const out = await generateStructured({
      system: SYSTEM[input.lang],
      prompt: (input.lang === "en" ? "Write the summary about this participant.\n\n" : "Bu katılımcı hakkında özeti yaz.\n\n") + input.text,
      toolName: "person_summary", schema: SCHEMA, maxTokens: 2000
    });
    const clean = v => String(v ?? "").trim();
    const record = {
      sicil: input.sicil,
      lang: input.lang,
      filters: { from: query.from || "", to: query.to || "" },
      input: input.text,
      summary: {
        overview: clean(out.overview), engagement: clean(out.engagement), surveys: clean(out.surveys),
        attention: (out.attention || []).map(clean).filter(Boolean).slice(0, 6),
        actions: (out.actions || []).map(clean).filter(Boolean).slice(0, 6)
      },
      createdAt: new Date().toISOString()
    };
    db.prepare(`
      INSERT INTO ai_person_summaries (company_id, sicil_no, record, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(company_id, sicil_no) DO UPDATE SET record = excluded.record, created_at = excluded.created_at
    `).run(cid, input.sicil, JSON.stringify(record), record.createdAt);
    return record;
  } finally {
    running.delete(key);
  }
}

function last(companyId, sicil) {
  const row = db.prepare(`SELECT record FROM ai_person_summaries WHERE company_id = ? AND sicil_no = ?`)
    .get(slugify(companyId), String([].concat(sicil || "")[0] || ""));
  try { return row ? JSON.parse(row.record) : null; } catch { return null; }
}

/**
 * Deleting a person (KVKK): their AI summary goes too - unless the same
 * person number is still in use (e.g. the mentor record of a deleted mentee).
 */
function forget(companyId, sicil) {
  const cid = slugify(companyId), no = String(sicil || "");
  if (!no) return;
  const inUse = db.prepare(`SELECT 1 FROM mentors WHERE company_id = ? AND sicil_no = ?
                            UNION SELECT 1 FROM mentees WHERE company_id = ? AND sicil_no = ?`).get(cid, no, cid, no);
  if (!inUse) db.prepare(`DELETE FROM ai_person_summaries WHERE company_id = ? AND sicil_no = ?`).run(cid, no);
}

module.exports = { buildInput, generate, last, forget };
