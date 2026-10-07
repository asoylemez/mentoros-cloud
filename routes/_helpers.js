const config = require("../config");
const { slugify } = require("../db");

/**
 * Personel API'leri icin kimlik dogrulama.
 *
 * GECERLI SAYILANLAR:
 *   1. Oturum cerezi  -> asil dogrulama. Kullanici giris yapmis.
 *   2. x-api-key      -> betikler / eski istemciler icin.
 *
 * NEDEN OTURUM YETERLI?
 *   x-api-key zaten HTML kaynagi icinde gorunuyordu; gercek bir sir
 *   degildi. Ayrica paketleme sirasinda .env'e RASTGELE bir anahtar
 *   yaziliyor, HTML'dekiyle eslesmiyordu - musteri kurulumunda tum
 *   personel istekleri "Unauthorized" donuyordu.
 *
 *   Oturum cerezi httpOnly'dir, JavaScript okuyamaz ve gercek bir
 *   sifreye dayanir. Dogru dogrulama budur.
 */
function requireApiKey(req, res, next) {
  const staffAuth = require("./staffAuth");

  if (staffAuth.readSession(req)) return next();

  /**
   * x-api-key GECIS YOLU BULUT SURUMUNDE KAPATILDI.
   *
   * O anahtar tum firmalarda ORTAKTI ve HTML kaynaginda gorunuyordu.
   * Tek firmalik kurulumda zararsizdi. Burada ise anahtari bilen biri
   * oturum acmadan istek atabilir - ve oturum olmadigi icin hangi
   * firmaya ait oldugu bilinemez. Yani izolasyonun disinda kalirdi.
   *
   * Artik tek gecerli kimlik oturum cerezidir.
   */
  return res.status(401).json({ error: "Unauthorized" });
}

/**
 * ====================================================================
 * FIRMA KIMLIGI  (izolasyonun kalbi)
 * ====================================================================
 *
 * Bulut surumunde tek kurulum BIRDEN FAZLA firmaya hizmet verir.
 * Butun personel sorgulari bu degere gore kapsanir; yanlis dondurmesi
 * bir firmanin digerinin verisini gormesi demektir.
 *
 * Bu yuzden deger SADECE oturumdan okunur. Istemcinin gonderdigi
 * hicbir sey (query string, header, govde) burada dikkate ALINMAZ -
 * aksi halde kullanici companyId'yi degistirip baska firmanin verisine
 * gecebilirdi.
 *
 * Oturum yoksa firma da yoktur: cagiran katman 401 dondurur.
 */
function getCompanyId(req) {
  const staffAuth = require("./staffAuth");
  const session = staffAuth.readSession(req);

  if (!session || !session.companyId) return null;
  if (session.isSuperAdmin) return null;   // super admin'in kendi verisi yok

  return session.companyId;
}

/**
 * Personel route'lari icin: oturumdaki firmayi dondurur, yoksa 401
 * yazip null doner. Cagiran fonksiyon null gorurse hemen cikmalidir.
 *
 *     const companyId = requireCompany(req, res);
 *     if (!companyId) return;
 */
function requireCompany(req, res) {
  const companyId = getCompanyId(req);

  if (!companyId) {
    res.status(401).json({
      error: "Sign-in required.",
      code: "no_session"
    });
    return null;
  }

  return companyId;
}

/**
 * ====================================================================
 * RECORD OWNERSHIP  (isolation for routes that take a record id)
 * ====================================================================
 *
 * Lists are scoped by company in the SQL. Routes that load ONE record
 * by id (/mentors/:id, /mentorships/:id, ids in a request body ...) read
 * it with a plain "WHERE id = ?" - so the company has to be checked here,
 * after loading. Without it, anyone signed in to one organisation who
 * learns an id (ids travel in approval and workspace links) could read,
 * change or delete another organisation's record.
 *
 * Returns the record when it belongs to the signed-in company. Otherwise
 * it writes the response itself and returns null:
 *   - no session                      -> 401
 *   - missing OR another company's     -> 404, identical in both cases,
 *                                        so the answer does not even
 *                                        reveal that the id exists
 *
 *     const ms = ownRecord(req, res, mentorships.get(id), "Mentorship not found");
 *     if (!ms) return;
 */
function ownRecord(req, res, record, notFoundMessage = "Not found") {
  const companyId = requireCompany(req, res);
  if (!companyId) return null;

  if (!record || record.companyId !== companyId) {
    res.status(404).json({ error: notFoundMessage, code: "not_found" });
    return null;
  }

  return record;
}

/**
 * AI switched off for an organisation (super admin): nothing of theirs is
 * sent to the AI. Writes 403 and returns true when the AI is off.
 */
function refuseIfAiOff(res, companyId) {
  const { companies } = require("../db/repos");
  if (companies.aiEnabled(companyId)) return false;
  res.status(403).json({ error: "AI features are turned off for this organisation.", code: "ai_disabled" });
  return true;
}

/**
 * A mentee in a group is matched together with the group, never alone.
 * Writes 409 and returns true when `mentee` is in a group.
 */
function refuseGroupMember(res, mentee) {
  if (!mentee || !mentee.groupId) return false;
  res.status(409).json({
    error: `This mentee is in the group "${mentee.groupName}" and is matched together with the group, not on their own.`,
    action: "Take the mentee out of the group in the Mentee Registry first.",
    code: "mentee_in_group",
    state: "in_group",
    groupId: mentee.groupId,
    groupName: mentee.groupName
  });
  return true;
}

/**
 * Async route'lardaki hatalari yakalar.
 * Bu olmadan await icindeki bir hata Express 5'te sessizce dusebilir.
 */
function wrap(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);
}

module.exports = { requireApiKey, getCompanyId, requireCompany, ownRecord, refuseGroupMember, refuseIfAiOff, wrap };
