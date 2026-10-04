const settings = require("../db/settings");
const schema = require("../public/assets/formSchema.js");

/**
 * An organisation's registration form settings (stage 5a), kept in the
 * settings table as "form_config:<companyId>" (JSON). Nothing stored =
 * the forms as they ship. The rules of what may change live in
 * public/assets/formSchema.js - shared with the browser.
 */
const keyOf = companyId => `form_config:${String(companyId || "")}`;

function get(companyId) {
  const raw = settings.get(keyOf(companyId), null);
  if (!raw) return schema.sanitize({});
  try { return schema.sanitize(JSON.parse(raw)); } catch { return schema.sanitize({}); }
}

function isDefault(companyId) {
  return !settings.get(keyOf(companyId), null);
}

function save(companyId, raw) {
  const clean = schema.sanitize(raw);
  settings.set(keyOf(companyId), JSON.stringify(clean));
  return clean;
}

function reset(companyId) {
  settings.remove(keyOf(companyId));
  return schema.sanitize({});
}

/** Required fields (locked ones included) a registration left empty. */
function missing(companyId, form, body) {
  return schema.missingAll(form, get(companyId), body || {});
}

module.exports = { get, isDefault, save, reset, missing, keyOf, schema };
