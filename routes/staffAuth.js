const crypto = require("crypto");
const path = require("path");

/**
 * ====================================================================
 * PERSONEL OTURUMU
 * ====================================================================
 *
 * PROBLEM:
 *   Tum HTML sayfalari /public klasorunden statik olarak sunuluyordu.
 *   Yani bir mentor, adres cubuguna /hr_dashboard.html yazip butun
 *   mentorlari, eslesmeleri ve gelisim ihtiyaclarini gorebiliyordu.
 *
 * COZUM:
 *   IK sayfalari artik statik degil. Sadece firma girisi yapmis birine
 *   sunulurlar. Giris /company-login ile yapilir (bcrypt), sunucu bir
 *   oturum cerezi birakir.
 *
 * NOT:
 *   Bu, sayfalara erisimi kapatir. Sayfalarin ICINDEKI paylasimli
 *   API anahtari da ancak giris yapmis birine ulasir. Mentor ve mentee
 *   sayfalari (kayit, onay, calisma alani) artik o anahtari hic
 *   tasimaz - kendi token'larini kullanirlar.
 */

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;   // 8 saat (bir is gunu)
const COOKIE_NAME = "mentoros_staff";

const sessions = new Map();     // token -> { companyId, companyName, expiresAt }

function createSession(companyId, companyName, options = {}) {
  const token = crypto.randomBytes(32).toString("base64url");

  sessions.set(token, {
    companyId,
    companyName,
    isSuperAdmin: !!options.isSuperAdmin,
    expiresAt: Date.now() + SESSION_TTL_MS
  });

  return token;
}

function readSession(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;

  const session = sessions.get(token);
  if (!session) return null;

  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }

  /**
   * FIRMA HALA GECERLI MI?
   *
   * Oturum 8 saat yasar. Super admin bu sure icinde firmayi pasife
   * alabilir veya erisim suresi dolabilir. Sadece giriste kontrol
   * etseydik, firma acik oturumuyla saatlerce calismaya devam ederdi.
   *
   * Bu yuzden her okumada tekrar bakiyoruz. Sorgu tek satirlik ve
   * indeksli (primary key) - maliyeti ihmal edilebilir.
   */
  if (!session.isSuperAdmin) {
    const { companies } = require("../db/repos");
    if (!companies.isUsable(session.companyId).ok) {
      sessions.delete(token);
      return null;
    }
  }

  // Kullanildikca uzat
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return { token, ...session };
}

/** Belirli bir firmanin TUM acik oturumlarini kapatir. */
function destroySessionsForCompany(companyId) {
  for (const [token, s] of sessions) {
    if (s.companyId === companyId && !s.isSuperAdmin) sessions.delete(token);
  }
}

function destroySession(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (token) sessions.delete(token);
}

function setCookie(res, token) {
  const config = require("../config");

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,          // JavaScript okuyamaz -> XSS ile calinamaz
    sameSite: "lax",
    maxAge: SESSION_TTL_MS,
    path: "/",

    /**
     * HTTPS uzerinde cerez sadece sifreli baglantida gonderilir.
     *
     * Bulut kurulumunda ZORUNLU: aksi halde oturum cerezi acik
     * baglantida yakalanabilir. Yerel gelistirmede (http://localhost)
     * kapali olmali, yoksa tarayici cerezi hic kaydetmez ve giris
     * "sessizce" calismaz gorunur.
     */
    secure: config.secureCookies
  });
}

function clearCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

/**
 * Personel sayfalarini sunar. Oturum yoksa giris ekranina yonlendirir.
 * Sayfalar /views/staff icinde durur - statik olarak YAYINLANMAZ.
 */
function noCompaniesYet() {
  try {
    const { db } = require("../db");
    return db.prepare(`SELECT COUNT(*) AS n FROM companies`).get().n === 0;
  } catch {
    return false;
  }
}

/**
 * Personel sayfalarini sunar. Oturum yoksa giris ekranina yonlendirir.
 *
 * NOT: super_admin.html BU YOLLA SUNULMAZ. O sayfanin kendi kapisi var
 * (yonetici sifresi), cunku firma oturumu olan biri - yani bir musteri -
 * asla firma yonetimi ekranini gormemeli.
 */
function serveStaffPage(fileName) {
  return (req, res) => {
    const session = readSession(req);

    if (!session) {
      const next = encodeURIComponent(req.originalUrl);
      return res.redirect(`/login.html?next=${next}`);
    }

    /**
     * Super admin'in kendi firma verisi yoktur. IK sayfalarini acarsa
     * bos/kirik bir ekran gorurdu - onun yerine acikca yonlendiriyoruz.
     */
    if (session.isSuperAdmin) {
      return res.redirect("/super_admin.html");
    }

    res.sendFile(path.join(__dirname, "..", "views", "staff", fileName));
  };
}

/**
 * Super admin API'leri icin.
 *
 * Firma yonetimi (olusturma, sure uzatma, silme) SADECE tedarikciye
 * aittir. Bir musterinin bu uclara ulasmasi, diger musterileri
 * gorebilmesi demektir - o yuzden ayri bir kapi.
 */
function requireSuperAdmin(req, res, next) {
  const session = readSession(req);

  if (!session || !session.isSuperAdmin) {
    return res.status(403).json({
      error: "Administrator access required.",
      code: "not_super_admin"
    });
  }

  req.staff = session;
  next();
}

/** Personel API'leri icin: oturum ZORUNLU. */
function requireStaff(req, res, next) {
  const session = readSession(req);

  if (!session) {
    return res.status(401).json({
      error: "Sign-in required.",
      code: "no_session"
    });
  }

  req.staff = session;
  next();
}

// Suresi dolmus oturumlari temizle
setInterval(() => {
  const now = Date.now();
  for (const [token, s] of sessions) {
    if (s.expiresAt < now) sessions.delete(token);
  }
}, 15 * 60 * 1000).unref();

module.exports = {
  COOKIE_NAME,
  noCompaniesYet,
  createSession,
  readSession,
  destroySession,
  destroySessionsForCompany,
  setCookie,
  clearCookie,
  serveStaffPage,
  requireStaff,
  requireSuperAdmin
};
