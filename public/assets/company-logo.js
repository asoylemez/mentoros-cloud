/**
 * ====================================================================
 * ORGANISATION LOGO ON A PAGE
 * ====================================================================
 *
 * Puts the organisation's logo at the start of the page header.
 *
 *   Staff pages:        <script src="/assets/company-logo.js" data-staff></script>
 *                       - reads the signed-in organisation (/my-company)
 *   Participant pages:  <script src="/assets/company-logo.js"></script>
 *                       - the page calls MentorOSLogo.show(data.logoUrl)
 *                         once it has loaded its own data (token pages
 *                         have no session)
 *
 * Where it goes: an element marked data-company-logo, otherwise the
 * page's brand block (.app-brand, .brand, .topbar). Shown at a fixed
 * height - the server does not resize images.
 */
(function () {
  function target() {
    return document.querySelector("[data-company-logo]") ||
           document.querySelector(".app-brand") ||
           document.querySelector(".brand") ||
           document.querySelector(".topbar");
  }

  function show(url) {
    let img = document.querySelector("img[data-company-logo-img]");
    if (!url) { if (img) img.remove(); return; }
    if (!img) {
      const box = target();
      if (!box) return;
      img = document.createElement("img");
      img.setAttribute("data-company-logo-img", "");
      img.alt = "";
      img.style.cssText = "height:38px;max-width:170px;width:auto;object-fit:contain;display:inline-block;" +
                          "vertical-align:middle;margin-right:14px;flex:0 0 auto;";
      if (box.hasAttribute("data-company-logo")) box.appendChild(img);
      else box.insertBefore(img, box.firstChild);
    }
    img.src = url;
  }

  async function loadForStaff() {
    try {
      const res = await fetch("/my-company");
      if (!res.ok) return;
      const d = await res.json();
      show(d.logo && d.logo.url);
    } catch { /* the logo is optional */ }
  }

  window.MentorOSLogo = { show, loadForStaff };

  const me = document.currentScript;
  if (me && me.hasAttribute("data-staff")) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", loadForStaff);
    else loadForStaff();
  }
})();
