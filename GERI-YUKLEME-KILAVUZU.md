# Acil Durum: Yedekten Geri Yükleme (MentorOS Cloud)

Bu kılavuz, bir sorun anında verileri yedekten nasıl geri alacağınızı adım adım anlatır. Sakin olun: aşağıdaki yöntemlerin hiçbiri mevcut veriyi silmez, önce kenara taşır.

---

## Önceden hazır olması gerekenler

Bunları bir sorun çıkmadan, şimdiden hazırlayın:

- [ ] `DB_ENCRYPTION_KEY` ve `SETTINGS_SECRET` bir parola yöneticisinde kayıtlı (Render → servis → **Environment**).
- [ ] Haftada bir indirilmiş, sunucu dışında saklanan yedek (Super admin → **Yedekler** → *Şimdi yedek al ve indir*).
- [ ] Bilgisayarınızda proje klasörü ve içinde bir kez `npm install --ignore-scripts` yapılmış.
- [ ] Render'da SSH anahtarınız tanımlı (bkz. **Ek: SSH anahtarını bir kez kurmak**). Yalnızca 3. senaryoda gerekir, ama acil anda kurmak zaman kaybettirir.

---

## Önce şunu bilin

- **Geri yükleme, 8 kuruluşun hepsini birlikte geriye alır.** Yedekten sonra herhangi bir firmanın girdiği her şey (yeni mentorlar, toplantı notları, anketler) kaybolur.
- Bu yüzden **tek bir firmanın tek bir kaydı** için tam geri yükleme yapılmaz; 1. senaryoya bakın.
- Geri yükleme sırasında uygulama 2–3 dakika kapanır ve HR kullanıcılarının oturumu düşer.
- Mümkünse başlamadan önce Super admin'den **Şimdi yedek al ve indir** ile o anki durumu da indirin.

---

## Hangi senaryodasınız?

| Ne oldu? | Ne yapılır? |
|---|---|
| Bir firma bir kaydı yanlışlıkla sildi ya da bozdu; uygulama çalışıyor | **Senaryo 1:** tam geri yükleme yok; kayıt yedekten bulunup elle yeniden girilir |
| Uygulama çalışmıyor ya da veriler topluca bozuldu; Render servisi ve disk yerinde | **Senaryo 2:** sunucudaki günlük yedekten geri yükleme |
| Disk ya da servis kayboldu; sunucudaki yedekler de yok veya bozuk | **Senaryo 3:** bilgisayarınıza indirdiğiniz yedekten geri yükleme |

---

## Senaryo 1 — Tek bir kayıt kayboldu

1. Silinmeden önceki tarihe ait bir yedeği indirin (Super admin → **Yedekler** → **İndir**).
2. Yedeğin açıldığını doğrulayın: PowerShell'de iki anahtarı girip `npm run verify-backup -- "C:\...\yedek.db"` çalıştırın.
3. Aynı pencerede yedeğin okunabilir bir kopyasını çıkarın:
   ```
   $env:DB_PATH="C:\...\yedek.db"
   npm run db-decrypt
   ```
   Yedeğin yanında `yedek.db.decrypted` dosyası oluşur.
4. Bu dosyayı ücretsiz **DB Browser for SQLite** programıyla açın; kaydı ilgili tabloda (`mentors`, `mentees`, `mentorships`, `meetings` …) bulun.
5. Bilgileri uygulamaya elle yeniden girin.
6. **`.decrypted` dosyasını hemen silin** — tüm firmaların verisi içinde şifresiz durur. PowerShell penceresini kapatın.

---

## Senaryo 2 — Sunucudaki günlük yedekten geri yükleme

Sunucu her gün kendi diskine bir yedek alır ve 14 gün saklar.

1. **Yedeği seçin.** Render → servis → **Shell** sekmesinde:
   ```
   ls /var/data/yedekler
   ```
   Sorundan önceki en yeni yedeğin adını not edin, örneğin `2026-11-05T16-20-45-oto`.
   *(Klasör farklıysa Environment'taki `BACKUP_DIR` değerine bakın.)*
2. **Geri yüklemeyi başlatın.** Render → **Environment** → **Add Environment Variable**:
   - Key: `RESTORE_FILE`
   - Value: `/var/data/yedekler/2026-11-05T16-20-45-oto/mentoros.db`

   **Save Changes**'e basın. Servis kendiliğinden yeniden başlar.
3. **Sonucu kontrol edin.** Render → **Logs**'ta şu bloğu arayın:
   ```
   BACKUP RESTORED from /var/data/yedekler/.../mentoros.db
     before : companies 8, mentors ...
     now    : companies 8, mentors ...
   ```
   `RESTORE NOT DONE` görürseniz hemen altında nedeni yazar ve **hiçbir şey değişmemiştir**; uygulama mevcut veriyle çalışır.
4. Uygulamaya girip birkaç firmayı kontrol edin.
5. **`RESTORE_FILE`'ı silin.** Environment → değişkeni silin → **Save Changes**. Servis bir kez daha yeniden başlar. Unutsanız bile aynı yedek ikinci kez yüklenmez, ama değişkeni bırakmayın.
6. Her şey yolundaysa birkaç gün sonra eski veritabanının kopyasını silin (Shell):
   ```
   ls /var/data
   rm -r /var/data/geri-yukleme-oncesi-2026-11-06T...
   ```

**Geri almak isterseniz:** Geri yüklemeden önceki veritabanı `/var/data/geri-yukleme-oncesi-<zaman>/` klasöründe durur. `RESTORE_FILE` değerini `/var/data/geri-yukleme-oncesi-<zaman>/mentoros.db` yapıp aynı adımları izleyin.

---

## Senaryo 3 — İndirdiğiniz yedekten geri yükleme

1. **Servis yoksa** yeniden kurun (bkz. `BULUT-KURULUM.md`). Environment'a **eski** `DB_ENCRYPTION_KEY` ve `SETTINGS_SECRET` değerlerini girin — yenisini üretmeyin, yoksa yedek açılmaz.
2. **Yedeği doğrulayın** (bilgisayarınızda):
   ```
   npm run verify-backup -- "C:\...\mentoros-yedek-....db"
   ```
   Üç satırda da **OK** görmelisiniz.
3. **Yedeği sunucuya yükleyin.** PowerShell'de (`SERVIS`'in ne olduğu için bkz. **Ek**):
   ```
   ssh SERVIS@ssh.frankfurt.render.com "mkdir -p /var/data/geri-yukle"
   scp -s "C:\...\mentoros-yedek-....db" SERVIS@ssh.frankfurt.render.com:/var/data/geri-yukle/
   ```
4. **Geri yüklemeyi başlatın.** Environment → `RESTORE_FILE` = `/var/data/geri-yukle/mentoros-yedek-....db` → **Save Changes**.
5. Senaryo 2'deki **3, 4 ve 5. adımları** izleyin (log kontrolü, uygulama kontrolü, `RESTORE_FILE`'ı silme).
6. Yüklediğiniz dosyayı sunucudan silin (Shell):
   ```
   rm -r /var/data/geri-yukle
   ```

---

## Son çare: Render disk anlık görüntüsü

Render diskin her gün anlık görüntüsünü alır ve 7 gün saklar (servis → **Disks** → snapshot seçimi). Geri dönüş tüm diski — yedekler dahil — o güne döndürür. Render bu yöntemi veritabanları için önermez, çünkü dosya yazılırken alınmış olabilir. Önce Senaryo 2 ve 3'ü deneyin.

---

## Ek: SSH anahtarını bir kez kurmak (Windows)

1. PowerShell'de:
   ```
   ssh-keygen -t ed25519
   ```
   Sorulara Enter ile geçebilirsiniz (isterseniz bir parola da verin).
2. Açık anahtarı panoya kopyalayın:
   ```
   Get-Content $HOME\.ssh\id_ed25519.pub | Set-Clipboard
   ```
3. Render → sağ üstte hesap → **Account Settings** → **SSH Public Keys** → **+ Add SSH Public Key** → bir ad verin ve yapıştırın.
4. **SERVIS kimliği:** Render'da servis sayfası açıkken adres çubuğuna bakın: `dashboard.render.com/web/srv-abc123...` — `srv-` ile başlayan kısım servis kimliğidir. (Servis sayfasındaki **Connect** menüsünde hazır SSH komutu da gösterilir.) Kılavuzdaki `SERVIS` yerine bunu yazın: `srv-abc123@ssh.frankfurt.render.com`.
5. Deneyin: `ssh srv-abc123@ssh.frankfurt.render.com "ls /var/data"` — dosya listesi gelirse hazırsınız.

`id_ed25519` (`.pub` olmayan) dosyası özel anahtarınızdır; kimseyle paylaşmayın.

---

Teknik ayrıntı: geri yükleme, uygulama açılırken, veritabanı henüz açılmamışken yapılır (`lib/restoreOnBoot.js`). Böylece çalışan bir veritabanının üzerine yazma riski yoktur. Bu yol `npm run restore-test` ile her sürümde sınanır.
