# MentorOS Cloud — Kurulum Kılavuzu

Bu sürüm, **tek sunucuda birden fazla kuruluşa** hizmet verir. Her kuruluş
kendi kullanıcı adı ve şifresiyle girer ve **yalnızca kendi verisini** görür.

---

## 1. Nasıl çalışıyor?

İki tür giriş var:

| Kim | Kullanıcı adı | Ne yapar |
|---|---|---|
| **Siz (yönetici)** | `superadmin` | Kuruluş hesabı açar, süre uzatır, şifre sıfırlar |
| **Kuruluş** | örn. `dernek` | Kendi mentor/mentee verisini yönetir |

İkisi de aynı adresten girer: `https://<adresiniz>/login.html`

Yönetici girince otomatik olarak yönetim paneline (`/super_admin.html`)
yönlendirilir. Kuruluşlar oraya **giremez**.

Ayrıca teknik ayarlar paneli (`/admin.html`) vardır: Claude bağlantısı,
SMTP ve denetim kaydı. Orası da yalnızca yöneticiye aittir — şifresi
`ADMIN_PASSWORD_HASH`'tir, kuruluş şifreleriyle ilgisi yoktur.

---

## 2. Kuruluma başlamadan: sağlayıcı seçimi

Uygulamanın üç şeye ihtiyacı var:

1. **Node.js 18+** çalıştırabilmek
2. **Kalıcı disk** — veritabanı bir dosya (SQLite). Geçici diske
   yazılırsa sunucu her yeniden başladığında **tüm veri silinir.**
   Bu, bulut kurulumunun en sık yapılan hatasıdır.
3. **HTTPS** — çoğu sağlayıcı otomatik verir.

Türkiye'den erişim için sunucunun Türkiye'de olması **gerekmez**;
Frankfurt/Amsterdam gibi Avrupa lokasyonları ~50 ms gecikmeyle çalışır
ve kullanıcı farkı hissetmez.

**Kolaylık önceliğinizse:** Render, Railway veya Fly.io gibi bir
platform (PaaS). Sunucu yönetimi yok; kodu bağlarsınız, çalıştırırlar.
Kalıcı disk (volume) eklemeyi **unutmayın** — ücretsiz katmanlarda
genelde yoktur.

**Maliyet önceliğinizse:** Hetzner gibi bir VPS aylık ~5 EUR'dan başlar
ve disk zaten kalıcıdır; karşılığında Node kurulumu, HTTPS sertifikası
ve servis ayarını kendiniz yaparsınız.

---

## 3. Ortam değişkenleri

Bulutta `.env` dosyası kullanılmaz. Değerleri sağlayıcınızın
**Environment Variables** ekranına girin.

Önce hash ve şifreleme anahtarını üretin:

```
npm install
npm run hash-password
```

Ekrana çıkan iki değeri kopyalayın, sonra şunları tanımlayın:

```
CLOUD=true
SITE_BASE_URL=https://mentoros.example.com
DB_PATH=/var/data/mentoros.db
ADMIN_PASSWORD_HASH=<üretilen>
SETTINGS_SECRET=<üretilen>
PII_SCRUBBING=true
CUSTOMER_DEPLOYMENT=true
```

Dikkat edilecekler:

- **`SITE_BASE_URL`** davet ve onay linklerinde kullanılır. Yanlışsa
  gönderilen linkler hata vermez, sadece **açılmaz**.
- **`DB_PATH`** kalıcı diskinizi göstermeli.
- **`SETTINGS_SECRET`** bir kez üretilir ve **asla değiştirilmez**.
  Değişirse kayıtlı Claude API anahtarı okunamaz hâle gelir.

Uygulama açılırken bu hataları tespit edip **günlüğe açıkça yazar**.
İlk çalıştırmadan sonra logları mutlaka okuyun.

---

## 4. İlk çalıştırma

```
npm install
npm start
```

Sonra sırasıyla:

1. `https://<adresiniz>/login.html` → kullanıcı adı `superadmin`,
   şifre: `hash-password` çalıştırırken girdiğiniz şifre.
2. **Teknik ayarlar** → Claude API anahtarınızı girin. (AI bağlantısı
   tüm kuruluşlarda ortaktır; maliyeti siz karşılarsınız.)
3. Aynı ekrandan SMTP bilgilerini girin — davet ve onay e-postaları
   bunsuz gönderilemez.
4. Yönetim paneline dönüp ilk kuruluş hesabını oluşturun.

---

## 5. Kuruluş hesabı açmak

Yönetim panelinde **Yeni hesap oluştur**:

- **Kuruluş adı** — ekranda görünen isim (sonradan değiştirilebilir)
- **Kullanıcı adı** — giriş için. **Sonradan değiştirilemez**, çünkü
  verinin anahtarıdır.
- **Şifre** — "Rastgele üret" önerilir
- **Geçerlilik bitişi** — varsayılan bir yıl sonrası

Kaydedince kimlik bilgileri **bir kez** gösterilir; şifre sunucuda
yalnızca şifrelenmiş hâliyle saklanır, tekrar görüntülenemez.
Kopyalayıp kuruluşa iletin.

---

## 6. Süre dolunca ne olur?

Hesap **giriş yapamaz**, ama **verisi silinmez**. Kullanıcı "şifreniz
yanlış" değil, sürenin dolduğunu söyleyen bir mesaj görür.

Tarihi uzattığınız anda erişim geri açılır ve tüm veri yerindedir.

Şifre değiştirmek, süreyi güncellemek veya hesabı pasife almak,
o hesabın **açık oturumlarını anında kapatır**.

---

## 7. Yedekleme (atlamayın)

Tüm veri tek bir dosyadadır: `DB_PATH` ile gösterdiğiniz yer.

SQLite `journal_mode=WAL` kullandığı için yanındaki `-wal` ve `-shm`
dosyaları da vardır. Güvenli kopya için sunucuyu kısa süre durdurup
üç dosyayı birlikte alın; ya da sağlayıcınızın disk anlık görüntüsü
(snapshot) özelliğini kullanın.

Sağlayıcının otomatik yedeği olsa bile **kendi kopyanızı da tutun**.

---

## 8. Gizlilik notu

Mentor ve mentee isimleri/e-postaları yapay zekaya **hiçbir zaman
gönderilmez**; profiller M1/M2/M3 gibi kodlarla anonimleştirilir ve
serbest metinlerdeki kişisel veriler ayrıca temizlenir
(`PII_SCRUBBING=true`). Ne gönderildiğini yönetici panelindeki
**denetim kaydından** satır satır görebilirsiniz.

Ancak bu sürümde veri **sizin kiraladığınız bulut sunucusunda** durur.
Kuruluşlara "veriler kendi makinemizden hiç çıkmaz" **diyemezsiniz** —
bu, yerel (on-premise) sürümün vaadidir. Burada doğru ifade şudur:

> Veriler, Avrupa'da barındırılan sunucumuzda şifreli saklanır;
> yapay zekaya kişisel veri gönderilmez.

Hangi bölgede barındırdığınızı ve sağlayıcınızla aranızdaki veri
işleme sözleşmesini kuruluşa bildirmeniz KVKK açısından yerinde olur.
