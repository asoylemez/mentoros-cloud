/**
 * ====================================================================
 * MENTEE GELISIM IHTIYACI METNI
 * ====================================================================
 *
 * Kayitli bir mentee kaydini, hem yapay zekanin okuyacagi hem de onay
 * e-postasinda gorunecek TEK bir ihtiyac metnine cevirir.
 *
 * NEDEN SUNUCUDA?
 *   1) GIZLILIK: Metin AI sinirina en yakin yerde, tek bir noktada
 *      uretilir. Tarayicida uretilseydi her sayfa kendi versiyonunu
 *      kurar ve bir gun biri yanlislikla isim/eposta ekleyebilirdi.
 *   2) TUTARLILIK: /match (puanlama) ve /match-request (talep kaydi)
 *      AYNI metni kullanir. Boylece yoneticinin onay e-postasinda
 *      gordugu ihtiyac ile AI'in degerlendirdigi ihtiyac ayni olur.
 *
 * KIMLIK BILGISI BURAYA GIRMEZ:
 *   fullName, email, managerName, managerEmail alanlari BILEREK
 *   disarida birakilmistir. Bu fonksiyon sadece "ne gelistirmek
 *   istiyor" sorusunu cevaplar.
 */

const LABELS = {
  tr: {
    developmentNeeds: "Gelisim ihtiyaci",
    challenge: "Su anki zorluk",
    devAreas: "Gelisim alanlari",
    competencies: "Gelistirmek istedigi yetkinlikler",
    goals: "Kariyer hedefi",
    expectations: "Mentorluktan beklentisi",
    role: "Rol/Unvan",
    department: "Departman",
    band: "Kademe",
    tenure: "Kidem",
    languages: "Diller",
    formats: "Tercih ettigi format",
    preferredMentor: "Tercih ettigi mentor profili",
    hours: "Ayirabilecegi sure (aylik)",
    message: "Ek not"
  },
  en: {
    developmentNeeds: "Development need",
    challenge: "Current challenge",
    devAreas: "Development areas",
    competencies: "Competencies to develop",
    goals: "Career goal",
    expectations: "Expectations from mentoring",
    role: "Role/Title",
    department: "Department",
    band: "Band",
    tenure: "Tenure",
    languages: "Languages",
    formats: "Preferred format",
    preferredMentor: "Preferred mentor profile",
    hours: "Available hours (monthly)",
    message: "Additional note"
  }
};

/** Diziyi "a, b, c" haline getirir; bos ise null. */
function joinList(value, extra) {
  const items = Array.isArray(value) ? value.filter(Boolean) : [];
  const text = String(extra || "").trim();
  if (text) items.push(text);
  return items.length ? items.join(", ") : null;
}

/** Bos/anlamsiz degerleri eler. */
function clean(value) {
  const text = String(value == null ? "" : value).trim();
  return text && text !== "-" ? text : null;
}

/**
 * Mentee kaydini ihtiyac metnine cevirir.
 *
 * @param {object} mentee   mentees repo'sundan gelen kayit
 * @param {string} language "tr" | "en"  (sadece etiketler icin)
 * @returns {string}        Bos alanlar HIC yazilmaz.
 */
function composeMenteeNeed(mentee, language = "tr") {
  if (!mentee) return "";

  const L = LABELS[language === "en" ? "en" : "tr"];

  const rows = [
    [L.role, clean(mentee.role)],
    [L.department, clean(mentee.department)],
    [L.band, clean(mentee.band)],
    [L.tenure, clean(mentee.tenure)],
    [L.developmentNeeds, clean(mentee.developmentNeeds)],
    [L.challenge, clean(mentee.challenge)],
    [L.devAreas, joinList(mentee.devFunctionalAreas, mentee.devAreasExtra)],
    [L.competencies, joinList(mentee.competenciesToDevelop, mentee.compExtra)],
    [L.goals, clean(mentee.goals)],
    [L.expectations, clean(mentee.expectations)],
    [L.preferredMentor, joinList(mentee.preferredMentorProfile)],
    [L.formats, joinList(mentee.formats)],
    [L.languages, joinList(mentee.languages)],
    [L.hours, clean(mentee.hoursPerMonth)],
    [L.message, clean(mentee.message)]
  ];

  // Bos alan YAZILMAZ. "Hedefler: -" gibi satirlar hem AI'i yaniltir
  // hem de onay e-postasini gereksiz uzatir.
  return rows
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}

/**
 * Listede/kartta gosterilecek KISA ozet (tam metin degil).
 * Sadece arayuz icindir; AI'a bu gitmez.
 */
function shortNeedSummary(mentee, maxLength = 160) {
  if (!mentee) return "";

  const source =
    clean(mentee.developmentNeeds) ||
    clean(mentee.goals) ||
    clean(mentee.challenge) ||
    joinList(mentee.devFunctionalAreas, mentee.devAreasExtra) ||
    joinList(mentee.competenciesToDevelop, mentee.compExtra) ||
    "";

  const text = String(source).replace(/\s+/g, " ").trim();
  return text.length > maxLength ? text.slice(0, maxLength - 1) + "…" : text;
}

module.exports = { composeMenteeNeed, shortNeedSummary };
