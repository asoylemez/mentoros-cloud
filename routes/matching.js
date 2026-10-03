const express = require("express");

const { mentors, mentees, programs, menteeGroups } = require("../db/repos");
const { rankMentors } = require("../ai/matching");
const { composeMenteeNeed, shortNeedSummary, composeGroupNeed } = require("../lib/menteeNeed");
const { loadMatchableGroup } = require("../lib/groupRules");
const { requireApiKey, requireCompany, ownRecord, refuseGroupMember, wrap } = require("./_helpers");
const { programForMatch } = require("../lib/programRules");

const router = express.Router();

// =====================================================================
// ESLESTIRME ADAYLARI
//
// Eslestirme sayfasi acilirken tek istekte hem kayitli mentee'leri hem
// secilebilir mentorleri alir. Iki ayri istek yerine tek istek: LAN
// uzerinde daha az gidip gelme, ekranda daha az bekleme.
//
// Kayit sayfalarinin kullandigi /mentees ve /mentors uclarina
// DOKUNULMADI - onlari degistirmek calisan ekranlari bozardi.
// =====================================================================

router.get("/matching-candidates", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const language = req.query.language === "en" ? "en" : "tr";

  // PROGRAMMES: an organisation that works with programmes matches inside
  // ONE programme at a time - ?programId=... is required, and only that
  // programme's mentees and mentors are listed.
  let program = null;
  if (programs.companyHasPrograms(companyId)) {
    if (!req.query.programId) {
      return res.status(400).json({ error: "Choose a programme first.", code: "program_required" });
    }
    program = ownRecord(req, res, programs.get(String(req.query.programId)), "Programme not found");
    if (!program) return;
    if (!programs.isOpen(program)) {
      return res.status(400).json({
        error: `The programme "${program.name}" is closed: no new matches can be made in it.`,
        code: "program_closed", programStatus: program.status
      });
    }
  }

  // Mentee listesi. Isim/e-posta BURADA kalir (IK ekrani); AI'a gitmez.
  //
  // Alanlar TEK TEK gonderilir (tek bir metin blogu yerine): boylece
  // arayuz mentee'yi de mentor kartlariyla ayni bolumlu duzende
  // gosterebilir. AI'a giden metin yine SUNUCUDA derlenir.
  const menteeList = mentees.listSelectable(companyId)
    .filter(m => !program || m.programId === program.id)
    .map(m => ({
    id: m.id,
    fullName: m.fullName,
    email: m.email,
    role: m.role,
    department: m.department,
    band: m.band,
    tenure: m.tenure,

    developmentNeeds: m.developmentNeeds || "",
    challenge: m.challenge || "",
    devFunctionalAreas: m.devFunctionalAreas || [],
    devAreasExtra: m.devAreasExtra || "",
    competenciesToDevelop: m.competenciesToDevelop || [],
    compExtra: m.compExtra || "",
    goals: m.goals || "",
    expectations: m.expectations || "",
    preferredMentorProfile: m.preferredMentorProfile || [],
    formats: m.formats || [],
    languages: m.languages || [],
    hoursPerMonth: m.hoursPerMonth || "",
    message: m.message || "",

    // Kayit bos mu? Arayuz uyari gosterebilsin diye.
    hasNeed: composeMenteeNeed(m, language).length > 0,
    needSummary: shortNeedSummary(m),
    engagement: m.engagement
  }));

  // Manuel eslestirme icin aktif mentorler. Kapasitesi dolu olanlar da
  // listelenir ama ISARETLENIR - karari IK verir, yazilim mentoru
  // sessizce gizlemez.
  const mentorPool = program
    ? mentors.listActiveInProgram(companyId, program.id)
    : mentors.listActiveByCompany(companyId);
  const mentorList = mentorPool.map(m => ({
    id: m.id,
    fullName: m.fullName,
    email: m.email,
    role: m.role,
    band: m.band,
    functionalAreas: m.functionalAreas || [],
    skills: m.skills || [],
    languages: m.languages || [],
    formats: m.formats || [],
    experienceAreas: m.experienceAreas || [],
    availability: m.availability || m.hoursPerMonth || "",
    messageToMentee: m.messageToMentee || "",
    capacity: m.capacity,
    activeMenteeCount: m.activeMenteeCount,
    remainingCapacity: m.remainingCapacity,
    mentorProfile: m.mentorProfile || ""
  }));

  // Mentee groups of the programme (all groups when there are no
  // programmes). A group with an active mentorship is listed but marked.
  const groupList = menteeGroups.listByCompany(companyId)
    .filter(g => (g.programId || "") === (program ? program.id : ""))
    .map(g => ({
      id: g.id,
      name: g.name,
      memberCount: g.members.length,
      members: g.members.map(m => ({ id: m.id, fullName: m.fullName, role: m.role || "", status: m.status })),
      matchable: g.members.length >= menteeGroups.MIN && !g.activeMentorship,
      activeMentorship: g.activeMentorship
    }));

  res.json({
    program: program
      ? { id: program.id, name: program.name, status: program.status,
          startDate: program.startDate, endDate: program.endDate }
      : null,
    mentees: menteeList,
    mentors: mentorList,
    groups: groupList
  });
}));

// =====================================================================
// ESLESTIRME
// =====================================================================

router.post("/match", requireApiKey, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const language = req.body.language || "tr";

  // ------------------------------------------------------------------
  // MENTEE: kayitli secim mi, serbest giris mi?
  //
  // Kayitli mentee varsa ihtiyac metni SUNUCUDA derlenir. Tarayicidan
  // gelen ihtiyac metnine guvenmeyiz: gizlilik katmani (isim scrub'i)
  // ve derleme mantigi tek noktada kalsin diye.
  // ------------------------------------------------------------------
  let mentee;
  let record = null;

  if (req.body.groupId) {
    // A GROUP: one anonymised block per member; every member's name is
    // given to the privacy layer as a known name.
    const group = loadMatchableGroup(req, res, companyId, req.body.groupId);
    if (!group) return;
    record = { id: group.id, companyId: group.companyId, programId: group.programId };
    mentee = {
      fullName: "",
      role: "",
      department: "",
      developmentNeeds: composeGroupNeed(group.memberRecords, language),
      goals: "",
      languages: [],
      knownNames: group.memberRecords.map(m => m.fullName).filter(Boolean)
    };
  } else if (req.body.menteeId) {
    record = ownRecord(req, res, mentees.get(req.body.menteeId), "Mentee not found");
    if (!record) return;
    if (refuseGroupMember(res, record)) return;

    const need = composeMenteeNeed(record, language);

    mentee = {
      fullName: record.fullName || "",
      role: record.role || "",
      department: record.department || "",
      developmentNeeds: need,
      goals: "",              // ihtiyac metni zaten hedefleri iceriyor
      languages: record.languages || []
    };

    if (!need) {
      return res.status(400).json({
        error: "This mentee record has no development information yet.",
        detail:
          "Open the Mentee Registry and fill in the development needs, " +
          "goals or development areas before matching.",
        code: "mentee_need_empty"
      });
    }
  } else {
    // SERBEST GIRIS (kayitsiz mentee) - geriye donuk uyumluluk.
    mentee = {
      fullName: req.body.fullName || req.body.menteeName || "",
      role: req.body.role || "",
      department: req.body.department || "",
      developmentNeeds: req.body.developmentNeeds || "",
      goals: req.body.goals || "",
      languages: req.body.languages || []
    };

    if (!mentee.developmentNeeds && !mentee.goals) {
      return res.status(400).json({
        error: "Either developmentNeeds or goals is required"
      });
    }
  }

  // Programme rule: with programmes, only the mentee's programme's
  // mentors are candidates (and only for a registered, placed mentee).
  const rule = programForMatch(res, companyId, record);
  if (!rule) return;

  const activeMentors = rule.programId
    ? mentors.listActiveInProgram(companyId, rule.programId)
    : mentors.listActiveByCompany(companyId);

  if (!activeMentors.length) {
    // "Mentor yok" ile "aktif mentor yok" farkli seylerdir.
    // IK'ya hangisi oldugunu SOYLE, tahmin ettirme.
    const allMentors = rule.programId
      ? mentors.listInProgram(companyId, rule.programId)
      : mentors.listByCompany(companyId);

    let reason;
    if (!allMentors.length) {
      reason = rule.programId ? "no_program_mentors" : "no_mentors";   // hic kayit yok
    } else if (allMentors.every(m => m.status !== "active")) {
      reason = "all_inactive";        // hepsi pasif
    } else {
      reason = "all_full";            // hepsinin kapasitesi dolu
    }

    return res.json({
      companyId,
      mentee,
      recommendations: [],
      emptyReason: reason,
      totalMentors: allMentors.length,
      message: {
        no_mentors: `"${companyId}" firmasinda hic mentor kaydi yok.`,
        no_program_mentors: `There is no mentor in the programme "${rule.program && rule.program.name}".`,
        all_inactive: `${allMentors.length} mentor var ama hepsi pasif durumda.`,
        all_full: `${allMentors.length} mentor var ama hepsinin kapasitesi dolu.`
      }[reason]
    });
  }

  const recommendations = await rankMentors(mentee, activeMentors, language);

  res.json({
    companyId,
    mentee,
    programId: rule.programId,
    mentorCount: activeMentors.length,
    recommendations
  });
}));

// =====================================================================
// MATCH REQUESTS - REMOVED (October 2026)
//
// There is no approval flow any more: HR matches directly with
// POST /mentorships (routes/mentorships.js) and sends the workspace
// e-mail from the HR Dashboard. The match_requests table is kept only
// as history of matches made before the change.
// =====================================================================

module.exports = router;
