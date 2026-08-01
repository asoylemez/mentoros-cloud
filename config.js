require("dotenv").config();

function bool(value, fallback) {
  if (value === undefined || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

const config = {
  port: Number(process.env.PORT || 3000),
  apiKey: process.env.API_KEY || "mentor-demo-key-2026",
  siteBaseUrl: process.env.SITE_BASE_URL || "http://localhost:3000",

  dbPath: process.env.DB_PATH || "./data/mentoros.db",

  /**
   * BULUT KURULUMU MU?
   *
   * true  -> HTTPS arkasinda calisiyoruz. Oturum cerezi "secure"
   *          isaretlenir ve Express, ters vekil (reverse proxy)
   *          basliklarina guvenir - boylece req.ip gercek ziyaretci
   *          adresini gosterir. Bu olmadan kaba kuvvet korumasi TUM
   *          kullanicilari tek IP sanip herkesi birlikte kilitlerdi.
   * false -> yerel/LAN kurulumu (http).
   */
  cloud: bool(process.env.CLOUD, false),

  // Yonetici paneli sifresi (bcrypt hash).
  // Uretmek icin: npm run set-admin-password
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH || "",

  /**
   * Super admin kullanici adi. Bu ad firma olarak OLUSTURULAMAZ -
   * aksi halde biri bu adla firma acip yonetici girisini golgeleyebilirdi.
   */
  superAdminUser: String(process.env.SUPER_ADMIN_USER || "superadmin")
    .trim().toLowerCase(),

  /**
   * MUSTERI KURULUMU MU?
   *
   * true  -> .env icindeki AI anahtarlari YOK SAYILIR. Baglanti SADECE
   *          yonetici panelinden kurulabilir. Musteriye gonderilen
   *          kurulumda bu ACIK olmali.
   * false -> .env'deki anahtar geri donus olarak kullanilir
   *          (gelistirme kolayligi).
   */
  customerDeployment: bool(process.env.CUSTOMER_DEPLOYMENT, false),

  privacy: {
    // Varsayilan ACIK. Kapatmak icin bilincli olarak "false" yazmak gerekir.
    scrubPii: bool(process.env.PII_SCRUBBING, true),
    auditLog: bool(process.env.AI_AUDIT_LOG, true)
  }
};

/**
 * NOT: Yapay zeka ayarlari (saglayici, model, API anahtari) artik
 * BURADA degil, veritabaninda tutulur ve yonetici panelinden
 * degistirilir. Bkz. db/settings.js
 *
 * .env icindeki ANTHROPIC_API_KEY vb. degerler sadece GERI DONUS
 * olarak kullanilir (gelistirici kolayligi icin).
 *
 * Bu yuzden sunucu, yapay zeka yapilandirilmamis olsa bile ACILIR -
 * musteri kurar, panele girer, kendi Claude erisimini baglar.
 */

// Cerez "secure" bayragi: varsayilan olarak bulut kurulumunda acik.
// Ozel durumlar icin SECURE_COOKIES ile ayrica zorlanabilir.
config.secureCookies = bool(process.env.SECURE_COOKIES, config.cloud);

if (!config.privacy.scrubPii) {
  console.warn(
    "\n  UYARI: PII_SCRUBBING=false. Kisisel veriler maskelenmeden " +
    "yapay zekaya gonderilecek. Uretimde ASLA kullanmayin.\n"
  );
}

module.exports = config;
