const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { db, now } = require("./index");

/**
 * ====================================================================
 * AYAR DEPOSU
 * ====================================================================
 *
 * Yapay zeka baglantisi buradan yonetilir. Tasarim kararlari:
 *
 * 1. Ayarlar .env'de DEGIL veritabaninda tutulur.
 *    Sebep: admin panelden degistirilebilmesi ve sunucunun yeniden
 *    baslatilmasina gerek kalmamasi icin.
 *
 * 2. API key'ler DUZ METIN saklanmaz. AES-256-GCM ile sifrelenir.
 *    Sifreleme anahtari .env icindeki SETTINGS_SECRET'tir; yoksa
 *    ilk aciliste uretilip .env'e yazilir.
 *
 * 3. Key'ler hicbir zaman tarayiciya geri donmez. Sadece maskeli
 *    hali gosterilir: sk-ant-...4f2a
 */

// --- Sifreleme anahtari ------------------------------------------------

function loadOrCreateSecret() {
  if (process.env.SETTINGS_SECRET) return process.env.SETTINGS_SECRET;

  const secret = crypto.randomBytes(32).toString("hex");
  const envPath = path.resolve(".env");

  try {
    const line = `\n# Otomatik uretildi - ayarlardaki API key'leri sifreler.\n` +
                 `# Bu satiri SILMEYIN, yoksa kayitli key'ler okunamaz.\n` +
                 `SETTINGS_SECRET=${secret}\n`;
    fs.appendFileSync(envPath, line, { mode: 0o600 });
    console.log("  .env icine SETTINGS_SECRET uretildi.");
  } catch (err) {
    console.warn(
      "  UYARI: SETTINGS_SECRET .env'e yazilamadi. Sunucu her yeniden " +
      "baslatildiginda kayitli API key'i tekrar girmeniz gerekecek."
    );
  }

  process.env.SETTINGS_SECRET = secret;
  return secret;
}

function key() {
  return crypto.createHash("sha256")
    .update(loadOrCreateSecret())
    .digest();
}

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([
    cipher.update(String(plaintext), "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  return [iv, tag, enc].map(b => b.toString("base64")).join(".");
}

function decrypt(payload) {
  try {
    const [ivB64, tagB64, dataB64] = String(payload).split(".");
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key(),
      Buffer.from(ivB64, "base64")
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));

    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    // SETTINGS_SECRET degismis olabilir -> eski kayit okunamaz.
    return null;
  }
}

// --- Okuma / yazma -----------------------------------------------------

function get(name, fallback = null) {
  const row = db.prepare(`SELECT value, encrypted FROM settings WHERE key = ?`)
    .get(name);

  if (!row || row.value === null || row.value === "") return fallback;

  return row.encrypted ? (decrypt(row.value) ?? fallback) : row.value;
}

function set(name, value, { encrypted = false, updatedBy = "admin" } = {}) {
  db.prepare(`
    INSERT INTO settings (key, value, encrypted, updated_at, updated_by)
    VALUES (@key, @value, @encrypted, @updatedAt, @updatedBy)
    ON CONFLICT(key) DO UPDATE SET
      value      = excluded.value,
      encrypted  = excluded.encrypted,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `).run({
    key: name,
    value: value === null || value === undefined
      ? null
      : (encrypted ? encrypt(value) : String(value)),
    encrypted: encrypted ? 1 : 0,
    updatedAt: now(),
    updatedBy
  });
}

function remove(name) {
  db.prepare(`DELETE FROM settings WHERE key = ?`).run(name);
}

/** "sk-ant-api03-xxxx...4f2a" -> "sk-ant-...4f2a" */
function mask(value) {
  if (!value) return "";
  const s = String(value);
  if (s.length <= 12) return "***";
  return `${s.slice(0, 7)}...${s.slice(-4)}`;
}

// --- Yapay zeka yapilandirmasi -----------------------------------------

/**
 * Etkin AI ayarlarini doner.
 *
 * Oncelik: veritabani (admin paneli) > .env > varsayilan
 * Boylece gelistirici .env ile calisabilir, musteri panelden baglar.
 */
function getAiConfig() {
  const config = require("../config");

  // Musteri kurulumunda .env'deki anahtarlar YOK SAYILIR.
  // Boylece gelistiricinin anahtari kazara kullanilamaz.
  const envKey = name =>
    config.customerDeployment ? "" : (process.env[name] || "");

  const provider = get("ai.provider", process.env.AI_PROVIDER || "anthropic");
  const model = get("ai.model", process.env.AI_MODEL || "claude-sonnet-5");

  const cfg = {
    provider,
    model,
    anthropicApiKey: get("ai.anthropicApiKey", envKey("ANTHROPIC_API_KEY")),
    awsRegion: get("ai.awsRegion", process.env.AWS_REGION || "eu-central-1"),
    awsAccessKeyId: get("ai.awsAccessKeyId", envKey("AWS_ACCESS_KEY_ID")),
    awsSecretAccessKey: get("ai.awsSecretAccessKey", envKey("AWS_SECRET_ACCESS_KEY")),
    gcpProject: get("ai.gcpProject", envKey("GOOGLE_CLOUD_PROJECT")),
    gcpRegion: get("ai.gcpRegion", process.env.CLOUD_ML_REGION || "europe-west1")
  };

  /**
   * Anahtar NEREDEN geliyor?
   *   "panel" -> kurum kendi anahtarini girmis (istenen durum)
   *   "env"   -> .env dosyasindan, yani GELISTIRICININ anahtari
   *   null    -> hic yok
   *
   * Bu ayrim onemli: panel "bagli" gorunup aslinda gelistiricinin
   * anahtariyla calisiyorsa, fatura yanlis kisiye gider.
   */
  const fromPanel = !!(
    get("ai.anthropicApiKey") ||
    get("ai.awsAccessKeyId") ||
    get("ai.gcpProject")
  );

  cfg.source = fromPanel ? "panel" : (
    (cfg.anthropicApiKey || cfg.awsAccessKeyId || cfg.gcpProject) ? "env" : null
  );

  // Yapilandirma tamam mi?
  if (provider === "anthropic") {
    cfg.configured = !!cfg.anthropicApiKey;
  } else if (provider === "bedrock") {
    cfg.configured = !!(cfg.awsAccessKeyId && cfg.awsSecretAccessKey);
  } else if (provider === "vertex") {
    cfg.configured = !!cfg.gcpProject;
  } else {
    cfg.configured = false;
  }

  return cfg;
}

/** Panelde gosterilecek hali - HICBIR SIR icermez. */
function getAiConfigPublic() {
  const cfg = getAiConfig();

  return {
    provider: cfg.provider,
    model: cfg.model,
    configured: cfg.configured,
    source: cfg.source,                    // "panel" | "env" | null
    usingDeveloperKey: cfg.source === "env",
    anthropicApiKeyMasked: mask(cfg.anthropicApiKey),
    awsRegion: cfg.awsRegion,
    awsAccessKeyIdMasked: mask(cfg.awsAccessKeyId),
    gcpProject: cfg.gcpProject,
    gcpRegion: cfg.gcpRegion,
    updatedAt: db.prepare(
      `SELECT MAX(updated_at) AS t FROM settings WHERE key LIKE 'ai.%'`
    ).get()?.t || null
  };
}

module.exports = {
  get, set, remove, mask,
  getAiConfig, getAiConfigPublic
};
