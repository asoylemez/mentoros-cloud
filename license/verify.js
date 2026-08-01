const crypto = require("crypto");

/**
 * ====================================================================
 * LISANS DOGRULAMA
 * ====================================================================
 *
 * TASARIM KARARI: Cevrimdisi, kriptografik dogrulama.
 *
 * NEDEN "SUNUCUYA SORMA" DEGIL?
 *   1. Bu urunun vaadi "tamamen sizin altyapinizda calisir". Her aciliste
 *      disariya baglanan bir sistem bu vaadi bozar.
 *   2. Tedarikcinin sunucusu kapanirsa musterinin sistemi durur. Kabul
 *      edilemez bir bagimlilik.
 *   3. Musterinin agi internete kapali olabilir.
 *
 * NASIL CALISIR?
 *   Tedarikci (siz) bir Ed25519 anahtar cifti uretir. OZEL anahtar sizde
 *   kalir; uygulamaya sadece ACIK anahtar gomulur.
 *
 *   Lisans anahtari = imzalanmis kucuk bir JSON:
 *       { firma, baslangic, bitis, surum }
 *
 *   Uygulama imzayi acik anahtarla dogrular. Internet gerekmez.
 *   Musteri anahtari taklit edemez - ozel anahtar olmadan imza uretilemez.
 *
 * SINIRLARI (durust olmak gerekirse):
 *   Bu bir is anlasmasinin teknik karsiligidir, kararli bir saldirgana
 *   karsi korumaz. Kaynak kodu musteride oldugu icin yeterince istekli
 *   biri kontrolu devre disi birakabilir. Amac dogruyu kolaylastirmak,
 *   yanlisi imkansizlastirmak degil.
 */

// Acik anahtar - scripts/license-tool.js tarafindan yazilir.
// Ozel anahtar ASLA bu depoda bulunmaz.
const PUBLIC_KEY_B64 = require("./publickey");

const PREFIX = "MENTOROS";

function publicKeyObject() {
  if (!PUBLIC_KEY_B64 || PUBLIC_KEY_B64.startsWith("REPLACE")) return null;

  return crypto.createPublicKey({
    key: Buffer.from(
      `-----BEGIN PUBLIC KEY-----\n${PUBLIC_KEY_B64}\n-----END PUBLIC KEY-----`
    ),
    format: "pem"
  });
}

/**
 * Lisans anahtarini dogrular.
 *
 * @param   {string} key   MENTOROS-<payload>.<imza>
 * @returns {object}       { valid, reason?, payload? }
 */
function verify(key) {
  if (!key || typeof key !== "string") {
    return { valid: false, reason: "empty" };
  }

  const cleaned = key.trim().replace(/\s+/g, "");

  if (!cleaned.startsWith(PREFIX + "-")) {
    return { valid: false, reason: "format" };
  }

  const body = cleaned.slice(PREFIX.length + 1);
  const dot = body.lastIndexOf(".");

  if (dot < 1) return { valid: false, reason: "format" };

  const payloadB64 = body.slice(0, dot);
  const sigB64 = body.slice(dot + 1);

  const pub = publicKeyObject();
  if (!pub) return { valid: false, reason: "no_public_key" };

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return { valid: false, reason: "format" };
  }

  let signatureOk = false;
  try {
    signatureOk = crypto.verify(
      null,
      Buffer.from(payloadB64),
      pub,
      Buffer.from(sigB64, "base64url")
    );
  } catch {
    return { valid: false, reason: "tampered" };
  }

  if (!signatureOk) return { valid: false, reason: "tampered" };

  return { valid: true, payload };
}

/** Panelde gosterilecek kisa hali: MENTOROS-eyJ...W9Q */
function mask(key) {
  if (!key) return "";
  const s = String(key).trim();
  if (s.length <= 28) return s;
  return `${s.slice(0, 18)}…${s.slice(-6)}`;
}

module.exports = { verify, mask, PREFIX };
