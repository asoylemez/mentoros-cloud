const crypto = require("crypto");
const { db, now, slugify } = require("../db");

/**
 * ====================================================================
 * COMPANY LOGO
 * ====================================================================
 *
 * Each organisation can have one logo. HR uploads it from its own
 * "Organisation settings" page; the super admin can replace or remove it.
 *
 *   - PNG or JPG only, at most 500 KB. The type is decided by the file's
 *     first bytes, not by its name. SVG is refused on purpose: an SVG can
 *     carry script.
 *   - No resizing on the server (no image library): pages show it at a
 *     fixed height.
 *   - Public URL /logo/<token>: the token is random and new on every
 *     upload, so the URL cannot be guessed and can be cached for long.
 *   - E-mails carry the logo embedded (CID), not as a remote image.
 */

const MAX_BYTES = 500 * 1024;

/** "image/png" | "image/jpeg" | null, from the file's own header. */
function sniff(buf) {
  if (!buf || buf.length < 8) return null;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  return null;
}

const logos = {
  MAX_BYTES,

  /** Checks and stores a logo. Returns { error, code } or { logo }. */
  set(companyId, data, updatedBy = "") {
    if (!data || !data.length) return { error: "The file is empty.", code: "empty_file" };
    if (data.length > MAX_BYTES) return { error: "The logo can be at most 500 KB.", code: "logo_too_big", limit: MAX_BYTES };
    const mime = sniff(data);
    if (!mime) return { error: "The logo must be a PNG or JPG image.", code: "logo_bad_type" };
    const cid = slugify(companyId);
    const token = crypto.randomBytes(16).toString("hex");
    db.prepare(`
      INSERT INTO company_logos (company_id, mime, data, size, token, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(company_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, size = excluded.size,
        token = excluded.token, updated_at = excluded.updated_at, updated_by = excluded.updated_by
    `).run(cid, mime, data, data.length, token, now(), updatedBy);
    return { logo: logos.info(cid) };
  },

  remove(companyId) {
    return db.prepare(`DELETE FROM company_logos WHERE company_id = ?`).run(slugify(companyId)).changes;
  },

  /** { url, mime, size, updatedAt, updatedBy } or null - no image bytes. */
  info(companyId) {
    const r = db.prepare(`SELECT mime, size, token, updated_at, updated_by FROM company_logos WHERE company_id = ?`)
      .get(slugify(companyId));
    return r ? { url: `/logo/${r.token}`, mime: r.mime, size: r.size, updatedAt: r.updated_at, updatedBy: r.updated_by } : null;
  },

  url(companyId) {
    const i = logos.info(companyId);
    return i ? i.url : "";
  },

  byToken(token) {
    if (!/^[0-9a-f]{32}$/.test(String(token || ""))) return null;
    return db.prepare(`SELECT mime, data FROM company_logos WHERE token = ?`).get(String(token)) || null;
  },

  /** The image itself, for embedding in an e-mail. */
  image(companyId) {
    return db.prepare(`SELECT mime, data FROM company_logos WHERE company_id = ?`).get(slugify(companyId)) || null;
  }
};

module.exports = { logos, sniff };
