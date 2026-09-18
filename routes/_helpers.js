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
 * Async route'lardaki hatalari yakalar.
 * Bu olmadan await icindeki bir hata Express 5'te sessizce dusebilir.
 */
function wrap(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);
}

module.exports = { requireApiKey, getCompanyId, requireCompany, wrap };
