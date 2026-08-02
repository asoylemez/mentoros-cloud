/**
 * ====================================================================
 * YEDEKLEME CEKIRDEGI
 * ====================================================================
 *
 * Hem elle calistirilan betikler (npm run backup / restore) hem de
 * uygulama icindeki gunluk zamanlayici BU dosyayi kullanir.
 *
 * Neden ortak: yedek klasorunun nerede oldugu bir kez hesaplansin.
 * Daha once bu hesap iki ayri dosyada duruyordu ve biri yanlisti -
 * yedekler bulutta GECICI alana yaziliyor, ilk yeniden baslatmada
 * sessizce siliniyordu.
 */

const fs = require("fs");
const path = require("path");

const DB_FILE = path.resolve(process.env.DB_PATH || "./data/mentoros.db");

/**
 * Yedekler veritabaninin YANINA yazilir; boylece kalici disk nereye
 * bagliysa yedek de oraya duser (bulutta /var/data, yerelde data/).
 *
 * Baska yere almak icin:  BACKUP_DIR=/istenen/yol
 */
const BACKUP_DIR = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.join(path.dirname(DB_FILE), "yedekler");

/** Klasor adi: 2026-08-02T00-05-17  (siralanabilir olmasi onemli) */
function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/** Yedek klasorleri, en yeniden eskiye. */
function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];

  return fs.readdirSync(BACKUP_DIR)
    .filter(name => {
      try { return fs.statSync(path.join(BACKUP_DIR, name)).isDirectory(); }
      catch { return false; }
    })
    .sort()
    .reverse();
}

/**
 * Klasor adindan zamani cozer. Cozulemezse null doner - elle
 * olusturulmus veya "-geri-yukleme-oncesi" ekli klasorler icin.
 */
function timeOf(name) {
  const m = String(name).match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  if (!m) return null;

  const t = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);
  return Number.isNaN(t) ? null : t;
}

/**
 * TUTARLI YEDEK ALIR.
 *
 * Duz dosya kopyalamasi yerine SQLite'in "VACUUM INTO" komutu
 * kullanilir. Sebep: SQLite WAL kipinde calisiyor, en son yazilan
 * kayitlar yanindaki -wal dosyasinda duruyor. Sadece ana dosyayi
 * kopyalamak o kayitlari DISARIDA BIRAKIR; ustelik kopyalama bir
 * yazma isleminin ortasina denk gelirse bozuk dosya uretir.
 *
 * VACUUM INTO, uygulama calisirken bile o anin tutarli bir goruntusunu
 * tek dosya olarak yazar.
 */
function createBackup(label = "") {
  if (!fs.existsSync(DB_FILE)) {
    throw new Error(`Veritabani bulunamadi: ${DB_FILE}`);
  }

  const name = stamp() + (label ? `-${label}` : "");
  const dir = path.join(BACKUP_DIR, name);

  fs.mkdirSync(dir, { recursive: true });

  const Database = require("better-sqlite3");
  const src = new Database(DB_FILE, { readonly: true });

  try {
    src.prepare("VACUUM INTO ?").run(path.join(dir, "mentoros.db"));
  } finally {
    src.close();
  }

  // .env yereldeki kurulumda SETTINGS_SECRET'i tasir; bulutta yoktur.
  const envFile = path.resolve(".env");
  if (fs.existsSync(envFile)) {
    fs.copyFileSync(envFile, path.join(dir, ".env"));
  }

  return { name, dir };
}

/**
 * Eski yedekleri siler.
 *
 * ELLE alinan yedekler ve geri yukleme oncesi guvenlik kopyalari
 * KORUNUR - yalnizca zamanlayicinin urettikleri (-oto ekli) temizlenir.
 * Otomatik bir surecin, insanin bilerek aldigi bir yedegi silmesi
 * kotu bir surpriz olurdu.
 */
function prune(keepDays) {
  const limit = Date.now() - keepDays * 86400000;
  const removed = [];

  for (const name of listBackups()) {
    if (!name.endsWith("-oto")) continue;

    const t = timeOf(name);
    if (t === null || t >= limit) continue;

    try {
      fs.rmSync(path.join(BACKUP_DIR, name), { recursive: true, force: true });
      removed.push(name);
    } catch { /* silinemezse bir sonrakine gec */ }
  }

  return removed;
}

/**
 * ====================================================================
 * GUNLUK OTOMATIK YEDEK
 * ====================================================================
 *
 * Neden "her gun saat 03:00'te" degil de "son yedek 24 saatten
 * eskiyse"?
 *
 * Sunucu gun icinde birkac kez yeniden baslayabilir (deploy, bakim).
 * Sabit saate baglasaydik, o saatte sunucu kapaliysa o gunun yedegi
 * hic alinmazdi. Yasa bagli calismak yeniden baslatmalara dayaniklidir
 * ve zamanlayici durumunu bir yerde saklamayi gerektirmez - son yedegin
 * klasor adi zaten bilgiyi tasiyor.
 */
function startSchedule({ keepDays = 14, intervalHours = 6 } = {}) {
  const DAY = 86400000;

  function tick() {
    try {
      const auto = listBackups().filter(n => n.endsWith("-oto"));
      const newest = auto.length ? timeOf(auto[0]) : null;

      if (newest !== null && Date.now() - newest < DAY) return;

      const { name } = createBackup("oto");
      const removed = prune(keepDays);

      console.log(
        `  Otomatik yedek alindi: ${name}` +
        (removed.length ? `  (${removed.length} eski yedek silindi)` : "")
      );
    } catch (err) {
      // Yedek alinamamasi uygulamayi DURDURMAMALI - ama sessiz de
      // kalmamali, yoksa aylarca yedeksiz calisildigi fark edilmez.
      console.error("  ! Otomatik yedek alinamadi:", err.message);
    }
  }

  // Acilista hemen calistirma: sunucunun oturmasini bekle.
  setTimeout(tick, 60 * 1000).unref?.();
  setInterval(tick, intervalHours * 3600 * 1000).unref?.();
}

module.exports = {
  DB_FILE,
  BACKUP_DIR,
  stamp,
  listBackups,
  timeOf,
  createBackup,
  prune,
  startSchedule
};
