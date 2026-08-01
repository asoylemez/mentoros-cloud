# MentorOS Cloud — Mimari Özet

Kuruluşların BT birimlerine sunulmak üzere hazırlanmıştır.
Son güncelleme: 1 Ağustos 2026

---

## 1. Tek cümleyle

MentorOS Cloud, Frankfurt'ta barındırılan tek bir sunucu üzerinde çalışan,
her kuruluşun yalnızca kendi verisini gördüğü bir web uygulamasıdır.
Kullanıcılar tarayıcıdan HTTPS ile bağlanır; kurulum, VPN veya eklenti
gerekmez.

---

## 2. Bileşenler — ne nerede?

| Katman | Sağlayıcı | Görevi | Veriyi görür mü? |
|---|---|---|---|
| Alan adı ve DNS | Cloudflare | `app.getmentoros.com` adresini sunucuya yönlendirir | **Hayır** |
| Uygulama + veritabanı | Render (Frankfurt) | Uygulamayı çalıştırır, veriyi diskte tutar | Altyapı sahibi olarak evet |
| Yapay zeka | Anthropic (Claude API) | Eşleştirme önerisi üretir | Yalnızca anonim veri |
| E-posta | SMTP sağlayıcınız | Davet ve onay e-postalarını iletir | **Evet — isim ve e-posta** |
| Tanıtım sitesi | Netlify | `getmentoros.com` ve `www` | Uygulama verisine erişimi yok |

**Önemli:** Cloudflare yalnızca DNS kaydı tutar (proxy kapalı — "DNS only").
Yani "bu isim şu adrese gitsin" der ve devreden çıkar. Kullanıcı trafiği
Cloudflare üzerinden **geçmez**; tarayıcı doğrudan Render'a bağlanır.

---

## 3. Bir isteğin izlediği yol

```
Kullanıcının tarayıcısı
        │
        │  1) app.getmentoros.com adresi nedir?
        ▼
   Cloudflare DNS  ──────────►  "şu sunucu"   (trafik buradan geçmez)
        │
        │  2) doğrudan HTTPS bağlantısı (TLS 1.2+)
        ▼
   Render — Frankfurt (EU Central)
        │
        ├── Node.js / Express uygulaması
        │
        └── SQLite veritabanı dosyası
            /var/data/mentoros.db   (kalıcı disk)
```

TLS şifrelemesi tarayıcı ile Render arasında uçtan uca kurulur.
Sertifika Let's Encrypt tarafından verilir ve otomatik yenilenir.

---

## 4. Veri nerede tutuluyor?

- **Fiziksel konum:** Render'ın Frankfurt (EU Central) bölgesindeki veri merkezi
- **Biçim:** Tek bir SQLite veritabanı dosyası
- **Yol:** `/var/data/mentoros.db` — servise bağlı kalıcı disk (1 GB)
- **Kapsam:** Mentor ve mentee profilleri, eşleşmeler, toplantı notları,
  anket sonuçları, e-posta kayıtları

Veri Türkiye'de değil, Avrupa Birliği içinde barındırılmaktadır.
Kullanıcıların Türkiye'den erişmesi için sunucunun Türkiye'de olması
gerekmez; gecikme yaklaşık 50 ms'dir ve kullanıcı tarafından hissedilmez.

---

## 5. Kuruluşlar birbirinin verisini nasıl görmüyor?

Tek veritabanı birden fazla kuruluşa hizmet verir. İzolasyon şu şekilde
sağlanır:

- Her kayıt (mentor, mentee, eşleşme, anket, e-posta günlüğü) bir
  **kuruluş kimliğine** bağlıdır.
- Bu kimlik **yalnızca oturum çerezinden** okunur. Adres çubuğu, başlık
  veya istek gövdesinden gelen hiçbir değer dikkate alınmaz — dolayısıyla
  kullanıcı kendi kuruluş kimliğini değiştirerek başka bir kuruluşun
  verisine geçemez.
- Oturumu olmayan istekler veriye hiç ulaşamaz (HTTP 401).
- Kuruluş hesapları, yönetim uçlarına (hesap listeleme, oluşturma, silme)
  erişemez (HTTP 403).

Bu davranışlar devreye alma öncesinde iki ayrı kuruluş hesabıyla
sınanmıştır.

---

## 6. Kimlik doğrulama ve oturum

**İki tür hesap vardır:**

| | Kullanıcı adı | Nerede saklanır | Yetkisi |
|---|---|---|---|
| Sağlayıcı (yönetici) | `superadmin` | Ortam değişkeni (veritabanında değil) | Hesap açar, süre uzatır; kuruluş verisine erişemez |
| Kuruluş | örn. `dernek` | Veritabanı (bcrypt ile şifrelenmiş) | Yalnızca kendi verisi |

**Oturum ayrıntıları:**

- Çerez `HttpOnly` (JavaScript okuyamaz), `Secure` (yalnızca HTTPS),
  `SameSite=Lax`
- Süre 8 saat; kullanıldıkça uzar
- Şifre değişikliği, hesabın pasife alınması veya sürenin dolması
  **açık oturumları anında düşürür**
- 8 başarısız giriş denemesinden sonra IP 15 dakika kilitlenir

**Erişim süresi:** Her kuruluş hesabının bir bitiş tarihi vardır
(varsayılan bir yıl). Süre dolduğunda hesap **giriş yapamaz**, ancak
**verisi silinmez**; tarih uzatıldığında erişim aynen geri açılır.

---

## 7. Yapay zekaya ne gönderiliyor?

Eşleştirme önerisi üretmek için Anthropic Claude API kullanılır.
Gönderilen veri **anonimleştirilir**:

**Gönderilmeyenler:** ad, soyad, e-posta, telefon, yönetici bilgisi

**Gönderilenler:** anonim kod (M1, M2, M3…), unvan, kademe, kıdem,
fonksiyonel alan, sektör, yetkinlikler, diller, uygun formatlar,
kalan kapasite ve serbest metin alanları

Serbest metinler ayrıca bir **temizleme katmanından** geçirilir; içlerinde
kalmış olabilecek isim, e-posta ve telefon örüntüleri maskelenir. Gönderim
öncesinde son bir kontrol daha yapılır ve kimlik bilgisi tespit edilirse
istek **iptal edilir**.

Yapay zekadan dönen sonuç yalnızca anonim kodlar ve puanlar içerir;
kod-kişi eşlemesi sunucu tarafında yapılır.

**Denetlenebilirlik:** Yönetim panelindeki denetim kaydından, yapay zekaya
gönderilen her isteğin içeriği satır satır görüntülenebilir.

---

## 8. Üçüncü taraflar ve veri işleme

Şeffaflık açısından BT birimine açıkça belirtilmesi gerekenler:

1. **Render** — uygulamayı ve veritabanını barındırır. Altyapı sahibi
   olduğu için teknik olarak veriye erişebilir. KVKK/GDPR anlamında
   **veri işleyen** konumundadır; veri işleme sözleşmesi (DPA)
   gerekmektedir.

2. **SMTP sağlayıcınız** — davet ve onay e-postalarını iletir. Bu
   e-postalar **gerçek ad ve e-posta adresi içerir**. Anonimleştirme
   yalnızca yapay zeka çağrıları için geçerlidir, e-posta gönderimi için
   değil.

3. **Anthropic** — yalnızca anonimleştirilmiş profil verisi alır.

4. **Cloudflare** — yalnızca DNS kaydı tutar, trafiği görmez.

5. **Let's Encrypt** — TLS sertifikası verir, veri akışına dahil değildir.

**Doğru ifade:** "Veriler Avrupa Birliği içinde (Frankfurt) barındırılan
sunucumuzda saklanır; yapay zekaya kişisel veri gönderilmez."

**Kullanılmaması gereken ifade:** "Veriler kendi makinemizden hiç çıkmaz,
hiçbir üçüncü taraf göremez." Bu, yerel (on-premise) kurulumun vaadidir ve
bulut sürümü için doğru değildir.

---

## 9. Süreklilik ve yedekleme

- **Tek örnek çalışır.** Yüksek erişilebilirlik (HA) yapılandırması yoktur.
  Dağıtım sırasında birkaç saniyelik kesinti olur.
- **Sunucu yeniden başladığında** açık oturumlar düşer; kullanıcılar
  yeniden giriş yapar. Veri etkilenmez.
- **Yedekleme sağlayıcının sorumluluğunda değildir.** Veritabanı dosyasının
  düzenli kopyası alınmalıdır. SQLite `WAL` kipinde çalıştığı için
  `-wal` ve `-shm` yardımcı dosyaları da birlikte kopyalanmalıdır.

---

## 10. Teknik künye

| | |
|---|---|
| Çalışma ortamı | Node.js 22 (Express) |
| Veritabanı | SQLite (`better-sqlite3`) |
| Barındırma | Render — Starter (512 MB RAM, 0.5 CPU), Frankfurt |
| Kalıcı disk | 1 GB, `/var/data` |
| Şifre saklama | bcrypt |
| TLS | Let's Encrypt, otomatik yenileme |
| Yapay zeka | Anthropic Claude API |
| Erişim adresi | `https://app.getmentoros.com` |
| Aylık maliyet | ≈ 7,25 USD (sunucu + disk) |
