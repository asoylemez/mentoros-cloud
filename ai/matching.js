const { generateStructured } = require("./client");
const { scrub, anonymizeMentor } = require("./privacy");

/**
 * ====================================================================
 * ESLESTIRME MOTORU
 * ====================================================================
 *
 * Yaklasim: Claude tum anonim mentor profillerini okur, mentee'nin
 * gelisim ihtiyaciyla karsilastirir ve GEREKCELI puan verir.
 *
 * Embedding kullanilmiyor. 10-100 mentor icin bu hem daha basit hem
 * daha kaliteli: embedding sadece vektor yakinligina bakar, akil
 * yurutemez ve gerekce uretemez. (Mentor havuzu birkac yuzu asarsa
 * onune bir on-eleme katmani eklenebilir - mimari buna hazir.)
 *
 * ESKI SURUMDEN DUZELTILEN HATALAR:
 *   1) Skor 100'u asabiliyordu (keywordScore sinirsizdi). Artik
 *      tum skorlar 0-100 arasinda.
 *   2) capacity string ise Number() -> NaN -> herkese -50 ceza.
 *      Artik kapasite DB'de INTEGER ve ayri bir sinyal olarak
 *      degerlendiriliyor, gizli ceza yok.
 *   3) Keyword eslesmesi substring ile yapiliyordu ("veri" kelimesi
 *      "verimlilik" icinde eslesip yanlis pozitif uretiyordu).
 *      Kaldirildi - Claude zaten anlamsal eslestirme yapiyor.
 */

const SYSTEM_PROMPT = `Sen kurumsal bir Insan Kaynaklari mentorluk asistanisin.
Gorevin: bir mentee'nin gelisim ihtiyaci ile aday mentorlarin profillerini
karsilastirip en uygun mentorlari gerekceli olarak siralamak.

KATI GIZLILIK KURALLARI:
- Mentorlar sana yalnizca anonim kodlarla (M1, M2, ...) verilir.
- Isim, e-posta, sirket adi veya baska kimlik bilgisi isteme.
- Ciktinda sadece bu anonim kodlari kullan.
- Metinde kimlik bilgisi gorursen yok say.

DEGERLENDIRME KRITERLERI (onem sirasiyla):
1. Mentorun deneyim ve yetkinliklerinin, mentee'nin gelisim ihtiyacini
   dogrudan karsilayip karsilamadigi.
2. Mentorun kademe/kidem seviyesinin mentee icin uygun olup olmadigi
   (mentor genelde bir-iki kademe uzeride olmali).
3. Ortak dil ve calisma formati uyumu.
4. Mentorun bos kapasitesi olup olmadigi.

PUANLAMA - 0-100 arasi tam sayi. Su capalari kullan:

  85-100  Cok guclu eslesme. Mentorun deneyimi ihtiyaci dogrudan karsiliyor.
  70-84   Guclu eslesme. Onemli ortusmeler var, birkac eksik nokta olabilir.
  55-69   Makul eslesme. Kismi ortusme; bazi alanlarda yardimci olabilir.
  40-54   Zayif eslesme. Sinirli ortusme, ancak yine de bir katki sunabilir.
  0-39    Uygun degil.

ONEMLI:
- Puanlarin AYRISTIRICI olsun. Herkese 70 vermek degerlendirmeyi
  anlamsizlastirir; ama herkesi 30'un altina cekmek de yardimci olmaz.
- Havuzdaki en iyi aday, mukemmel olmasa bile digerlerinden belirgin
  sekilde yuksek puan almalidir. IK'nin bir sey secebilmesi gerekir.
- Mentorluk transfer edilebilir bir seydir: bir finans direktoru,
  ihtiyac "liderlik ve etkileme" olsa bile ust yonetimle calisma
  deneyimi sayesinde degerli olabilir. Fonksiyon farkli diye otomatik
  olarak dusuk puan verme - ONEMLI OLAN mentorun YETKINLIKLERININ
  ihtiyaci karsilayip karsilamadigidir.
- Bos kapasitesi olmayan mentorlarin puanini 15 puan dusur (ama
  gerekcesinde bunu belirt).`;

/**
 * Sema, mentor sayisina gore URETILIR.
 *
 * NEDEN: Sabit semada `code` serbest metindi ve model bazen BOS KODLU
 * yuzlerce sonuc uretip takiliyordu (degenerate loop). Kodu `enum` ile
 * sinirlayinca model gecerli kodlar disina cikamaz - bos kod uretmesi
 * teknik olarak imkansiz hale gelir.
 *
 * Ayrica maxItems = mentor sayisi: model listeyi sonsuza kadar uzatamaz.
 */
function buildSchema(codes) {
  return {
    type: "object",
    properties: {
      matches: {
        type: "array",
        description:
          `Havuzdaki HER mentor icin bir sonuc dondur (toplam ${codes.length}). ` +
          `Her mentor SADECE BIR KEZ yer almali. Gecerli kodlar: ${codes.join(", ")}`,
        items: {
          type: "object",
          properties: {
            code: {
              type: "string",
              enum: codes,                      // <-- model bunun disina cikamaz
              description: "Degerlendirilen mentorun anonim kodu."
            },
            score: {
              type: "integer",
              minimum: 0,
              maximum: 100,
              description: "0-100 arasi uyum puani."
            },
            reason: {
              type: "string",
              description:
                "Bu puanin NEDEN verildigini aciklayan 1-2 cumle. Mentee'nin " +
                "ihtiyacindaki somut bir noktaya ve mentorun profilindeki somut " +
                "bir yetkinlige atif yap."
            },
            concerns: {
              type: "string",
              description:
                "Bu eslesmenin zayif yani veya dikkat edilmesi gereken nokta. " +
                "Yoksa bos birak."
            },
            focusAreas: {
              type: "array",
              items: { type: "string" },
              description: "Bu eslesmede odaklanilmasi onerilen 2-3 konu."
            },
            firstSessionQuestions: {
              type: "array",
              items: { type: "string" },
              description: "Ilk gorusmede sorulabilecek 3 acik uclu soru."
            }
          },
          required: ["code", "score", "reason"]
        }
      }
    },
    required: ["matches"]
  };
}

/**
 * @param {object}   mentee      { developmentNeeds, goals, role, department, ... }
 * @param {object[]} mentors     Aktif mentor listesi (DB'den)
 * @param {string}   language    "tr" | "en"
 * @returns {Promise<object[]>}  Puanlanmis, siralanmis mentor listesi
 */
async function rankMentors(mentee, mentors, language = "tr") {
  if (!mentors.length) return [];

  // --- 1. Mentee metnini temizle -------------------------------------
  // IK serbest metin yazdigi icin icine isim/eposta kacmis olabilir.
  // Mentee'nin kendi adini ve mentor adlarini bilinen isim olarak veriyoruz.
  const knownNames = [
    mentee.fullName,
    mentee.menteeName,
    ...mentors.map(m => m.fullName)
  ].filter(Boolean);

  const menteeText = scrub(
    [
      `Rol/Unvan: ${mentee.role || "-"}`,
      `Departman: ${mentee.department || "-"}`,
      `Gelisim ihtiyaci: ${mentee.developmentNeeds || "-"}`,
      `Hedefler: ${mentee.goals || "-"}`,
      `Diller: ${(mentee.languages || []).join(", ") || "-"}`
    ].join("\n"),
    knownNames
  );

  // --- 2. Mentorlari anonimlestir ------------------------------------
  // code -> gercek mentor eslesmesi SADECE sunucuda tutulur.
  const codeMap = new Map();
  const anonymizedBlocks = mentors.map((mentor, i) => {
    const code = `M${i + 1}`;
    codeMap.set(code, mentor);
    return anonymizeMentor(mentor, code);
  });

  const prompt = `## MENTEE GELISIM IHTIYACI

${menteeText}

## ADAY MENTORLAR (anonim)

${anonymizedBlocks.join("\n\n---\n\n")}

## GOREV

Yukaridaki ${mentors.length} aday mentoru degerlendir.

CIKTI KURALLARI (kesin):
- TAM OLARAK ${mentors.length} sonuc dondur, ne eksik ne fazla.
- Her mentor SADECE BIR KEZ yer alsin.
- Her sonucun "code" alani su listeden biri olmali:
  ${[...codeMap.keys()].join(", ")}
- Ayni mentoru tekrar etme, bos kayit uretme.

Ciktiyi ${language === "en" ? "Ingilizce" : "Turkce"} yaz.`;

  // --- 3. Claude'a sor ------------------------------------------------
  const codes = [...codeMap.keys()];

  /**
   * SONUCU DIZIYE CEVIR
   *
   * Sema "array" istese de model bazen baska sekilde donebiliyor:
   *   - dizi                          -> beklenen
   *   - koda gore nesne {M1:{...}}    -> gorulmus
   *   - tek nesne {code,score,...}    -> tek mentor varken
   *
   * Eskiden dogrudan .filter() cagriliyordu ve dizi olmayan her sekil
   * "filter is not a function" hatasiyla TUM eslestirmeyi cokertiyordu.
   */
  function toArray(raw) {
    if (Array.isArray(raw)) return raw;
    if (!raw || typeof raw !== "object") return [];

    // {matches: [...]} disinda, dogrudan {code: ...} seklinde TEK sonuc
    if (typeof raw.code === "string") return [raw];

    // {M1: {...}, M2: {...}} seklinde nesne haritasi
    return Object.entries(raw).map(([key, value]) =>
      value && typeof value === "object" ? { code: value.code || key, ...value } : null
    ).filter(Boolean);
  }

  /**
   * Modeli bir kez cagirir, kodlari gercek mentorlarla geri eslestirir.
   * Bozuk/tekrarli/taninmayan kayitlari eler.
   */
  async function evaluateOnce() {
    const result = await generateStructured({
      system: SYSTEM_PROMPT,
      prompt,
      toolName: "mentor_siralama",
      schema: buildSchema(codes),
      maxTokens: Math.min(16000, 1500 + mentors.length * 700)
    });

    // Bazi modeller sonucu {matches:[...]} yerine dogrudan dizi/nesne
    // olarak dondurebiliyor - iki durumu da destekle.
    const rawMatches = toArray(
      result && result.matches !== undefined ? result.matches : result
    );

    const seen = new Set();
    const matches = rawMatches.filter(m => {
      if (!m || typeof m.code !== "string" || !codeMap.has(m.code)) return false;
      if (seen.has(m.code)) return false;
      seen.add(m.code);
      return true;
    });

    return { rawCount: rawMatches.length, matches, seen, raw: result };
  }

  // --- 4. Degerlendir (gerekirse bir kez daha dene) -------------------
  //
  // Model NADIREN semaya ragmen bos/taninmayan sonuc dondurur. Boyle bir
  // durumda BIR KEZ daha deneriz; cogu zaman ikinci deneme duzelir.
  let { matches, seen, raw } = await evaluateOnce();

  if (matches.length === 0) {
    console.warn("[eslestirme] Ilk denemede taninan sonuc yok. Tekrar deneniyor...");
    ({ matches, seen, raw } = await evaluateOnce());
  }

  // --- 5. Guvenlik agi -----------------------------------------------
  //
  // Ikinci deneme de bos gelse bile ARTIK HATA FIRLATMIYORUZ. Mentorlar
  // havuzda mevcut; asagidaki "atlanan mentorlar" blogu hepsini
  // "degerlendirilmedi" olarak listeye ekler. Boylece IK bos/hatali ekran
  // yerine tum mentorlari gorur ve elle secebilir. (Ilkemiz: hicbir mentor
  // sessizce dusmez.)
  //
  // TESHIS: Model bos dondurduyse HAM CIKTISINI loga yaz. Bu ciktida
  // yalnizca anonim kodlar (M1..) ve puanlar bulunur - isim/eposta YOK,
  // dolayisiyla loglanmasi gizlilik acisindan guvenli. IT ekibi bu logla
  // sorunun modelde mi (bos donuyor) yoksa kodlarda mi (yanlis kod)
  // oldugunu net gorur.
  if (matches.length === 0) {
    console.error(
      "[eslestirme] Model gecerli sonuc dondurmedi. Ham cikti (ilk 1000 kr): " +
      JSON.stringify(raw).slice(0, 1000)
    );
    console.warn(
      "[eslestirme] Tum mentorlar 'degerlendirilmedi' olarak listeleniyor."
    );
  }

  const recommendations = [];

  for (const match of matches) {
    const mentor = codeMap.get(match.code);

    // Skoru guvenli araliga sikistir (model semaya uysa da temkinli ol)
    const score = Math.min(100, Math.max(0, Math.round(Number(match.score) || 0)));

    recommendations.push({
      ...mentor,
      mentorId: mentor.id,
      score,
      aiReason: match.reason || "",
      aiConcerns: match.concerns || "",
      suggestedFocusAreas: match.focusAreas || [],
      suggestedFirstSessionQuestions: match.firstSessionQuestions || [],

      // Eski frontend'in bekledigi alanlar (uyumluluk icin)
      aiSummary: match.reason || "",
      reasons: [
        match.reason,
        match.concerns ? `Dikkat: ${match.concerns}` : null,
        mentor.remainingCapacity > 0
          ? `Bos kapasite: ${mentor.remainingCapacity}`
          : "Bos kapasite yok"
      ].filter(Boolean)
    });
  }

  /**
   * ATLANAN MENTORLAR
   *
   * Model bazen bir kismini degerlendirmeden birakiyor. Onlari sessizce
   * DUSURMEK yanlis olur - IK, mentorun havuzda oldugunu bilmeli.
   * Bu yuzden listenin sonuna, degerlendirilmedigi ACIKCA yazili olarak
   * ekliyoruz. Uydurma puan vermiyoruz.
   */
  const missing = codes.filter(c => !seen.has(c));

  for (const code of missing) {
    const mentor = codeMap.get(code);
    if (!mentor) continue;

    recommendations.push({
      ...mentor,
      mentorId: mentor.id,
      score: 0,
      notAssessed: true,
      aiReason: language === "en"
        ? "The AI did not return an assessment for this mentor. They remain available in the pool — review manually if relevant."
        : "Yapay zeka bu mentor icin degerlendirme dondurmedi. Havuzda mevcut - ilgili gorunuyorsa elle inceleyin.",
      aiConcerns: "",
      suggestedFocusAreas: [],
      suggestedFirstSessionQuestions: [],
      aiSummary: "",
      reasons: []
    });
  }

  if (missing.length) {
    console.warn(
      `[eslestirme] Model ${missing.length} mentoru degerlendirmedi: ${missing.join(", ")}`
    );
  }

  // Degerlendirilenler puana gore, degerlendirilmeyenler en sonda.
  return recommendations.sort((a, b) => {
    if (a.notAssessed !== b.notAssessed) return a.notAssessed ? 1 : -1;
    return b.score - a.score;
  });
}

module.exports = { rankMentors };
