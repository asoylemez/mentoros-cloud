/**
 * ====================================================================
 * YEDEKLE / GERI YUKLE
 * ====================================================================
 *
 *   npm run backup            Yedek al
 *   npm run backup -- --list  Yedekleri listele
 *   npm run restore           Son yedegi geri yukle
 *   npm run restore -- <ad>   Belirli bir yedegi geri yukle
 *
 * Yedeklenen dosyalar:
 *   data/mentoros.db   Tum veri (firmalar, mentorlar, iliskiler, notlar)
 *   .env               Admin sifresi + SETTINGS_SECRET
 *
 * SETTINGS_SECRET onemli: Claude anahtari veritabaninda BU anahtarla
 * sifrelenmis durumda. .env kaybolursa anahtar cozulemez ve panelden
 * yeniden girmeniz gerekir. Bu yuzden ikisi BIRLIKTE yedeklenir.
 *
 * Yedekler proje disinda tutulur (../mentoros-yedekler), boylece
 * projenin uzerine yeni surum acmak yedekleri silmez.
 */

const fs = require("fs");
const path = require("path");

const DB_FILE = path.resolve(process.env.DB_PATH || "./data/mentoros.db");

/**
 * YEDEKLER VERITABANININ YANINA YAZILIR.
 *
 * Onceden calisma klasorunun bir ustune yaziliyordu. Yerel kurulumda
 * bu dogruydu, ama BULUTTA orasi GECICI alandir: yedek alinir, "Yedek
 * alindi" yazar, sonra ilk yeniden baslatmada SILINIR. Yani yedek tam
 * ihtiyac duyuldugu anda ortada olmaz.
 *
 * Veritabaninin yanini secmek her iki kurulumda da doğruyu verir:
 * kalici disk nereye bagliysa yedek de oraya duser.
 *
 * Baska bir yere almak icin:  BACKUP_DIR=/istenen/yol npm run backup
 */
const BACKUP_DIR = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.join(path.dirname(DB_FILE), "yedekler");
const ENV_FILE = path.resolve(".env");

const argv = process.argv.slice(2);
const MODE = path.basename(process.argv[1]).includes("restore")
  ? "restore" : "backup";

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];

  return fs.readdirSync(BACKUP_DIR)
    .filter(name => fs.statSync(path.join(BACKUP_DIR, name)).isDirectory())
    .sort()
    .reverse();
}

// =====================================================================
// YEDEK AL
// =====================================================================

function backup() {
  if (argv.includes("--list")) {
    const backups = listBackups();

    if (!backups.length) {
      console.log("\n  Henuz yedek yok. Almak icin:  npm run backup\n");
      return;
    }

    console.log(`\n  Yedekler (${BACKUP_DIR}):\n`);
    backups.forEach((name, i) => {
      const dir = path.join(BACKUP_DIR, name);
      const dbPath = path.join(dir, "mentoros.db");
      const size = fs.existsSync(dbPath)
        ? (fs.statSync(dbPath).size / 1024).toFixed(0) + " KB"
        : "-";
      console.log(`    ${i === 0 ? "*" : " "} ${name}   ${size}`);
    });
    console.log("\n    (* = en yeni)\n");
    return;
  }

  if (!fs.existsSync(DB_FILE)) {
    console.error(`\n  HATA: Veritabani bulunamadi: ${DB_FILE}\n`);
    process.exit(1);
  }

  const dir = path.join(BACKUP_DIR, stamp());
  fs.mkdirSync(dir, { recursive: true });

  /**
   * TUTARLI YEDEK ALMA
   *
   * Onceden burada duz dosya kopyalamasi (fs.copyFileSync) vardi.
   * Bunun iki sorunu var ve ikisi de yalnizca SUNUCU CALISIRKEN
   * ortaya cikiyor - yani tam da yedege ihtiyac duyulan durumda:
   *
   *   1. SQLite "WAL" kipinde calisiyor. Son yazilan kayitlar ana
   *      dosyaya degil, yanindaki -wal dosyasina gider. Sadece ana
   *      dosyayi kopyalamak, en yeni kayitlari DISARIDA BIRAKIR.
   *
   *   2. Kopyalama sirasinda bir yazma islemi surerse, yarim yazilmis
   *      bir dosya elde edilir. Acilir gibi gorunur, ama bozuktur.
   *
   * "VACUUM INTO" bu iki sorunu da cozer: SQLite kendi ic kilitlerini
   * kullanarak, o ANIN tutarli bir goruntusunu tek dosya olarak yazar.
   * Uygulama bu sirada calismaya devam edebilir. Ayrica ciktiyi
   * sikistirir, yani yedek dosyasi daha kucuk olur.
   *
   * Ayni gerekce Render'in disk anlik goruntuleri icin de gecerlidir:
   * onlar diski oldugu gibi dondurur ve yazma ortasina denk gelebilir.
   * Bu yuzden kurtarma icin oncelikle BU yedekleri kullanin.
   */
  const target = path.join(dir, "mentoros.db");

  {
    const Database = require("better-sqlite3");
    const src = new Database(DB_FILE, { readonly: true });
    try {
      src.prepare("VACUUM INTO ?").run(target);
    } finally {
      src.close();
    }
  }

  if (fs.existsSync(ENV_FILE)) {
    fs.copyFileSync(ENV_FILE, path.join(dir, ".env"));
  } else {
    // Bulutta .env yoktur; degerler ortam degiskeni olarak tutulur.
    console.log("  Not: .env bulunamadi (bulut kurulumunda normaldir).");
  }

  // Ozet
  let summary = "";
  try {
    const Database = require("better-sqlite3");
    const db = new Database(path.join(dir, "mentoros.db"), { readonly: true });

    const count = table =>
      db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

    summary =
      `    firma       : ${count("companies")}\n` +
      `    mentor      : ${count("mentors")}\n` +
      `    mentorluk   : ${count("mentorships")}\n` +
      `    toplanti    : ${count("meetings")}\n`;

    db.close();
  } catch { /* ozet cikarilamadi, onemli degil */ }

  console.log(`
  Yedek alindi.
  ---------------------------------------------------------
  ${dir}
${summary}  ---------------------------------------------------------
  Geri yuklemek icin:  npm run restore
`);
}

// =====================================================================
// GERI YUKLE
// =====================================================================

function restore() {
  const backups = listBackups();

  if (!backups.length) {
    console.error(`\n  HATA: Hic yedek yok (${BACKUP_DIR})\n`);
    process.exit(1);
  }

  const wanted = argv.find(a => !a.startsWith("--"));
  const name = wanted || backups[0];

  if (!backups.includes(name)) {
    console.error(
      `\n  HATA: "${name}" adinda bir yedek yok.\n\n` +
      `  Mevcut yedekler:\n` +
      backups.map(b => `     ${b}`).join("\n") + "\n"
    );
    process.exit(1);
  }

  const dir = path.join(BACKUP_DIR, name);

  // Mevcut durumu once yedekle - geri yukleme de bir kayip riskidir.
  if (fs.existsSync(DB_FILE)) {
    const safety = path.join(BACKUP_DIR, `${stamp()}-geri-yukleme-oncesi`);
    fs.mkdirSync(safety, { recursive: true });
    fs.copyFileSync(DB_FILE, path.join(safety, "mentoros.db"));
    if (fs.existsSync(ENV_FILE)) {
      fs.copyFileSync(ENV_FILE, path.join(safety, ".env"));
    }
    console.log(`\n  Mevcut durum guvenlik icin yedeklendi:\n  ${safety}`);
  }

  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.copyFileSync(path.join(dir, "mentoros.db"), DB_FILE);

  const envBackup = path.join(dir, ".env");
  if (fs.existsSync(envBackup)) {
    fs.copyFileSync(envBackup, ENV_FILE);
  }

  console.log(`
  Geri yuklendi: ${name}
  ---------------------------------------------------------
  Veritabani : ${DB_FILE}
  .env       : ${fs.existsSync(envBackup) ? "geri yuklendi" : "yedekte yoktu"}
  ---------------------------------------------------------
  Sunucuyu yeniden baslatin:  npm start
`);
}

MODE === "restore" ? restore() : backup();
