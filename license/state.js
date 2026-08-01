const fs = require("fs");
const path = require("path");

const { db, now } = require("../db");
const settings = require("../db/settings");
const { verify, mask } = require("./verify");

/**
 * ====================================================================
 * DENEME SURESI VE LISANS DURUMU
 * ====================================================================
 */

const TRIAL_DAYS = 20;

/**
 * Deneme baslangici IKI yerde tutulur:
 *   1. Veritabani (data/mentoros.db)
 *   2. Proje kokunde gizli bir isaret dosyasi
 *
 * En ERKEN tarih gecerli sayilir. Boylece veritabanini silip
 * denemeyi sifirlamak islevsiz kalir - isaret dosyasi kalir.
 *
 * Not: Ikisini de silen biri denemeyi sifirlayabilir. Bu kabul
 * edilmis bir sinirdir; amac kazara degil kasitli davranisi
 * zorlastirmak.
 */
const MARKER = path.resolve(".mentoros-install");

function readMarker() {
  try {
    const raw = fs.readFileSync(MARKER, "utf8").trim();
    const date = new Date(raw);
    return isNaN(date) ? null : raw;
  } catch {
    return null;
  }
}

function writeMarker(iso) {
  try {
    fs.writeFileSync(MARKER, iso, { mode: 0o600 });

    // Windows'ta gizle - kazara silinmesin.
    if (process.platform === "win32") {
      require("child_process").execSync(`attrib +h "${MARKER}"`, { stdio: "ignore" });
    }
  } catch {
    // Yazilamazsa sorun degil, veritabani kaydi yeterli.
  }
}

/** Kurulum tarihini dondurur; yoksa olusturur. */
function installedAt() {
  const row = db.prepare(`SELECT installed_at, last_seen_at FROM install WHERE id = 1`).get();
  const fromFile = readMarker();
  const ts = now();

  if (!row) {
    // Ilk calisma. Isaret dosyasi varsa ONU kullan (veritabani silinmis olabilir).
    const start = fromFile || ts;

    db.prepare(
      `INSERT INTO install (id, installed_at, last_seen_at) VALUES (1, ?, ?)`
    ).run(start, ts);

    if (!fromFile) writeMarker(start);
    return { installedAt: start, lastSeenAt: ts, clockWarning: false };
  }

  // Iki kaynaktan EN ERKEN olani gecerli.
  let start = row.installed_at;
  if (fromFile && fromFile < start) start = fromFile;
  if (!fromFile) writeMarker(start);

  /**
   * SAAT GERI ALMA TESPITI
   * Sistem saati son gorulen tarihten geriye gittiyse, birileri
   * denemeyi uzatmaya calisiyor olabilir. Kaydi guncellemeyiz ve
   * durumu isaretleriz.
   */
  const clockWarning = ts < row.last_seen_at;

  if (!clockWarning) {
    db.prepare(`UPDATE install SET installed_at = ?, last_seen_at = ? WHERE id = 1`)
      .run(start, ts);
  } else if (start !== row.installed_at) {
    db.prepare(`UPDATE install SET installed_at = ? WHERE id = 1`).run(start);
  }

  return { installedAt: start, lastSeenAt: row.last_seen_at, clockWarning };
}

function daysBetween(a, b) {
  return Math.floor((new Date(b) - new Date(a)) / 86400000);
}

/**
 * Sistemin lisans durumu.
 *
 * Donen `state`:
 *   licensed        -> gecerli lisans var
 *   trial           -> deneme suresi devam ediyor
 *   trial_expiring  -> deneme suresi 5 gunden az kaldi
 *   trial_expired   -> deneme bitti, lisans yok
 *   license_expired -> lisans vardi ama suresi doldu
 *   invalid_license -> girilen anahtar gecersiz
 */
function status() {
  const install = installedAt();
  const today = now();
  const stored = settings.get("license.key", "");

  // --- Lisans girilmis mi? ---
  if (stored) {
    const result = verify(stored);

    if (!result.valid) {
      return {
        state: "invalid_license",
        reason: result.reason,
        active: false,
        trialDaysLeft: 0,
        keyMasked: mask(stored)
      };
    }

    const { payload } = result;
    const expired = payload.expiresAt && today > payload.expiresAt;

    if (expired) {
      return {
        state: "license_expired",
        active: false,
        company: payload.company,
        expiresAt: payload.expiresAt,
        keyMasked: mask(stored)
      };
    }

    return {
      state: "licensed",
      active: true,
      company: payload.company,
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt || null,
      perpetual: !payload.expiresAt,
      daysLeft: payload.expiresAt ? daysBetween(today, payload.expiresAt) : null,
      keyMasked: mask(stored)
    };
  }

  // --- Lisans yok: deneme suresi ---
  const used = daysBetween(install.installedAt, today);
  const left = TRIAL_DAYS - used;

  if (left <= 0) {
    return {
      state: "trial_expired",
      active: false,
      trialDaysLeft: 0,
      installedAt: install.installedAt,
      clockWarning: install.clockWarning
    };
  }

  return {
    state: left <= 5 ? "trial_expiring" : "trial",
    active: true,
    trialDays: TRIAL_DAYS,
    trialDaysLeft: left,
    installedAt: install.installedAt,
    clockWarning: install.clockWarning
  };
}

/**
 * Lisans anahtarini kaydeder.
 * Gecersizse KAYDETMEZ - kullaniciya hemen sebebini soyler.
 */
function activate(key) {
  const result = verify(key);

  if (!result.valid) {
    return { ok: false, reason: result.reason };
  }

  const { payload } = result;

  // Suresi gecmis bir anahtari kabul etmenin anlami yok.
  if (payload.expiresAt && now() > payload.expiresAt) {
    return { ok: false, reason: "expired", expiresAt: payload.expiresAt };
  }

  settings.set("license.key", String(key).trim());

  return { ok: true, payload };
}

function clear() {
  settings.remove("license.key");
}

module.exports = { status, activate, clear, TRIAL_DAYS };
