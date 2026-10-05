/**
 * ====================================================================
 * REGISTRATION FORM CATALOG  (mentor + mentee)  - stage 5a
 * ====================================================================
 *
 * The single description of WHAT is on the two registration forms and
 * WHAT an organisation may change about them. The same file runs in the
 * browser (window.MentorFormSchema - forms and the editor) and on the
 * server (require() - saving the settings and checking a registration).
 *
 * The forms' HTML keeps its fields. A field is found by the element ids
 * in `anchors` (the first one carries the label); for a field made of
 * several parts (a list + its "not listed above" box) every part is
 * hidden or shown together.
 *
 * LOCKED fields cannot be changed at all - not visibility, not
 * "required", not the text: identity, consent, the mentor's capacity and
 * availability (the mentor's active/inactive status comes from it) and
 * the mentee's development need (AI matching cannot work without it).
 * sanitize() drops any attempt, so the server enforces it.
 *
 *   ai: true      the field is sent (anonymised) to AI matching
 *   aiCritical    hiding it lowers the matching quality noticeably;
 *                 the editor warns
 *   requirable    false = can be hidden but not made required (a slider
 *                 always has a value)
 *   keys          the registration's data keys; a "required" field is
 *                 filled when ANY of its keys has a value
 */
(function (root) {
  const F = (o) => Object.assign({ locked: false, required: false, ai: false, aiCritical: false, requirable: true }, o);

  const FORMS = {
    mentor: {
      steps: {
        1: { tr: "Sizi tanıyalım", en: "Let's get to know you" },
        2: { tr: "Deneyiminiz hangi alanlarda?", en: "Where does your experience lie?" },
        3: { tr: "Hangi alanlarda daha güçlüsünüz?", en: "Where do you feel strongest?" },
        4: { tr: "Nasıl mentorluk yapmak istersiniz?", en: "How would you like to mentor?" },
        5: { tr: "Son birkaç soru", en: "A few final questions" }
      },
      fields: [
        F({ id: "fullName", step: 1, locked: true, required: true, anchors: ["fullName"], keys: ["fullName"],
            label: { tr: "Ad Soyad", en: "Full name" } }),
        F({ id: "email", step: 1, locked: true, required: true, anchors: ["email"], keys: ["email"],
            label: { tr: "Şirket e-postası", en: "Company email" } }),
        F({ id: "role", step: 1, required: true, ai: true, anchors: ["role"], keys: ["role"],
            label: { tr: "Mevcut unvan / rol", en: "Current title / role" } }),
        F({ id: "tenure", step: 1, ai: true, anchors: ["tenure"], keys: ["tenure"],
            label: { tr: "Şirkette toplam çalışma süresi", en: "Total tenure at the company" } }),
        F({ id: "functionalAreas", step: 2, required: true, ai: true, aiCritical: true, anchors: ["funcTags", "funcExtra"],
            keys: ["functionalAreas", "functionalAreasExtra"],
            label: { tr: "Uzmanlık fonksiyon alanları", en: "Functional areas of expertise" } }),
        F({ id: "industries", step: 2, ai: true, aiCritical: true, anchors: ["industryTags", "industryExtra"],
            keys: ["industries", "industriesExtra"],
            label: { tr: "Uzman olduğunuz sektörler", en: "Industries worked in (including previous employers)" } }),
        F({ id: "careerBio", step: 2, ai: true, aiCritical: true, anchors: ["careerBio"], keys: ["careerBio"],
            label: { tr: "Kariyer özeti — profesyonel yolculuğunuzu kısaca anlatın", en: "Career summary — briefly describe your professional journey" } }),
        F({ id: "competencies", step: 3, required: true, ai: true, aiCritical: true,
            anchors: ["behaviouralTags", "technicalTags", "extraComp"],
            keys: ["behaviouralCompetencies", "technicalCompetencies", "additionalCompetencies"],
            label: { tr: "Davranışsal yetkinlikler", en: "Behavioural competencies" } }),
        F({ id: "capacity", step: 4, locked: true, required: true, anchors: ["capacityCards"], keys: ["capacity"],
            label: { tr: "Aynı anda kaç mentee ile çalışabilirsiniz?", en: "How many mentees can you take on at once?" } }),
        F({ id: "menteeLevels", step: 4, ai: true, anchors: ["menteeLevelTags"], keys: ["menteeLevels"],
            label: { tr: "Hangi seviyedeki kişilere mentorluk yapmak istersiniz?", en: "Which levels would you prefer to mentor?" } }),
        F({ id: "formats", step: 4, ai: true, anchors: ["formatCards"], keys: ["formats"],
            label: { tr: "Tercih edilen mentorluk formatı", en: "Preferred mentoring format" } }),
        F({ id: "languages", step: 4, ai: true, anchors: ["languageTags"], keys: ["languages"],
            label: { tr: "Mentorluk yapabileceğiniz diller", en: "Languages you can mentor in" } }),
        F({ id: "motivations", step: 5, anchors: ["motivationTags"], keys: ["motivations"],
            label: { tr: "Neden mentor olmak istiyorsunuz?", en: "Why do you want to be a mentor?" } }),
        F({ id: "availability", step: 5, locked: true, required: true, anchors: ["availabilityCards"], keys: ["availability"],
            label: { tr: "Mevcut uygunluk", en: "Current availability" } }),
        F({ id: "hoursPerMonth", step: 5, requirable: false, anchors: ["hoursSlider"], keys: ["hoursPerMonth"],
            label: { tr: "Ayda ne kadar zaman ayırabilirsiniz?", en: "How much time can you commit per month?" } }),
        F({ id: "messageToMentee", step: 5, ai: true, anchors: ["mentorMsg"], keys: ["messageToMentee"],
            label: { tr: "Gelecekteki mentee'nize mesajınız", en: "Message to your future mentee" } }),
        F({ id: "kvkkConsent", step: 5, locked: true, required: true, anchors: ["kvkkConsent"], keys: ["kvkkConsent"],
            label: { tr: "Kişisel verilerin korunması (KVKK)", en: "Data protection (KVKK / GDPR)" } })
      ]
    },

    mentee: {
      steps: {
        1: { tr: "Seni tanıyalım", en: "Let's get to know you" },
        2: { tr: "Neden mentee olmak istiyorsun?", en: "Why do you want to be a mentee?" },
        3: { tr: "Ne başarmak istiyorsun?", en: "What do you want to achieve?" },
        4: { tr: "Nasıl bir mentorluk istiyorsun?", en: "What kind of mentorship do you want?" },
        5: { tr: "Son birkaç bilgi", en: "A few final details" }
      },
      fields: [
        F({ id: "fullName", step: 1, locked: true, required: true, anchors: ["fullName"], keys: ["fullName"],
            label: { tr: "Ad Soyad", en: "Full name" } }),
        F({ id: "email", step: 1, locked: true, required: true, anchors: ["email"], keys: ["email"],
            label: { tr: "Şirket e-postası", en: "Company email" } }),
        F({ id: "role", step: 1, required: true, ai: true, anchors: ["role"], keys: ["role"],
            label: { tr: "Mevcut unvan / rol", en: "Current title / role" } }),
        F({ id: "department", step: 1, ai: true, anchors: ["department"], keys: ["department"],
            label: { tr: "Departman", en: "Department" } }),
        F({ id: "tenure", step: 1, ai: true, anchors: ["tenure"], keys: ["tenure"],
            label: { tr: "Şirkette toplam çalışma süresi", en: "Total tenure at the company" } }),
        F({ id: "devAreas", step: 2, required: true, ai: true, aiCritical: true, anchors: ["devFuncTags", "devAreasExtra"],
            keys: ["devFunctionalAreas", "devAreasExtra"],
            label: { tr: "Gelişmek istediğin alanlar", en: "Areas you want to develop" } }),
        F({ id: "developmentNeeds", step: 2, locked: true, required: true, ai: true, anchors: ["developmentNeeds"],
            keys: ["developmentNeeds"], label: { tr: "Gelişim ihtiyacını anlat", en: "Describe your development need" } }),
        F({ id: "challenge", step: 2, ai: true, aiCritical: true, anchors: ["challenge"], keys: ["challenge"],
            label: { tr: "Şu anki en büyük zorluğun", en: "Your biggest current challenge" } }),
        F({ id: "competenciesToDevelop", step: 3, ai: true, aiCritical: true,
            anchors: ["devBehaviouralTags", "devTechnicalTags", "compExtra"], keys: ["competenciesToDevelop", "compExtra"],
            label: { tr: "Geliştirmek istediğin davranışsal yetkinlikler", en: "Behavioural competencies to develop" } }),
        F({ id: "goals", step: 3, required: true, ai: true, aiCritical: true, anchors: ["goals"], keys: ["goals"],
            label: { tr: "Kariyer hedefin", en: "Your career goal" } }),
        F({ id: "expectations", step: 3, ai: true, anchors: ["expectations"], keys: ["expectations"],
            label: { tr: "Bu mentorlukta başarı senin için ne demek?", en: "What does success from this mentorship look like?" } }),
        F({ id: "formats", step: 4, ai: true, anchors: ["formatCards"], keys: ["formats"],
            label: { tr: "Tercih ettiğin görüşme formatı", en: "Preferred meeting format" } }),
        F({ id: "hoursPerMonth", step: 4, ai: true, anchors: ["hoursPerMonth"], keys: ["hoursPerMonth"],
            label: { tr: "Aylık ayırabileceğin zaman", en: "Time you can commit per month" } }),
        F({ id: "languages", step: 4, ai: true, anchors: ["languageTags"], keys: ["languages"],
            label: { tr: "Mentorluk almak istediğin diller", en: "Languages you'd like to be mentored in" } }),
        F({ id: "preferredMentorProfile", step: 4, ai: true, anchors: ["mentorProfileTags"], keys: ["preferredMentorProfile"],
            label: { tr: "Tercih ettiğin mentor profili", en: "Preferred mentor profile" } }),
        F({ id: "message", step: 5, ai: true, anchors: ["menteeMsg"], keys: ["message"],
            label: { tr: "Gelecekteki mentoruna mesajın", en: "A message to your future mentor" } }),
        F({ id: "kvkkConsent", step: 5, locked: true, required: true, anchors: ["kvkkConsent"], keys: ["kvkkConsent"],
            label: { tr: "Kişisel verilerin korunması (KVKK)", en: "Data protection (KVKK / GDPR)" } })
      ]
    }
  };

  // Option lists (stage 5b). A SHARED list is one vocabulary on both forms:
  // the mentor's expertise and the mentee's development area are compared
  // by the AI, so an option added to it appears on both forms.
  const LISTS = {
    functionalAreas: {
      shared: true,
      title: {"tr": "Fonksiyonel alanlar", "en": "Functional areas"},
      places: { mentor: { field: "functionalAreas", container: "funcTags" }, mentee: { field: "devAreas", container: "devFuncTags" } },
      builtins: [
        {"value": "Commercial / Sales", "tr": "Ticari / Satış", "en": "Commercial / Sales"},
        {"value": "Marketing", "tr": "Pazarlama", "en": "Marketing"},
        {"value": "Finance & P&L", "tr": "Finans & P&L", "en": "Finance & P&L"},
        {"value": "Supply Chain", "tr": "Tedarik Zinciri", "en": "Supply Chain"},
        {"value": "HR & People", "tr": "İK & İnsan", "en": "HR & People"},
        {"value": "Operations", "tr": "Operasyon", "en": "Operations"},
        {"value": "Legal & Compliance", "tr": "Hukuk & Uyum", "en": "Legal & Compliance"},
        {"value": "Digital & IT", "tr": "Dijital & IT", "en": "Digital & IT"},
        {"value": "Strategy", "tr": "Strateji", "en": "Strategy"},
        {"value": "General Management", "tr": "Genel Yönetim", "en": "General Management"},
        {"value": "R&D / Innovation", "tr": "Ar-Ge / İnovasyon", "en": "R&D / Innovation"}
      ]
    },
    behavioural: {
      shared: true,
      title: {"tr": "Davranışsal yetkinlikler", "en": "Behavioural competencies"},
      places: { mentor: { field: "competencies", container: "behaviouralTags" }, mentee: { field: "competenciesToDevelop", container: "devBehaviouralTags" } },
      builtins: [
        {"value": "Leadership development", "tr": "Liderlik gelişimi", "en": "Leadership development"},
        {"value": "Coaching & feedback", "tr": "Koçluk & geri bildirim", "en": "Coaching & feedback"},
        {"value": "Team management", "tr": "Ekip yönetimi", "en": "Team management"},
        {"value": "Communication & influence", "tr": "İletişim & etkileme", "en": "Communication & influence"},
        {"value": "Change management", "tr": "Değişim yönetimi", "en": "Change management"},
        {"value": "Career planning", "tr": "Kariyer planlama", "en": "Career planning"},
        {"value": "Cross-cultural working", "tr": "Kültürler arası çalışma", "en": "Cross-cultural working"},
        {"value": "Psychological safety", "tr": "Psikolojik güvenlik", "en": "Psychological safety"},
        {"value": "Resilience & wellbeing", "tr": "Dayanıklılık & iyi oluş", "en": "Resilience & wellbeing"},
        {"value": "Inclusion & diversity", "tr": "Kapsayıcılık & çeşitlilik", "en": "Inclusion & diversity"},
        {"value": "Negotiation & persuasion", "tr": "Müzakere & ikna", "en": "Negotiation & persuasion"},
        {"value": "Confidence & visibility", "tr": "Özgüven & görünürlük", "en": "Confidence & visibility"}
      ]
    },
    technical: {
      shared: true,
      title: {"tr": "Teknik yetkinlikler", "en": "Technical competencies"},
      places: { mentor: { field: "competencies", container: "technicalTags" }, mentee: { field: "competenciesToDevelop", container: "devTechnicalTags" } },
      builtins: [
        {"value": "P&L / financial acumen", "tr": "P&L / finansal bakış", "en": "P&L / financial acumen"},
        {"value": "Strategy development", "tr": "Strateji geliştirme", "en": "Strategy development"},
        {"value": "Customer negotiation", "tr": "Müşteri müzakeresi", "en": "Customer negotiation"},
        {"value": "Data & analytics", "tr": "Veri & analitik", "en": "Data & analytics"},
        {"value": "Digital transformation", "tr": "Dijital dönüşüm", "en": "Digital transformation"},
        {"value": "Project management", "tr": "Proje yönetimi", "en": "Project management"},
        {"value": "Procurement & tendering", "tr": "Satın alma & ihale", "en": "Procurement & tendering"},
        {"value": "Presenting & storytelling", "tr": "Sunum & hikâyeleştirme", "en": "Presenting & storytelling"},
        {"value": "Talent management", "tr": "Yetenek yönetimi", "en": "Talent management"},
        {"value": "Category & shopper", "tr": "Kategori & müşteri davranışı", "en": "Category & shopper"}
      ]
    },
    languages: {
      shared: true,
      title: {"tr": "Diller", "en": "Languages"},
      places: { mentor: { field: "languages", container: "languageTags" }, mentee: { field: "languages", container: "languageTags" } },
      builtins: [
        {"value": "English", "tr": "İngilizce", "en": "English"},
        {"value": "Turkish", "tr": "Türkçe", "en": "Turkish"},
        {"value": "German", "tr": "Almanca", "en": "German"},
        {"value": "French", "tr": "Fransızca", "en": "French"},
        {"value": "Spanish", "tr": "İspanyolca", "en": "Spanish"},
        {"value": "Russian", "tr": "Rusça", "en": "Russian"},
        {"value": "Arabic", "tr": "Arapça", "en": "Arabic"},
        {"value": "Other", "tr": "Diğer", "en": "Other"}
      ]
    },
    industries: {
      shared: false,
      title: {"tr": "Sektörler", "en": "Industries"},
      places: { mentor: { field: "industries", container: "industryTags" } },
      builtins: [
        {"value": "FMCG / CPG", "tr": "FMCG / CPG", "en": "FMCG / CPG"},
        {"value": "Retail", "tr": "Perakende", "en": "Retail"},
        {"value": "Technology", "tr": "Teknoloji", "en": "Technology"},
        {"value": "Manufacturing", "tr": "Üretim", "en": "Manufacturing"},
        {"value": "Financial services", "tr": "Finansal hizmetler", "en": "Financial services"},
        {"value": "Consulting", "tr": "Danışmanlık", "en": "Consulting"},
        {"value": "Healthcare", "tr": "Sağlık", "en": "Healthcare"},
        {"value": "Energy", "tr": "Enerji", "en": "Energy"}
      ]
    },
    menteeLevels: {
      shared: false,
      title: {"tr": "Mentee seviyeleri", "en": "Mentee levels"},
      places: { mentor: { field: "menteeLevels", container: "menteeLevelTags" } },
      builtins: [
        {"value": "New joiners", "tr": "Yeni başlayanlar", "en": "New joiners"},
        {"value": "Mid-level (Band 6–8)", "tr": "Orta seviye (Band 6–8)", "en": "Mid-level (Band 6–8)"},
        {"value": "Senior (Band 9–10)", "tr": "Kıdemli (Band 9–10)", "en": "Senior (Band 9–10)"},
        {"value": "First-time managers", "tr": "İlk kez yönetici olanlar", "en": "First-time managers"},
        {"value": "Experienced leaders", "tr": "Deneyimli liderler", "en": "Experienced leaders"},
        {"value": "No preference", "tr": "Tercihim yok", "en": "No preference"}
      ]
    },
    motivations: {
      shared: false,
      title: {"tr": "Motivasyonlar", "en": "Motivations"},
      places: { mentor: { field: "motivations", container: "motivationTags" } },
      builtins: [
        {"value": "Giving back", "tr": "Katkı sağlamak", "en": "Giving back"},
        {"value": "Gaining new perspectives", "tr": "Yeni bakış açıları kazanmak", "en": "Gaining new perspectives"},
        {"value": "Developing my leadership", "tr": "Liderliğimi geliştirmek", "en": "Developing my leadership"},
        {"value": "Strengthening the organisation", "tr": "Organizasyonu güçlendirmek", "en": "Strengthening the organisation"},
        {"value": "Personal growth", "tr": "Kişisel gelişim", "en": "Personal growth"}
      ]
    },
    mentorProfile: {
      shared: false,
      title: {"tr": "Tercih edilen mentor profili", "en": "Preferred mentor profile"},
      places: { mentee: { field: "preferredMentorProfile", container: "mentorProfileTags" } },
      builtins: [
        {"value": "Same function", "tr": "Aynı fonksiyondan", "en": "Same function"},
        {"value": "Different function", "tr": "Farklı fonksiyondan", "en": "Different function"},
        {"value": "Senior leader", "tr": "Üst düzey lider", "en": "Senior leader"},
        {"value": "No preference", "tr": "Fark etmez", "en": "No preference"}
      ]
    }
  };

  const OPTION_MAX = 20;      // options an organisation may add to one list
  const OPTION_TEXT_MAX = 60;

  const TEXT_MAX = 200;      // label
  const HELP_MAX = 400;      // help text under the label
  const STEP_MAX = 120;

  const cleanText = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  const cleanPair = (v, max) => {
    const o = v && typeof v === "object" ? v : {};
    const tr = cleanText(o.tr, max), en = cleanText(o.en, max);
    return tr || en ? { tr, en } : null;
  };

  /**
   * Keeps only what may be changed, in the right shape. Unknown fields,
   * locked fields and anything else are dropped silently.
   *   { mentor: { fields: { <id>: { hidden, required, label, help } }, steps: { <n>: {tr,en} } }, mentee: {...} }
   */
  function sanitize(raw) {
    const out = { mentor: { fields: {}, steps: {} }, mentee: { fields: {}, steps: {} }, options: {} };
    const src = raw && typeof raw === "object" ? raw : {};
    for (const form of Object.keys(FORMS)) {
      const s = src[form] && typeof src[form] === "object" ? src[form] : {};
      const fs = s.fields && typeof s.fields === "object" ? s.fields : {};
      for (const def of FORMS[form].fields) {
        if (def.locked) continue;
        const c = fs[def.id];
        if (!c || typeof c !== "object") continue;
        const o = {};
        if (c.hidden === true) o.hidden = true;
        if (def.requirable && typeof c.required === "boolean" && c.required !== def.required) o.required = c.required;
        const label = cleanPair(c.label, TEXT_MAX), help = cleanPair(c.help, HELP_MAX);
        if (label) o.label = label;
        if (help) o.help = help;
        if (Object.keys(o).length) out[form].fields[def.id] = o;
      }
      const st = s.steps && typeof s.steps === "object" ? s.steps : {};
      for (const n of Object.keys(FORMS[form].steps)) {
        const p = cleanPair(st[n], STEP_MAX);
        if (p) out[form].steps[n] = p;
      }
    }

    // Option lists: hidden built-ins (by value) and the organisation's own
    // options. An own option is stored with its English name, else its
    // Turkish name - like the built-ins, whose values are English.
    out.options = {};
    const so = src.options && typeof src.options === "object" ? src.options : {};
    for (const [lid, def] of Object.entries(LISTS)) {
      const c = so[lid] && typeof so[lid] === "object" ? so[lid] : {};
      const builtins = new Set(def.builtins.map(o => o.value));
      const hidden = [...new Set((Array.isArray(c.hidden) ? c.hidden : []).filter(v => builtins.has(v)))];
      const taken = new Set(def.builtins.flatMap(o => [o.value, o.tr, o.en]).filter(Boolean).map(x => x.toLocaleLowerCase("tr")));
      const custom = [];
      for (const o of Array.isArray(c.custom) ? c.custom : []) {
        if (custom.length >= OPTION_MAX) break;
        const tr = cleanText(o && o.tr, OPTION_TEXT_MAX), en = cleanText(o && o.en, OPTION_TEXT_MAX);
        const value = en || tr;
        if (!value) continue;
        const keys = [value, tr, en].filter(Boolean).map(x => x.toLocaleLowerCase("tr"));
        if (keys.some(k => taken.has(k))) continue;          // same as a built-in or an earlier own option
        keys.forEach(k => taken.add(k));
        custom.push({ value, tr, en });
      }
      if (hidden.length || custom.length) out.options[lid] = { hidden, custom };
    }
    return out;
  }

  /** The option lists shown on one form, with the organisation's changes. */
  function listsOf(form, config) {
    const opts = (config && config.options) || {};
    return Object.entries(LISTS).filter(([, d]) => d.places[form]).map(([id, d]) => {
      const c = opts[id] || { hidden: [], custom: [] };
      return { id, ...d, place: d.places[form], hidden: c.hidden || [], custom: c.custom || [] };
    });
  }

  /** The form as an organisation's settings make it: one entry per field. */
  function effective(form, config) {
    const cfg = (config && config[form]) || { fields: {}, steps: {} };
    const fields = FORMS[form].fields.map(def => {
      const c = (!def.locked && cfg.fields && cfg.fields[def.id]) || {};
      const hidden = !!c.hidden;
      const required = !hidden && (def.locked ? def.required : typeof c.required === "boolean" ? c.required : def.required);
      return { ...def, hidden, required, customLabel: c.label || null, customHelp: c.help || null };
    });
    return { fields, steps: (cfg.steps) || {} };
  }

  const filled = v => Array.isArray(v) ? v.some(x => String(x).trim() !== "")
                    : typeof v === "boolean" ? v
                    : v != null && String(v).trim() !== "";

  /**
   * Required, visible, NON-locked fields left empty in a registration.
   * (Locked fields are checked by the form and the route themselves.)
   * Returns the field ids.
   */
  function missing(form, config, data) {
    const d = data || {};
    return effective(form, config).fields
      .filter(f => !f.locked && f.required && !f.keys.some(k => filled(d[k])))
      .map(f => f.id);
  }

  /**
   * Every required field left empty, locked ones included - what the
   * SERVER checks for a registration (the browser can be bypassed).
   */
  function missingAll(form, config, data) {
    const d = data || {};
    return effective(form, config).fields
      .filter(f => f.required && !f.hidden && !f.keys.some(k => filled(d[k])))
      .map(f => f.id);
  }

  /** Text of a field in a language: the organisation's own, or the default. */
  function labelOf(field, lang) {
    const own = field.customLabel && field.customLabel[lang];
    return own || field.label[lang] || field.label.tr;
  }

  const api = { FORMS, LISTS, sanitize, effective, listsOf, missing, missingAll, labelOf, LIMITS: { label: TEXT_MAX, help: HELP_MAX, step: STEP_MAX, options: OPTION_MAX, optionText: OPTION_TEXT_MAX } };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MentorFormSchema = api;
})(typeof window !== "undefined" ? window : this);
