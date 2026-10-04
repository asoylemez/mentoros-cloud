/**
 * ====================================================================
 * REPORT PRINTING  (PDF through the browser's own print dialogue)
 * ====================================================================
 *
 * MentorOSPrint.printReport({ title, subtitle, sections, footer, landscape })
 * builds a clean report page and opens the print dialogue, where the user
 * picks "Save as PDF". No PDF library: nothing to install.
 *
 *   sections: { title, rows: [{label, value}] } | { note } |
 *             { title, table: { columns, rows }, emptyText }
 *
 * Adapted from the on-premises version's brand.js, without the logo
 * image (the cloud has no image to wait for before printing).
 */
(function () {
  const CSS = `
  #mos-print { display: none; }

  @media print {
    /* Hide the application, show only the report. */
    body > *:not(#mos-print) { display: none !important; }

    #mos-print {
      display: block !important;
      font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
      color: #1a1f36;
      font-size: 11pt;
      line-height: 1.45;
    }

    @page { margin: 18mm 16mm; }

    /* A table, not flexbox.
       Print engines vary in their flexbox support, and a report that
       collapses on one of them is worse than a plainer layout that
       holds everywhere. Tables and inline-block are understood by
       every engine. */
    .mos-p-head { width: 100%; border-bottom: 2px solid #101b3f;
                  padding-bottom: 10px; margin-bottom: 18px; }
    .mos-p-head td { vertical-align: top; padding: 0; border: 0; }
    .mos-p-brand { font-weight: 700; color: #101b3f; font-size: 13pt; }

    .mos-p-title { font-size: 17pt; font-weight: 700; margin: 0 0 3px; }
    .mos-p-sub   { font-size: 10pt; color: #5b6478; margin: 0; }

    .mos-p-section {
      margin: 0 0 16px;
      /* Keep a heading with its content instead of stranding it at the
         bottom of a page. */
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .mos-p-section h2 {
      font-size: 10pt;
      text-transform: uppercase;
      letter-spacing: .06em;
      color: #5b6478;
      border-bottom: 1px solid #dfe3ec;
      padding-bottom: 4px;
      margin: 0 0 8px;
    }

    .mos-p-row { width: 100%; padding: 3px 0; break-inside: avoid; }
    .mos-p-row td { vertical-align: top; padding: 2px 0; border: 0; }
    .mos-p-label { width: 38%; color: #5b6478; padding-right: 12px !important; }
    .mos-p-value { font-weight: 500; white-space: pre-wrap; }
    .mos-p-note {
      border: 1px solid #e8c56b; background: #fff8e6; color: #6b4e00;
      border-radius: 6px; padding: 8px 10px; font-size: 11px; line-height: 1.5; margin: 0;
    }
    .mos-p-table td { white-space: pre-wrap; }

    .mos-p-table { width: 100%; border-collapse: collapse; font-size: 10pt; }
    .mos-p-table th {
      text-align: left;
      background: #f4f5f9;
      border-bottom: 1px solid #cfd5e4;
      padding: 6px 8px;
      font-size: 9pt;
      text-transform: uppercase;
      letter-spacing: .04em;
      color: #5b6478;
    }
    .mos-p-table td {
      padding: 6px 8px;
      border-bottom: 1px solid #e8ebf2;
      vertical-align: top;
    }
    /* Repeat the header when a table runs across pages. */
    .mos-p-table thead { display: table-header-group; }
    .mos-p-table tr { break-inside: avoid; }

    .mos-p-cards { margin: 0; }
    .mos-p-card {
      display: inline-block;
      vertical-align: top;
      border: 1px solid #dfe3ec;
      border-radius: 6px;
      padding: 8px 16px;
      margin: 0 8px 8px 0;
      min-width: 96px;
      text-align: center;
    }
    .mos-p-card .n { font-size: 20pt; font-weight: 700; color: #101b3f; }
    .mos-p-card .l { font-size: 9pt; color: #5b6478; }

    .mos-p-foot {
      margin-top: 22px;
      padding-top: 8px;
      border-top: 1px solid #dfe3ec;
      font-size: 8.5pt;
      color: #8a93a8;
    }
  }`;

  function injectStyles() {
    if (document.getElementById("mos-print-css")) return;
    const el = document.createElement("style");
    el.id = "mos-print-css";
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  const esc = v => String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function renderSection(section) {
    let body = "";
    if (section.rows) {
      body = section.rows.filter(r => r && r.value !== "" && r.value != null)
        .map(r => `<tr><td class="mos-p-label">${esc(r.label)}</td><td class="mos-p-value">${esc(r.value)}</td></tr>`).join("");
      if (!body) return "";
      body = `<table class="mos-p-row"><tbody>${body}</tbody></table>`;
    }
    if (section.note) body = `<p class="mos-p-note">${esc(section.note)}</p>`;
    if (section.table) {
      const { columns, rows } = section.table;
      body = !rows || !rows.length
        ? `<p class="mos-p-value">${esc(section.emptyText || "-")}</p>`
        : `<table class="mos-p-table">
             <thead><tr>${columns.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>
             <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
           </table>`;
    }
    return `<div class="mos-p-section">${section.title ? `<h2>${esc(section.title)}</h2>` : ""}${body}</div>`;
  }

  function printReport(opts) {
    injectStyles();
    const old = document.getElementById("mos-print");
    if (old) old.remove();
    const oldOrient = document.getElementById("mos-print-orient");
    if (oldOrient) oldOrient.remove();
    if (opts.landscape) {
      const st = document.createElement("style");
      st.id = "mos-print-orient";
      st.textContent = "@page { size: A4 landscape; margin: 12mm 12mm; } .mos-p-table { font-size: 8.5pt; }";
      document.head.appendChild(st);
    }
    const stamp = new Date().toLocaleString(opts.lang === "en" ? "en-GB" : "tr-TR");
    const container = document.createElement("div");
    container.id = "mos-print";
    container.innerHTML = `
      <table class="mos-p-head"><tbody><tr>
        <td><p class="mos-p-title">${esc(opts.title)}</p>${opts.subtitle ? `<p class="mos-p-sub">${esc(opts.subtitle)}</p>` : ""}</td>
        <td style="text-align:right;width:170px"><span class="mos-p-brand">MentorOS</span></td>
      </tr></tbody></table>
      ${(opts.sections || []).map(renderSection).join("")}
      <div class="mos-p-foot">${esc(opts.footer || "MentorOS")} &middot; ${esc(stamp)}</div>`;
    document.body.appendChild(container);
    window.print();
    setTimeout(() => {
      container.remove();
      const o = document.getElementById("mos-print-orient");
      if (o) o.remove();
    }, 500);
  }

  window.MentorOSPrint = { printReport };
})();
