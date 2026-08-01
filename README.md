# MentorOS v2

Gizlilik odaklı mentor–mentee eşleştirme platformu.
Tamamen **local** çalışır: SQLite + Node.js. Bulut bağımlılığı yok.

---

## Kurulum

```bash
npm install
cp .env.example .env            # PowerShell: Copy-Item .env.example .env
npm run set-admin-password      # yönetici şifresini belirle
npm run seed                    # demo verisi (firma: demo / şifre: demo1234)
npm start
```

Sonra **http://localhost:3000/admin.html** → yönetici şifresiyle gir →
Claude bağlantısını kur.

Uygulama: http://localhost:3000/login.html

---

## Claude bağlantısı (yönetici paneli)

**Geliştiricinin API anahtarı uygulamada bulunmaz.** Kurumu kuran firma,
yönetici panelinden kendi Claude erişimini bağlar. Faturayı onlar öder,
veri onların hesabından geçer.

Üç yol sunulur:

| Yöntem | Ne zaman |
|---|---|
| **Anthropic API anahtarı** | En basit. `console.anthropic.com → API Keys` |
| **AWS Bedrock** | Firmanın AWS altyapısı varsa. Veri AWS hesabında kalır. |
| **Google Cloud** | Firmanın GCP altyapısı varsa. Veri GCP hesabında kalır. |

Panel ayrıca:

- **Bağlantı testi** — gerçek bir çağrı atar. Hata varsa IT'nin anlayacağı
  Türkçe teşhis verir: *"Ağa erişilemiyor. IT ekibinden api.anthropic.com
  (443) trafiğini açmasını isteyin."*
- **Gizlilik denetimi** — yapay zekaya gönderilen **her metni** gösterir.
  Admin, isimlerin gerçekten maskelendiğini (`[ISIM]`, `[EPOSTA]`, `M1`)
  gözle doğrulayabilir. KVKK denetiminde kanıt olur.
- **Kullanım** — çağrı sayısı, token, ortalama süre.

**Güvenlik notu:** Panel, uygulamanın geri kalanından **ayrı bir şifreyle**
korunur. Sebebi: `API_KEY` tüm HTML dosyalarında açıkça yazılıdır, yani
ağdaki herkes onu okuyabilir. Panel de o anahtarla korunsaydı, ağdaki
herkes firmanın Claude anahtarını değiştirebilirdi.

API anahtarları veritabanında **AES-256-GCM ile şifreli** saklanır ve
tarayıcıya bir daha asla dönmez — sadece `sk-ant-...4f2a` gibi maskeli
gösterilir.

---

## Akış

```
mentor_registration.html   Mentor kaydolur, formu doldurur
        ↓
mentee_matching.html       İK mentee ihtiyacını yazar → "Eşleştir"
        ↓  POST /match
   ai/privacy.js           İsim/e-posta maskelenir, mentorlar M1, M2... olur
   ai/matching.js          Claude anonim profilleri okur, gerekçeli puanlar
        ↓
match_approval.html        Mentor ve mentee ayrı token'lı linklerle onaylar
        ↓  ikisi de onaylayınca
mentorship_workspace.html  AI hedefleri üretir, taraflar düzenleyebilir,
                           toplantı kurar, not yazar, geçmişe bakar
        ↓
hr_dashboard.html          İK süreci izler
```

---

## Gizlilik mimarisi

Bu projenin ana vaadi. Nasıl garanti altına alındığı:

**1. Anonimleştirme yapısal, opsiyonel değil.**
`ai/privacy.js → anonymizeMentor()` mentor profilini AI için hazırlar ve
`fullName` / `email` alanlarına *hiç dokunmaz*. Sızıntı bir env değişkenini
unutmakla değil, ancak bu fonksiyonu bilerek değiştirmekle mümkün.

**2. Tek AI çıkışı.**
Uygulamadaki hiçbir yer Claude'u doğrudan çağırmaz. Hepsi `ai/client.js`
üzerinden geçer, o da her istekte `assertClean()` çalıştırır. Metinde
e-posta veya kimlik numarası kalmışsa **istek gönderilmez, hata fırlatılır**.

**3. Serbest metin temizliği.**
İK'nın yazdığı gelişim ihtiyacına isim kaçmışsa (`"Zeynep'in ekibiyle..."`),
`scrub()` bunu maskeler. Türkçe ekleri de yakalar.

**4. Denetim izi.**
`AI_AUDIT_LOG=true` iken AI'a giden her metin konsola yazılır. KVKK
denetiminde "ne gönderiliyor?" sorusuna kanıtla cevap verebilirsiniz.

### Kurumsal seçenek: veriyi Anthropic'e hiç göndermemek

Firmanın AWS veya Google Cloud altyapısı varsa, `.env` içinde tek satır:

```
AI_PROVIDER=bedrock     # veya vertex
```

Kod değişmez. İstekler firmanın kendi bulut hesabından geçer; veri
Anthropic'e hiç ulaşmaz. Bölgesel endpoint'lerle AB veri ikametgâhı da
sağlanabilir.

---

## Yedekleme — güncelleme öncesi MUTLAKA

```powershell
npm run backup              # yedek al
npm run backup -- --list    # yedekleri listele
npm run restore             # son yedeği geri yükle
npm run restore -- 2026-07-12T19-23-54    # belirli bir yedeği
```

Yedekler **proje dışında** tutulur (`../mentoros-yedekler`), böylece projenin
üstüne yeni sürüm açmak yedekleri silmez.

Hem `data/mentoros.db` hem `.env` yedeklenir — birlikte olmaları şart:
Claude anahtarı veritabanında `.env` içindeki `SETTINGS_SECRET` ile şifrelidir.
`.env` kaybolursa anahtar çözülemez.

`restore` çalışmadan önce mevcut durumu ayrıca yedekler — geri yükleme de bir
kayıp riskidir.

---

## Eski (Firestore) verisini taşıma

**Veri bilgisayarınızdan çıkmaz.**

```powershell
npm install firebase-admin --no-save

# 1. Google hesabınızla giriş (servis hesabı anahtarı GEREKMEZ)
gcloud auth application-default login

# 2. Sadece istediğiniz firmanın kayıtlarını çek
npm run export-firestore -- --project mentor-matching-ai-a9a0a --company 0003

# 3. ÖNCE DENEME — hiçbir şey yazılmaz
node scripts/import-mentors.js --dry-run --from 0003 --company demo

# 4. Doğruysa gerçek yükleme (--replace mevcutları siler)
node scripts/import-mentors.js --from 0003 --company demo --replace

# 5. Temizlik
npm uninstall firebase-admin
```

| Bayrak | Anlamı |
|---|---|
| `--project` | Firebase proje kimliği |
| `--company` (export) | Sadece bu `companyId`'ye ait kayıtları çeker |
| `--from` (import) | **Kaynak** firma kodu (eski Firestore'daki) |
| `--company` (import) | **Hedef** firma kodu (yeni sistemdeki) |
| `--replace` | Hedef firmadaki mevcut mentorları önce siler |
| `--dry-run` | Sadece gösterir, yazmaz |

`--from` vermezseniz ve dosyada birden fazla firma varsa script durur — başka
müşterilerin verisi kazara yüklenmesin diye.

### İki giriş yolu

**A) Google hesabınızla (önerilen)** — `gcloud auth application-default login`
ve `--project`. Anahtar dosyasıyla uğraşmazsınız; iptal edilmiş anahtar sorunu
yaşanmaz.

**B) Servis hesabı anahtarıyla** — `serviceAccountKey.json` proje kökünde
olsun, `--project` vermeyin. Anahtar iptal edilmişse `UNAUTHENTICATED` hatası
alırsınız; o zaman A yolunu kullanın.

`export-firestore.js` yalnızca **okur** — Firestore'daki hiçbir veriyi
değiştirmez veya silmez. Eski projeniz yedek olarak olduğu gibi kalır.

Yükleyici eski alan adlarına toleranslıdır: `displayName` / `name` /
`fullName`, `title` / `jobTitle` / `role`, `softSkills` /
`behaviouralCompetencies` gibi varyantları tanır. Firestore Timestamp'lerini,
ISO metin tarihleri, `"2-3 mentee"` gibi bozuk kapasite değerlerini ve
virgülle ayrılmış metinleri doğru çevirir. Adı olmayan bozuk kayıtları atlar
ve hangilerini atladığını söyler.

**`--replace` uyarısı:** Silinecek mentorların aktif mentorluk ilişkisi varsa
script önce uyarır — silmek çalışma alanlarını ve toplantı notlarını da yok
eder.

---

## Müşteriye teslim ederken — ÖNEMLİ

AI anahtarının öncelik sırası:

```
1. Veritabanı (yönetici panelinden girilen)   ← varsa bu kazanır
2. .env dosyası                               ← geri dönüş
```

Firma panelden kendi anahtarını girdiği anda `.env`'deki anahtar **devre dışı
kalır** — ama **silinmez**. Dosya hâlâ oradadır.

### Teslim adımları

1. **`.env` dosyanızı GÖNDERMEYİN.** Sadece `.env.example` gitsin.
2. Müşterinin `.env` dosyasına şunu ekleyin:
   ```
   CUSTOMER_DEPLOYMENT=true
   ```
   Bu, `.env` içindeki AI anahtarlarını **tamamen yok saydırır**. Kazara
   geliştirici anahtarı kullanılamaz; bağlantı yalnızca panelden kurulabilir.
3. `npm run set-admin-password` → şifreyi müşteriye verin.
4. Müşteri `/admin.html` → kendi Claude erişimini bağlar.

### Panel geliştirici anahtarını fark eder

`CUSTOMER_DEPLOYMENT=false` iken ve `.env`'de bir anahtar varsa, panel yeşil
"bağlandı" göstermez. Sarı uyarı çıkarır:

> **Dikkat:** Sistem şu anda tedarikçinin geçici anahtarıyla çalışıyor.
> Kullanım ücreti kuruma değil tedarikçiye yansır.

Böylece müşteri "zaten bağlıymış" sanıp sizin faturanızı şişirmez.

---

## Erişim katmanları — kim neyi görebilir

| Katman | Sayfalar | Nasıl erişilir |
|---|---|---|
| **Herkese açık** | `login`, `index`, `register` | Anahtar/giriş yok |
| **Katılımcı** | `match_approval`, `mentorship_workspace`, `guided_session` | Kendine özel token |
| **Personel (İK)** | `mentor_registry`, `hr_dashboard`, `mentee_matching`, `super_admin` | **Firma girişi zorunlu** |
| **Yönetici** | `admin` | Ayrı admin şifresi |

### Mentor Kayıtları sayfası (`/mentor_registry.html`)

İK'nın mentor veritabanı. Ana sayfadaki **Mentor Registry** kartından açılır.

- Üstte **davet bağlantısı** (kopyala / yenile)
- Tüm mentorların tablosu: rol, uzmanlık, kapasite çubuğu, durum, kayıt tarihi
- Arama ve filtre (aktif / pasif / boş kapasitesi olan)
- Bir mentora tıkla → **profilini düzenle** (mentorun formu tekrar doldurmasına gerek yok)
- **Pasife al** → eşleştirmeye girmez ama verisi durur
- **Sil** → aktif ilişkisi varsa önce uyarır (silmek çalışma alanlarını ve toplantı notlarını da yok eder)

**Mentorlar giriş yapmaz.** İK bu sayfadan davet bağlantısı alır ve paylaşır:

```
http://localhost:3000/register.html?invite=<token>
```

Mentor bu linke tıklar, formu doldurur, kaydeder. Başka hiçbir sayfayı
göremez — `/hr_dashboard.html` yazsa giriş ekranına yönlendirilir.

Bağlantı yanlış kişilere ulaştıysa İK panelinden **Yenile** denir; eski
link anında geçersiz olur.

### Paylaşımlı API anahtarı artık hiçbir açık sayfada yok

Eskiden 7 HTML dosyasının içinde `API_KEY = "mentor-demo-key-2026"` açıkça
yazılıydı. Kayıt formuna ulaşan bir mentor, sayfanın kaynağına bakıp bu
anahtarı okuyabilir ve onunla **tüm İK verilerine** erişebilirdi.

Artık mentor/mentee sayfaları paylaşımlı anahtar taşımaz. Her biri yalnızca
kendi kaynağına erişim veren bir token kullanır:

- Kayıt formu → firmanın davet token'ı (sadece "bu firmaya mentor ekle")
- Onay sayfası → o talebe özel token (sadece o talebi görür/onaylar)
- Çalışma alanı → o ilişkiye özel token (sadece o ilişkiyi görür)

Token, sahibine başka hiçbir şey göstermez.

---

## v1'den v2'ye — düzeltilenler

| Sorun | v1 | v2 |
|---|---|---|
| Firebase private key repo'da | Sızmıştı | Firebase tamamen çıkarıldı |
| Toplantı notları | SQLite'ta **hiç çalışmıyordu** (subcollection yok) | Gerçek tablo, çalışıyor |
| `mentorships` tablosu | SQLite'ta **yoktu** → onay sonrası crash | Var |
| `/guided-session` | Frontend çağırıyordu, **endpoint yoktu** | Eklendi |
| Mentor isimleri | Embedding modunda OpenAI'a **gidiyordu** | Hiç gitmiyor |
| `/development-plan` | Mentor + mentee **gerçek adını** gönderiyordu | İsim göndermiyor |
| Onay linkleri | ID'yi bilen **herkes onaylayabiliyordu** | Kriptografik token |
| Firma şifreleri | **Düz metin** | bcrypt |
| Skorlar | 100'ü aşabiliyordu | 0–100, normalize |
| `capacity` | String gelirse NaN → herkese −50 ceza | INTEGER, güvenli parse |
| `/debug-firestore` | **Auth'suz**, tüm isim + e-postalar açık | Silindi |
| JSON parse | `JSON.parse(output_text)` → kırılgan | Tool use → şema garantili |
| AI çağrıları | 3 ayrı yerde dağınık | Tek `ai/client.js` |
| API anahtarı | 7 açık HTML dosyasında yazılı | Açık sayfalarda hiç yok |
| İK panelleri | Herkes açabiliyordu | Giriş zorunlu (oturum çerezi) |
| Mentor kaydı | Giriş / anahtar gerekiyordu | Davet linki, giriş yok |
| Claude anahtarı | `.env`'de, geliştiricinin | Panelden, firmanın kendi anahtarı |

---

## Test

```bash
node scripts/smoke-test.js
```

43 test — özellikle v1'de kırık olan her şeyi kontrol eder.

---

## Yapı

```
config.js              Tüm yapılandırma tek yerde
server.js              İnce, sadece route bağlama
db/
  schema.sql           Gerçek tablolar, FK, index
  index.js             better-sqlite3 bağlantısı
  repos.js             Tüm SQL burada
ai/
  client.js            TEK Claude çıkışı (anthropic/bedrock/vertex)
  privacy.js           PII maskeleme + anonimleştirme
  matching.js          Eşleştirme motoru
  devplan.js           Gelişim planı üretimi
  guidedSession.js     Rehberli seans
routes/                REST endpoint'leri
public/                HTML arayüzleri (v1'den korundu)
```

---

## Notlar

- `API_KEY` frontend'de görünür — bu gerçek kimlik doğrulama değil, kaza
  koruması. Gerçek kullanıcı girişi eklenecekse ayrı bir iş.
- Eşleştirme embedding kullanmaz. 10–100 mentor için Claude'un tüm
  profilleri okuyup gerekçe üretmesi hem daha basit hem daha kaliteli.
  Mentor havuzu birkaç yüzü aşarsa `ai/matching.js` içine bir ön eleme
  katmanı eklenebilir; mimari buna hazır.
