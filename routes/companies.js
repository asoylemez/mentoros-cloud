const express = require("express");
const config = require("../config");
const { companies } = require("../db/repos");
const { slugify } = require("../db");
const { wrap } = require("./_helpers");
const staffAuth = require("./staffAuth");

// Kaba kuvvet korumasi
const loginAttempts = new Map();

const router = express.Router();

// Firma olustur / guncelle  (SADECE super admin)
router.post("/companies", staffAuth.requireSuperAdmin, wrap(async (req, res) => {
  const { companyId, name, domain, password, status, expiresAt } = req.body;

  if (!companyId) {
    return res.status(400).json({ error: "companyId is required" });
  }
  if (!password) {
    return res.status(400).json({ error: "password is required" });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const slug = slugify(companyId);

  if (!slug) {
    return res.status(400).json({
      error: "Kullanici adi harf ve rakam icermeli. / Username must contain letters or digits."
    });
  }

  // Rezerve ad: yonetici girisinin golgelenmesini onler.
  if (slug === config.superAdminUser) {
    return res.status(400).json({
      error: `"${config.superAdminUser}" rezerve bir kullanici adidir. / Reserved username.`
    });
  }

  /**
   * VAR OLAN FIRMANIN UZERINE YAZILMASINI ENGELLE.
   *
   * repos.create() ON CONFLICT ile gunceller. Bu, "yeni firma ekle"
   * formunda mevcut bir adi yazan birinin o firmanin sifresini
   * SESSIZCE degistirmesi demekti - musteri ertesi gun giremezdi ve
   * sebebi hicbir yerde gorunmezdi. Guncelleme icin PATCH var.
   */
  if (companies.exists(slug)) {
    return res.status(409).json({
      error: `"${slug}" zaten kayitli. / This username already exists.`,
      code: "already_exists"
    });
  }

  const company = companies.create({
    companyId: slug, name, domain, password, status, expiresAt
  });

  res.json({ success: true, companyId: company.companyId, company });
}));

// Firma listesi (sifre hash'i asla donmez) - SADECE super admin
router.get("/companies", staffAuth.requireSuperAdmin, wrap(async (req, res) => {
  res.json(companies.list());
}));

/**
 * Firma bilgilerini guncelle.
 *
 * Sifre alani BOS birakilirsa mevcut sifre KORUNUR. Boylece sadece
 * adi degistirmek isteyen biri kazara sifreyi sifirlamaz.
 */
router.patch("/companies/:id", staffAuth.requireSuperAdmin, wrap(async (req, res) => {
  const { name, domain, status, password, expiresAt } = req.body;

  if (password && String(password).length < 8) {
    return res.status(400).json({
      error: "Password must be at least 8 characters."
    });
  }

  const updated = companies.update(req.params.id, {
    name, domain, status, password, expiresAt
  });

  if (!updated) {
    return res.status(404).json({ error: "Company not found" });
  }

  /**
   * Sifre degistiyse veya firma kapatildiysa ACIK OTURUMLARI DUSUR.
   *
   * Aksi halde sifreyi degistirmek hicbir sey yapmazdi: eski oturum
   * 8 saat daha calismaya devam ederdi. Sifre degistirmenin amaci
   * genelde tam olarak birini disari almaktir.
   */
  if (password || status === "inactive" || expiresAt !== undefined) {
    staffAuth.destroySessionsForCompany(updated.companyId);
  }

  res.json({
    success: true,
    message: "Company updated",
    passwordChanged: !!password,
    company: updated
  });
}));

/**
 * Firmayi sil.
 *
 * GUVENLIK AGI: Firmanin mentorlari/iliskileri varsa once uyari doneriz.
 * Silmek hepsini yok eder (cascade) ve geri alinamaz.
 */
router.delete("/companies/:id", staffAuth.requireSuperAdmin, wrap(async (req, res) => {
  const company = companies.get(req.params.id);
  if (!company) {
    return res.status(404).json({ error: "Company not found" });
  }

  const counts = companies.counts(req.params.id);
  const total = counts.mentors + counts.mentees + counts.mentorships + counts.meetings;
  const force = req.query.force === "true";

  if (total > 0 && !force) {
    return res.status(409).json({
      error: "This company still has data.",
      code: "has_data",
      counts,
      warning:
        `"${company.name}" hesabini silmek ${counts.mentors} mentor, ` +
        `${counts.mentees} mentee, ${counts.mentorships} eslesme ve ` +
        `${counts.meetings} toplanti notunu KALICI olarak siler. ` +
        `Bu islem geri alinamaz. Bunun yerine hesabi "pasif" yapmayi dusunun.`
    });
  }

  const removed = companies.remove(req.params.id);

  res.json({
    success: true,
    message: `Company "${removed.name}" deleted`,
    deleted: removed.deleted
  });
}));

/**
 * ====================================================================
 * GIRIS  (tek kullanici)
 * ====================================================================
 */
router.post("/login", wrap(async (req, res) => {
  const ip = req.ip || "unknown";
  const rec = loginAttempts.get(ip);

  if (rec && rec.until > Date.now()) {
    const min = Math.ceil((rec.until - Date.now()) / 60000);
    return res.status(429).json({
      success: false,
      error: `Too many failed attempts. Try again in ${min} minute(s).`
    });
  }

  const { username, password } = req.body;

  /**
   * SUPER ADMIN GIRISI
   *
   * Ayri bir giris sayfasi yok - ayni form. Kullanici adi rezerve
   * edilmistir ve firma olarak olusturulamaz (asagidaki create
   * kontrolune bakiniz), yoksa biri "superadmin" adinda firma acip
   * girisi ele gecirebilirdi.
   *
   * Sifre .env icindeki ADMIN_PASSWORD_HASH'tir. Firma sifreleriyle
   * hicbir ilgisi yoktur.
   */
  if (String(username || "").trim().toLowerCase() === config.superAdminUser) {
    const hash = config.adminPasswordHash;

    if (!hash) {
      return res.status(503).json({
        success: false,
        error: "Yonetici sifresi ayarlanmamis. / Administrator password is not set.",
        detail: "Sunucuda calistirin: npm run set-admin-password"
      });
    }

    const ok = require("bcryptjs").compareSync(String(password || ""), hash);

    if (!ok) {
      const r = loginAttempts.get(ip) || { count: 0 };
      r.count++;
      if (r.count >= 8) r.until = Date.now() + 15 * 60 * 1000;
      loginAttempts.set(ip, r);

      return res.status(401).json({
        success: false,
        error: "Username or password is incorrect."
      });
    }

    loginAttempts.delete(ip);

    const token = staffAuth.createSession(config.superAdminUser, "Administrator", {
      isSuperAdmin: true
    });
    staffAuth.setCookie(res, token);

    return res.json({
      success: true,
      isSuperAdmin: true,
      redirect: "/super_admin.html"
    });
  }

  const result = companies.verifyLogin(username, password);

  if (!result.ok) {
    /**
     * Sure dolmasi ve pasiflik kaba kuvvet SAYILMAZ.
     *
     * Dogru sifreyi giren bir musteriyi, sirf suresi doldugu icin
     * defalarca deneyip kendini 15 dakika kilitlemeye zorlamak
     * anlamsiz olurdu. Ayrica ona nedenini soylememiz gerekir -
     * yoksa sifresini yanlis hatirladigini sanip ugrasir durur.
     */
    if (result.reason === "expired") {
      return res.status(403).json({
        success: false,
        code: "expired",
        error:
          "Bu hesabin erisim suresi doldu. / This account's access period has ended.",
        detail:
          "Verileriniz duruyor. Sureyi uzatmak icin yoneticinizle iletisime gecin. / " +
          "Your data is intact. Contact your administrator to extend access."
      });
    }

    if (result.reason === "inactive") {
      return res.status(403).json({
        success: false,
        code: "inactive",
        error: "Bu hesap pasif durumda. / This account is inactive.",
        detail: "Yoneticinizle iletisime gecin. / Please contact your administrator."
      });
    }

    const r = loginAttempts.get(ip) || { count: 0 };
    r.count++;
    if (r.count >= 8) r.until = Date.now() + 15 * 60 * 1000;
    loginAttempts.set(ip, r);

    return res.status(401).json({
      success: false,
      error: "Username or password is incorrect."
    });
  }

  loginAttempts.delete(ip);

  const token = staffAuth.createSession(result.companyId, result.name);
  staffAuth.setCookie(res, token);

  res.json({
    success: true,
    companyId: result.companyId,
    companyName: result.name,
    username: result.name,
    expiresAt: result.expiresAt,
    daysLeft: result.daysLeft
  });
}));

/**
 * Firma kendi sifresini degistirir.
 *
 * Kullanici adi (company_id) DEGISTIRILEMEZ - o, verinin tum
 * tablolardaki anahtaridir. Degistirmek firmanin butun kayitlarini
 * kopariр gorunmez yapardi. Isim degisikligi super admin panelinden,
 * "name" alani uzerinden yapilir.
 */
router.post("/change-password", staffAuth.requireStaff, wrap(async (req, res) => {
  if (req.staff.isSuperAdmin) {
    return res.status(400).json({
      error: "Yonetici sifresi buradan degistirilmez."
    });
  }

  const { currentPassword, newPassword } = req.body;

  const check = companies.verifyLogin(req.staff.companyId, currentPassword);
  if (!check.ok) {
    return res.status(400).json({ error: "Your current password is incorrect." });
  }

  if (String(newPassword || "").length < 8) {
    return res.status(400).json({
      error: "The new password must be at least 8 characters."
    });
  }

  companies.update(req.staff.companyId, { password: String(newPassword) });

  res.json({ success: true });
}));

/** Giris ekrani / uyari bandi icin. */
router.get("/auth-status", wrap(async (req, res) => {
  const session = staffAuth.readSession(req);

  if (!session) return res.json({ authenticated: false });

  const company = companies.get(session.companyId);

  res.json({
    authenticated: true,
    isSuperAdmin: !!session.isSuperAdmin,
    username: session.companyName,
    companyId: session.companyId,
    expiresAt: company?.expiresAt || "",
    daysLeft: company ? companies.daysLeft(company.expiresAt) : null
  });
}));

// Cikis
router.post("/company-logout", wrap(async (req, res) => {
  staffAuth.destroySession(req);
  staffAuth.clearCookie(res);
  res.json({ success: true });
}));

// Tarayici "giris yapmis miyim?" diye sorabilsin
router.get("/session", wrap(async (req, res) => {
  const session = staffAuth.readSession(req);

  if (!session) return res.json({ authenticated: false });

  const company = session.isSuperAdmin ? null : companies.get(session.companyId);

  res.json({
    authenticated: true,
    isSuperAdmin: !!session.isSuperAdmin,
    username: session.companyName,
    companyId: session.companyId,
    companyName: session.companyName,
    expiresAt: company?.expiresAt || "",
    daysLeft: company ? companies.daysLeft(company.expiresAt) : null
  });
}));

// --- Mentor davet linki (IK paylasir) ---

router.get("/invite-link", staffAuth.requireStaff, wrap(async (req, res) => {
  const token = companies.getInviteToken(req.staff.companyId);

  res.json({
    inviteUrl: `${config.siteBaseUrl}/register.html?invite=${token}`
  });
}));

// Token sizdiysa yenile -> eski link aninda gecersiz olur.
router.post("/invite-link/rotate", staffAuth.requireStaff, wrap(async (req, res) => {
  const token = companies.rotateInviteToken(req.staff.companyId);

  res.json({
    success: true,
    inviteUrl: `${config.siteBaseUrl}/register.html?invite=${token}`
  });
}));

module.exports = router;
