const { generateStructured } = require("./client");
const { scrub } = require("./privacy");

/**
 * ====================================================================
 * GELISIM PLANI URETICI
 * ====================================================================
 *
 * ESKI SURUMDEKI GIZLILIK ACIGI:
 *   Prompt icinde `Mentee name: ${menteeName}` ve
 *   `Mentor name: ${mentorName}` satirlari vardi - yani calisma
 *   sayfasinda hedefler uretilirken iki kisinin de GERCEK ADI
 *   OpenAI'a gonderiliyordu. Halbuki plan uretmek icin isme hic
 *   ihtiyac yok; sadece rol ve gelisim ihtiyaci yeterli.
 *
 * Yeni surumde isim hic gonderilmiyor.
 */

const SYSTEM_PROMPT = `Sen kurumsal bir Insan Kaynaklari mentorluk asistanisin.
Bir mentor-mentee iliskisi icin pratik, is odakli bir gelisim plani
hazirlarsin.

GIZLILIK: Sana kimse hakkinda isim verilmez, istemezsin de. Sadece rol
ve gelisim ihtiyaci uzerinden calisirsin.

ILKELER:
- Hedefler somut ve eyleme donuk olmali. "Iletisimi gelistirmek" degil,
  "Ceyrek sonunda ekip toplantilarini kendisi yonetebilir hale gelmek".
- Gelisim alanlari kisa yetkinlik adlari olmali.
- Basari kriterleri GOZLEMLENEBILIR olmali; mentor ve mentee bir
  toplantida "bu oldu mu?" diye bakip cevaplayabilmeli.
- 3-6 aylik bir mentorluk sureci varsay.
- Genel gecer klise yazma. Verilen gelisim ihtiyacina ozel ol.`;

const SCHEMA = {
  type: "object",
  properties: {
    developmentGoals: {
      type: "array",
      items: { type: "string" },
      description: "3-4 adet somut, eyleme donuk gelisim hedefi.",
      minItems: 2
    },
    developmentAreas: {
      type: "array",
      items: { type: "string" },
      description: "3-5 adet kisa yetkinlik adi.",
      minItems: 2
    },
    successCriteria: {
      type: "array",
      items: { type: "string" },
      description: "3-4 adet gozlemlenebilir basari kriteri.",
      minItems: 2
    }
  },
  required: ["developmentGoals", "developmentAreas", "successCriteria"]
};

/**
 * @param {object} input
 * @param {string} input.menteeRole
 * @param {string} input.menteeDepartment
 * @param {string} input.developmentNeed
 * @param {string} input.mentorRole        (opsiyonel, isim DEGIL)
 * @param {string} input.language
 * @param {string[]} input.knownNames      Maskelenecek isimler
 */
async function generateDevelopmentPlan({
  menteeRole = "",
  menteeDepartment = "",
  developmentNeed = "",
  mentorRole = "",
  language = "tr",
  knownNames = []
}) {
  const prompt = scrub(
    [
      "## MENTEE",
      `Rol/Unvan: ${menteeRole || "-"}`,
      `Departman: ${menteeDepartment || "-"}`,
      "",
      "## MENTOR",
      `Rol/Unvan: ${mentorRole || "-"}`,
      "",
      "## GELISIM IHTIYACI",
      developmentNeed || "-",
      "",
      "## GOREV",
      "Bu iliski icin bir gelisim plani hazirla.",
      `Ciktiyi ${language === "en" ? "Ingilizce" : "Turkce"} yaz.`
    ].join("\n"),
    knownNames
  );

  return generateStructured({
    system: SYSTEM_PROMPT,
    prompt,
    toolName: "gelisim_plani",
    schema: SCHEMA,
    maxTokens: 1500
  });
}

module.exports = { generateDevelopmentPlan };
