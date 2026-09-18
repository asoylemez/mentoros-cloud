/**
 * ====================================================================
 * GIZLILIK KATMANI
 * ====================================================================
 *
 * Eski surumdeki problem:
 *   Anonimlik AI_MATCHING_MODE=anonymous env degiskenine bagliydi.
 *   Bu degisken unutulursa mentor isimleri ve e-postalari sessizce
 *   OpenAI'a gidiyordu. Ayrica /development-plan endpoint'i mentor ve
 *   mentee isimlerini prompt'a acikca yaziyordu.
 *
 * Yeni yaklasim:
 *   1) Mentor profilleri AI icin ayri bir fonksiyonla insa edilir ve
 *      bu fonksiyon isim/eposta alanlarina hic dokunmaz. Yani sizinti
 *      "unutmakla" degil, ancak kodu bilerek degistirmekle mumkun.
 *   2) Serbest metinler (IK'nin yazdigi gelisim ihtiyaci gibi) ayrica
 *      scrub() fonksiyonundan gecer; icine kacan isim/eposta/telefon
 *      maskelenir.
 *   3) ai/client.js, scrub()'dan gecmemis hicbir metni gondermez.
 */

// --- Maskeleme kaliplari ---------------------------------------------

const PATTERNS = [
  // E-posta
  { re: /[\w.+-]+@[\w-]+\.[\w.-]+/g, tag: "[EPOSTA]" },

  // Telefon (TR ve uluslararasi yaygin bicimler)
  { re: /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}\b/g,
    tag: "[TELEFON]" },

  // TC Kimlik No (11 hane)
  { re: /\b[1-9]\d{10}\b/g, tag: "[KIMLIK]" },

  // URL
  { re: /https?:\/\/\S+/g, tag: "[LINK]" },

  // @kullanici
  { re: /(^|\s)@[\w.]+/g, tag: "$1[KULLANICI]" }
];

/**
 * Bilinen isimleri metinden temizler.
 * Ornek: IK "Ayse'nin ekibiyle sorun yasiyor" yazdiysa ve Ayse
 * sistemdeki bir mentee ise, "Ayse" -> "[ISIM]" olur.
 *
 * Turkce ek almis halleri de yakalar (Ayse'nin, Ayseyle, Ayse'ye...).
 */
function buildNamePattern(names) {
  const parts = [];

  for (const fullName of names) {
    if (!fullName) continue;

    for (const token of String(fullName).trim().split(/\s+/)) {
      // 3 harften kisa parcalari atla (yanlis eslesme uretir)
      if (token.length < 3) continue;
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Kelime basi + opsiyonel Turkce ek (kesme isaretli veya bitisik)
      parts.push(`${escaped}(?:['’]?\\w{0,4})?`);
    }
  }

  if (!parts.length) return null;
  return new RegExp(`\\b(?:${parts.join("|")})\\b`, "gi");
}

/**
 * Metni AI'a gonderilebilir hale getirir.
 *
 * @param {string}   text            Ham metin
 * @param {string[]} knownNames      Maskelenecek bilinen isimler (opsiyonel)
 * @returns {string}                 Temizlenmis metin
 */
function scrub(text, knownNames = []) {
  const config = require("../config");

  let out = String(text || "");

  if (!config.privacy.scrubPii) return out.trim();

  // 1) Bilinen isimler
  const namePattern = buildNamePattern(knownNames);
  if (namePattern) {
    out = out.replace(namePattern, "[ISIM]");
  }

  // 2) Genel kaliplar
  for (const { re, tag } of PATTERNS) {
    out = out.replace(re, tag);
  }

  return out.trim();
}

/**
 * Bir mentor kaydindan AI'a gonderilecek ANONIM profil metnini uretir.
 *
 * Bu fonksiyon fullName, email, id gibi alanlara BILEREK hic dokunmaz.
 * Yeni bir kimlik alani eklersen, buraya eklememeye dikkat et.
 */
function anonymizeMentor(mentor, code, knownNames = []) {
  const list = arr => (Array.isArray(arr) && arr.length ? arr.join(", ") : "-");

  // Mentor kendi adini (veya baska bir mentorun adini) serbest metne
  // yazmis olabilir. Bilinen isimler maskelenir; mentorun kendi adi
  // listede olmasa bile eklenir.
  const names = [...knownNames, mentor.fullName].filter(Boolean);
  const clean = text => scrub(text, names);
  // Liste + mentorun elle yazdigi ek (serbest metin -> scrub'dan gecer)
  const withExtra = (arr, extra) => {
    const items = Array.isArray(arr) ? arr.filter(Boolean) : [];
    const text = clean(extra);
    if (text) items.push(text);
    return items.length ? items.join(", ") : "-";
  };

  const lines = [
    `Kod: ${code}`,
    `Rol/Unvan: ${mentor.role || "-"}`,
    // Kademe kayit formlarindan kaldirildi; sadece eski kayitlarda dolu.
    // Bossa satir hic yazilmaz ("Kademe: -" AI'i yaniltmasin).
    ...(mentor.band ? [`Kademe: ${mentor.band}`] : []),
    `Kidem: ${mentor.tenure || "-"}`,
    `Fonksiyonel alanlar: ${withExtra(mentor.functionalAreas, mentor.functionalAreasExtra)}`,
    `Sektorler: ${withExtra(mentor.industries, mentor.industriesExtra)}`,
    `Davranissal yetkinlikler: ${list(mentor.behaviouralCompetencies)}`,
    `Teknik yetkinlikler: ${list(mentor.technicalCompetencies)}`,
    `Beceriler: ${list(mentor.skills)}`,
    `Deneyim alanlari: ${list(mentor.experienceAreas)}`,
    `Calisabilecegi mentee seviyeleri: ${list(mentor.menteeLevels)}`,
    `Formatlar: ${list(mentor.formats)}`,
    `Diller: ${list(mentor.languages)}`,
    `Bos kapasite: ${mentor.remainingCapacity ?? 0}`,
    `Kariyer ozeti: ${clean(mentor.careerBio)}`,
    `Mentorluk yaklasimi: ${clean(mentor.mentorProfile)}`,
    `Yetkinlik aciklamasi: ${clean(mentor.competencyDescription)}`,
    `Ek yetkinlikler: ${clean(mentor.additionalCompetencies)}`
  ];

  return lines.join("\n");
}

/**
 * Guvenlik agi: AI'a gitmek uzere olan bir metinde hala kimlik
 * bilgisi kaliyor mu diye son bir kontrol. Kalirsa firlatir.
 * (client.js her cagriden once bunu calistirir.)
 */
function assertClean(text) {
  const config = require("../config");
  if (!config.privacy.scrubPii) return;

  const leaks = [];

  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(text)) leaks.push("e-posta");
  if (/\b[1-9]\d{10}\b/.test(text)) leaks.push("kimlik numarasi");

  if (leaks.length) {
    throw new Error(
      `Gizlilik ihlali engellendi: AI'a gonderilecek metinde ` +
      `${leaks.join(", ")} tespit edildi. Istek iptal edildi.`
    );
  }
}

module.exports = { scrub, anonymizeMentor, assertClean };
