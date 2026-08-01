const express = require("express");

const config = require("../config");
const { mentors, mentees, mentorships, matchRequests } = require("../db/repos");
const { rankMentors } = require("../ai/matching");
const { composeMenteeNeed, shortNeedSummary } = require("../lib/menteeNeed");
const { requireApiKey, requireCompany, wrap, requireLicense } = require("./_helpers");

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

  // Mentee listesi. Isim/e-posta BURADA kalir (IK ekrani); AI'a gitmez.
  //
  // Alanlar TEK TEK gonderilir (tek bir metin blogu yerine): boylece
  // arayuz mentee'yi de mentor kartlariyla ayni bolumlu duzende
  // gosterebilir. AI'a giden metin yine SUNUCUDA derlenir.
  const menteeList = mentees.listSelectable(companyId).map(m => ({
    id: m.id,
    fullName: m.fullName,
    email: m.email,
    role: m.role,
    department: m.department,
    band: m.band,
    tenure: m.tenure,
    managerName: m.managerName || "",
    managerEmail: m.managerEmail || "",

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
  const mentorList = mentors.listActiveByCompany(companyId).map(m => ({
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

  res.json({ mentees: menteeList, mentors: mentorList });
}));

// =====================================================================
// ESLESTIRME
// =====================================================================

router.post("/match", requireApiKey, requireLicense, wrap(async (req, res) => {
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

  if (req.body.menteeId) {
    const record = mentees.get(req.body.menteeId);

    if (!record) {
      return res.status(404).json({ error: "Mentee not found" });
    }

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

  const activeMentors = mentors.listActiveByCompany(companyId);

  if (!activeMentors.length) {
    // "Mentor yok" ile "aktif mentor yok" farkli seylerdir.
    // IK'ya hangisi oldugunu SOYLE, tahmin ettirme.
    const allMentors = mentors.listByCompany(companyId);

    let reason;
    if (!allMentors.length) {
      reason = "no_mentors";          // hic kayit yok
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
        all_inactive: `${allMentors.length} mentor var ama hepsi pasif durumda.`,
        all_full: `${allMentors.length} mentor var ama hepsinin kapasitesi dolu.`
      }[reason]
    });
  }

  const recommendations = await rankMentors(mentee, activeMentors, language);

  res.json({
    companyId,
    mentee,
    mentorCount: activeMentors.length,
    recommendations
  });
}));

// =====================================================================
// ESLESME TALEBI + ONAY
// =====================================================================

router.post("/match-request", requireApiKey, requireLicense, wrap(async (req, res) => {
  const companyId = requireCompany(req, res);
  if (!companyId) return;
  const { mentorId, mentorName } = req.body;

  if (!mentorId || !mentorName) {
    return res.status(400).json({ error: "mentorId and mentorName are required" });
  }

  const mentor = mentors.get(mentorId);
  if (!mentor) {
    return res.status(404).json({ error: "Mentor not found" });
  }

  // ------------------------------------------------------------------
  // TEK-MENTOR KURALI  (asil guvence burasi)
  //
  // Bir mentee ayni anda tek bir mentorle calisir. Arayuz zaten mesgul
  // mentee'yi secilemez yapiyor - ama arayuz atlanabilir, sunucu
  // atlanamaz. Bu yuzden kural BURADA uygulanir.
  //
  // Baypas (force) BILEREK yok: "bir mentee sadece bir mentorde olmali"
  // sert bir kural olarak konuldu. IK yeniden eslestirmek isterse once
  // mevcut talebi/iliskiyi kapatir.
  //
  // SINIR: Bu koruma yalnizca KAYITLI mentee'ler icin isler. Kayitsiz
  // (elle yazilan) mentee'nin kalici bir kimligi olmadigi icin tekilligi
  // dogrulanamaz - orada sorumluluk IK'dadir.
  // ------------------------------------------------------------------
  const menteeRecord = req.body.menteeId ? mentees.get(req.body.menteeId) : null;

  if (menteeRecord) {
    const engagement = mentees.engagement(companyId, menteeRecord.id);

    if (engagement.engaged) {
      return res.status(409).json({
        error: engagement.state === "matched"
          ? "This mentee already has an active mentorship."
          : "This mentee already has a pending match request.",
        detail: engagement.mentorName
          ? `Mentor: ${engagement.mentorName}`
          : undefined,
        action: engagement.state === "matched"
          ? "Complete or cancel the existing mentorship before creating a new match."
          : "Resolve or delete the pending request before creating a new one.",
        code: "mentee_already_engaged",
        state: engagement.state,
        mentorName: engagement.mentorName,
        mentorshipId: engagement.mentorshipId,
        requestId: engagement.requestId
      });
    }
  }

  // ------------------------------------------------------------------
  // Kayitli mentee varsa kimlik ve ihtiyac bilgisi KAYITTAN alinir.
  // Tarayicidan gelen degerlere guvenip kaydi taklit etmesine izin
  // vermeyiz; boylece talepteki bilgi ile mentee kaydi asla ayrismaz.
  //
  // Yonetici bilgisi istisnadir: IK ekranda duzenleyebildigi icin
  // gonderilen deger doluysa o kullanilir, bos ise kayittakine dusulur.
  // ------------------------------------------------------------------
  const payload = { ...req.body };

  if (menteeRecord) {
    payload.menteeId = menteeRecord.id;
    payload.menteeName = menteeRecord.fullName || "";
    payload.menteeEmail = menteeRecord.email || "";
    payload.menteeRole = menteeRecord.role || "";
    payload.menteeDepartment = menteeRecord.department || "";
    payload.developmentNeed = composeMenteeNeed(
      menteeRecord,
      req.body.language === "en" ? "en" : "tr"
    );
    payload.managerName =
      String(req.body.managerName || "").trim() || menteeRecord.managerName || "";
    payload.managerEmail =
      String(req.body.managerEmail || "").trim() || menteeRecord.managerEmail || "";
  }

  const request = matchRequests.create(companyId, payload);
  const base = config.siteBaseUrl;
  const c = encodeURIComponent(companyId);

  const link = (type, token) =>
    `${base}/match_approval.html?id=${request.id}&type=${type}&token=${token}&company=${c}`;

  // GUVENLIK: linkler token tasiyor. Sadece id'yi bilen biri baskasi
  // adina onay veremez.
  //
  // SIRA: Yonetici girilmisse ONCE o onaylamali. Mentor ve mentee
  // linkleri yine uretilir (IK gorebilsin) ama sunucu, yonetici
  // onaylamadan onlarin onayini KABUL ETMEZ.
  res.json({
    success: true,
    requestId: request.id,
    managerRequired: request.managerApproval !== "not_required",
    managerLink: request.managerApproval !== "not_required"
      ? link("manager", request.managerToken)
      : null,
    mentorLink: link("mentor", request.mentorToken),
    menteeLink: link("mentee", request.menteeToken)
  });
}));

/** Ham token yerine kullanima hazir onay linki uretir. */
function withLinks(request) {
  const { mentorToken, menteeToken, managerToken, ...rest } = request;
  const base = config.siteBaseUrl;
  const c = encodeURIComponent(request.companyId);

  const link = (type, token) =>
    `${base}/match_approval.html?id=${request.id}&type=${type}&token=${token}&company=${c}`;

  return {
    ...rest,
    managerRequired: request.managerApproval !== "not_required",
    managerGateOpen: matchRequests.managerGateOpen(request),
    managerLink: managerToken ? link("manager", managerToken) : null,
    mentorLink: link("mentor", mentorToken),
    menteeLink: link("mentee", menteeToken)
  };
}

router.get("/match-requests", requireApiKey, wrap(async (req, res) => {
  // IK linkleri dagitan taraf oldugu icin linkleri gormeli.
  // Ham token'lar yine de disari cikmaz - sadece hazir link doner.
  const companyId = requireCompany(req, res);
  if (!companyId) return;

  res.json(matchRequests.listByCompany(companyId).map(withLinks));
}));

router.get("/match-request/:id", requireApiKey, wrap(async (req, res) => {
  const { token, type } = req.query;

  // Token verilmisse dogrula (onay sayfasi bu yolu kullanir).
  if (token) {
    const request = matchRequests.verifyToken(req.params.id, type, token);
    if (!request) {
      return res.status(403).json({ error: "Invalid or expired link" });
    }
    const { mentorToken, menteeToken, ...safe } = request;
    return res.json(safe);
  }

  // Token yoksa: IK panelinden geliyor demektir (x-api-key zaten dogrulandi).
  const request = matchRequests.get(req.params.id);
  if (!request) return res.status(404).json({ error: "Request not found" });

  const { mentorToken, menteeToken, ...safe } = request;
  res.json(safe);
}));

/**
 * Eslesme talebini sil (IK).
 *
 * Bu talepten dogmus bir calisma alani varsa ONA DOKUNULMAZ - talep
 * sadece onay surecinin kaydidir. IK'ya bunu acikca soyleriz.
 */
router.delete("/match-request/:id", requireApiKey, wrap(async (req, res) => {
  const request = matchRequests.get(req.params.id);

  if (!request) {
    return res.status(404).json({ error: "Request not found" });
  }

  matchRequests.remove(req.params.id);

  res.json({
    success: true,
    message: "Match request deleted",
    hadMentorship: !!request.mentorshipId,
    note: request.mentorshipId
      ? "The workspace created from this request was NOT deleted and keeps running."
      : null
  });
}));

router.patch("/match-request/:id", requireApiKey, wrap(async (req, res) => {
  const { type, status, token } = req.body;

  if (!["mentor", "mentee"].includes(type)) {
    return res.status(400).json({ error: "type must be 'mentor' or 'mentee'" });
  }
  if (!["approved", "rejected", "pending"].includes(status)) {
    return res.status(400).json({ error: "Invalid approval status" });
  }

  // GUVENLIK: onay vermek icin dogru token sart.
  const request = matchRequests.verifyToken(req.params.id, type, token);
  if (!request) {
    return res.status(403).json({ error: "Invalid approval link" });
  }

  if (request.status !== "pending") {
    return res.status(409).json({
      error: "This request has already been resolved",
      status: request.status
    });
  }

  const updated = matchRequests.setApproval(req.params.id, type, status);

  // --- Taraflardan biri reddettiyse ---
  if (updated.mentorApproval === "rejected" || updated.menteeApproval === "rejected") {
    matchRequests.setStatus(req.params.id, "rejected");
    return res.json({ success: true, status: "rejected" });
  }

  // --- Ikisi de onayladiysa: calisma alani ac ---
  if (
    updated.mentorApproval === "approved" &&
    updated.menteeApproval === "approved" &&
    !updated.mentorshipId
  ) {
    // ----------------------------------------------------------------
    // TEK-MENTOR KURALI - son kontrol.
    //
    // /match-request zaten cift talebi engelliyor. Ama bu surumden ONCE
    // olusmus talepler veritabaninda duruyor olabilir; onlar o kontrolden
    // gecmedi. Calisma alani acmadan hemen once bir kez daha bakiyoruz -
    // aksi halde eski bir talep kurali sessizce delerdi.
    //
    // Burada onayi geri almiyoruz: taraflar onayladi, sorun IK'nin
    // cozmesi gereken bir cakisma. Bu yuzden acik bir mesajla durduruyoruz.
    // ----------------------------------------------------------------
    if (updated.menteeId && mentees.get(updated.menteeId)) {
      const engagement = mentees.engagement(updated.companyId, updated.menteeId);

      if (engagement.engaged && engagement.state === "matched") {
        return res.status(409).json({
          error: "This mentee already has an active mentorship.",
          detail: engagement.mentorName
            ? `Mentor: ${engagement.mentorName}`
            : undefined,
          action:
            "A mentee can only work with one mentor at a time. Complete or " +
            "cancel the existing mentorship, then reopen this request.",
          code: "mentee_already_engaged",
          mentorshipId: engagement.mentorshipId
        });
      }
    }

    const { mentorship } = mentorships.create(updated.companyId, {
      mentorId: updated.mentorId,
      menteeId: updated.menteeId,
      mentorName: updated.mentorName,
      menteeName: updated.menteeName,
      mentorEmail: updated.mentorEmail,
      menteeEmail: updated.menteeEmail,
      menteeRole: updated.menteeRole,
      menteeDepartment: updated.menteeDepartment,
      developmentNeed: updated.developmentNeed,
      goals: [],
      developmentAreas: [],
      successCriteria: []
    });

    matchRequests.setStatus(req.params.id, "approved", mentorship.id);

    return res.json({
      success: true,
      status: "approved",
      mentorshipId: mentorship.id,
      workspaceUrl:
        `${config.siteBaseUrl}/mentorship_workspace.html` +
        `?id=${mentorship.id}&token=${mentorship.accessToken}`
    });
  }

  // --- Bir taraf onayladi, digeri bekliyor ---
  res.json({
    success: true,
    status: "pending",
    mentorApproval: updated.mentorApproval,
    menteeApproval: updated.menteeApproval
  });
}));

module.exports = router;
