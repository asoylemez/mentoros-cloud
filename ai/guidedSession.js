const { generateStructured } = require("./client");
const { scrub } = require("./privacy");

/**
 * ====================================================================
 * REHBERLI SEANS (guided session)
 * ====================================================================
 *
 * NOT: guided_session.html sayfasi `POST /guided-session` cagiriyordu
 * ama bu endpoint eski server.js'te HIC YOKTU - sayfa tamamen kirikti.
 * Burada eksik parca tamamlaniyor.
 *
 * Frontend'in bekledigi cevap sekli (guided_session.html renderAI):
 *   { aiMessage, questions: [], structuredData: {} }
 */

const SYSTEM_PROMPT = `Sen bir mentorluk seansi kolaylastiricisisin.
Mentor ve mentee'nin verimli bir gorusme yapmasina yardim edersin.

GIZLILIK: Sana isim verilmez. Kimseyi ismiyle anma.

YAKLASIMIN:
- Cevap vermezsin, DUSUNDURURSUN. Iyi bir kolaylastirici tavsiye
  yagdirmaz; dogru soruyu sorar.
- Sorularin acik uclu olsun ("evet/hayir" ile cevaplanamasin).
- Somut ol. "Nasil hissediyorsun?" degil, "Gecen ay bu konuda attigin
  en kucuk adim neydi?"
- Kisa tut. Mentor ve mentee'nin konusmasi gerekiyor, senin degil.`;

const SCHEMA = {
  type: "object",
  properties: {
    aiMessage: {
      type: "string",
      description:
        "Bu adim icin 2-3 cumlelik yonlendirme. Ne uzerine " +
        "konusulmasi gerektigini cerceveler."
    },
    questions: {
      type: "array",
      items: { type: "string" },
      description: "Bu adimda konusulacak 3-4 acik uclu soru.",
      minItems: 2
    },
    structuredData: {
      type: "object",
      properties: {
        keyPoints: {
          type: "array",
          items: { type: "string" },
          description: "Konusmadan cikan/cikmasi beklenen ana noktalar."
        },
        suggestedActions: {
          type: "array",
          items: { type: "string" },
          description: "Bir sonraki gorusmeye kadar yapilabilecek somut adimlar."
        },
        watchOuts: {
          type: "array",
          items: { type: "string" },
          description: "Dikkat edilmesi gereken riskler veya tuzaklar."
        }
      }
    }
  },
  required: ["aiMessage", "questions", "structuredData"]
};

const STEP_GUIDES = {
  1: "Acilis: Mentee'nin su anki durumunu ve bu seanstan beklentisini netlestir.",
  2: "Kesif: Gelisim ihtiyacinin altindaki gercek engeli birlikte bul.",
  3: "Secenekler: Denenebilecek somut yaklasimlari masaya yatir.",
  4: "Taahhut: Bir sonraki gorusmeye kadar atilacak adimi netlestir."
};

/**
 * @param {object}   input
 * @param {number}   input.step             Kacinci adim
 * @param {string}   input.userInput        Kullanicinin yazdigi metin
 * @param {object}   input.previousAnswers  Onceki adimlarin ozeti
 * @param {string}   input.developmentNeed  Iliskinin gelisim ihtiyaci
 * @param {string[]} input.knownNames       Maskelenecek isimler
 * @param {string}   input.language
 */
async function generateGuidance({
  step = 1,
  userInput = "",
  previousAnswers = {},
  developmentNeed = "",
  knownNames = [],
  language = "tr"
}) {
  const previousSummary = Object.entries(previousAnswers)
    .map(([stepNo, entry]) => {
      const said = entry?.input || "";
      return said ? `Adim ${stepNo}: ${said}` : null;
    })
    .filter(Boolean)
    .join("\n");

  const prompt = scrub(
    [
      `## SEANS ADIMI: ${step}`,
      STEP_GUIDES[step] || "Seansi ilerlet.",
      "",
      "## ILISKININ GELISIM IHTIYACI",
      developmentNeed || "-",
      "",
      previousSummary ? "## ONCEKI ADIMLARDA KONUSULANLAR" : "",
      previousSummary || "",
      "",
      "## KULLANICININ BU ADIMDA YAZDIKLARI",
      userInput || "-",
      "",
      "## GOREV",
      "Bu adim icin yonlendirme ve sorular uret.",
      `Ciktiyi ${language === "en" ? "Ingilizce" : "Turkce"} yaz.`
    ].filter(Boolean).join("\n"),
    knownNames
  );

  return generateStructured({
    system: SYSTEM_PROMPT,
    prompt,
    toolName: "seans_rehberi",
    schema: SCHEMA,
    maxTokens: 1500
  });
}

module.exports = { generateGuidance };
