const path = require("path");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const config = require("./config");
const settings = require("./db/settings");
const { run: migrate } = require("./db/migrate");
const staffAuth = require("./routes/staffAuth");

migrate();   // mevcut veritabanlarina eksik sutunlari ekle

/**
 * BULUT SURUMU: otomatik "default" firma YOK.
 *
 * Yerel surumde her kurulum tek firmaya aitti ve acilista sabit bir
 * "default" kaydi olusturuluyordu. Burada firmalari super admin
 * paneli olusturur. Otomatik kayit birakmak, sahipsiz ve sifresi
 * kimsede olmayan bir kiraci yaratirdi.
 */

const app = express();

/**
 * Ters vekil (reverse proxy) arkasindayiz.
 *
 * Bulut saglayicisi istegi bize kendi ic agindan iletir. Bu ayar
 * olmadan req.ip HERKES icin ayni (vekilin adresi) gorunur - yani
 * bir kisinin hatali sifre denemesi TUM kullanicilari kilitler.
 */
if (config.cloud) {
  app.set("trust proxy", 1);
}

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

/**
 * URL'deki fazla egik cizgileri temizle.
 *
 * "//super_admin.html" gibi bir adres Express icin FARKLI bir yoldur ve
 * "Cannot GET //super_admin.html" seklinde ham bir hata verir. Kullanici
 * neyi yanlis yaptigini anlamaz.
 *
 * Bu genellikle bir linki elle yazarken veya birlestirirken olur.
 */
app.use((req, res, next) => {
  if (req.url.startsWith("//") || /\/{2,}/.test(req.path)) {
    const clean = req.url.replace(/\/{2,}/g, "/");
    return res.redirect(301, clean);
  }
  next();
});

// =====================================================================
// SAYFA ERISIM KATMANLARI
// =====================================================================
//
//  1. HERKESE ACIK   : login, index, register       -> anahtar yok
//  2. KATILIMCI      : onay, calisma alani, seans   -> kendi token'i
//  3. PERSONEL       : IK panelleri                 -> GIRIS ZORUNLU
//  4. YONETICI       : admin paneli                 -> ayri sifre
//
// Personel sayfalari /views/staff icinde durur ve STATIK OLARAK
// SUNULMAZ. Boylece bir mentor adres cubuguna /hr_dashboard.html
// yazsa bile giris ekranina yonlendirilir.
// =====================================================================

// --- 3. Personel sayfalari (oturum gerekli) ---
app.get("/mentor_registry.html", staffAuth.serveStaffPage("mentor_registry.html"));
app.get("/mentee_registry.html", staffAuth.serveStaffPage("mentee_registry.html"));
app.get("/hr_dashboard.html",  staffAuth.serveStaffPage("hr_dashboard.html"));
app.get("/mentee_matching.html", staffAuth.serveStaffPage("mentee_matching.html"));

// --- 4. Super admin (tedarikci) ---
//
// Firma yonetimi. Firma oturumu olan biri buraya ASLA giremez.
app.get("/super_admin.html", (req, res) => {
  const session = staffAuth.readSession(req);

  if (!session) {
    return res.redirect("/login.html?next=%2Fsuper_admin.html");
  }

  if (!session.isSuperAdmin) {
    return res.status(403).send(
      `<!DOCTYPE html><html><body style="font:15px/1.6 -apple-system,'Segoe UI',sans-serif;
        padding:14vh 24px;text-align:center;color:#374151">
        <h2 style="color:#1a2b5e">Bu sayfaya erisiminiz yok</h2>
        <p style="color:#6b7280">You do not have access to this page.</p>
        <p><a href="/hr_dashboard.html" style="color:#b5651d">Panele don / Back to dashboard</a></p>
      </body></html>`
    );
  }

  res.sendFile(path.join(__dirname, "views", "staff", "super_admin.html"));
});

/**
 * KARSILAMA SAYFASI OTURUM ISTER.
 *
 * index.html statik klasorde durdugu icin herkese aciktı. Icinde veri
 * yok - kartlarin gittigi sayfalarin hepsi zaten giris istiyor - ama
 * oturumsuz bir ziyaretcinin "Mentor Kayitlari / HR Dashboard" yazan
 * bir uygulama ekrani gormesi yaniltici: iceri girmis gibi hissettiriyor.
 *
 * Bu kontrol express.static'ten ONCE gelmeli, yoksa statik katman
 * dosyayi sunar ve buraya hic ugranmaz.
 */
app.get(["/", "/index.html"], (req, res, next) => {
  const session = staffAuth.readSession(req);

  if (!session) {
    return res.redirect("/login.html?next=%2Findex.html");
  }

  // Super admin'in kurulus verisi yok; kendi paneline gitsin.
  if (session.isSuperAdmin) {
    return res.redirect("/super_admin.html");
  }

  next();   // oturum var -> statik katman index.html'i sunsun
});

// --- 1 & 2. Herkese acik ve katilimci sayfalari ---
app.use(express.static(path.join(__dirname, "public")));

// =====================================================================
// ROUTE'LAR
// =====================================================================

app.use(require("./routes/public"));      // token bazli, API anahtari YOK
app.use(require("./routes/admin"));       // yonetici paneli (ayri sifre)
app.use(require("./routes/companies"));
app.use(require("./routes/people"));
app.use(require("./routes/matching"));
app.use(require("./routes/mentorships"));
app.use(require("./routes/email"));
app.use(require("./routes/surveys"));   // kapanis anketleri

// --- Saglik kontrolu --------------------------------------------------

/**
 * Lisans durumu ozeti.
 *
 * Kimlik dogrulamasi ISTEMEZ - IK sayfalari bunu okuyup uyari bandi
 * gosterir. Sadece durum ve kalan gun doner; anahtar veya firma
 * bilgisi ICERMEZ.
 */
app.get("/license-status", (req, res) => {
  /**
   * Bulut surumunde deneme/lisans kavrami yok. IK sayfalarindaki uyari
   * bandi da gorunmemeli - musteriye anlamsiz bir "deneme bitiyor"
   * uyarisi gostermek guven kaybettirir.
   */
  if (config.cloud) {
    return res.json({
      state: "cloud",
      active: true,
      trialDaysLeft: null,
      daysLeft: null,
      clockWarning: false
    });
  }

  const s = require("./license/state").status();

  res.json({
    state: s.state,
    active: s.active,
    trialDaysLeft: s.trialDaysLeft ?? null,
    daysLeft: s.daysLeft ?? null,
    clockWarning: !!s.clockWarning
  });
});

app.get("/health", (req, res) => {
  const ai = settings.getAiConfigPublic();

  res.json({
    status: "ok",
    database: "sqlite",
    aiConfigured: ai.configured,
    aiProvider: ai.provider,
    aiModel: ai.model,
    piiScrubbing: config.privacy.scrubPii,
    adminPasswordSet: !!config.adminPasswordHash
  });
});

// --- Bulunamadi -------------------------------------------------------

app.use((req, res, next) => {
  // API istekleri JSON bekler
  if (req.path.startsWith("/api/") || req.headers.accept?.includes("application/json")) {
    return res.status(404).json({ error: "Not found", path: req.path });
  }

  // Tarayici istekleri: anlasilir bir sayfa goster
  res.status(404).send(`<!DOCTYPE html>
<html><body style="margin:0;background:#f4f5f7;
  font:15px/1.6 -apple-system,'Segoe UI',Roboto,sans-serif;color:#374151">
  <div style="max-width:480px;margin:14vh auto;text-align:center;padding:24px">
    <div style="font-size:46px;margin-bottom:14px">🔍</div>
    <h2 style="color:#1a2b5e;margin:0 0 10px">Page not found</h2>
    <p style="color:#6b7280">
      No page exists at <code style="background:#e5e7eb;padding:2px 6px;
      border-radius:4px">${req.path.replace(/[<>&"]/g, "")}</code>
    </p>
    <p style="margin-top:24px">
      <a href="/login.html" style="color:#b5651d">Go to sign-in</a>
    </p>
  </div>
</body></html>`);
});

// --- Hata yakalayici --------------------------------------------------

app.use((err, req, res, next) => {
  console.error("Hata:", err.message);

  if (err.message?.includes("Gizlilik ihlali")) {
    return res.status(400).json({ error: err.message });
  }

  if (err.code === "AI_NOT_CONFIGURED") {
    return res.status(503).json({
      error: "Yapay zeka baglantisi kurulmamis.",
      action: "Yonetici panelinden baglantiyi kurun: /admin.html",
      code: "AI_NOT_CONFIGURED"
    });
  }

  if (err.diagnosis) {
    return res.status(502).json({
      error: err.diagnosis.title,
      detail: err.diagnosis.detail,
      action: err.diagnosis.action,
      code: err.diagnosis.code
    });
  }

  res.status(500).json({ error: err.message || "Sunucu hatasi" });
});

// --- Baslat -----------------------------------------------------------

// Sirket agindaki adresi bul (bilgi amacli).
function lanAddress() {
  const os = require("os");

  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === "IPv4" && !a.internal &&
          /^(192\.168\.|10\.|172\.)/.test(a.address)) {
        return a.address;
      }
    }
  }
  return null;
}

// 0.0.0.0 -> tum ag arayuzlerini dinle (sadece localhost degil).
// Boylece ayni agdaki diger bilgisayarlar baglanabilir.
app.listen(config.port, "0.0.0.0", () => {
  const ai = settings.getAiConfigPublic();
  const lan = lanAddress();

  console.log(`
  MentorOS Cloud is running
  ---------------------------------------------------------
  On this machine : http://localhost:${config.port}
  Mode            : ${config.cloud ? "CLOUD (multi-tenant)" : "LOCAL"}${config.cloud ? "" : `
  On the network  : ${lan ? `http://${lan}:${config.port}` : "(no network address found)"}`}

  Address used in links : ${config.siteBaseUrl}

  Database      : SQLite  (${config.dbPath})
  PII masking   : ${config.privacy.scrubPii ? "ON" : "OFF (!)"}
  AI            : ${ai.configured ? `${ai.provider} / ${ai.model}` : "NOT CONFIGURED"}
  ---------------------------------------------------------`);

  /**
   * ==================================================================
   * SESSIZ KIRILMA UYARILARI
   * ==================================================================
   *
   * Asagidakiler hata VERMEZ - sadece yanlis calisir. Bu yuzden
   * acilista acikca soyluyoruz.
   */

  const warnings = [];

  // 1. Linkler localhost uretiyorsa, gonderilen davetler acilmaz.
  if (/localhost|127\.0\.0\.1/.test(config.siteBaseUrl)) {
    warnings.push(`SITE_BASE_URL "localhost" gorunuyor.
    Mentorlara gonderilen davet ve onay linkleri ONLARIN
    bilgisayarinda ACILMAZ. Kendi alan adinizi yazin.`);
  }

  // 2. Bulutta HTTP -> oturum cerezi "secure" oldugu icin hic kaydedilmez.
  if (config.cloud && config.siteBaseUrl.startsWith("http://")) {
    warnings.push(`CLOUD=true ama adres HTTPS degil.
    Oturum cerezi "secure" isaretlendigi icin tarayici onu
    KAYDETMEZ; giris ekrani surekli kendine doner.`);
  }

  // 3. SETTINGS_SECRET sabit degilse kayitli API anahtari her acilista okunamaz olur.
  if (config.cloud && !process.env.SETTINGS_SECRET) {
    warnings.push(`SETTINGS_SECRET tanimli degil.
    Her yeniden baslatmada yeni anahtar uretilir ve kayitli
    Claude API anahtari OKUNAMAZ hale gelir. Ortam degiskeni
    olarak sabitleyin:  npm run hash-password`);
  }

  // 4. Kalici disk kontrolu: veritabani gecici bir yoldaysa veri kaybolur.
  if (config.cloud) {
    const dbAbs = require("path").resolve(config.dbPath);
    const ephemeral = !/^\/(var\/data|data|mnt|opt\/render\/project\/data|home\/data)/.test(dbAbs);

    if (ephemeral) {
      warnings.push(`Veritabani kalici olmayabilecek bir yolda:
    ${dbAbs}
    Saglayicinizin KALICI DISKINE isaret ettiginden emin olun.
    Aksi halde sunucu her yeniden baslatildiginda TUM VERI SILINIR.`);
    }
  }

  // 5. Yonetici sifresi yoksa hicbir hesap olusturulamaz.
  if (!config.adminPasswordHash) {
    warnings.push(`ADMIN_PASSWORD_HASH ayarlanmamis.
    Yonetim paneline girilemez, dolayisiyla hicbir kurulus
    hesabi olusturulamaz.  ->  npm run hash-password`);
  }

  for (const w of warnings) {
    console.log(`\n  ! ${w}\n`);
  }

  /**
   * GUNLUK OTOMATIK YEDEK
   *
   * Yalnizca bulut kurulumunda acilir. Yerel kurulumda makine
   * sahibinin kendi yedekleme duzeni vardir ve BACKUP.bat ile elle
   * aliniyor; oraya habersiz bir zamanlayici eklemek dogru olmaz.
   *
   * Kapatmak icin:      AUTO_BACKUP=false
   * Saklama suresi:     BACKUP_KEEP_DAYS (varsayilan 14 gun)
   */
  if (config.cloud && config.autoBackup) {
    const backupCore = require("./lib/backup-core");

    backupCore.startSchedule({ keepDays: config.backupKeepDays });

    console.log(
      `  Otomatik yedek : acik  (gunluk, ${config.backupKeepDays} gun saklanir)\n` +
      `                   ${backupCore.BACKUP_DIR}\n`
    );
  }

  if (!ai.configured) {
    console.log(`
  ! Claude baglantisi kurulmamis.
    Yonetici panelinden baglayin:  ${config.siteBaseUrl}/admin.html
`);
  } else {
    console.log("");
  }
});
