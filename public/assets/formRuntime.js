/**
 * ====================================================================
 * REGISTRATION FORM RUNTIME  (stage 5a)
 * ====================================================================
 *
 * Applies an organisation's form settings (assets/formSchema.js) to
 * register.html / mentee_register.html:
 *   - hides fields (every part of a field together: a list and its
 *     "not listed above" box)
 *   - marks required fields with the red asterisk, unmarks optional ones
 *   - replaces a field's label / help text and a step's heading
 *
 *   MentorFormRuntime.init("mentor" | "mentee")
 *   MentorFormRuntime.setConfig(config)   from /public/invite/:token
 *   MentorFormRuntime.apply(lang)         after every language change
 *   MentorFormRuntime.missing(data)       -> [{ id, label }] required + empty
 *
 * Locked fields are never touched.
 */
(function () {
  let FORM = "mentor";
  let CONFIG = null;
  let LANG = "tr";

  const S = () => window.MentorFormSchema;

  function wrappersOf(field) {
    const out = [];
    for (const id of field.anchors) {
      const el = document.getElementById(id);
      const w = el && el.closest(".field");
      if (w && !out.includes(w)) out.push(w);
    }
    return out;
  }

  /** The organisation's text in the page's language only; when it wrote
      none for this language, the form keeps its own text (same language). */
  function pick(pair) {
    return (pair && pair[LANG]) || "";
  }

  function apply(lang) {
    if (lang) LANG = lang === "en" ? "en" : "tr";
    if (!S()) return;
    const eff = S().effective(FORM, CONFIG);

    for (const f of eff.fields) {
      const ws = wrappersOf(f);
      if (!ws.length) continue;
      for (const w of ws) w.style.display = f.hidden ? "none" : "";
      if (f.locked) continue;

      const label = ws[0].querySelector("label");
      if (label) {
        // The element holding the label text: the label itself, or its
        // translated <span> (the "(optional)" marker is a separate span).
        // Only that element is rewritten, so the form's own translation
        // can restore it after a language change.
        const textEl = label.matches("[data-i18n]") ? label
          : (label.querySelector('[data-i18n]:not([data-i18n="optional"])') || label);
        if (f.customLabel && pick(f.customLabel)) {
          if (textEl === label) {
            const opt = label.querySelector('span[data-i18n="optional"], span[style*="9ca3af"]');
            label.textContent = pick(f.customLabel) + (opt ? " " : "");
            if (opt) label.appendChild(opt);
          } else {
            textEl.textContent = pick(f.customLabel);
          }
        }
        label.classList.toggle("req", !!f.required);
        // "(optional)" markers make no sense on a required field.
        label.querySelectorAll('span[data-i18n="optional"], span[style*="9ca3af"]')
          .forEach(sp => { sp.style.display = f.required ? "none" : ""; });
      }

      let help = ws[0].querySelector("[data-form-help]");
      const text = f.customHelp ? pick(f.customHelp) : "";
      if (text) {
        if (!help) {
          help = document.createElement("div");
          help.setAttribute("data-form-help", "");
          help.style.cssText = "font-size:12.5px;color:#6b7280;margin:-2px 0 8px;line-height:1.45";
          if (label) label.insertAdjacentElement("afterend", help); else ws[0].prepend(help);
        }
        help.textContent = text;
      } else if (help) {
        help.remove();
      }
    }

    // "Select or add at least one competency" note follows the field.
    const comp = eff.fields.find(f => f.id === "competencies");
    const note = document.querySelector('[data-i18n="compReqNote"]');
    if (comp && note) note.style.display = comp.required && !comp.hidden ? "" : "none";

    // Step headings
    for (const [n, pair] of Object.entries(eff.steps || {})) {
      const el = document.querySelector(`#step${n} .section-title`);
      if (el && pick(pair)) el.textContent = pick(pair);
    }
  }

  /** Required, visible fields left empty: [{ id, label }] in form order. */
  function missing(data) {
    if (!S()) return [];
    const ids = S().missing(FORM, CONFIG, data);
    const eff = S().effective(FORM, CONFIG);
    return ids.map(id => {
      const f = eff.fields.find(x => x.id === id);
      return { id, label: S().labelOf(f, LANG) };
    });
  }

  window.MentorFormRuntime = {
    init(form) { FORM = form === "mentee" ? "mentee" : "mentor"; },
    setConfig(config) { CONFIG = config || null; apply(); },
    getConfig() { return CONFIG; },
    apply,
    missing
  };
})();
