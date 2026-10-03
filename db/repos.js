const bcrypt = require("bcryptjs");
const { encrypt, decrypt } = require("./settings");

const {
  db,
  newId,
  newToken,
  now,
  slugify,
  parseArray,
  toJson,
  camelize,
  parseCapacity
} = require("./index");

// =====================================================================
// COMPANIES
// =====================================================================

/**
 * Var olmayan bir firma icin de hash karsilastirmasi yapabilmek icin
 * gercek ama anlamsiz bir bcrypt hash'i. Boylece "firma yok" ile
 * "sifre yanlis" arasindaki cevap suresi farki kapanir.
 */
const DUMMY_HASH = bcrypt.hashSync("mentoros-timing-equaliser", 10);

/**
 * Eski hesaplarda login_name bos: girilen hali bilinmiyor, anahtar
 * (company_id) gosterilir - giriste zaten o da calisir.
 */
function withLoginName(c) {
  if (!c) return c;
  c.loginName = c.loginName || c.companyId;
  c.hasPassword = !!c.hasPassword;
  return c;
}

const companies = {
  create({ companyId, loginName, name, domain, password, status, expiresAt }) {
    const id = slugify(companyId);
    if (!id) throw new Error("companyId gerekli");
    if (!password) throw new Error("password gerekli");

    const ts = now();

    db.prepare(`
      INSERT INTO companies
        (company_id, login_name, name, domain, password_hash, password_enc,
         status, expires_at, created_at, updated_at)
      VALUES (@companyId, @loginName, @name, @domain, @passwordHash, @passwordEnc,
         @status, @expiresAt, @createdAt, @updatedAt)
      ON CONFLICT(company_id) DO UPDATE SET
        login_name    = excluded.login_name,
        name          = excluded.name,
        domain        = excluded.domain,
        password_hash = excluded.password_hash,
        password_enc  = excluded.password_enc,
        status        = excluded.status,
        expires_at    = excluded.expires_at,
        updated_at    = excluded.updated_at
    `).run({
      companyId: id,
      // Girildigi hali; verilmediyse companyId oldugu gibi.
      loginName: String(loginName || companyId).trim(),
      name: name || id,
      domain: domain || "",
      passwordHash: bcrypt.hashSync(String(password), 10),
      passwordEnc: encrypt(String(password)),
      status: status || "active",
      expiresAt: expiresAt || companies.defaultExpiry(),
      createdAt: ts,
      updatedAt: ts
    });

    return companies.get(id);
  },

  /**
   * Super admin icin kayitli sifrenin acik hali.
   * null: bu ozellikten once olusturulmus (kopya yok) veya SETTINGS_SECRET
   * degismis (kopya cozulemiyor) -> sifreyi yeniden belirlemek gerekir.
   */
  revealPassword(companyId) {
    const row = db.prepare(
      `SELECT password_enc FROM companies WHERE company_id = ?`
    ).get(slugify(companyId));
    if (!row || !row.password_enc) return null;
    return decrypt(row.password_enc);
  },

  /** Varsayilan erisim suresi: bugunden itibaren bir yil. */
  defaultExpiry() {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().slice(0, 10);   // YYYY-AA-GG
  },

  get(companyId) {
    const row = db.prepare(
      `SELECT company_id, login_name, name, domain, status, expires_at,
              created_at, updated_at, (password_enc <> '') AS has_password
         FROM companies WHERE company_id = ?`
    ).get(slugify(companyId));
    return withLoginName(camelize(row));
  },

  list() {
    const rows = db.prepare(
      `SELECT company_id, login_name, name, domain, status, expires_at,
              created_at, updated_at, (password_enc <> '') AS has_password
         FROM companies ORDER BY created_at DESC`
    ).all();

    return rows.map(row => {
      const c = withLoginName(camelize(row));
      c.expired = companies.isExpired(c.expiresAt);
      c.daysLeft = companies.daysLeft(c.expiresAt);
      c.counts = companies.counts(c.companyId);
      return c;
    });
  },

  /**
   * Sure dolmus mu?
   *
   * Bitis GUNUNUN SONUNA kadar erisim aciktir; "2027-01-01" yazan bir
   * firma o gun hala girebilir. Gun ortasinda kapanmak kullaniciya
   * aciklanamaz bir davranis olurdu.
   */
  isExpired(expiresAt) {
    if (!expiresAt) return false;              // bos -> sinirsiz
    const end = new Date(`${String(expiresAt).slice(0, 10)}T23:59:59`);
    if (isNaN(end.getTime())) return false;    // bozuk tarih kilitlemesin
    return end.getTime() < Date.now();
  },

  /** Kalan gun sayisi. Sinirsizsa null. */
  daysLeft(expiresAt) {
    if (!expiresAt) return null;
    const end = new Date(`${String(expiresAt).slice(0, 10)}T23:59:59`);
    if (isNaN(end.getTime())) return null;
    return Math.ceil((end.getTime() - Date.now()) / 86400000);
  },

  /**
   * ==================================================================
   * FIRMA GIRISI
   * ==================================================================
   *
   * Kullanici adi = company_id (slug). Buyuk/kucuk harf duyarsizdir.
   *
   * Basarisiz durumlarda sebep AYIRT EDILMEZ ("boyle bir firma yok" vs
   * "sifre yanlis"), cunku bu, gecerli firma adlarini disaridan
   * taramaya yarar. Tek istisna: sure dolmasi ve pasiflik - onlari
   * kullaniciya soylemek gerekir, yoksa neden giremedigini anlamaz ve
   * bu bilgi zaten dogru sifreyi bilen birine gosterilir.
   */
  verifyLogin(companyId, password) {
    const id = slugify(companyId);

    const row = db.prepare(
      `SELECT company_id, name, password_hash, status, expires_at
         FROM companies WHERE company_id = ?`
    ).get(id);

    if (!row) {
      // Zamanlama farkindan firma adi tahmin edilmesin diye yine de bir
      // hash karsilastirmasi yap. Sonucu kullanilmaz.
      try { bcrypt.compareSync(String(password || ""), DUMMY_HASH); } catch { /* yoksay */ }
      return { ok: false, reason: "bad_credentials" };
    }

    if (!bcrypt.compareSync(String(password || ""), row.password_hash)) {
      return { ok: false, reason: "bad_credentials" };
    }

    if (row.status !== "active") {
      return { ok: false, reason: "inactive" };
    }

    if (companies.isExpired(row.expires_at)) {
      return { ok: false, reason: "expired", expiresAt: row.expires_at };
    }

    return {
      ok: true,
      companyId: row.company_id,
      name: row.name,
      expiresAt: row.expires_at || "",
      daysLeft: companies.daysLeft(row.expires_at)
    };
  },

  /**
   * Oturum SIRASINDA firmanin hala gecerli olup olmadigini soyler.
   *
   * Neden gerekli: oturum 8 saat yasiyor. Super admin bir firmayi
   * pasife alsa veya suresi dolsa bile, o firma acik oturumuyla
   * calismaya devam ederdi. Her istekte ucuz bir kontrol yapiyoruz.
   */
  isUsable(companyId) {
    const row = db.prepare(
      `SELECT status, expires_at FROM companies WHERE company_id = ?`
    ).get(slugify(companyId));

    if (!row) return { ok: false, reason: "not_found" };
    if (row.status !== "active") return { ok: false, reason: "inactive" };
    if (companies.isExpired(row.expires_at)) return { ok: false, reason: "expired" };

    return { ok: true };
  },

  exists(companyId) {
    return !!db.prepare(
      `SELECT 1 FROM companies WHERE company_id = ?`
    ).get(slugify(companyId));
  },

  /**
   * Firma bilgilerini gunceller.
   * Sadece gonderilen alanlar degisir. Sifre bos gelirse KORUNUR
   * (yanlislikla sifirlanmasin).
   */
  update(companyId, { name, domain, status, password, expiresAt }) {
    const id = slugify(companyId);
    const existing = companies.get(id);
    if (!existing) return null;

    const sets = [];
    const params = { id, updatedAt: now() };

    if (name !== undefined)   { sets.push("name = @name");     params.name = String(name); }
    if (domain !== undefined) { sets.push("domain = @domain"); params.domain = String(domain); }

    // Bos string ("") gecerli bir degerdir: "sinirsiz" demektir.
    if (expiresAt !== undefined) {
      sets.push("expires_at = @expiresAt");
      params.expiresAt = String(expiresAt || "").slice(0, 10);
    }

    if (status !== undefined && ["active", "inactive"].includes(status)) {
      sets.push("status = @status");
      params.status = status;
    }

    // Sifre SADECE yeni bir deger geldiyse degisir.
    if (password) {
      sets.push("password_hash = @passwordHash", "password_enc = @passwordEnc");
      params.passwordHash = bcrypt.hashSync(String(password), 10);
      params.passwordEnc = encrypt(String(password));
    }

    if (!sets.length) return existing;

    db.prepare(
      `UPDATE companies SET ${sets.join(", ")}, updated_at = @updatedAt
        WHERE company_id = @id`
    ).run(params);

    return companies.get(id);
  },

  /** Bu firmadaki kayit sayilari (silme uyarisi icin). */
  counts(companyId) {
    const id = slugify(companyId);

    return {
      mentors: db.prepare(
        `SELECT COUNT(*) AS n FROM mentors WHERE company_id = ?`
      ).get(id).n,

      /**
       * Mentee sayimi sonradan eklendi.
       *
       * Onceden eksikti ve bu, SILME UYARISINI etkisiz birakiyordu:
       * yalnizca mentee kaydi olan bir kurulus "veri yok" sayilip
       * uyari verilmeden silinebiliyordu.
       */
      mentees: db.prepare(
        `SELECT COUNT(*) AS n FROM mentees WHERE company_id = ?`
      ).get(id).n,

      mentorships: db.prepare(
        `SELECT COUNT(*) AS n FROM mentorships WHERE company_id = ?`
      ).get(id).n,
      meetings: db.prepare(`
        SELECT COUNT(*) AS n FROM meetings
         WHERE mentorship_id IN (SELECT id FROM mentorships WHERE company_id = ?)
      `).get(id).n
    };
  },

  /**
   * Firmayi siler.
   *
   * DIKKAT: foreign key CASCADE nedeniyle bu firmanin TUM mentorlari,
   * mentorluk iliskileri ve toplanti notlari da silinir. Route katmani
   * once kullaniciyi uyarir.
   */
  remove(companyId) {
    const id = slugify(companyId);
    const existing = companies.get(id);
    if (!existing) return null;

    const counts = companies.counts(id);
    db.prepare(`DELETE FROM companies WHERE company_id = ?`).run(id);

    return { ...existing, deleted: counts };
  },

  /**
   * Mentor davet token'i. Yoksa uretir.
   * IK bu linki mentorlara gonderir; mentorlar GIRIS YAPMADAN sadece
   * kayit formuna ulasir.
   */
  getInviteToken(companyId) {
    const id = slugify(companyId);
    const row = db.prepare(
      `SELECT invite_token FROM companies WHERE company_id = ?`
    ).get(id);

    if (!row) return null;
    if (row.invite_token) return row.invite_token;

    const token = newToken();
    db.prepare(
      `UPDATE companies SET invite_token = ?, updated_at = ? WHERE company_id = ?`
    ).run(token, now(), id);

    return token;
  },

  /** Token sizdiysa yenile. Eski link aninda gecersiz olur. */
  rotateInviteToken(companyId) {
    const id = slugify(companyId);
    const token = newToken();

    db.prepare(
      `UPDATE companies SET invite_token = ?, updated_at = ? WHERE company_id = ?`
    ).run(token, now(), id);

    return token;
  },

  /** Davet token'ini firmaya cevirir. Gecersizse null. */
  findByInviteToken(token) {
    if (!token) return null;

    const row = db.prepare(`
      SELECT company_id, name, status
        FROM companies
       WHERE invite_token = ? AND status = 'active'
    `).get(token);

    return camelize(row);
  },

  /**
   * Girisde yazilani firmaya cevirir.
   *
   * IK'nin "0003" gibi bir kodu ezberlemesi sacma - ekranda firmanin
   * ADI yaziyor. Bu yuzden giris hem KODU hem ADI kabul eder.
   *
   * Belirsizlik: iki firma ayni ada sahipse hangisine giris yapilacagi
   * bilinemez. O durumda kod istenir.
   */
  resolve(input) {
    const raw = String(input || "").trim();
    if (!raw) return { ok: false, reason: "empty" };

    // 1) Once KOD olarak dene
    const byId = db.prepare(
      `SELECT company_id FROM companies WHERE company_id = ?`
    ).get(slugify(raw));

    if (byId) return { ok: true, companyId: byId.company_id };

    // 2) Sonra AD olarak dene (buyuk/kucuk harf duyarsiz)
    const byName = db.prepare(
      `SELECT company_id FROM companies
        WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))`
    ).all(raw);

    if (byName.length === 1) return { ok: true, companyId: byName[0].company_id };

    if (byName.length > 1) {
      return {
        ok: false,
        reason: "ambiguous",
        candidates: byName.map(r => r.company_id)
      };
    }

    return { ok: false, reason: "not_found" };
  },

  /**
   * Sifre dogrulama. Duz metin karsilastirma YOK - bcrypt.
   * Girdi olarak firma KODU veya ADI kabul edilir.
   */
  verifyPassword(input, password) {
    const found = companies.resolve(input);

    if (!found.ok) {
      return { ok: false, reason: found.reason, candidates: found.candidates };
    }

    const row = db.prepare(
      `SELECT company_id, name, status, password_hash
         FROM companies WHERE company_id = ?`
    ).get(found.companyId);

    if (!row) return { ok: false, reason: "not_found" };
    if (!bcrypt.compareSync(String(password || ""), row.password_hash)) {
      return { ok: false, reason: "bad_password" };
    }
    if (row.status !== "active") return { ok: false, reason: "inactive" };

    return { ok: true, company: camelize(row) };
  }
};

// =====================================================================
// MENTORS
// =====================================================================

const ARRAY_FIELDS = [
  "functionalAreas", "industries", "behaviouralCompetencies",
  "technicalCompetencies", "skills", "experienceAreas",
  "menteeLevels", "formats", "languages", "motivations",
  "visibilityPreference"
];

function hydrateMentor(row) {
  const m = camelize(row);
  if (!m) return null;
  // Programmes this mentor is in (a mentor can be in several).
  m.programIds = db.prepare(
    `SELECT program_id FROM program_mentors WHERE mentor_id = ? ORDER BY added_at`
  ).all(m.id).map(r => r.program_id);
  for (const field of ARRAY_FIELDS) {
    if (field in m) m[field] = parseArray(m[field]);
  }
  m.remainingCapacity = Math.max(
    0,
    (m.capacity || 0) - (m.activeMenteeCount || 0)
  );
  return m;
}

const mentors = {
  create(companyId, body) {
    const id = newId();
    const ts = now();
    const capacity = parseCapacity(body.capacity);

    db.prepare(`
      INSERT INTO mentors (
        id, company_id, full_name, email, role, band, country, location,
        region, tenure, functional_areas, functional_areas_extra,
        industries, industries_extra, career_bio,
        behavioural_competencies, technical_competencies, additional_competencies,
        skills, competency_description, experience_areas, mentor_profile,
        capacity, hours_per_month, active_mentee_count,
        mentee_levels, formats, languages,
        availability, motivations, message_to_mentee, visibility_preference,
        status, kvkk_consent, submitted_at, created_at, updated_at
      ) VALUES (
        @id, @companyId, @fullName, @email, @role, @band, @country, @location,
        @region, @tenure, @functionalAreas, @functionalAreasExtra,
        @industries, @industriesExtra, @careerBio,
        @behaviouralCompetencies, @technicalCompetencies, @additionalCompetencies,
        @skills, @competencyDescription, @experienceAreas, @mentorProfile,
        @capacity, @hoursPerMonth, 0,
        @menteeLevels, @formats, @languages,
        @availability, @motivations, @messageToMentee, @visibilityPreference,
        @status, @kvkkConsent, @submittedAt, @createdAt, @updatedAt
      )
    `).run({
      id,
      companyId: slugify(companyId),
      fullName: body.fullName || "",
      email: body.email || "",
      role: body.role || "",
      band: body.band || "",
      country: body.country || "",
      location: body.location || body.country || "",
      region: body.region || "",
      tenure: body.tenure || "",
      functionalAreas: toJson(body.functionalAreas),
      functionalAreasExtra: String(body.functionalAreasExtra || "").trim(),
      industries: toJson(body.industries),
      industriesExtra: String(body.industriesExtra || "").trim(),
      careerBio: body.careerBio || "",
      behaviouralCompetencies: toJson(body.behaviouralCompetencies),
      technicalCompetencies: toJson(body.technicalCompetencies),
      additionalCompetencies: body.additionalCompetencies || "",
      skills: toJson(body.skills),
      competencyDescription: body.competencyDescription || "",
      experienceAreas: toJson(body.experienceAreas),
      mentorProfile: body.mentorProfile || "",
      capacity,
      hoursPerMonth: String(body.hoursPerMonth || ""),
      menteeLevels: toJson(body.menteeLevels),
      formats: toJson(body.formats),
      languages: toJson(body.languages),
      availability: body.availability || "",
      motivations: toJson(body.motivations),
      messageToMentee: body.messageToMentee || "",
      visibilityPreference: toJson(body.visibilityPreference),
      status: body.availability === "At capacity" ? "inactive" : "active",
      kvkkConsent: body.kvkkConsent ? 1 : 0,
      submittedAt: body.submittedAt || ts,
      createdAt: ts,
      updatedAt: ts
    });

    return mentors.get(id);
  },

  get(id) {
    return hydrateMentor(
      db.prepare(`SELECT * FROM mentors WHERE id = ?`).get(id)
    );
  },

  listByCompany(companyId) {
    return db.prepare(
      `SELECT * FROM mentors WHERE company_id = ? ORDER BY created_at DESC`
    ).all(slugify(companyId)).map(hydrateMentor);
  },

  /** All mentors placed in one programme (any status). */
  listInProgram(companyId, programId) {
    return db.prepare(`
      SELECT m.* FROM mentors m
        JOIN program_mentors pm ON pm.mentor_id = m.id
       WHERE m.company_id = ? AND pm.program_id = ?
       ORDER BY m.created_at DESC
    `).all(slugify(companyId), programId).map(hydrateMentor);
  },

  /** Active mentors of one programme - the candidates for a match in it. */
  listActiveInProgram(companyId, programId) {
    return mentors.listInProgram(companyId, programId).filter(m => m.status === "active");
  },

  /** Eslestirmeye sadece aktif ve bos kapasitesi olanlar girer. */
  listActiveByCompany(companyId) {
    return db.prepare(
      `SELECT * FROM mentors
        WHERE company_id = ? AND status = 'active'
        ORDER BY created_at DESC`
    ).all(slugify(companyId)).map(hydrateMentor);
  },

  /**
   * Mentor profilini gunceller (IK duzenler).
   * Sadece gonderilen alanlar degisir; digerleri korunur.
   */
  update(id, body) {
    const current = mentors.get(id);
    if (!current) return null;

    const SCALAR = [
      "fullName", "email", "role", "band", "country", "location", "region",
      "tenure", "careerBio", "additionalCompetencies", "competencyDescription",
      "mentorProfile", "hoursPerMonth", "availability", "messageToMentee",
      "functionalAreasExtra", "industriesExtra"
    ];
    const COLUMN = {
      fullName: "full_name", email: "email", role: "role", band: "band",
      country: "country", location: "location", region: "region",
      tenure: "tenure", careerBio: "career_bio",
      additionalCompetencies: "additional_competencies",
      competencyDescription: "competency_description",
      mentorProfile: "mentor_profile", hoursPerMonth: "hours_per_month",
      availability: "availability", messageToMentee: "message_to_mentee",
      functionalAreasExtra: "functional_areas_extra", industriesExtra: "industries_extra"
    };
    const ARRAY_COLUMN = {
      functionalAreas: "functional_areas", industries: "industries",
      behaviouralCompetencies: "behavioural_competencies",
      technicalCompetencies: "technical_competencies",
      skills: "skills", experienceAreas: "experience_areas",
      menteeLevels: "mentee_levels", formats: "formats",
      languages: "languages", motivations: "motivations",
      visibilityPreference: "visibility_preference"
    };

    const sets = [];
    const params = { id, updatedAt: now() };

    for (const field of SCALAR) {
      if (body[field] !== undefined) {
        sets.push(`${COLUMN[field]} = @${field}`);
        params[field] = String(body[field] ?? "");
      }
    }

    for (const [field, column] of Object.entries(ARRAY_COLUMN)) {
      if (body[field] !== undefined) {
        sets.push(`${column} = @${field}`);
        params[field] = toJson(body[field]);
      }
    }

    // Kayit formu "location" alanini ulkeden turetiyor (location: country).
    // Ayni davranisi burada da koruyoruz ki iki alan ayrisip kafa karistirmasin.
    if (body.country !== undefined && body.location === undefined) {
      sets.push("location = @location");
      params.location = String(body.country ?? "");
    }

    if (body.capacity !== undefined) {
      sets.push("capacity = @capacity");
      params.capacity = parseCapacity(body.capacity);
    }

    if (body.status !== undefined && ["active", "inactive"].includes(body.status)) {
      sets.push("status = @status");
      params.status = body.status;
    }

    if (!sets.length) return current;

    db.prepare(`
      UPDATE mentors SET ${sets.join(", ")}, updated_at = @updatedAt WHERE id = @id
    `).run(params);

    return mentors.get(id);
  },

  /** Bu mentorun devam eden mentorluk iliskisi sayisi. */
  activeMentorshipCount(id) {
    return db.prepare(`
      SELECT COUNT(*) AS n FROM mentorships
       WHERE mentor_id = ? AND status = 'active'
    `).get(id).n;
  },

  /**
   * Mentoru siler.
   *
   * DIKKAT: foreign key CASCADE nedeniyle bu mentorun eslesme talepleri
   * ve mentorluk iliskileri (dolayisiyla toplanti notlari) da silinir.
   * Bu yuzden route katmani, aktif iliski varsa once uyari verir.
   */
  remove(id) {
    const mentor = mentors.get(id);
    if (!mentor) return null;

    db.prepare(`DELETE FROM mentors WHERE id = ?`).run(id);
    return mentor;
  },

  incrementMenteeCount(id, delta = 1) {
    db.prepare(`
      UPDATE mentors
         SET active_mentee_count = MAX(0, active_mentee_count + ?),
             updated_at = ?
       WHERE id = ?
    `).run(delta, now(), id);
  }
};

// =====================================================================
// MENTEES
// =====================================================================

const mentees = {
  create(companyId, body) {
    const id = newId();
    const ts = now();

    db.prepare(`
      INSERT INTO mentees (
        id, company_id, full_name, email, department, role, band,
        country, region, tenure,
        dev_functional_areas, dev_areas_extra, development_needs, challenge,
        competencies_to_develop, comp_extra, goals, expectations,
        formats, hours_per_month, preferred_mentor_profile, languages, location,
        manager_name, manager_email, message, kvkk_consent,
        status, submitted_at, created_at, updated_at
      ) VALUES (
        @id, @companyId, @fullName, @email, @department, @role, @band,
        @country, @region, @tenure,
        @devFunctionalAreas, @devAreasExtra, @developmentNeeds, @challenge,
        @competenciesToDevelop, @compExtra, @goals, @expectations,
        @formats, @hoursPerMonth, @preferredMentorProfile, @languages, @location,
        @managerName, @managerEmail, @message, @kvkkConsent,
        @status, @submittedAt, @createdAt, @updatedAt
      )
    `).run({
      id,
      companyId: slugify(companyId),
      fullName: body.fullName || "",
      email: body.email || "",
      department: body.department || "",
      role: body.role || "",
      band: body.band || "",
      country: body.country || "",
      region: body.region || "",
      tenure: body.tenure || "",
      devFunctionalAreas: toJson(body.devFunctionalAreas),
      devAreasExtra: body.devAreasExtra || "",
      developmentNeeds: body.developmentNeeds || "",
      challenge: body.challenge || "",
      competenciesToDevelop: toJson(body.competenciesToDevelop),
      compExtra: body.compExtra || "",
      goals: body.goals || "",
      expectations: body.expectations || "",
      formats: toJson(body.formats),
      hoursPerMonth: body.hoursPerMonth != null ? String(body.hoursPerMonth) : "",
      preferredMentorProfile: toJson(body.preferredMentorProfile),
      languages: toJson(body.languages),
      location: body.location || body.country || "",
      managerName: body.managerName || "",
      managerEmail: body.managerEmail || "",
      message: body.message || "",
      kvkkConsent: body.kvkkConsent ? 1 : 0,
      status: body.status === "inactive" ? "inactive" : "active",
      submittedAt: body.submittedAt || ts,
      createdAt: ts,
      updatedAt: ts
    });

    return mentees.get(id);
  },

  get(id) {
    const row = db.prepare(`SELECT * FROM mentees WHERE id = ?`).get(id);
    return hydrateMentee(row);
  },

  listByCompany(companyId) {
    return db.prepare(
      `SELECT * FROM mentees WHERE company_id = ? ORDER BY created_at DESC`
    ).all(slugify(companyId)).map(hydrateMentee);
  },

  updateStatus(id, status) {
    db.prepare(
      `UPDATE mentees SET status = ?, updated_at = ? WHERE id = ?`
    ).run(status === "inactive" ? "inactive" : "active", now(), id);
    return mentees.get(id);
  },

  remove(id) {
    db.prepare(`DELETE FROM mentees WHERE id = ?`).run(id);
  },

  /**
   * ------------------------------------------------------------------
   * MENTEE MESGUL MU?  (tek-mentor kurali)
   * ------------------------------------------------------------------
   *
   * KURAL: Bir mentee ayni anda YALNIZCA BIR mentorle calisabilir.
   * (Tersi serbesttir: bir mentor birden fazla mentee alabilir - onu
   * zaten kapasite alani sinirlar.)
   *
   * "Mesgul" sayilan iki durum:
   *   1) AKTIF MENTORLUK  - herhangi bir mentorle devam eden iliski
   *   2) BEKLEYEN TALEP   - herhangi bir mentorle sonuclanmamis onay
   *
   * Bekleyen talep neden bloklar?
   *   Ayni mentee icin iki paralel talep acilirsa IKISI DE onaylanip
   *   kurali cignerdi. Dogru cozum once eski talebi iptal etmektir -
   *   IK bunu IK panelinden yapabiliyor.
   *
   * Mesgul SAYILMAYANLAR: reddedilmis talepler ve tamamlanmis /
   * duraklatilmis / iptal edilmis mentorluklar. O mentee yeniden
   * eslesebilir.
   *
   * NOT: Bu kural veritabani seviyesinde zorlanamaz - mentorships
   * tablosundaki tekil indeks (company, mentor, mentee) CIFT uzerinde
   * calisir, tek basina mentee uzerinde degil. Bu yuzden kontrol
   * uygulama katmanindadir.
   */
  engagement(companyId, menteeId) {
    if (!menteeId) return { engaged: false, state: "available" };

    const cid = slugify(companyId);

    const mentorship = db.prepare(`
      SELECT id, mentor_id, mentor_name, created_at
        FROM mentorships
       WHERE company_id = ? AND mentee_id = ? AND status = 'active'
       LIMIT 1
    `).get(cid, menteeId);

    if (mentorship) {
      return {
        engaged: true,
        state: "matched",
        mentorshipId: mentorship.id,
        mentorId: mentorship.mentor_id,
        mentorName: mentorship.mentor_name || "",
        since: mentorship.created_at
      };
    }

    const request = db.prepare(`
      SELECT id, mentor_id, mentor_name, created_at
        FROM match_requests
       WHERE company_id = ? AND mentee_id = ? AND status = 'pending'
       LIMIT 1
    `).get(cid, menteeId);

    if (request) {
      return {
        engaged: true,
        state: "pending",
        requestId: request.id,
        mentorId: request.mentor_id,
        mentorName: request.mentor_name || "",
        since: request.created_at
      };
    }

    return { engaged: false, state: "available" };
  },

  /**
   * Aktif mentee'ler + her birinin mesguliyet durumu.
   *
   * Mesgul mentee'ler listeden GIZLENMEZ - gorunur ama secilemez ve
   * yaninda kiminle mesgul oldugu yazar. Sessizce kaybolmalari IK'yi
   * "kayit nerede?" diye arattirirdi.
   */
  listSelectable(companyId) {
    return mentees
      .listByCompany(companyId)
      .filter(m => m.status === "active")
      .map(m => ({ ...m, engagement: mentees.engagement(companyId, m.id) }));
  },

  // IK, mentee profilini duzenler. Gonderilmeyen alanlar mevcut degerinde kalir.
  update(id, body) {
    const cur = mentees.get(id);
    if (!cur) return null;
    const m = { ...cur, ...body };

    db.prepare(`
      UPDATE mentees SET
        full_name = @fullName, email = @email, department = @department, role = @role,
        band = @band, country = @country, region = @region, tenure = @tenure,
        dev_functional_areas = @devFunctionalAreas, dev_areas_extra = @devAreasExtra,
        development_needs = @developmentNeeds, challenge = @challenge,
        competencies_to_develop = @competenciesToDevelop, comp_extra = @compExtra,
        goals = @goals, expectations = @expectations,
        formats = @formats, hours_per_month = @hoursPerMonth,
        preferred_mentor_profile = @preferredMentorProfile, languages = @languages,
        location = @location, manager_name = @managerName, manager_email = @managerEmail,
        message = @message, kvkk_consent = @kvkkConsent, status = @status,
        updated_at = @updatedAt
      WHERE id = @id
    `).run({
      id,
      fullName: m.fullName || "",
      email: m.email || "",
      department: m.department || "",
      role: m.role || "",
      band: m.band || "",
      country: m.country || "",
      region: m.region || "",
      tenure: m.tenure || "",
      devFunctionalAreas: toJson(m.devFunctionalAreas),
      devAreasExtra: m.devAreasExtra || "",
      developmentNeeds: m.developmentNeeds || "",
      challenge: m.challenge || "",
      competenciesToDevelop: toJson(m.competenciesToDevelop),
      compExtra: m.compExtra || "",
      goals: m.goals || "",
      expectations: m.expectations || "",
      formats: toJson(m.formats),
      hoursPerMonth: m.hoursPerMonth != null ? String(m.hoursPerMonth) : "",
      preferredMentorProfile: toJson(m.preferredMentorProfile),
      languages: toJson(m.languages),
      location: m.location || m.country || "",
      managerName: m.managerName || "",
      managerEmail: m.managerEmail || "",
      message: m.message || "",
      kvkkConsent: m.kvkkConsent ? 1 : 0,
      status: m.status === "inactive" ? "inactive" : "active",
      updatedAt: now()
    });

    return mentees.get(id);
  }
};

// Mentee satirini uygulama nesnesine cevirir (JSON alanlari diziye acar).
function hydrateMentee(row) {
  const m = camelize(row);
  if (!m) return m;
  m.languages = parseArray(m.languages);
  m.devFunctionalAreas = parseArray(m.devFunctionalAreas);
  m.competenciesToDevelop = parseArray(m.competenciesToDevelop);
  m.formats = parseArray(m.formats);
  m.preferredMentorProfile = parseArray(m.preferredMentorProfile);
  m.kvkkConsent = !!m.kvkkConsent;
  return m;
}

// =====================================================================
// MATCH REQUESTS
// =====================================================================

const matchRequests = {
  create(companyId, body) {
    const id = newId();
    const ts = now();

    db.prepare(`
      INSERT INTO match_requests (
        id, company_id, mentor_id, mentee_id,
        mentor_name, mentee_name, mentor_email, mentee_email,
        manager_name, manager_email,
        mentee_role, mentee_department, development_need,
        match_score, match_reason,
        mentor_token, mentee_token, manager_token,
        manager_approval, mentor_approval, mentee_approval, status,
        program_id, created_at, updated_at
      ) VALUES (
        @id, @companyId, @mentorId, @menteeId,
        @mentorName, @menteeName, @mentorEmail, @menteeEmail,
        @managerName, @managerEmail,
        @menteeRole, @menteeDepartment, @developmentNeed,
        @matchScore, @matchReason,
        @mentorToken, @menteeToken, @managerToken,
        @managerApproval, 'pending', 'pending', 'pending',
        @programId, @createdAt, @updatedAt
      )
    `).run({
      id,
      companyId: slugify(companyId),
      mentorId: body.mentorId,
      menteeId: body.menteeId || "",
      mentorName: body.mentorName || "",
      menteeName: body.menteeName || "",
      mentorEmail: body.mentorEmail || "",
      menteeEmail: body.menteeEmail || "",
      menteeRole: body.menteeRole || "",
      menteeDepartment: body.menteeDepartment || "",
      developmentNeed: body.developmentNeed || "",
      matchScore: Math.round(Number(body.matchScore) || 0),
      // Eski istemciler dizi gonderebilir; ikisini de kabul et.
      matchReason: body.matchReason ||
        (Array.isArray(body.matchReasons) ? body.matchReasons[0] : "") || "",
      // Yonetici bilgisi verilmediyse kapi yoktur (eski davranis korunur).
      managerName: body.managerName || "",
      managerEmail: body.managerEmail || "",
      managerToken: newToken(),
      managerApproval: body.managerEmail ? "pending" : "not_required",

      mentorToken: newToken(),
      menteeToken: newToken(),
      // Set by the route from the mentee's programme - never from the browser.
      programId: body.programId || "",
      createdAt: ts,
      updatedAt: ts
    });

    return matchRequests.get(id);
  },

  get(id) {
    return camelize(
      db.prepare(`SELECT * FROM match_requests WHERE id = ?`).get(id)
    );
  },

  listByCompany(companyId) {
    return db.prepare(
      `SELECT * FROM match_requests
        WHERE company_id = ? ORDER BY created_at DESC`
    ).all(slugify(companyId)).map(camelize);
  },

  /** Token dogrulamasi: id + token + taraf eslesmeli. */
  verifyToken(id, type, token) {
    const req = matchRequests.get(id);
    if (!req || !token) return null;

    const expected = {
      mentor: req.mentorToken,
      mentee: req.menteeToken,
      manager: req.managerToken
    }[type];

    if (!expected || expected !== token) return null;

    return req;
  },

  /**
   * Yonetici kapisi acik mi?
   *
   * Mentee'nin yoneticisi girilmisse, mentor ve mentee ONDAN ONCE
   * onay veremez. Sebep: mentee'nin zamanini taahhut eden kisi
   * yoneticisidir; once o kabul etmeli.
   */
  managerGateOpen(req) {
    return req.managerApproval === "not_required" ||
           req.managerApproval === "approved";
  },

  setManagerApproval(id, status) {
    db.prepare(
      `UPDATE match_requests SET manager_approval = ?, updated_at = ? WHERE id = ?`
    ).run(status, now(), id);
    return matchRequests.get(id);
  },

  setApproval(id, type, status) {
    const field = type === "mentor" ? "mentor_approval" : "mentee_approval";
    db.prepare(
      `UPDATE match_requests SET ${field} = ?, updated_at = ? WHERE id = ?`
    ).run(status, now(), id);
    return matchRequests.get(id);
  },

  /**
   * Eslesme talebini siler.
   *
   * NOT: Bu talepten dogmus bir mentorluk iliskisi varsa ONA DOKUNMAZ.
   * Talep sadece onay surecinin kaydidir; iliski ayri bir varliktir.
   */
  remove(id) {
    const request = matchRequests.get(id);
    if (!request) return null;

    db.prepare(`DELETE FROM match_requests WHERE id = ?`).run(id);
    return request;
  },

  /**
   * Red gerekcesini kaydeder.
   *
   * Kategori + serbest not birlikte tutulur:
   *   - kategori  -> IK istatistik cikarabilir ("6 red, 4'u zamanlama")
   *   - not       -> insan okuyacagi ayrinti
   */
  setRejection(id, { by, category, note }) {
    db.prepare(`
      UPDATE match_requests
         SET rejected_by = ?, rejection_category = ?, rejection_note = ?,
             rejected_at = ?, updated_at = ?
       WHERE id = ?
    `).run(
      by || "",
      category || "",
      String(note || "").slice(0, 1000),
      now(), now(), id
    );

    return matchRequests.get(id);
  },

  setStatus(id, status, mentorshipId = null) {
    db.prepare(`
      UPDATE match_requests
         SET status = ?, mentorship_id = COALESCE(?, mentorship_id), updated_at = ?
       WHERE id = ?
    `).run(status, mentorshipId, now(), id);
    return matchRequests.get(id);
  }
};

// =====================================================================
// MENTORSHIPS
// =====================================================================

function hydrateMentorship(row) {
  const m = camelize(row);
  if (!m) return null;
  m.goals = parseArray(m.goals);
  m.developmentAreas = parseArray(m.developmentAreas);
  m.successCriteria = parseArray(m.successCriteria);
  return m;
}

const mentorships = {
  /** One mentorship per mentor-mentee pair PER PROGRAMME. */
  findPair(companyId, mentorId, menteeId, programId = "") {
    return hydrateMentorship(
      db.prepare(`
        SELECT * FROM mentorships
         WHERE company_id = ? AND mentor_id = ? AND mentee_id = ? AND program_id = ?
         LIMIT 1
      `).get(slugify(companyId), mentorId, menteeId || "", programId || "")
    );
  },

  /**
   * body.programId: the programme the match was made in ('' = none).
   * The workspace closing date starts as the programme's end date; HR can
   * change it later as before.
   */
  create(companyId, body) {
    const programId = body.programId || "";
    const existing = mentorships.findPair(
      companyId, body.mentorId, body.menteeId, programId
    );
    if (existing) return { created: false, mentorship: existing };

    const program = programId
      ? db.prepare(`SELECT end_date FROM programs WHERE id = ?`).get(programId)
      : null;
    const closingDate = body.closingDate || (program ? program.end_date : "");

    const id = newId();
    const ts = now();

    db.prepare(`
      INSERT INTO mentorships (
        id, company_id, mentor_id, mentee_id,
        mentor_name, mentee_name, mentor_email, mentee_email,
        mentee_role, mentee_department, development_need,
        goals, development_areas, success_criteria,
        status, next_meeting_date, access_token, program_id, closing_date,
        created_at, updated_at
      ) VALUES (
        @id, @companyId, @mentorId, @menteeId,
        @mentorName, @menteeName, @mentorEmail, @menteeEmail,
        @menteeRole, @menteeDepartment, @developmentNeed,
        @goals, @developmentAreas, @successCriteria,
        'active', '', @accessToken, @programId, @closingDate,
        @createdAt, @updatedAt
      )
    `).run({
      id,
      accessToken: newToken(),
      companyId: slugify(companyId),
      mentorId: body.mentorId,
      menteeId: body.menteeId || "",
      mentorName: body.mentorName || "",
      menteeName: body.menteeName || "",
      mentorEmail: body.mentorEmail || "",
      menteeEmail: body.menteeEmail || "",
      menteeRole: body.menteeRole || "",
      menteeDepartment: body.menteeDepartment || "",
      developmentNeed: body.developmentNeed || "",
      goals: toJson(body.goals),
      developmentAreas: toJson(body.developmentAreas),
      successCriteria: toJson(body.successCriteria),
      programId,
      closingDate,
      createdAt: ts,
      updatedAt: ts
    });

    // Mentorun dolu kapasitesi arttir; doldu ise pasife al.
    mentors.incrementMenteeCount(body.mentorId, 1);
    const mentor = mentors.get(body.mentorId);
    if (mentor && mentor.remainingCapacity <= 0) {
      db.prepare(
        `UPDATE mentors SET status = 'inactive', updated_at = ? WHERE id = ?`
      ).run(now(), body.mentorId);
    }

    return { created: true, mentorship: mentorships.get(id) };
  },

  get(id) {
    return hydrateMentorship(
      db.prepare(`SELECT * FROM mentorships WHERE id = ?`).get(id)
    );
  },

  /**
   * Calisma alani erisim token'ini dogrular.
   *
   * Bu token SADECE bu iliskiye erisim verir. Mentor veya mentee,
   * calisma sayfasini acmak icin paylasimli API anahtarina ihtiyac
   * duymaz - dolayisiyla o anahtari ele gecirip IK verilerine
   * ulasamazlar.
   */
  verifyAccess(id, token) {
    if (!token) return null;

    const ms = mentorships.get(id);
    if (!ms || ms.accessToken !== token) return null;

    return ms;
  },

  /** Calisma sayfasi icin: iliski + tum toplantilar. */
  getWithMeetings(id) {
    const mentorship = mentorships.get(id);
    if (!mentorship) return null;
    mentorship.meetings = meetings.listByMentorship(id);
    return mentorship;
  },

  listByCompany(companyId) {
    return db.prepare(
      `SELECT * FROM mentorships
        WHERE company_id = ? ORDER BY created_at DESC`
    ).all(slugify(companyId)).map(hydrateMentorship);
  },

  /**
   * Mentorluk iliskisini siler.
   *
   * DIKKAT: foreign key CASCADE nedeniyle bu iliskiye ait TUM TOPLANTI
   * NOTLARI da silinir. Route katmani once kullaniciyi uyarir.
   *
   * Iliski aktifse mentorun kapasitesi geri verilir.
   */
  remove(id) {
    const ms = mentorships.get(id);
    if (!ms) return null;

    const meetingCount = db.prepare(
      `SELECT COUNT(*) AS n FROM meetings WHERE mentorship_id = ?`
    ).get(id).n;

    // Aktif iliski siliniyorsa mentorun kapasitesini iade et.
    if (ms.status === "active") {
      mentors.incrementMenteeCount(ms.mentorId, -1);

      // Kapasite acildiysa mentoru tekrar aktif yap.
      const mentor = mentors.get(ms.mentorId);
      if (mentor && mentor.remainingCapacity > 0 && mentor.status === "inactive") {
        db.prepare(
          `UPDATE mentors SET status = 'active', updated_at = ? WHERE id = ?`
        ).run(now(), ms.mentorId);
      }
    }

    db.prepare(`DELETE FROM mentorships WHERE id = ?`).run(id);

    return { ...ms, deletedMeetings: meetingCount };
  },

  /** Bu iliskiye ait toplanti notu sayisi (silme uyarisi icin). */
  meetingCount(id) {
    return db.prepare(
      `SELECT COUNT(*) AS n FROM meetings WHERE mentorship_id = ?`
    ).get(id).n;
  },

  updateStatus(id, status) {
    db.prepare(
      `UPDATE mentorships SET status = ?, updated_at = ? WHERE id = ?`
    ).run(status, now(), id);
    return mentorships.get(id);
  },

  updateDevelopmentPlan(id, { goals, developmentAreas, successCriteria }) {
    db.prepare(`
      UPDATE mentorships
         SET goals = ?, development_areas = ?, success_criteria = ?, updated_at = ?
       WHERE id = ?
    `).run(
      toJson(goals), toJson(developmentAreas), toJson(successCriteria),
      now(), id
    );
    return mentorships.get(id);
  },

  setNextMeeting(id, date, time) {
    db.prepare(
      `UPDATE mentorships
          SET next_meeting_date = ?, next_meeting_time = ?, updated_at = ?
        WHERE id = ?`
    ).run(date || "", time || "", now(), id);
  },

  // Calisma alaninin kapanacagi tarihi belirler/revize eder.
  // Bos string ("") verilirse tarih temizlenir. Sayfa asla silinmez.
  setClosingDate(id, date) {
    db.prepare(
      `UPDATE mentorships SET closing_date = ?, updated_at = ? WHERE id = ?`
    ).run(date || "", now(), id);
    return mentorships.get(id);
  }
};

// =====================================================================
// MEETINGS
// =====================================================================

/**
 * Meeting length, stored in MINUTES. Accepts "HH:MM" as typed in the
 * workspace ("01:20" = 80) or a whole number of minutes. Valid: 1 minute
 * to 12 hours. Anything else -> null ("not recorded").
 *
 * Both routes that save a meeting note (HR API and workspace) refuse a
 * note without a valid duration; NULL only remains on notes saved before
 * the duration became required. The workspace page uses the same rule
 * (durationToMinutes in mentorship_workspace.html) - change both together.
 */
const DURATION_MAX_MINUTES = 12 * 60;

function meetingDuration(value) {
  if (value === null || value === undefined || value === "") return null;
  let n;
  const text = String(value).trim();
  const hhmm = text.match(/^(\d{1,2}):([0-5]\d)$/);
  if (hhmm) n = Number(hhmm[1]) * 60 + Number(hhmm[2]);
  else if (/^\d+$/.test(text)) n = Number(text);
  else return null;
  return n >= 1 && n <= DURATION_MAX_MINUTES ? n : null;
}

function hydrateMeeting(row) {
  const m = camelize(row);
  if (!m) return null;
  m.actionItems = parseArray(m.actionItems);
  return m;
}

const meetings = {
  create(mentorshipId, body) {
    const id = newId();
    const ts = now();

    db.prepare(`
      INSERT INTO meetings (
        id, mentorship_id, meeting_date, title, agenda, discussed,
        progress_since_last_meeting, action_items,
        next_meeting_focus, next_meeting_date, next_meeting_time,
        duration_minutes, created_by, created_at, updated_at
      ) VALUES (
        @id, @mentorshipId, @meetingDate, @title, @agenda, @discussed,
        @progressSinceLastMeeting, @actionItems,
        @nextMeetingFocus, @nextMeetingDate, @nextMeetingTime,
        @durationMinutes, @createdBy, @createdAt, @updatedAt
      )
    `).run({
      id,
      mentorshipId,
      meetingDate: body.meetingDate,
      title: body.title,
      agenda: body.agenda || "",
      discussed: body.discussed || "",
      progressSinceLastMeeting: body.progressSinceLastMeeting || "",
      actionItems: JSON.stringify(
        (Array.isArray(body.actionItems) ? body.actionItems : []).map(item =>
          typeof item === "string"
            ? { text: item, status: "open" }
            : { text: item.text || "", status: item.status || "open" }
        )
      ),
      nextMeetingFocus: body.nextMeetingFocus || "",
      nextMeetingDate: body.nextMeetingDate || "",
      nextMeetingTime: body.nextMeetingTime || "",
      durationMinutes: meetingDuration(body.duration ?? body.durationMinutes),
      createdBy: body.createdBy || "unknown",
      createdAt: ts,
      updatedAt: ts
    });

    mentorships.setNextMeeting(
      mentorshipId,
      body.nextMeetingDate || body.meetingDate,
      body.nextMeetingTime || ""
    );

    return meetings.get(id);
  },

  get(id) {
    return hydrateMeeting(
      db.prepare(`SELECT * FROM meetings WHERE id = ?`).get(id)
    );
  },

  listByMentorship(mentorshipId) {
    return db.prepare(
      `SELECT * FROM meetings
        WHERE mentorship_id = ? ORDER BY meeting_date ASC`
    ).all(mentorshipId).map(hydrateMeeting);
  },

  updateActionStatus(meetingId, index, status) {
    const meeting = meetings.get(meetingId);
    if (!meeting) return null;

    const items = meeting.actionItems;
    if (!items[index]) return null;

    items[index].status = status;

    db.prepare(
      `UPDATE meetings SET action_items = ?, updated_at = ? WHERE id = ?`
    ).run(JSON.stringify(items), now(), meetingId);

    return meetings.get(meetingId);
  }
};


// =====================================================================
// SURVEYS  (kapanis anketleri)
//
// Her mentorluk icin mentor ve mentee'ye AYRI anket gonderilir.
// Anket kendi token'i ile acilir; giris gerektirmez.
//
// GIZLILIK: Cevaplari yalnizca IK gorur. Taraflar birbirinin
// cevabini goremez - bu soz anket sayfasinda kullaniciya yazilir.
// =====================================================================

const surveys = {

  /**
   * Anket olusturur. AYNI rol icin zaten CEVAPLANMAMIS bir anket varsa
   * yenisini uretmez, mevcudu dondurur.
   *
   * Neden? IK "gonder"e iki kez basarsa iki farkli link olusur; kisiye
   * iki e-posta gider ve hangisini dolduracagini bilemez. Ayrica ilk
   * link sessizce olu kalirdi.
   */
  create(companyId, { mentorshipId, role, recipientName, recipientEmail, language }) {
    const cid = slugify(companyId);

    const existing = db.prepare(`
      SELECT * FROM surveys
       WHERE company_id = ? AND mentorship_id = ? AND role = ? AND status = 'pending'
       LIMIT 1
    `).get(cid, mentorshipId, role);

    if (existing) return { survey: hydrateSurvey(existing), reused: true };

    const survey = {
      id: newId(),
      companyId: cid,
      mentorshipId,
      role,
      token: newToken(),
      status: "pending",
      recipientName: recipientName || "",
      recipientEmail: recipientEmail || "",
      language: language === "en" ? "en" : "tr",
      answers: null,
      sentAt: now(),
      completedAt: null
    };

    db.prepare(`
      INSERT INTO surveys
        (id, company_id, mentorship_id, role, token, status,
         recipient_name, recipient_email, language, answers, sent_at, completed_at)
      VALUES
        (@id, @companyId, @mentorshipId, @role, @token, @status,
         @recipientName, @recipientEmail, @language, @answers, @sentAt, @completedAt)
    `).run(survey);

    return { survey, reused: false };
  },

  getByToken(token) {
    const row = db.prepare(`SELECT * FROM surveys WHERE token = ?`).get(token);
    return row ? hydrateSurvey(row) : null;
  },

  /** Bir mentorlugun anketleri (mentor + mentee). */
  listByMentorship(mentorshipId) {
    return db.prepare(`
      SELECT * FROM surveys WHERE mentorship_id = ? ORDER BY sent_at ASC
    `).all(mentorshipId).map(hydrateSurvey);
  },

  /**
   * Cevaplari kaydeder.
   *
   * Ikinci kez gonderim KABUL EDILMEZ: link e-postada durdugu icin
   * yanlislikla tekrar acilabilir; ilk cevabin uzerine yazmak, kisinin
   * dusunerek verdigi yaniti sessizce silmek olurdu.
   */
  submit(token, answers) {
    const survey = surveys.getByToken(token);
    if (!survey) return { ok: false, reason: "not_found" };
    if (survey.status === "completed") return { ok: false, reason: "already_completed", survey };

    // DIKKAT: toJson() DIZILER icindir - dizi olmayan degeri [value]
    // diye sarar. Cevaplar bir NESNE oldugu icin dogrudan stringify
    // edilir; aksi halde tum cevaplar tek elemanli bir diziye gomulur.
    db.prepare(`
      UPDATE surveys SET answers = ?, status = 'completed', completed_at = ?
       WHERE token = ?
    `).run(JSON.stringify(answers || {}), now(), token);

    return { ok: true, survey: surveys.getByToken(token) };
  }
};

function hydrateSurvey(row) {
  const survey = camelize(row);
  try {
    survey.answers = row.answers ? JSON.parse(row.answers) : null;
  } catch {
    survey.answers = null;
  }
  return survey;
}

// =====================================================================
// PROGRAMMES
//
// An organisation can run several mentoring programmes, each with a start
// and an end date. Status is never stored - it is worked out from the
// dates every time, so it cannot go stale:
//   archived  set by HR
//   planned   today is before the start date
//   active    start <= today <= end
//   ended     today is after the end date
// =====================================================================

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(text) {
  if (!DATE_RE.test(text || "")) return false;
  const d = new Date(text + "T00:00:00Z");
  return !isNaN(d) && d.toISOString().slice(0, 10) === text;
}

function programStatus(p, today = new Date().toISOString().slice(0, 10)) {
  if (p.archived) return "archived";
  if (today < p.startDate) return "planned";
  if (today > p.endDate) return "ended";
  return "active";
}

function hydrateProgram(row) {
  const p = camelize(row);
  if (!p) return null;
  p.archived = !!p.archived;
  p.status = programStatus(p);
  return p;
}

const programs = {
  /**
   * Checks the fields HR typed. Returns { error } or { value }.
   * `current` is the stored programme when editing (fields left out of
   * the body keep their value).
   */
  validate(companyId, body, current = null) {
    const pick = (k, d = "") => (body[k] === undefined ? (current ? current[k] : d) : body[k]);
    const name = String(pick("name")).trim();
    const description = String(pick("description")).trim();
    const startDate = String(pick("startDate")).trim();
    const endDate = String(pick("endDate")).trim();

    if (!name) return { error: "The programme name is required.", code: "name_required" };
    if (name.length > 120) return { error: "The programme name can be at most 120 characters.", code: "name_too_long" };
    if (description.length > 1000) return { error: "The description can be at most 1000 characters.", code: "description_too_long" };
    if (!isRealDate(startDate) || !isRealDate(endDate)) {
      return { error: "Start and end dates are required (YYYY-MM-DD).", code: "dates_required" };
    }
    if (endDate < startDate) {
      return { error: "The end date cannot be before the start date.", code: "end_before_start" };
    }

    const clash = db.prepare(`
      SELECT id FROM programs
       WHERE company_id = ? AND name = ? COLLATE NOCASE AND id != ?
    `).get(slugify(companyId), name, current ? current.id : "");
    if (clash) return { error: "A programme with this name already exists.", code: "name_taken" };

    return { value: { name, description, startDate, endDate } };
  },

  create(companyId, value) {
    const id = newId();
    const ts = now();
    db.prepare(`
      INSERT INTO programs (id, company_id, name, description, start_date, end_date,
                            archived, created_at, updated_at)
      VALUES (@id, @companyId, @name, @description, @startDate, @endDate, 0, @ts, @ts)
    `).run({ id, companyId: slugify(companyId), ...value, ts });
    return programs.get(id);
  },

  get(id) {
    return hydrateProgram(db.prepare(`SELECT * FROM programs WHERE id = ?`).get(id));
  },

  /** With head counts, newest start first. */
  listByCompany(companyId) {
    const cid = slugify(companyId);
    return db.prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM program_mentors pm WHERE pm.program_id = p.id) AS mentor_count,
        (SELECT COUNT(*) FROM mentees me WHERE me.program_id = p.id AND me.company_id = p.company_id) AS mentee_count,
        (SELECT COUNT(*) FROM mentorships ms WHERE ms.program_id = p.id AND ms.status = 'active') AS active_mentorship_count
        FROM programs p
       WHERE p.company_id = ?
       ORDER BY p.archived ASC, p.start_date DESC, p.name COLLATE NOCASE
    `).all(cid).map(hydrateProgram);
  },

  update(id, value) {
    db.prepare(`
      UPDATE programs
         SET name = @name, description = @description,
             start_date = @startDate, end_date = @endDate, updated_at = @ts
       WHERE id = @id
    `).run({ id, ...value, ts: now() });
    return programs.get(id);
  },

  setArchived(id, archived) {
    db.prepare(`UPDATE programs SET archived = ?, updated_at = ? WHERE id = ?`)
      .run(archived ? 1 : 0, now(), id);
    return programs.get(id);
  },

  /** Does this organisation work with programmes at all? (any, archived too) */
  companyHasPrograms(companyId) {
    return !!db.prepare(`SELECT 1 FROM programs WHERE company_id = ? LIMIT 1`).get(slugify(companyId));
  },

  /** New matches can be made while a programme is planned or running. */
  isOpen(program) {
    return !!program && (program.status === "planned" || program.status === "active");
  },

  /** Active mentorships of one mentor inside one programme. */
  activeMentorshipsOfMentor(mentorId, programId) {
    return db.prepare(`
      SELECT COUNT(*) n FROM mentorships
       WHERE mentor_id = ? AND program_id = ? AND status = 'active'
    `).get(mentorId, programId).n;
  },

  /** How many match requests / mentorships were made in this programme. */
  usage(id) {
    return {
      matchRequests: db.prepare(`SELECT COUNT(*) n FROM match_requests WHERE program_id = ?`).get(id).n,
      mentorships: db.prepare(`SELECT COUNT(*) n FROM mentorships WHERE program_id = ?`).get(id).n
    };
  },

  /**
   * Deletes an EMPTY programme (no match request, no mentorship - the
   * route checks). People are never deleted: mentors lose the membership
   * (FK cascade), mentees become "not assigned".
   */
  remove(id) {
    const tx = db.transaction(() => {
      db.prepare(`UPDATE mentees SET program_id = '', updated_at = ? WHERE program_id = ?`).run(now(), id);
      db.prepare(`DELETE FROM program_mentors WHERE program_id = ?`).run(id);
      db.prepare(`DELETE FROM programs WHERE id = ?`).run(id);
    });
    tx();
  },

  /** Replaces the programmes of one mentor. Ids must be checked by the caller. */
  setMentorPrograms(companyId, mentorId, programIds) {
    const cid = slugify(companyId);
    const tx = db.transaction(() => {
      const keep = new Set(programIds);
      const current = db.prepare(`SELECT program_id FROM program_mentors WHERE mentor_id = ?`)
        .all(mentorId).map(r => r.program_id);
      for (const pid of current) {
        if (!keep.has(pid)) {
          db.prepare(`DELETE FROM program_mentors WHERE program_id = ? AND mentor_id = ?`).run(pid, mentorId);
        }
      }
      const ts = now();
      for (const pid of keep) {
        db.prepare(`
          INSERT OR IGNORE INTO program_mentors (program_id, mentor_id, company_id, added_at)
          VALUES (?, ?, ?, ?)
        `).run(pid, mentorId, cid, ts);
      }
    });
    tx();
    return mentors.get(mentorId);
  },

  /** Puts one mentee into one programme ('' = not assigned). */
  setMenteeProgram(menteeId, programId) {
    db.prepare(`UPDATE mentees SET program_id = ?, updated_at = ? WHERE id = ?`)
      .run(programId || "", now(), menteeId);
    return mentees.get(menteeId);
  }
};

module.exports = {
  companies,
  mentors,
  mentees,
  matchRequests,
  mentorships,
  meetings,
  meetingDuration,
  surveys,
  programs,
  programStatus
};
