const { db, slugify } = require("../db");
const { mentors, mentees, mentorships, menteeGroups, programs, checkins } = require("../db/repos");
const { flatQuestions } = require("./surveyQuestions");
const { scrub } = require("../ai/privacy");

/**
 * ====================================================================
 * REPORTS  (HR page "Reports")
 * ====================================================================
 *
 * Every report comes back in ONE shape that the page turns into the
 * screen view, the PDF and the Excel file - so the three never differ:
 *
 *   { title, subtitle, notes: [text], summary: [{ label, value }],
 *     tables: [{ key, title, sheet, columns: [..], rows: [[..]] }] }
 *
 * Filters (all optional):
 *   from / to   YYYY-MM-DD. Management: matches active at any time in
 *               the range and meetings held in it (head counts are the
 *               current state). Surveys / check-ins: those SENT in it.
 *   programId   a programme id, "none" (no programme) or "" (all)
 *
 * NAMES IN SURVEY ANSWERS (decision 1b): participants are told that only
 * HR sees their answers. HR sees named answers ON SCREEN; tables marked
 * `screenOnly` carry `exportColumns` / `exportRows` instead for the PDF and
 * the Excel file: people become "Participant 1, 2 ...", the match is left
 * out, and known names inside free text are masked. The page builds its
 * files only from those - a named row never leaves the screen.
 *
 * Only the signed-in organisation's own data is read (every query is
 * scoped by company_id). Meeting CONTENT never appears - only dates and
 * durations. Nothing here goes to the AI.
 */

const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !isNaN(Date.parse(s + "T00:00:00Z"));
const day = d => String(d || "").slice(0, 10);
const todayStr = () => new Date().toISOString().slice(0, 10);

function filters(q) {
  const from = validDate(q.from) ? q.from : "";
  let to = validDate(q.to) ? q.to : "";
  if (from && to && to < from) to = from;
  return { from, to, programId: String(q.programId || ""), lang: q.lang === "en" ? "en" : "tr" };
}
const inRange = (d, f) => {
  const x = day(d);
  if (!x) return !f.from && !f.to;
  return (!f.from || x >= f.from) && (!f.to || x <= f.to);
};

// ---------------------------------------------------------------------
// Texts
// ---------------------------------------------------------------------
const T = {
  tr: {
    all: "Tüm zamanlar", rangeLbl: "Tarih aralığı", programLbl: "Program", allPrograms: "Tüm programlar", noProgram: "Programsız",
    none: "—", yes: "Evet", no: "Hayır", active: "Aktif", inactive: "Pasif", completed: "Tamamlandı", cancelled: "İptal",
    paused: "Beklemede", oneToOne: "Bireysel", group: "Grup", mentor: "Mentor", mentee: "Mentee", deleted: "(silinmiş mentee)",
    people: "kişi",
    mTitle: "Yönetim Raporu",
    mNote: "Mentor ve mentee sayıları bugünkü durumu gösterir. Eşleşmeler ve toplantılar seçilen tarih aralığına göre hesaplanır. Toplantıların yalnızca tarihi ve süresi yer alır; içerikleri yer almaz.",
    mentorsTotal: "Mentor", mentorsActive: "Aktif mentor", mentorsInactive: "Pasif mentor", menteesTotal: "Mentee",
    menteesMatched: "Eşleşmiş mentee (aktif)", menteesUnmatched: "Eşleşmemiş mentee", groups: "Mentee grubu",
    matches: "Eşleşme", matchesActive: "Aktif eşleşme", matchesCompleted: "Tamamlanan eşleşme", groupMatches: "Grup eşleşmesi",
    meetings: "Toplantı", meetingTime: "Toplam toplantı süresi", meetingAvg: "Ortalama toplantı süresi",
    noDuration: "Süresi girilmemiş toplantı", capacityTotal: "Toplam mentor kapasitesi", capacityUsed: "Kullanılan kapasite",
    tMentors: "Mentorlar", tMatches: "Eşleşmeler", tGroups: "Grup üyeleri", tMeetings: "Toplantılar",
    cName: "Ad Soyad", cRole: "Unvan", cStatus: "Durum", cPrograms: "Program", cCapacity: "Kapasite", cActiveMentees: "Aktif eşleşme",
    cTotalMatches: "Eşleşme (aralıkta)", cMeetings: "Toplantı", cTotalTime: "Toplam süre", cMentor: "Mentor",
    cMentee: "Mentee / Grup", cType: "Tür", cStart: "Başlangıç", cEnd: "Bitiş", cFirst: "İlk toplantı", cLast: "Son toplantı",
    cGroup: "Grup", cDept: "Departman", cDate: "Tarih", cMinutes: "Süre (dk)",
    cSupport: "Destek istiyor",
    sTitle: "Anket Sonuçları",
    sNote: "Seçilen tarih aralığında gönderilen ara geri bildirimler ve kapanış anketleri. Ekranda isimli cevaplar da görünür; PDF ve Excel dosyalarında kişiler \"Katılımcı 1, 2…\" olarak yer alır, eşleşme bilgisi çıkarılır ve metinlerdeki bilinen isimler maskelenir.",
    ciSent: "Gönderilen ara geri bildirim", ciAnswered: "Yanıtlanan ara geri bildirim", ciRate: "Ara geri bildirim yanıt oranı",
    ciSupport: "Destek isteyen cevap", ciSupportPeople: "Destek isteyen kişi (son cevabına göre)",
    csSent: "Gönderilen kapanış anketi", csAnswered: "Yanıtlanan kapanış anketi", csRate: "Kapanış anketi yanıt oranı",
    nps: "NPS (tavsiye skoru)",
    tCiSum: "Ara geri bildirim — soru bazında", tCsSumMentee: "Kapanış anketi — mentee cevapları", tCsSumMentor: "Kapanış anketi — mentor cevapları",
    tComments: "Açık uçlu cevaplar (isimsiz)", tSupport: "Destek isteyenler", tCiDetail: "Ara geri bildirim — kişi bazında",
    tCsDetail: "Kapanış anketi — kişi bazında",
    shCiSum: "Ara GB özet", shCsMentee: "Kapanış mentee", shCsMentor: "Kapanış mentor", shComments: "Açık uçlu",
    shSupport: "Destek isteyenler", shCiDetail: "Ara GB cevaplar", shCsDetail: "Kapanış cevaplar",
    cQuestion: "Soru", cAnswers: "Yanıt sayısı", cResult: "Sonuç", cWho: "Kim", cAnswer: "Cevap", cPair: "Eşleşme",
    cPerson: "Yanıtlayan", cParticipant: "Katılımcı", cSource: "Kaynak", cSent: "Gönderim", cAnswered: "Yanıt",
    avg: "ortalama", comments: "yorum", participant: "Katılımcı", checkin: "Ara geri bildirim", closing: "Kapanış anketi"
  },
  en: {
    all: "All time", rangeLbl: "Date range", programLbl: "Programme", allPrograms: "All programmes", noProgram: "No programme",
    none: "—", yes: "Yes", no: "No", active: "Active", inactive: "Inactive", completed: "Completed", cancelled: "Cancelled",
    paused: "Paused", oneToOne: "One-to-one", group: "Group", mentor: "Mentor", mentee: "Mentee", deleted: "(deleted mentee)",
    people: "people",
    mTitle: "Management Report",
    mNote: "Mentor and mentee counts show the current state. Matches and meetings follow the selected date range. Meetings appear with their date and length only - never their content.",
    mentorsTotal: "Mentors", mentorsActive: "Active mentors", mentorsInactive: "Inactive mentors", menteesTotal: "Mentees",
    menteesMatched: "Matched mentees (active)", menteesUnmatched: "Unmatched mentees", groups: "Mentee groups",
    matches: "Matches", matchesActive: "Active matches", matchesCompleted: "Completed matches", groupMatches: "Group matches",
    meetings: "Meetings", meetingTime: "Total meeting time", meetingAvg: "Average meeting length",
    noDuration: "Meetings without a length", capacityTotal: "Total mentor capacity", capacityUsed: "Capacity in use",
    tMentors: "Mentors", tMatches: "Matches", tGroups: "Group members", tMeetings: "Meetings",
    cName: "Name", cRole: "Title", cStatus: "Status", cPrograms: "Programme", cCapacity: "Capacity", cActiveMentees: "Active matches",
    cTotalMatches: "Matches (in range)", cMeetings: "Meetings", cTotalTime: "Total time", cMentor: "Mentor",
    cMentee: "Mentee / Group", cType: "Type", cStart: "Start", cEnd: "End", cFirst: "First meeting", cLast: "Last meeting",
    cGroup: "Group", cDept: "Department", cDate: "Date", cMinutes: "Length (min)",
    cSupport: "Needs support",
    sTitle: "Survey Results",
    sNote: "Mid-programme feedback and closing surveys sent in the selected date range. Named answers are shown on screen; in the PDF and Excel files people appear as \"Participant 1, 2 ...\", the match is left out and known names inside texts are masked.",
    ciSent: "Feedback rounds sent", ciAnswered: "Feedback rounds answered", ciRate: "Feedback response rate",
    ciSupport: "Answers asking for support", ciSupportPeople: "People asking for support (latest answer)",
    csSent: "Closing surveys sent", csAnswered: "Closing surveys answered", csRate: "Closing survey response rate",
    nps: "NPS (net promoter score)",
    tCiSum: "Mid-programme feedback — by question", tCsSumMentee: "Closing survey — mentee answers", tCsSumMentor: "Closing survey — mentor answers",
    tComments: "Open answers (anonymous)", tSupport: "Asking for support", tCiDetail: "Mid-programme feedback — person by person",
    tCsDetail: "Closing survey — person by person",
    shCiSum: "Feedback summary", shCsMentee: "Closing mentee", shCsMentor: "Closing mentor", shComments: "Open answers",
    shSupport: "Asking for support", shCiDetail: "Feedback answers", shCsDetail: "Closing answers",
    cQuestion: "Question", cAnswers: "Answers", cResult: "Result", cWho: "Who", cAnswer: "Answer", cPair: "Match",
    cPerson: "Respondent", cParticipant: "Participant", cSource: "Source", cSent: "Sent", cAnswered: "Answered",
    avg: "average", comments: "comments", participant: "Participant", checkin: "Mid-programme feedback", closing: "Closing survey"
  }
};

const fmtMin = (m, lang) => {
  if (m == null) return T[lang].none;
  const h = Math.floor(m / 60), r = m % 60;
  const [H, M] = lang === "en" ? ["h", "min"] : ["sa", "dk"];
  return h ? `${h} ${H}${r ? ` ${r} ${M}` : ""}` : `${r} ${M}`;
};
const fmtDate = (d, lang) => {
  const x = day(d);
  if (!validDate(x)) return "";
  const [y, m, dd] = x.split("-");
  return lang === "en" ? `${dd}/${m}/${y}` : `${dd}.${m}.${y}`;
};
const dec = (n, lang) => (lang === "en" ? n.toFixed(1) : n.toFixed(1).replace(".", ","));
const pct = (a, b, lang) => (!b ? "—" : lang === "en" ? `${Math.round((a / b) * 100)}%` : `%${Math.round((a / b) * 100)}`);

// ---------------------------------------------------------------------
// Scope: the organisation's records, narrowed to a programme
// ---------------------------------------------------------------------

function scope(companyId, f) {
  const cid = slugify(companyId);
  const progList = programs.listByCompany(cid);
  const progName = id => (progList.find(p => p.id === id) || {}).name || "";
  const matchProgram = id => !f.programId || (f.programId === "none" ? !id : id === f.programId);

  const allMentors = mentors.listByCompany(cid);
  return {
    cid,
    progName,
    programLabel: !f.programId ? T[f.lang].allPrograms : f.programId === "none" ? T[f.lang].noProgram : progName(f.programId),
    mentors: allMentors.filter(m => !f.programId || (f.programId === "none" ? !(m.programIds || []).length : (m.programIds || []).includes(f.programId))),
    mentees: mentees.listByCompany(cid).filter(m => matchProgram(m.programId || "")),
    groups: menteeGroups.listByCompany(cid).filter(g => matchProgram(g.programId || "")),
    mentorships: mentorships.listByCompany(cid).filter(ms => matchProgram(ms.programId || ""))
  };
}

function subtitle(f, s) {
  const L = T[f.lang];
  const range = f.from || f.to ? `${f.from ? fmtDate(f.from, f.lang) : "…"} – ${f.to ? fmtDate(f.to, f.lang) : "…"}` : L.all;
  return `${L.rangeLbl}: ${range} · ${L.programLbl}: ${s.programLabel}`;
}

function menteeLabel(ms, L) {
  if (ms.groupId) return `${ms.groupName || ms.menteeName} (${(ms.members || []).length} ${L.people})`;
  return ms.menteeDeleted ? L.deleted : ms.menteeName || "";
}

// ---------------------------------------------------------------------
// 1. MANAGEMENT REPORT
// ---------------------------------------------------------------------

function management(companyId, query) {
  const f = filters(query), L = T[f.lang], s = scope(companyId, f);
  const today = todayStr();

  // Active at any time in the range: started on/before "to", and still
  // active or ended on/after "from".
  const endOf = ms => (ms.status === "active" ? today : day(ms.closingDate) || day(ms.updatedAt));
  const ms = s.mentorships.filter(m => (!f.to || day(m.createdAt) <= f.to) && (!f.from || endOf(m) >= f.from));

  const meetRows = db.prepare(`
    SELECT mt.mentorship_id AS msId, mt.meeting_date AS date, mt.duration_minutes AS minutes
      FROM meetings mt JOIN mentorships m ON m.id = mt.mentorship_id
     WHERE m.company_id = ? ORDER BY mt.meeting_date
  `).all(s.cid);
  const msIds = new Set(s.mentorships.map(m => m.id));
  const meetings = meetRows.filter(r => msIds.has(r.msId) && inRange(r.date, f));
  const byMs = new Map();
  for (const r of meetings) {
    if (!byMs.has(r.msId)) byMs.set(r.msId, []);
    byMs.get(r.msId).push(r);
  }
  const timed = meetings.filter(r => r.minutes != null);
  const totalMinutes = timed.reduce((a, r) => a + Number(r.minutes), 0);

  const activeMentors = s.mentors.filter(m => m.status === "active");
  const activeMs = s.mentorships.filter(m => m.status === "active");
  const matchedMentees = new Set();
  for (const m of activeMs) {
    if (m.groupId) (m.members || []).forEach(x => matchedMentees.add(x.id));
    else matchedMentees.add(m.menteeId);
  }
  const menteeIds = new Set(s.mentees.map(m => m.id));
  const matchedHere = [...matchedMentees].filter(id => menteeIds.has(id)).length;

  const mentorRows = s.mentors.map(m => {
    const mine = ms.filter(x => x.mentorId === m.id);
    const mm = meetings.filter(r => mine.some(x => x.id === r.msId));
    const mins = mm.filter(r => r.minutes != null).reduce((a, r) => a + Number(r.minutes), 0);
    return [m.fullName, m.role || "", L[m.status] || m.status, (m.programIds || []).map(s.progName).filter(Boolean).join(", "),
            Number(m.capacity) || 0, s.mentorships.filter(x => x.mentorId === m.id && x.status === "active").length,
            mine.length, mm.length, mm.length ? fmtMin(mins, f.lang) : L.none];
  });

  const matchRows = ms.map(m => {
    const mm = byMs.get(m.id) || [];
    const mins = mm.filter(r => r.minutes != null).reduce((a, r) => a + Number(r.minutes), 0);
    return [m.mentorName || "", menteeLabel(m, L), m.groupId ? L.group : L.oneToOne, s.progName(m.programId) || L.none,
            L[m.status] || m.status, fmtDate(m.createdAt, f.lang), fmtDate(m.closingDate, f.lang),
            mm.length, mm.length ? fmtMin(mins, f.lang) : L.none,
            mm.length ? fmtDate(mm[0].date, f.lang) : "", mm.length ? fmtDate(mm[mm.length - 1].date, f.lang) : "",
            // someone's LATEST answered check-in asks for HR support
            checkins.summary(m.id).needsSupport ? L.yes : ""];
  });

  const groupRows = [];
  for (const g of s.groups) {
    const active = s.mentorships.find(m => m.groupId === g.id && m.status === "active");
    for (const mem of g.members) {
      groupRows.push([g.name, s.progName(g.programId) || L.none, active ? active.mentorName : L.none,
                      mem.fullName, mem.role || "", mem.department || "", L[mem.status] || mem.status]);
    }
  }

  const msById = new Map(s.mentorships.map(m => [m.id, m]));
  const meetingRows = meetings.map(r => {
    const m = msById.get(r.msId);
    return [m.mentorName || "", menteeLabel(m, L), fmtDate(r.date, f.lang), r.minutes == null ? "" : Number(r.minutes)];
  });

  return {
    title: L.mTitle, subtitle: subtitle(f, s), notes: [L.mNote],
    summary: [
      { label: L.mentorsTotal, value: s.mentors.length },
      { label: L.mentorsActive, value: activeMentors.length },
      { label: L.mentorsInactive, value: s.mentors.length - activeMentors.length },
      { label: L.menteesTotal, value: s.mentees.length },
      { label: L.menteesMatched, value: matchedHere },
      { label: L.menteesUnmatched, value: Math.max(0, s.mentees.length - matchedHere) },
      { label: L.groups, value: s.groups.length },
      { label: L.matches, value: ms.length },
      { label: L.matchesActive, value: ms.filter(m => m.status === "active").length },
      { label: L.matchesCompleted, value: ms.filter(m => m.status === "completed").length },
      { label: L.groupMatches, value: ms.filter(m => m.groupId).length },
      { label: L.meetings, value: meetings.length },
      { label: L.meetingTime, value: timed.length ? fmtMin(totalMinutes, f.lang) : L.none },
      { label: L.meetingAvg, value: timed.length ? fmtMin(Math.round(totalMinutes / timed.length), f.lang) : L.none },
      { label: L.noDuration, value: meetings.length - timed.length },
      { label: L.capacityTotal, value: activeMentors.reduce((a, m) => a + (Number(m.capacity) || 0), 0) },
      { label: L.capacityUsed, value: activeMentors.reduce((a, m) => a + (Number(m.activeMenteeCount) || 0), 0) }
    ],
    tables: [
      { key: "mentors", title: L.tMentors, sheet: L.tMentors,
        columns: [L.cName, L.cRole, L.cStatus, L.cPrograms, L.cCapacity, L.cActiveMentees, L.cTotalMatches, L.cMeetings, L.cTotalTime],
        rows: mentorRows },
      { key: "matches", title: L.tMatches, sheet: L.tMatches,
        columns: [L.cMentor, L.cMentee, L.cType, L.cPrograms, L.cStatus, L.cStart, L.cEnd, L.cMeetings, L.cTotalTime, L.cFirst, L.cLast, L.cSupport],
        rows: matchRows },
      { key: "groups", title: L.tGroups, sheet: L.tGroups,
        columns: [L.cGroup, L.cPrograms, L.cMentor, L.cName, L.cRole, L.cDept, L.cStatus], rows: groupRows },
      { key: "meetings", title: L.tMeetings, sheet: L.tMeetings,
        columns: [L.cMentor, L.cMentee, L.cDate, L.cMinutes], rows: meetingRows }
    ]
  };
}

// ---------------------------------------------------------------------
// Answer aggregation (closing survey and check-ins)
// ---------------------------------------------------------------------

const YES = ["yes", "evet"], NO = ["no", "hayır", "hayir"];
const CHOICE_ORDER = [["yes", "evet"], ["maybe", "belki"], ["no", "hayır", "hayir"]];

/** One row: question, answer count, result text. */
function aggregate(q, values, lang) {
  const L = T[lang];
  const vals = values.filter(v => v !== undefined && v !== null && String(v).trim() !== "");
  if (q.type === "scale5" || q.type === "nps") {
    const nums = vals.map(Number).filter(n => Number.isFinite(n));
    if (!nums.length) return [vals.length, L.none];
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    if (q.type === "nps") {
      const pro = nums.filter(n => n >= 9).length, det = nums.filter(n => n <= 6).length;
      return [nums.length, `NPS ${Math.round(((pro - det) / nums.length) * 100)} · ${L.avg} ${dec(avg, lang)}/10`];
    }
    return [nums.length, `${dec(avg, lang)} / 5`];
  }
  if (q.type === "yesno") {
    const y = vals.filter(v => YES.includes(String(v).toLowerCase())).length;
    const n = vals.filter(v => NO.includes(String(v).toLowerCase())).length;
    return [vals.length, `${L.yes} ${y} · ${L.no} ${n}`];
  }
  if (q.type === "choice") {
    const labels = lang === "en" ? ["Yes", "Maybe", "No"] : ["Evet", "Belki", "Hayır"];
    const counts = CHOICE_ORDER.map(group => vals.filter(v => group.includes(String(v).toLowerCase())).length);
    return [vals.length, labels.map((l, i) => `${l} ${counts[i]}`).join(" · ")];
  }
  return [vals.length, `${vals.length} ${L.comments}`];
}

function answerText(q, v, lang) {
  if (v === undefined || v === null || String(v).trim() === "") return "";
  if (q.type === "yesno") return YES.includes(String(v).toLowerCase()) ? T[lang].yes : T[lang].no;
  if (q.type === "scale5") return `${v}/5`;
  if (q.type === "nps") return `${v}/10`;
  return String(v);
}

// ---------------------------------------------------------------------
// 2. SURVEY RESULTS  (mid-programme feedback + closing survey)
// ---------------------------------------------------------------------

const parse = (txt, fallback) => { try { return txt ? JSON.parse(txt) : fallback; } catch { return fallback; } };

function surveyResults(companyId, query) {
  const f = filters(query), L = T[f.lang], s = scope(companyId, f);
  const msById = new Map(s.mentorships.map(m => [m.id, m]));
  const who = role => (role === "mentee" ? L.mentee : L.mentor);
  const pairOf = id => { const m = msById.get(id); return m ? `${m.mentorName} → ${menteeLabel(m, L)}` : ""; };
  const qText = q => (f.lang === "en" ? (q.en || q.tr) : (q.tr || q.en)) || q.id;

  // Every name the organisation knows, to mask inside exported free text.
  const knownNames = [
    ...mentors.listByCompany(s.cid).map(m => m.fullName),
    ...mentees.listByCompany(s.cid).map(m => m.fullName),
    ...mentorships.listByCompany(s.cid).flatMap(m => [m.mentorName, m.menteeName, ...(m.members || []).map(x => x.fullName)])
  ].filter(Boolean);
  const mask = text => scrub(String(text || ""), knownNames);

  // One participant number per person across the whole report.
  const numbers = new Map();
  const participant = r => {
    const k = `${r.mentorship_id}:${r.role}:${r.member_id || ""}`;
    if (!numbers.has(k)) numbers.set(k, numbers.size + 1);
    return `${L.participant} ${numbers.get(k)}`;
  };

  // ---- mid-programme feedback ----
  const ci = db.prepare(`SELECT * FROM checkins WHERE company_id = ? ORDER BY sent_at`).all(s.cid)
    .filter(r => msById.has(r.mentorship_id) && inRange(r.sent_at, f))
    .map(r => ({ ...r, questions: parse(r.questions, []), answers: parse(r.answers, null) }));
  const ciDone = ci.filter(r => r.status === "completed" && r.answers);

  const byId = new Map();     // question id -> newest wording
  for (const r of ci.slice().reverse()) for (const q of r.questions) if (!byId.has(q.id)) byId.set(q.id, q);
  const ciSum = [];
  for (const role of ["mentee", "mentor"]) {
    for (const [id, q] of byId) {
      const vals = ciDone.filter(r => r.role === role && r.questions.some(x => x.id === id)).map(r => r.answers[id]);
      if (vals.length) ciSum.push([who(role), qText(q), ...aggregate(q, vals, f.lang)]);
    }
  }
  const latest = new Map();
  for (const r of ciDone.slice().reverse()) {
    const k = `${r.mentorship_id}:${r.role}:${r.member_id}`;
    if (!latest.has(k)) latest.set(k, r);
  }
  const supportLatest = [...latest.values()].filter(r => r.needs_support);

  // ---- closing survey ----
  const cs = db.prepare(`SELECT * FROM surveys WHERE company_id = ? ORDER BY sent_at`).all(s.cid)
    .filter(r => msById.has(r.mentorship_id) && inRange(r.sent_at, f))
    .map(r => ({ ...r, answers: parse(r.answers, null) }));
  const csDone = cs.filter(r => r.status === "completed" && r.answers);
  const csSum = {}, npsBy = {};
  for (const role of ["mentee", "mentor"]) {
    const done = csDone.filter(r => r.role === role);
    const qs = flatQuestions(role, f.lang);
    csSum[role] = qs.map(q => [q.q, ...aggregate(q, done.map(r => r.answers[q.id]), f.lang)]);
    const npsQ = qs.find(q => q.type === "nps");
    const a = npsQ ? aggregate(npsQ, done.map(r => r.answers[npsQ.id]), f.lang) : null;
    npsBy[role] = a && a[0] ? a[1].split(" · ")[0].replace("NPS ", "") : L.none;
  }

  // ---- open answers (anonymous everywhere: no person, text masked) ----
  const comments = [];
  for (const r of ciDone) for (const q of r.questions.filter(x => x.type === "text")) {
    const v = r.answers[q.id];
    if (v && String(v).trim()) comments.push([L.checkin, who(r.role), qText(q), mask(String(v).trim())]);
  }
  for (const r of csDone) for (const q of flatQuestions(r.role, f.lang).filter(x => x.type === "text")) {
    const v = r.answers[q.id];
    if (v && String(v).trim()) comments.push([L.closing, who(r.role), q.q, mask(String(v).trim())]);
  }

  // ---- person by person: named on screen, anonymous in the files ----
  const detail = (list, questionsOf, label) => {
    const rows = [], exportRows = [];
    for (const r of list) {
      const base = [pairOf(r.mentorship_id), r.recipient_name || "", who(r.role), fmtDate(r.sent_at, f.lang)];
      const anon = [participant(r), who(r.role), fmtDate(r.sent_at, f.lang)];
      if (r.status !== "completed" || !r.answers) {
        rows.push([...base, "", "", ""]); exportRows.push([...anon, "", "", ""]);
        continue;
      }
      for (const q of questionsOf(r)) {
        const text = label(q), ans = answerText(q, r.answers[q.id], f.lang);
        rows.push([...base, fmtDate(r.completed_at, f.lang), text, ans]);
        exportRows.push([...anon, fmtDate(r.completed_at, f.lang), text, q.type === "text" ? mask(ans) : ans]);
      }
    }
    return { rows, exportRows };
  };
  const ciDet = detail(ci, r => r.questions, qText);
  const csDet = detail(cs, r => flatQuestions(r.role, f.lang), q => q.q);
  const namedCols = [L.cPair, L.cPerson, L.cWho, L.cSent, L.cAnswered, L.cQuestion, L.cAnswer];
  const anonCols = [L.cParticipant, L.cWho, L.cSent, L.cAnswered, L.cQuestion, L.cAnswer];

  return {
    title: L.sTitle, subtitle: subtitle(f, s), notes: [L.sNote],
    summary: [
      { label: L.ciSent, value: ci.length },
      { label: L.ciAnswered, value: ciDone.length },
      { label: L.ciRate, value: pct(ciDone.length, ci.length, f.lang) },
      { label: L.ciSupport, value: ciDone.filter(r => r.needs_support).length },
      { label: L.ciSupportPeople, value: supportLatest.length },
      { label: L.csSent, value: cs.length },
      { label: L.csAnswered, value: csDone.length },
      { label: L.csRate, value: pct(csDone.length, cs.length, f.lang) },
      { label: `${L.nps} — ${L.mentee}`, value: npsBy.mentee },
      { label: `${L.nps} — ${L.mentor}`, value: npsBy.mentor }
    ],
    tables: [
      { key: "ci_sum", title: L.tCiSum, sheet: L.shCiSum, columns: [L.cWho, L.cQuestion, L.cAnswers, L.cResult], rows: ciSum },
      { key: "cs_mentee", title: L.tCsSumMentee, sheet: L.shCsMentee, columns: [L.cQuestion, L.cAnswers, L.cResult], rows: csSum.mentee },
      { key: "cs_mentor", title: L.tCsSumMentor, sheet: L.shCsMentor, columns: [L.cQuestion, L.cAnswers, L.cResult], rows: csSum.mentor },
      { key: "comments", title: L.tComments, sheet: L.shComments, columns: [L.cSource, L.cWho, L.cQuestion, L.cAnswer], rows: comments },
      { key: "support", title: L.tSupport, sheet: L.shSupport, screenOnly: true, detail: true,
        columns: [L.cPair, L.cPerson, L.cWho, L.cAnswered],
        rows: supportLatest.map(r => [pairOf(r.mentorship_id), r.recipient_name || "", who(r.role), fmtDate(r.completed_at, f.lang)]),
        exportColumns: [L.cParticipant, L.cWho, L.cAnswered],
        exportRows: supportLatest.map(r => [participant(r), who(r.role), fmtDate(r.completed_at, f.lang)]) },
      { key: "ci_detail", title: L.tCiDetail, sheet: L.shCiDetail, screenOnly: true, detail: true,
        columns: namedCols, rows: ciDet.rows, exportColumns: anonCols, exportRows: ciDet.exportRows },
      { key: "cs_detail", title: L.tCsDetail, sheet: L.shCsDetail, screenOnly: true, detail: true,
        columns: namedCols, rows: csDet.rows, exportColumns: anonCols, exportRows: csDet.exportRows }
    ]
  };
}

module.exports = { management, surveyResults, filters };
