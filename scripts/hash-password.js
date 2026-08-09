/**
 * Yonetici sifresi icin hash uretir:  npm run hash-password
 *
 * FARKI NE?
 *   set-admin-password  -> hash'i .env DOSYASINA yazar (yerel kurulum)
 *   hash-password       -> hash'i sadece EKRANA yazar (bulut kurulumu)
 *
 * Bulutta .env dosyasi yoktur; degerler saglayicinin "environment
 * variables" ekranindan girilir. Bu betik oraya yapistiracaginiz
 * degeri uretir.
 *
 * Duz sifre hicbir yere kaydedilmez.
 */

const readline = require("readline");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

function ask(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

(async () => {
  console.log(`
  MentorOS - yonetici sifresi hash'i
  ---------------------------------------------------------
  Uretilen degerleri bulut saglayicinizin "Environment
  Variables" ekranina girin. Bu ekranda gorunen duz sifre
  HICBIR YERE kaydedilmez.
`);

  const password = await ask("  Yonetici sifresi : ");

  if (!password || password.length < 8) {
    console.error("\n  Sifre en az 8 karakter olmali.\n");
    process.exit(1);
  }

  const hash = bcrypt.hashSync(password, 12);
  const secret = crypto.randomBytes(32).toString("hex");

  console.log(`
  ---------------------------------------------------------
  Asagidakileri ortam degiskeni olarak ekleyin:

  ADMIN_PASSWORD_HASH=${hash}

  SETTINGS_SECRET=${secret}

  ---------------------------------------------------------
  SETTINGS_SECRET NEDIR?
    Claude API anahtarinizi veritabaninda sifrelemek icin
    kullanilir. DEGISTIRMEYIN ve KAYBETMEYIN - degisirse
    kayitli API anahtari okunamaz hale gelir ve yonetici
    panelinden yeniden girmeniz gerekir.

    Bu degeri sadece ILK kurulumda uretin. Zaten bir
    degeriniz varsa onu koruyun.
  ---------------------------------------------------------
`);
})();
