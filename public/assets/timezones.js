/**
 * Time zones offered for events (stage 6a): a curated list of IANA zone
 * names, shown as "(GMT+3) İstanbul". The offset is worked out by the
 * browser for the given date, so summer time is right.
 *
 *   MentorTimeZones.options(lang, selected, atDate) -> <option> HTML
 *   MentorTimeZones.label(tz, lang, atDate)
 */
(function () {
  const Z = [
    ["UTC", "UTC", "UTC"],
    ["Europe/Istanbul", "İstanbul", "Istanbul"], ["Europe/London", "Londra", "London"], ["Europe/Dublin", "Dublin", "Dublin"],
    ["Europe/Lisbon", "Lizbon", "Lisbon"], ["Europe/Madrid", "Madrid", "Madrid"], ["Europe/Paris", "Paris", "Paris"],
    ["Europe/Brussels", "Brüksel", "Brussels"], ["Europe/Amsterdam", "Amsterdam", "Amsterdam"], ["Europe/Berlin", "Berlin", "Berlin"],
    ["Europe/Zurich", "Zürih", "Zurich"], ["Europe/Rome", "Roma", "Rome"], ["Europe/Vienna", "Viyana", "Vienna"],
    ["Europe/Stockholm", "Stockholm", "Stockholm"], ["Europe/Warsaw", "Varşova", "Warsaw"], ["Europe/Athens", "Atina", "Athens"],
    ["Europe/Bucharest", "Bükreş", "Bucharest"], ["Europe/Sofia", "Sofya", "Sofia"], ["Europe/Kyiv", "Kiev", "Kyiv"],
    ["Europe/Moscow", "Moskova", "Moscow"], ["Asia/Tbilisi", "Tiflis", "Tbilisi"], ["Asia/Baku", "Bakü", "Baku"],
    ["Asia/Dubai", "Dubai", "Dubai"], ["Asia/Riyadh", "Riyad", "Riyadh"], ["Asia/Qatar", "Doha", "Doha"],
    ["Africa/Cairo", "Kahire", "Cairo"], ["Africa/Lagos", "Lagos", "Lagos"], ["Africa/Johannesburg", "Johannesburg", "Johannesburg"],
    ["Asia/Tehran", "Tahran", "Tehran"], ["Asia/Karachi", "Karaçi", "Karachi"], ["Asia/Tashkent", "Taşkent", "Tashkent"],
    ["Asia/Almaty", "Almatı", "Almaty"], ["Asia/Kolkata", "Hindistan (Kalküta)", "India (Kolkata)"], ["Asia/Singapore", "Singapur", "Singapore"],
    ["Asia/Shanghai", "Şanghay", "Shanghai"], ["Asia/Tokyo", "Tokyo", "Tokyo"], ["Australia/Sydney", "Sidney", "Sydney"],
    ["America/Sao_Paulo", "São Paulo", "São Paulo"], ["America/New_York", "New York", "New York"], ["America/Toronto", "Toronto", "Toronto"],
    ["America/Chicago", "Chicago", "Chicago"], ["America/Mexico_City", "Meksiko", "Mexico City"], ["America/Denver", "Denver", "Denver"],
    ["America/Los_Angeles", "Los Angeles", "Los Angeles"]
  ];

  function offset(tz, at) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(at);
      const p = parts.find(x => x.type === "timeZoneName");
      return p ? p.value.replace("GMT", "GMT").replace(/^GMT$/, "GMT+0") : "";
    } catch { return ""; }
  }
  const cityOf = (tz, lang) => {
    const z = Z.find(x => x[0] === tz);
    return z ? (lang === "en" ? z[2] : z[1]) : String(tz).split("/").pop().replace(/_/g, " ");
  };
  const label = (tz, lang, at) => `(${offset(tz, at || new Date())}) ${cityOf(tz, lang)}`;

  function options(lang, selected, at) {
    const list = Z.map(z => z[0]);
    if (selected && !list.includes(selected)) list.unshift(selected);   // a zone set elsewhere stays selectable
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    return list.map(tz => `<option value="${esc(tz)}"${tz === selected ? " selected" : ""}>${esc(label(tz, lang, at))}</option>`).join("");
  }

  window.MentorTimeZones = { ZONES: Z.map(z => z[0]), options, label, cityOf };
})();
