const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");

const config = require("../config");
const settings = require("../db/settings");
const audit = require("../ai/audit");
const { testConnection, resetClient } = require("../ai/client");
const mailer = require("../mail/mailer");
const license = require("../license/state");
const { wrap } = require("./_helpers");

const router = express.Router();

/**
 * ====================================================================
 * YONETICI PANELI
 * ====================================================================
 *
 * ONEMLI: Bu bolum, uygulamanin geri kalanindan AYRI bir sifreyle
 * korunur.
 *
 * Sebep: API_KEY (x-api-key) tum HTML dosyalarinda acikca yazili -
 * yani agdaki herkes onu okuyabilir. Eger admin panelini de o key
 * ile korusaydik, agdaki herkes firmanin Claude anahtarini okuyup
 * degistirebilirdi. Bu yuzden ayri sifre + ayri oturum token'i.
 *
 * Sifre .env icinde ADMIN_PASSWORD_HASH olarak bcrypt ile tutulur.
 * Uretmek icin:  npm run set-admin-password
 */

// --- Oturum yonetimi ---------------------------------------------------

const sessions = new Map();          // token -> { expiresAt }
const SESSION_TTL_MS = 60 * 60 * 1000;   // 1 saat

function createSession() {
  const token = crypto.randomBytes(32).toString("base64url");
  sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"];
  const session = sessions.get(token);

  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return res.status(401).json({ error: "Admin session required" });
  }

  // Kullanildikca uzat
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  next();
}

// Suresi dolmus oturumlari periyodik temizle
setInterval(() => {
  const now = Date.now();
  for (const [token, s] of sessions) {
    if (s.expiresAt < now) sessions.delete(token);
  }
}, 10 * 60 * 1000).unref();

// --- Kaba kuvvet korumasi ---------------------------------------------

const attempts = new Map();          // ip -> { count, until }
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function checkLockout(ip) {
  const record = attempts.get(ip);
  if (!record) return null;

  if (record.until && record.until > Date.now()) {
    const minutes = Math.ceil((record.until - Date.now()) / 60000);
    return `Cok fazla hatali deneme. ${minutes} dakika sonra tekrar deneyin.`;
  }

  if (record.until && record.until <= Date.now()) attempts.delete(ip);
  return null;
}

function recordFailure(ip) {
  const record = attempts.get(ip) || { count: 0 };
  record.count++;

  if (record.count >= MAX_ATTEMPTS) {
    record.until = Date.now() + LOCKOUT_MS;
  }

  attempts.set(ip, record);
}

// =====================================================================
// GIRIS
// =====================================================================

router.post("/admin/login", wrap(async (req, res) => {
  const ip = req.ip || "unknown";

  const lockout = checkLockout(ip);
  if (lockout) return res.status(429).json({ error: lockout });

  /**
   * BULUT SURUMU: yonetici paneli TEDARIKCIYE aittir, firmaya degil.
   *
   * Yerel surumde bu panel firmanin giris sifresiyle aciliyordu.
   * Burada ayni sunucuda birden fazla firma var ve panel; Claude API
   * anahtarini, SMTP bilgilerini ve denetim kaydini iceriyor. Bir
   * musterinin oraya girmesi, diger musterileri de etkileyen ayarlara
   * ve TUM firmalarin AI denetim kaydina erisim demekti.
   *
   * Bu yuzden dogrulama ADMIN_PASSWORD_HASH ile yapilir - firma
   * sifreleriyle hicbir baglantisi yoktur.
   */
  const { password } = req.body;

  if (!config.adminPasswordHash) {
    return res.status(503).json({
      error: "Yonetici sifresi ayarlanmamis.",
      action: "Sunucuda calistirin: npm run set-admin-password"
    });
  }

  if (!bcrypt.compareSync(String(password || ""), config.adminPasswordHash)) {
    recordFailure(ip);
    return res.status(401).json({ error: "Incorrect password" });
  }

  attempts.delete(ip);

  res.json({
    success: true,
    token: createSession(),
    expiresInMinutes: SESSION_TTL_MS / 60000
  });
}));

router.post("/admin/logout", requireAdmin, wrap(async (req, res) => {
  sessions.delete(req.headers["x-admin-token"]);
  res.json({ success: true });
}));

// =====================================================================
// DURUM
// =====================================================================

router.get("/admin/status", requireAdmin, wrap(async (req, res) => {
  res.json({
    ai: settings.getAiConfigPublic(),
    smtp: mailer.getConfigPublic(),
    auth: {
      username: config.superAdminUser,
      isSuperAdmin: true,
      companyCount: require("../db/repos").companies.list().length
    },
    license: license.status(),
    privacy: {
      piiScrubbing: config.privacy.scrubPii
    },
    usage: audit.stats()
  });
}));

// =====================================================================
// E-POSTA SUNUCUSU (SMTP)
// =====================================================================

router.put("/admin/smtp-config", requireAdmin, wrap(async (req, res) => {
  const { host, port, secure, user, password, fromName, fromEmail } = req.body;

  if (!host || !String(host).trim()) {
    return res.status(400).json({ error: "Server address (host) is required" });
  }

  if (!fromEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fromEmail)) {
    return res.status(400).json({ error: "A valid sender email address is required" });
  }

  const portNum = Number(port) || 587;
  if (portNum < 1 || portNum > 65535) {
    return res.status(400).json({ error: "Invalid port" });
  }

  settings.set("smtp.host", String(host).trim());
  settings.set("smtp.port", String(portNum));
  settings.set("smtp.secure", secure ? "true" : "false");
  settings.set("smtp.user", String(user || "").trim());
  settings.set("smtp.fromName", String(fromName || "Mentorluk Programi").trim());
  settings.set("smtp.fromEmail", String(fromEmail).trim());

  // Sifre: sadece YENI bir deger geldiyse yaz (maskeli deger gelirse yok say).
  if (password && !password.includes("...")) {
    settings.set("smtp.password", password, { encrypted: true });
  }

  mailer.resetTransport();

  res.json({
    success: true,
    message: "Email settings saved",
    smtp: mailer.getConfigPublic()
  });
}));

router.post("/admin/test-smtp", requireAdmin, wrap(async (req, res) => {
  res.json(await mailer.testConnection(req.body?.lang || "tr"));
}));

// =====================================================================
// LISANS
// =====================================================================

router.put("/admin/license", requireAdmin, wrap(async (req, res) => {
  const { key, lang = "en" } = req.body;
  const tr = lang === "tr";

  if (!key || !String(key).trim()) {
    return res.status(400).json({
      error: tr ? "Lisans anahtari gerekli." : "A license key is required."
    });
  }

  const result = license.activate(key);

  if (!result.ok) {
    // Neyin yanlis oldugunu SOYLE - "gecersiz" tek basina ise yaramaz.
    const reasons = {
      format: {
        tr: "Anahtar bicimi hatali. Tamamini kopyaladiginizdan emin olun (MENTOROS- ile baslar).",
        en: "The key format is wrong. Make sure you copied all of it (it starts with MENTOROS-)."
      },
      tampered: {
        tr: "Anahtar dogrulanamadi. Kopyalarken bir karakter eksik veya fazla olabilir.",
        en: "The key could not be verified. A character may be missing or extra."
      },
      expired: {
        tr: "Bu anahtarin suresi zaten dolmus.",
        en: "This key has already expired."
      },
      no_public_key: {
        tr: "Bu kurulum lisans dogrulamasi icin yapilandirilmamis. Tedarikciye bildirin.",
        en: "This installation is not configured for license verification. Contact your supplier."
      },
      empty: { tr: "Lisans anahtari bos.", en: "The license key is empty." }
    };

    const r = reasons[result.reason] || reasons.tampered;

    return res.status(400).json({
      error: tr ? r.tr : r.en,
      code: result.reason
    });
  }

  res.json({
    success: true,
    message: tr ? "Lisans etkinlestirildi." : "License activated.",
    license: license.status()
  });
}));

router.get("/admin/license", requireAdmin, wrap(async (req, res) => {
  res.json(license.status());
}));

// =====================================================================
// YAPILANDIRMA
// =====================================================================

const ALLOWED_PROVIDERS = ["anthropic", "bedrock", "vertex"];

router.put("/admin/ai-config", requireAdmin, wrap(async (req, res) => {
  const {
    provider,
    model,
    anthropicApiKey,
    awsRegion,
    awsAccessKeyId,
    awsSecretAccessKey,
    gcpProject,
    gcpRegion
  } = req.body;

  if (!ALLOWED_PROVIDERS.includes(provider)) {
    return res.status(400).json({
      error: `Gecersiz saglayici. Secenekler: ${ALLOWED_PROVIDERS.join(", ")}`
    });
  }

  if (!model || !/^[a-z0-9.\-]+$/i.test(model)) {
    return res.status(400).json({ error: "Invalid model name" });
  }

  settings.set("ai.provider", provider);
  settings.set("ai.model", model);

  // --- Sirlar: sadece YENI bir deger geldiyse yaz. ---
  // Bos gelirse mevcut kayit korunur (kullanici key'i tekrar
  // yazmak zorunda kalmasin diye).

  if (provider === "anthropic") {
    if (anthropicApiKey && !anthropicApiKey.includes("...")) {
      if (!anthropicApiKey.startsWith("sk-ant-")) {
        return res.status(400).json({
          error: "Anthropic API anahtarlari 'sk-ant-' ile baslar. Anahtari kontrol edin."
        });
      }
      settings.set("ai.anthropicApiKey", anthropicApiKey.trim(), { encrypted: true });
    }
  }

  if (provider === "bedrock") {
    if (awsRegion) settings.set("ai.awsRegion", awsRegion.trim());
    if (awsAccessKeyId && !awsAccessKeyId.includes("...")) {
      settings.set("ai.awsAccessKeyId", awsAccessKeyId.trim(), { encrypted: true });
    }
    if (awsSecretAccessKey && !awsSecretAccessKey.includes("...")) {
      settings.set("ai.awsSecretAccessKey", awsSecretAccessKey.trim(), { encrypted: true });
    }
  }

  if (provider === "vertex") {
    if (gcpProject) settings.set("ai.gcpProject", gcpProject.trim());
    if (gcpRegion) settings.set("ai.gcpRegion", gcpRegion.trim());
  }

  // Onbellegi sifirla -> yeni ayar aninda gecerli, restart gerekmez.
  resetClient();

  res.json({
    success: true,
    message: "Settings saved",
    ai: settings.getAiConfigPublic()
  });
}));

// Baglantiyi gercekten test et
router.post("/admin/test-connection", requireAdmin, wrap(async (req, res) => {
  res.json(await testConnection(req.body?.lang || "en"));
}));

// =====================================================================
// DENETIM KAYDI
//
// KVKK icin kritik: yapay zekaya GERCEKTE ne gonderildigini gosterir.
// Admin, isimlerin maskelendigini gozle dogrulayabilir.
// =====================================================================

router.get("/admin/audit", requireAdmin, wrap(async (req, res) => {
  res.json({
    stats: audit.stats(),
    entries: audit.list(Number(req.query.limit) || 25)
  });
}));

router.delete("/admin/audit", requireAdmin, wrap(async (req, res) => {
  audit.clear();
  res.json({ success: true });
}));

module.exports = router;
