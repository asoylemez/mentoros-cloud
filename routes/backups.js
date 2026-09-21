const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");

const staffAuth = require("./staffAuth");
const settings = require("../db/settings");
const core = require("../lib/backup-core");
const { wrap } = require("./_helpers");

const router = express.Router();

/**
 * ====================================================================
 * YEDEK INDIRME (yalnizca super admin)
 * ====================================================================
 *
 * Neden var: Gunluk otomatik yedekler veritabaniyla AYNI diske yazilir
 * (/var/data/yedekler). Yanlislikla silinen bir kayit icin yeterli, ama
 * disk kaybolursa veritabani ve yedekler birlikte gider. Bu uclar
 * yedegin sunucu DISINA alinmasini tek tikla yapilabilir kiliyor.
 *
 * GUVENLIK:
 *   - Indirilen dosya TUM kuruluslarin verisini icerir. O yuzden sadece
 *     requireSuperAdmin; kurulus hesaplari 403 alir.
 *   - Dosya adi istemciden gelir ama DOGRUDAN yola eklenmez: yalnizca
 *     listBackups()'in dondurdugu adlardan biriyse kabul edilir
 *     ("../../etc/passwd" gibi bir ad listede olmadigi icin reddedilir).
 *   - Her indirme sunucu log'una yazilir ve son indirme zamani saklanir.
 *   - API anahtari ve SMTP sifresi veritabaninda SETTINGS_SECRET ile
 *     sifreli durur; indirilen dosyada da sifreli kalir.
 */

const LAST_DOWNLOAD_KEY = "backup.lastDownloadAt";

function fileSize(p) {
  try { return fs.statSync(p).size; } catch { return 0; }
}

function dirSize(dir) {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      total += entry.isDirectory() ? dirSize(p) : fileSize(p);
    }
  } catch { /* klasor yoksa 0 */ }
  return total;
}

/** Kalici diskin doluluk bilgisi. Okunamazsa null. */
function diskUsage() {
  try {
    const s = fs.statfsSync(path.dirname(core.DB_FILE));
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    return { total, free, used: total - free };
  } catch {
    return null;
  }
}

function logDownload(req, what) {
  const ip = req.ip || req.socket?.remoteAddress || "-";
  console.log(`  [yedek] indirildi: ${what}  (super admin, ip ${ip})`);
  settings.set(LAST_DOWNLOAD_KEY, new Date().toISOString(), { updatedBy: "superadmin" });
}

function downloadName(stamp) {
  return `mentoros-yedek-${stamp}.db`;
}

function sendDb(res, filePath, name, onDone) {
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.setHeader("Content-Length", fileSize(filePath));
  res.setHeader("Cache-Control", "no-store");

  const stream = fs.createReadStream(filePath);
  let finished = false;
  const done = () => { if (!finished) { finished = true; onDone && onDone(); } };

  stream.on("error", err => {
    console.error("  ! Yedek gonderilemedi:", err.message);
    if (!res.headersSent) res.status(500).json({ error: "Backup could not be sent." });
    else res.destroy(err);
    done();
  });
  res.on("close", done);
  stream.pipe(res);
}

/** Yedek listesi + disk durumu. */
router.get("/backups", staffAuth.requireSuperAdmin, wrap(async (req, res) => {
  const list = core.listBackups().map(name => {
    const file = path.join(core.BACKUP_DIR, name, "mentoros.db");
    const t = core.timeOf(name);
    return {
      name,
      createdAt: t ? new Date(t).toISOString() : null,
      size: fileSize(file),
      automatic: name.endsWith("-oto"),
      downloadable: fs.existsSync(file)
    };
  });

  const dbSize =
    fileSize(core.DB_FILE) +
    fileSize(core.DB_FILE + "-wal") +
    fileSize(core.DB_FILE + "-shm");

  res.set("Cache-Control", "no-store");
  res.json({
    backups: list,
    databaseSize: dbSize,
    backupsSize: dirSize(core.BACKUP_DIR),
    disk: diskUsage(),
    lastDownloadAt: settings.get(LAST_DOWNLOAD_KEY, null)
  });
}));

/**
 * ANLIK YEDEK AL VE INDIR.
 *
 * Kalici diske YAZMAZ: goruntu gecici klasore alinir, gonderilir ve
 * silinir. Boylece her tiklama 1 GB'lik diskte kalici yer kaplamaz.
 * POST olmasinin sebebi: sunucuda is yapan bir istek; baska bir siteden
 * gelen basit bir baglantiyla tetiklenmemeli.
 */
router.post("/backups/snapshot", staffAuth.requireSuperAdmin, wrap(async (req, res) => {
  if (!fs.existsSync(core.DB_FILE)) {
    return res.status(500).json({ error: "Database file not found." });
  }

  const stamp = core.stamp();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mentoros-yedek-"));
  const tmpFile = path.join(tmpDir, "mentoros.db");

  const Database = require("better-sqlite3");
  const src = new Database(core.DB_FILE, { readonly: true });
  try {
    // Uygulama calisirken bile tutarli tek dosya (bkz. backup-core).
    src.prepare("VACUUM INTO ?").run(tmpFile);
  } finally {
    src.close();
  }

  const name = downloadName(stamp);
  logDownload(req, `${name} (anlik)`);
  sendDb(res, tmpFile, name, () => {
    fs.rm(tmpDir, { recursive: true, force: true }, () => {});
  });
}));

/** Mevcut bir yedegi indir. */
router.get("/backups/:name/download", staffAuth.requireSuperAdmin, wrap(async (req, res) => {
  const wanted = String(req.params.name || "");

  // Yalnizca listede OLAN bir ad kabul edilir - yol gezinmesine kapali.
  if (!core.listBackups().includes(wanted)) {
    return res.status(404).json({ error: "Backup not found." });
  }

  const file = path.join(core.BACKUP_DIR, wanted, "mentoros.db");
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: "Backup file not found." });
  }

  const name = downloadName(wanted);
  logDownload(req, name);
  sendDb(res, file, name);
}));

module.exports = router;
