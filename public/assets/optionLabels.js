/**
 * ====================================================================
 * OPTION NAMES ON HR SCREENS
 * ====================================================================
 *
 * The registration forms store every choice with its English value
 * ("Supply Chain"), so that people who register in Turkish and in
 * English can be matched. This file shows those values in the screen's
 * language on the HR screens ("Tedarik Zinciri"), and turns a name typed
 * in an HR edit box back into the stored value. Nothing stored changes.
 *
 *   MentorOptionLabels.load()             the organisation's own options
 *   MentorOptionLabels.label(value, lang) value -> name (unknown: as is)
 *   MentorOptionLabels.labels(list, lang)
 *   MentorOptionLabels.toValue(text, lang) name or value -> value
 *
 * VOCAB holds the forms' fixed options; a test checks it against the
 * forms, so a new option there must be added here too.
 */
(function () {
  const VOCAB = {
    "Commercial / Sales": {"tr": "Ticari / Satış", "en": "Commercial / Sales"},
    "Marketing": {"tr": "Pazarlama", "en": "Marketing"},
    "Finance & P&L": {"tr": "Finans & P&L", "en": "Finance & P&L"},
    "Supply Chain": {"tr": "Tedarik Zinciri", "en": "Supply Chain"},
    "HR & People": {"tr": "İK & İnsan", "en": "HR & People"},
    "Operations": {"tr": "Operasyon", "en": "Operations"},
    "Legal & Compliance": {"tr": "Hukuk & Uyum", "en": "Legal & Compliance"},
    "Digital & IT": {"tr": "Dijital & IT", "en": "Digital & IT"},
    "Strategy": {"tr": "Strateji", "en": "Strategy"},
    "General Management": {"tr": "Genel Yönetim", "en": "General Management"},
    "R&D / Innovation": {"tr": "Ar-Ge / İnovasyon", "en": "R&D / Innovation"},
    "FMCG / CPG": {"tr": "FMCG / CPG", "en": "FMCG / CPG"},
    "Retail": {"tr": "Perakende", "en": "Retail"},
    "Technology": {"tr": "Teknoloji", "en": "Technology"},
    "Manufacturing": {"tr": "Üretim", "en": "Manufacturing"},
    "Financial services": {"tr": "Finansal hizmetler", "en": "Financial services"},
    "Consulting": {"tr": "Danışmanlık", "en": "Consulting"},
    "Healthcare": {"tr": "Sağlık", "en": "Healthcare"},
    "Energy": {"tr": "Enerji", "en": "Energy"},
    "Leadership development": {"tr": "Liderlik gelişimi", "en": "Leadership development"},
    "Coaching & feedback": {"tr": "Koçluk & geri bildirim", "en": "Coaching & feedback"},
    "Team management": {"tr": "Ekip yönetimi", "en": "Team management"},
    "Communication & influence": {"tr": "İletişim & etkileme", "en": "Communication & influence"},
    "Change management": {"tr": "Değişim yönetimi", "en": "Change management"},
    "Career planning": {"tr": "Kariyer planlama", "en": "Career planning"},
    "Cross-cultural working": {"tr": "Kültürler arası çalışma", "en": "Cross-cultural working"},
    "Psychological safety": {"tr": "Psikolojik güvenlik", "en": "Psychological safety"},
    "Resilience & wellbeing": {"tr": "Dayanıklılık & iyi oluş", "en": "Resilience & wellbeing"},
    "Inclusion & diversity": {"tr": "Kapsayıcılık & çeşitlilik", "en": "Inclusion & diversity"},
    "Negotiation & persuasion": {"tr": "Müzakere & ikna", "en": "Negotiation & persuasion"},
    "Confidence & visibility": {"tr": "Özgüven & görünürlük", "en": "Confidence & visibility"},
    "P&L / financial acumen": {"tr": "P&L / finansal bakış", "en": "P&L / financial acumen"},
    "Strategy development": {"tr": "Strateji geliştirme", "en": "Strategy development"},
    "Customer negotiation": {"tr": "Müşteri müzakeresi", "en": "Customer negotiation"},
    "Data & analytics": {"tr": "Veri & analitik", "en": "Data & analytics"},
    "Digital transformation": {"tr": "Dijital dönüşüm", "en": "Digital transformation"},
    "Project management": {"tr": "Proje yönetimi", "en": "Project management"},
    "Procurement & tendering": {"tr": "Satın alma & ihale", "en": "Procurement & tendering"},
    "Presenting & storytelling": {"tr": "Sunum & hikâyeleştirme", "en": "Presenting & storytelling"},
    "Talent management": {"tr": "Yetenek yönetimi", "en": "Talent management"},
    "Category & shopper": {"tr": "Kategori & müşteri davranışı", "en": "Category & shopper"},
    "New joiners": {"tr": "Yeni başlayanlar", "en": "New joiners"},
    "Mid-level (Band 6–8)": {"tr": "Orta seviye (Band 6–8)", "en": "Mid-level (Band 6–8)"},
    "Senior (Band 9–10)": {"tr": "Kıdemli (Band 9–10)", "en": "Senior (Band 9–10)"},
    "First-time managers": {"tr": "İlk kez yönetici olanlar", "en": "First-time managers"},
    "Experienced leaders": {"tr": "Deneyimli liderler", "en": "Experienced leaders"},
    "No preference": {"tr": "Tercihim yok", "en": "No preference"},
    "English": {"tr": "İngilizce", "en": "English"},
    "Turkish": {"tr": "Türkçe", "en": "Turkish"},
    "German": {"tr": "Almanca", "en": "German"},
    "French": {"tr": "Fransızca", "en": "French"},
    "Spanish": {"tr": "İspanyolca", "en": "Spanish"},
    "Russian": {"tr": "Rusça", "en": "Russian"},
    "Arabic": {"tr": "Arapça", "en": "Arabic"},
    "Other": {"tr": "Diğer", "en": "Other"},
    "Giving back": {"tr": "Katkı sağlamak", "en": "Giving back"},
    "Gaining new perspectives": {"tr": "Yeni bakış açıları kazanmak", "en": "Gaining new perspectives"},
    "Developing my leadership": {"tr": "Liderliğimi geliştirmek", "en": "Developing my leadership"},
    "Strengthening the organisation": {"tr": "Organizasyonu güçlendirmek", "en": "Strengthening the organisation"},
    "Personal growth": {"tr": "Kişisel gelişim", "en": "Personal growth"},
    "Less than 2 years": {"tr": "2 yıldan az", "en": "Less than 2 years"},
    "2–4 years": {"tr": "2–4 yıl", "en": "2–4 years"},
    "5–7 years": {"tr": "5–7 yıl", "en": "5–7 years"},
    "8–10 years": {"tr": "8–10 yıl", "en": "8–10 years"},
    "10+ years": {"tr": "10+ yıl", "en": "10+ years"},
    "Video call": {"tr": "Video görüşme", "en": "Video call"},
    "Written / async": {"tr": "Yazılı / asenkron", "en": "Written / async"},
    "In person": {"tr": "Yüz yüze", "en": "In person"},
    "Flexible / mixed": {"tr": "Esnek / karma", "en": "Flexible / mixed"},
    "Available": {"tr": "Uygunum", "en": "Available"},
    "Soon": {"tr": "Yakında", "en": "Soon"},
    "At capacity": {"tr": "Kapasitem dolu", "en": "At capacity"},
    "Same function": {"tr": "Aynı fonksiyondan", "en": "Same function"},
    "Different function": {"tr": "Farklı fonksiyondan", "en": "Different function"},
    "Senior leader": {"tr": "Üst düzey lider", "en": "Senior leader"},
    "1-2": {"tr": "1–2 saat", "en": "1–2 hours"},
    "2-4": {"tr": "2–4 saat", "en": "2–4 hours"},
    "4-6": {"tr": "4–6 saat", "en": "4–6 hours"},
    "6+": {"tr": "6+ saat", "en": "6+ hours"}
  };

  let OWN = {};       // the organisation's own options: value -> { tr, en }

  async function load() {
    try {
      const res = await fetch("/registration-forms");
      if (!res.ok) return;
      const d = await res.json();
      OWN = {};
      for (const list of Object.values((d.config && d.config.options) || {})) {
        for (const o of list.custom || []) OWN[o.value] = { tr: o.tr || o.en, en: o.en || o.tr };
      }
    } catch { /* names stay as stored */ }
  }

  function label(value, lang) {
    const v = String(value == null ? "" : value);
    const e = VOCAB[v] || OWN[v];
    if (!e) return v;
    return (lang === "en" ? e.en : e.tr) || v;
  }

  const labels = (list, lang) => (Array.isArray(list) ? list : []).map(v => label(v, lang));

  /** A name typed in an edit box back to its stored value; anything else as typed. */
  function toValue(text, lang) {
    const s = String(text == null ? "" : text).trim();
    if (!s || VOCAB[s] || OWN[s]) return s;
    const low = s.toLocaleLowerCase("tr");
    for (const src of [OWN, VOCAB]) {
      for (const [v, e] of Object.entries(src)) {
        if ([e.tr, e.en].some(n => n && n.toLocaleLowerCase("tr") === low)) return v;
      }
    }
    return s;
  }

  window.MentorOptionLabels = { VOCAB, load, label, labels, toValue };
})();
