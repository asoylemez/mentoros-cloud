/**
 * Yonetici sifresini belirler:  npm run set-admin-password
 *
 * Sifreyi bcrypt ile hash'leyip .env icine ADMIN_PASSWORD_HASH olarak
 * yazar. Duz sifre hicbir yere kaydedilmez.
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const bcrypt = require("bcryptjs");

const ENV_PATH = path.resolve(".env");

function ask(question, { hidden = false } = {}) {
  return new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    if (hidden) {
      // Yazilani ekranda gosterme
      const onData = char => {
        if (["\n", "\r", "\u0004"].includes(char)) {
          process.stdin.removeListener("data", onData);
        } else {
          readline.clearLine(process.stdout, 0);
          readline.cursorTo(process.stdout, 0);
          process.stdout.write(question + "*".repeat(rl.line.length));
        }
      };
      process.stdin.on("data", onData);
    }

    rl.question(question, answer => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer);
    });
  });
}

(async () => {
  console.log("\n  MentorOS - Yonetici sifresi belirleme\n");

  const password = await ask("  Yeni yonetici sifresi : ", { hidden: true });

  if (!password || password.length < 8) {
    console.error("\n  Sifre en az 8 karakter olmali.\n");
    process.exit(1);
  }

  const confirm = await ask("  Sifreyi tekrar girin   : ", { hidden: true });

  if (password !== confirm) {
    console.error("\n  Sifreler eslesmiyor.\n");
    process.exit(1);
  }

  const hash = bcrypt.hashSync(password, 12);

  // .env dosyasini oku (yoksa .env.example'dan olustur)
  let env = "";

  if (fs.existsSync(ENV_PATH)) {
    env = fs.readFileSync(ENV_PATH, "utf8");
  } else if (fs.existsSync(".env.example")) {
    env = fs.readFileSync(".env.example", "utf8");
    console.log("\n  .env bulunamadi, .env.example'dan olusturuluyor.");
  }

  const line = `ADMIN_PASSWORD_HASH=${hash}`;

  if (/^ADMIN_PASSWORD_HASH=.*$/m.test(env)) {
    env = env.replace(/^ADMIN_PASSWORD_HASH=.*$/m, line);
  } else {
    env += `\n# Yonetici paneli sifresi (bcrypt). npm run set-admin-password ile uretildi.\n${line}\n`;
  }

  fs.writeFileSync(ENV_PATH, env, { mode: 0o600 });

  console.log(`
  Sifre kaydedildi.
  ------------------------------------------
  Panel : http://localhost:3000/admin.html
  ------------------------------------------
  Sunucu calisiyorsa yeniden baslatin.
`);
})();
