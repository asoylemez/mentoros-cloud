/**
 * ====================================================================
 * XLSX ON THE SERVER  (V11 - no dependency)
 * ====================================================================
 *
 * An .xlsx file is a ZIP of XML files. Node already has zlib, so reading
 * and writing need no Excel library (the package has none; see also
 * public/assets/xlsx.js, the browser's writer for reports).
 *
 *   read(buffer)   -> [{ name, rows: [[cell, ...], ...] }]   cells are strings
 *   write(sheets)  -> Buffer (a template: header styles, column widths,
 *                     text columns, drop-down lists)
 *
 * READING is defensive - the file comes from outside:
 *   - only the parts we need are unzipped; every part and the total are
 *     size-limited (a "zip bomb" stops with an error, not a full disk);
 *   - Excel, LibreOffice and Google Sheets files are read the same way
 *     (shared strings, inline strings, numbers, booleans, namespace
 *     prefixes such as <x:c>);
 *   - formulas are never evaluated: the value Excel saved is used.
 */
const zlib = require("zlib");

const LIMITS = {
  partBytes: 30 * 1024 * 1024,     // one unzipped XML part
  totalBytes: 60 * 1024 * 1024,    // everything unzipped together
  maxRows: 5000,                   // rows read per sheet (the caller limits people)
  maxCols: 60
};

class XlsxError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// --------------------------------------------------------------------
// ZIP reading
// --------------------------------------------------------------------

function unzipEntries(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new XlsxError("not_xlsx", "Not an .xlsx file.");
  // End of central directory: last 22 bytes + up to 64 KB comment.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new XlsxError("not_xlsx", "Not an .xlsx file.");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new XlsxError("bad_zip", "The file is damaged.");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString("utf8").replace(/\\/g, "/").replace(/^\//, "");
    entries.set(name.toLowerCase(), { name, method, csize, usize, local });
    p += 46 + nlen + xlen + clen;
  }
  let used = 0;
  return {
    has: n => entries.has(String(n).toLowerCase()),
    text(n) {
      const e = entries.get(String(n).toLowerCase());
      if (!e) return null;
      if (e.local + 30 > buf.length || buf.readUInt32LE(e.local) !== 0x04034b50) throw new XlsxError("bad_zip", "The file is damaged.");
      const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
      const data = buf.slice(start, start + e.csize);
      let out;
      if (e.method === 0) out = data;
      else if (e.method === 8) {
        try { out = zlib.inflateRawSync(data, { maxOutputLength: LIMITS.partBytes }); }
        catch (err) {
          if (err.code === "ERR_BUFFER_TOO_LARGE" || /maxOutputLength|too large/i.test(err.message)) {
            throw new XlsxError("too_large", "The file is too large.");
          }
          throw new XlsxError("bad_zip", "The file is damaged.");
        }
      } else throw new XlsxError("bad_zip", "The file uses an unsupported compression.");
      used += out.length;
      if (out.length > LIMITS.partBytes || used > LIMITS.totalBytes) throw new XlsxError("too_large", "The file is too large.");
      return out.toString("utf8");
    }
  };
}

// --------------------------------------------------------------------
// XML helpers (the parts are machine-written; regular expressions are enough)
// --------------------------------------------------------------------

const decode = s => String(s)
  .replace(/_x([0-9a-fA-F]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16)))   // Excel's own escape (_x000D_)
  .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&amp;/g, "&");

/** <x:c> -> <c>, </x:c> -> </c> : namespace prefixes on tags only. */
const unprefix = xml => String(xml || "").replace(/<(\/?)[A-Za-z_][\w.-]*:/g, "<$1");

function attrs(s) {
  const o = {};
  String(s || "").replace(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g, (m, k, _q, a, b) => { o[k] = decode(a != null ? a : b); return ""; });
  return o;
}

/** All text of <t> elements inside a piece, phonetic runs (<rPh>) left out. */
function textOf(piece) {
  const clean = String(piece).replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  clean.replace(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g, (m, t) => { out += t ? decode(t) : ""; return ""; });
  return out;
}

function colIndex(ref) {
  const m = /^([A-Z]+)/i.exec(String(ref || ""));
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Excel stores 3 as 3, but 0.1+0.2 as 0.30000000000000004: show what the person typed. */
function numText(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return String(Math.round(n * 1e9) / 1e9);
}

function resolveTarget(base, target) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

/**
 * Reads every worksheet. Returns [{ name, rows }], rows as arrays of
 * strings ("" for an empty cell), trailing empty rows dropped.
 */
function read(buf) {
  const zip = unzipEntries(buf);
  const wbXml = unprefix(zip.text("xl/workbook.xml"));
  if (!wbXml) throw new XlsxError("not_xlsx", "Not an .xlsx file.");

  const rels = {};
  unprefix(zip.text("xl/_rels/workbook.xml.rels") || "").replace(/<Relationship\b([^>]*)\/?>/g, (m, a) => {
    const at = attrs(a); if (at.Id && at.Target) rels[at.Id] = resolveTarget("xl/workbook.xml", at.Target); return "";
  });

  const shared = [];
  const ss = unprefix(zip.text("xl/sharedStrings.xml") || "");
  ss.replace(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g, (m, inner) => { shared.push(inner ? textOf(inner) : ""); return ""; });

  const sheets = [];
  wbXml.replace(/<sheet\b([^>]*)\/?>/g, (m, a) => {
    const at = attrs(a);
    const rid = at["r:id"] || Object.entries(at).find(([k]) => /(^|:)id$/.test(k) && k !== "sheetId")?.[1];
    const target = rels[rid] || `xl/worksheets/sheet${sheets.length + 1}.xml`;
    sheets.push({ name: at.name || `Sheet${sheets.length + 1}`, target });
    return "";
  });

  return sheets.map(s => {
    const xml = unprefix(zip.text(s.target) || "");
    const data = (/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/.exec(xml) || [])[1] || "";
    const rows = [];
    let rowNo = 0;
    data.replace(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g, (m, ra, inner) => {
      const r = Number(attrs(ra).r) || rowNo + 1;
      rowNo = r;
      if (r > LIMITS.maxRows) return "";
      const cells = [];
      let col = -1;
      String(inner || "").replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (cm, ca, cin) => {
        const at = attrs(ca);
        col = at.r ? colIndex(at.r) : col + 1;
        if (col < 0 || col >= LIMITS.maxCols) return "";
        const v = (/<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cin || "") || [])[1];
        let val = "";
        switch (at.t) {
          case "s": val = shared[Number(v)] ?? ""; break;
          case "inlineStr": val = textOf((/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(cin || "") || [])[1] || ""); break;
          case "str": val = v != null ? decode(v) : ""; break;
          case "b": val = v === "1" ? "TRUE" : v === "0" ? "FALSE" : ""; break;
          case "e": val = ""; break;                            // #N/A, #REF! ... -> empty
          default: val = v != null ? numText(decode(v)) : "";
        }
        cells[col] = val;
        return "";
      });
      for (let i = 0; i < cells.length; i++) if (cells[i] == null) cells[i] = "";
      rows[r - 1] = cells;
      return "";
    });
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    while (rows.length && rows[rows.length - 1].every(c => String(c).trim() === "")) rows.pop();
    return { name: s.name, rows };
  });
}

// --------------------------------------------------------------------
// Writing (templates)
// --------------------------------------------------------------------

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function zip(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const raw = Buffer.from(f.data, "utf8");
    const data = zlib.deflateRawSync(raw);
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, name, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10); cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += 30 + name.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}

const esc = v => String(v)
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function colName(i) {
  let s = "";
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

/**
 * Cell styles (index = s attribute):
 *   0 normal, 1 bold header, 2 header navy, 3 header blue (mentor),
 *   4 header copper (mentee), 5 header grey (filled by the system),
 *   6 text cell (@ - "0001" stays "0001"), 7 wrapped text, 8 bold title
 */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="13"/><color rgb="FF1A2B5E"/><name val="Calibri"/></font></fonts>
<fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1A2B5E"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF3657FF"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFB5651D"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF9AA3B5"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="49" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="2" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="2" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const STYLE = { normal: 0, bold: 1, navy: 2, blue: 3, copper: 4, grey: 5, text: 6, wrap: 7, title: 8 };

/**
 * sheets: [{
 *   name, rows: [[value | {v, s}]], widths: [n], freeze: true,
 *   headerHeight, colStyles: { colIndex: styleName } (empty cells too, rows 2..styleRows),
 *   styleRows, validations: [{ sqref, type: "list"|"whole", list: [..], min, max, prompt, error }]
 * }]
 */
function sheetXml(s) {
  const rows = s.rows || [];
  const styleRows = s.styleRows || 0;
  const colStyles = s.colStyles || {};
  const total = Math.max(rows.length, styleRows);
  let body = "";
  for (let r = 0; r < total; r++) {
    const row = rows[r] || [];
    const width = Math.max(row.length, r > 0 && r < styleRows ? Object.keys(colStyles).reduce((a, k) => Math.max(a, Number(k) + 1), 0) : 0);
    let cells = "";
    for (let c = 0; c < width; c++) {
      const raw = row[c];
      const obj = raw && typeof raw === "object" ? raw : { v: raw };
      const styleName = obj.s || (r > 0 && colStyles[c]) || "";
      const sAttr = styleName ? ` s="${STYLE[styleName] ?? 0}"` : "";
      const ref = colName(c) + (r + 1);
      const v = obj.v;
      if (v == null || v === "") { if (sAttr) cells += `<c r="${ref}"${sAttr}/>`; continue; }
      if (typeof v === "number" && isFinite(v)) cells += `<c r="${ref}"${sAttr}><v>${v}</v></c>`;
      else cells += `<c r="${ref}" t="inlineStr"${sAttr}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }
    const ht = r === 0 && s.headerHeight ? ` ht="${s.headerHeight}" customHeight="1"` : "";
    body += `<row r="${r + 1}"${ht}>${cells}</row>`;
  }
  const cols = (s.widths || []).length
    ? `<cols>${s.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"${colStyles[i] ? ` style="${STYLE[colStyles[i]]}"` : ""}/>`).join("")}</cols>` : "";
  const pane = s.freeze ? `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>` : "";
  const dv = (s.validations || []).map(v => {
    const common = `allowBlank="1" showInputMessage="${v.prompt ? 1 : 0}" showErrorMessage="1" sqref="${v.sqref}"` +
      (v.prompt ? ` promptTitle="${esc(v.promptTitle || "")}" prompt="${esc(v.prompt)}"` : "") +
      (v.error ? ` errorTitle="${esc(v.errorTitle || "")}" error="${esc(v.error)}"` : "");
    if (v.type === "list") return `<dataValidation type="list" ${common}><formula1>"${esc(v.list.join(","))}"</formula1></dataValidation>`;
    return `<dataValidation type="whole" operator="between" ${common}><formula1>${v.min}</formula1><formula2>${v.max}</formula2></dataValidation>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"${s.tabSelected ? ' tabSelected="1"' : ""}>${pane}</sheetView></sheetViews>${cols}<sheetData>${body}</sheetData>${dv ? `<dataValidations count="${(s.validations || []).length}">${dv}</dataValidations>` : ""}</worksheet>`;
}

function write(sheets) {
  const names = sheets.map(s => String(s.name).replace(/[\[\]:*?\/\\]/g, " ").slice(0, 31));
  const files = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) }))
  ];
  return zip(files);
}

module.exports = { read, write, XlsxError, LIMITS, _colName: colName };
