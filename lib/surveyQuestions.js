/**
 * ====================================================================
 * KAPANIS ANKETI - SORU TANIMLARI  (TEK KAYNAK)
 * ====================================================================
 *
 * Sorular BURADA tanimlanir. Anket sayfasi formu buradan uretir,
 * IK panosu cevaplari buradaki basliklarla gosterir. Tek yerde
 * durmasinin sebebi: soru metni degistiginde iki ekranin birbirinden
 * ayrisip "hangi cevap hangi soruya aitti?" karmasasi yasanmamasi.
 *
 * SORU TIPLERI
 *   scale5  : 1-5 (1 = Hic katilmiyorum, 5 = Tamamen katiliyorum)
 *   nps     : 0-10 tavsiye skoru
 *   choice  : sabit secenekler
 *   text    : serbest metin
 *
 * ID'LER DEGISMEZ. Cevaplar JSON olarak id ile saklanir; bir id
 * degistirilirse eski cevaplar okunamaz hale gelir. Soru METNI
 * degistirilebilir, id'si ASLA.
 *
 * SORULMAYANLAR
 *   Gorusme sayisi, sure, tamamlanan aksiyon sayisi BILEREK
 *   sorulmaz - sistem bunlari zaten biliyor. Anketi uzatmak yerine
 *   bu veriler sonuc ekraninda otomatik gosterilir.
 */

const SCALE5_LABELS = {
  tr: ["Hiç katılmıyorum", "Katılmıyorum", "Kararsızım", "Katılıyorum", "Tamamen katılıyorum"],
  en: ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"]
};

const YES_MAYBE_NO = {
  tr: ["Evet", "Belki", "Hayır"],
  en: ["Yes", "Maybe", "No"]
};

// ---------------------------------------------------------------------
// MENTEE
// ---------------------------------------------------------------------

const MENTEE_SURVEY = {
  tr: {
    title: "Mentorluk Kapanış Anketi",
    intro:
      "Mentorluk süreciniz tamamlandı. Bu kısa anket, programı geliştirmemize " +
      "yardımcı oluyor. Doldurması yaklaşık 3–4 dakika sürer.",
    privacy:
      "Cevaplarınızı yalnızca İnsan Kaynakları görür. Mentorunuz bu ankete " +
      "verdiğiniz yanıtları göremez.",
    sections: [
      {
        title: "Hedefler ve sonuç",
        questions: [
          { id: "goals_reached", type: "scale5",
            q: "Süreç başında belirlediğimiz hedeflere ulaştım." },
          { id: "concrete_benefit", type: "scale5",
            q: "Bu mentorluk gelişimime somut katkı sağladı." },
          { id: "goals_comment", type: "text",
            q: "Süreç hedefler açısından nasıl geçti?",
            hint: "Neyi başardınız, nerede ilerleyemediniz?" }
        ]
      },
      {
        title: "Mentor değerlendirmesi",
        questions: [
          { id: "mentor_satisfaction", type: "scale5",
            q: "Mentorumla çalışmaktan memnun kaldım." },
          { id: "mentor_comment", type: "text",
            q: "Mentorunuzu değerlendirir misiniz?",
            hint: "Güçlü yönleri, size en çok yardımı dokunan tarafı ve geliştirebileceği yanlar." }
        ]
      },
      {
        title: "Eşleştirme ve süreç",
        questions: [
          { id: "right_match", type: "scale5",
            q: "Doğru mentorle eşleştirildim." },
          { id: "cadence_fit", type: "scale5",
            q: "Görüşme sıklığı ve süresi ihtiyacıma uygundu." },
          { id: "meetings_happened", type: "scale5",
            q: "Görüşmeler planlandığı gibi gerçekleşti." }
        ]
      },
      {
        title: "Platform",
        questions: [
          { id: "platform_easy", type: "scale5",
            q: "Çalışma alanını kullanmak kolaydı." },
          { id: "platform_useful", type: "scale5",
            q: "Toplantı davetleri ve notlar süreci takip etmemi kolaylaştırdı." },
          { id: "platform_comment", type: "text", optional: true,
            q: "Platformda zorlandığınız bir yer oldu mu?" }
        ]
      },
      {
        title: "Kapanış",
        questions: [
          { id: "nps", type: "nps",
            q: "Bu programı bir iş arkadaşıma tavsiye ederim." },
          { id: "again", type: "choice", options: YES_MAYBE_NO.tr,
            q: "İleride yeni bir mentorluk sürecine katılmak isterim." },
          { id: "final_comment", type: "text", optional: true,
            q: "Eklemek istediğiniz başka bir şey var mı?" }
        ]
      }
    ]
  },

  en: {
    title: "Mentoring Closure Survey",
    intro:
      "Your mentoring relationship has come to an end. This short survey helps us " +
      "improve the programme. It takes about 3–4 minutes to complete.",
    privacy:
      "Only Human Resources can see your answers. Your mentor cannot see the " +
      "responses you give in this survey.",
    sections: [
      {
        title: "Goals and outcome",
        questions: [
          { id: "goals_reached", type: "scale5",
            q: "I reached the goals we set at the start of the process." },
          { id: "concrete_benefit", type: "scale5",
            q: "This mentoring made a concrete contribution to my development." },
          { id: "goals_comment", type: "text",
            q: "How did the process go in terms of goals?",
            hint: "What did you achieve, and where did you not make progress?" }
        ]
      },
      {
        title: "Your mentor",
        questions: [
          { id: "mentor_satisfaction", type: "scale5",
            q: "I was satisfied working with my mentor." },
          { id: "mentor_comment", type: "text",
            q: "How would you assess your mentor?",
            hint: "Their strengths, what helped you most, and what they could develop." }
        ]
      },
      {
        title: "Matching and process",
        questions: [
          { id: "right_match", type: "scale5",
            q: "I was matched with the right mentor." },
          { id: "cadence_fit", type: "scale5",
            q: "The frequency and length of meetings suited my needs." },
          { id: "meetings_happened", type: "scale5",
            q: "Meetings took place as planned." }
        ]
      },
      {
        title: "Platform",
        questions: [
          { id: "platform_easy", type: "scale5",
            q: "The workspace was easy to use." },
          { id: "platform_useful", type: "scale5",
            q: "Calendar invitations and notes made it easier to follow the process." },
          { id: "platform_comment", type: "text", optional: true,
            q: "Was there anything you found difficult on the platform?" }
        ]
      },
      {
        title: "Closing",
        questions: [
          { id: "nps", type: "nps",
            q: "I would recommend this programme to a colleague." },
          { id: "again", type: "choice", options: YES_MAYBE_NO.en,
            q: "I would like to take part in another mentoring relationship in future." },
          { id: "final_comment", type: "text", optional: true,
            q: "Is there anything else you would like to add?" }
        ]
      }
    ]
  }
};

// ---------------------------------------------------------------------
// MENTOR
// ---------------------------------------------------------------------

const MENTOR_SURVEY = {
  tr: {
    title: "Mentorluk Kapanış Anketi",
    intro:
      "Mentorluk süreciniz tamamlandı. Bu kısa anket, programı geliştirmemize " +
      "yardımcı oluyor. Doldurması yaklaşık 3–4 dakika sürer.",
    privacy:
      "Cevaplarınızı yalnızca İnsan Kaynakları görür. Mentee'niz bu ankete " +
      "verdiğiniz yanıtları göremez.",
    sections: [
      {
        title: "Hedefler ve sonuç",
        questions: [
          { id: "mentee_progress", type: "scale5",
            q: "Mentee bu süreçte gözle görülür ilerleme kaydetti." },
          { id: "goals_comment", type: "text",
            q: "Süreç hedefler açısından nasıl geçti?",
            hint: "Nerede ilerleme oldu, nerede olmadı?" }
        ]
      },
      {
        title: "Mentee değerlendirmesi",
        questions: [
          { id: "mentee_productive", type: "scale5",
            q: "Mentee ile çalışmak verimliydi." },
          { id: "mentee_comment", type: "text",
            q: "Mentee'yi değerlendirir misiniz?",
            hint: "Süreci sahiplenmesi, hazırlığı, geri bildirime açıklığı ve gelişebileceği yanlar." }
        ]
      },
      {
        title: "Eşleştirme ve süreç",
        questions: [
          { id: "right_match", type: "scale5",
            q: "Deneyimim mentee'nin ihtiyacına uygundu." },
          { id: "cadence_fit", type: "scale5",
            q: "Görüşme sıklığı ve süresi yeterliydi." },
          { id: "gained_myself", type: "scale5",
            q: "Mentorluk bana da bir şey kattı." }
        ]
      },
      {
        title: "Platform",
        questions: [
          { id: "platform_easy", type: "scale5",
            q: "Çalışma alanını kullanmak kolaydı." },
          { id: "platform_useful", type: "scale5",
            q: "Rehber ve toplantı notları işime yaradı." },
          { id: "platform_comment", type: "text", optional: true,
            q: "Platformda zorlandığınız bir yer oldu mu?" }
        ]
      },
      {
        title: "Kapanış",
        questions: [
          { id: "nps", type: "nps",
            q: "Bu programı bir iş arkadaşıma tavsiye ederim." },
          { id: "again", type: "choice", options: YES_MAYBE_NO.tr,
            q: "Yeniden mentor olmak isterim." },
          { id: "final_comment", type: "text", optional: true,
            q: "İK'nın bilmesi gereken bir şey var mı?" }
        ]
      }
    ]
  },

  en: {
    title: "Mentoring Closure Survey",
    intro:
      "Your mentoring relationship has come to an end. This short survey helps us " +
      "improve the programme. It takes about 3–4 minutes to complete.",
    privacy:
      "Only Human Resources can see your answers. Your mentee cannot see the " +
      "responses you give in this survey.",
    sections: [
      {
        title: "Goals and outcome",
        questions: [
          { id: "mentee_progress", type: "scale5",
            q: "The mentee made visible progress during this process." },
          { id: "goals_comment", type: "text",
            q: "How did the process go in terms of goals?",
            hint: "Where was there progress, and where was there none?" }
        ]
      },
      {
        title: "Your mentee",
        questions: [
          { id: "mentee_productive", type: "scale5",
            q: "Working with the mentee was productive." },
          { id: "mentee_comment", type: "text",
            q: "How would you assess your mentee?",
            hint: "Ownership of the process, preparation, openness to feedback, and areas to develop." }
        ]
      },
      {
        title: "Matching and process",
        questions: [
          { id: "right_match", type: "scale5",
            q: "My experience suited the mentee's needs." },
          { id: "cadence_fit", type: "scale5",
            q: "The frequency and length of meetings was sufficient." },
          { id: "gained_myself", type: "scale5",
            q: "Mentoring gave me something too." }
        ]
      },
      {
        title: "Platform",
        questions: [
          { id: "platform_easy", type: "scale5",
            q: "The workspace was easy to use." },
          { id: "platform_useful", type: "scale5",
            q: "The guide and meeting notes were useful to me." },
          { id: "platform_comment", type: "text", optional: true,
            q: "Was there anything you found difficult on the platform?" }
        ]
      },
      {
        title: "Closing",
        questions: [
          { id: "nps", type: "nps",
            q: "I would recommend this programme to a colleague." },
          { id: "again", type: "choice", options: YES_MAYBE_NO.en,
            q: "I would like to be a mentor again." },
          { id: "final_comment", type: "text", optional: true,
            q: "Is there anything HR should know?" }
        ]
      }
    ]
  }
};

/** Rol + dile gore anket tanimini dondurur. */
function getSurvey(role, language) {
  const lang = language === "en" ? "en" : "tr";
  const pack = role === "mentor" ? MENTOR_SURVEY : MENTEE_SURVEY;
  return pack[lang];
}

/** Tum sorulari duz liste halinde dondurur (dogrulama ve gosterim icin). */
function flatQuestions(role, language) {
  return getSurvey(role, language).sections.flatMap(s => s.questions);
}

module.exports = { getSurvey, flatQuestions, SCALE5_LABELS };
