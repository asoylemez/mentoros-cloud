-- ============================================================
-- MentorOS veritabani semasi
--
-- Tasarim notu: Eski surumde SQLite, Firestore'u taklit eden bir
-- katmanla kullaniliyordu (collection/doc/subcollection). Bu yuzden
-- toplanti notlari (subcollection) hic calismiyordu.
-- Burada gercek tablolar ve gercek foreign key'ler var.
--
-- Dizi (array) alanlar JSON metin olarak saklanir; SQLite'in JSON
-- destegi bunun icin yeterli ve bu alanlarda sorgu yapmiyoruz.
-- ============================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- Firmalar (multi-tenant)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
  company_id     TEXT PRIMARY KEY,          -- slug: "acme-holding"
  name           TEXT NOT NULL,
  domain         TEXT DEFAULT '',
  password_hash  TEXT NOT NULL,             -- bcrypt. Duz metin sifre YOK.
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'inactive')),

  -- Mentorlarin GIRIS YAPMADAN kayit formuna ulasmasini saglayan token.
  -- IK bu linki paylasir: /register.html?invite=<token>
  -- Sizarsa IK panelinden yenilenebilir.
  invite_token   TEXT UNIQUE,

  -- Erisimin BITECEGI tarih (ISO). Bos ise sinirsiz.
  --
  -- Sure dolunca firma GIRIS YAPAMAZ, ama verisi SILINMEZ. Super admin
  -- panelinden tarihi uzatmak erisimi aninda geri acar. Veriyi rehin
  -- almiyoruz - sadece kapiyi kapatiyoruz.
  expires_at     TEXT DEFAULT '',

  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- ------------------------------------------------------------
-- Mentorlar
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mentors (
  id                        TEXT PRIMARY KEY,
  company_id                TEXT NOT NULL,

  -- Kimlik bilgileri (KVKK: bunlar AI'a ASLA gonderilmez)
  full_name                 TEXT NOT NULL DEFAULT '',
  email                     TEXT NOT NULL DEFAULT '',

  -- Profil
  role                      TEXT DEFAULT '',
  band                      TEXT DEFAULT '',
  country                   TEXT DEFAULT '',
  location                  TEXT DEFAULT '',
  region                    TEXT DEFAULT '',
  tenure                    TEXT DEFAULT '',

  functional_areas          TEXT DEFAULT '[]',   -- JSON
  industries                TEXT DEFAULT '[]',   -- JSON
  career_bio                TEXT DEFAULT '',

  behavioural_competencies  TEXT DEFAULT '[]',   -- JSON
  technical_competencies    TEXT DEFAULT '[]',   -- JSON
  additional_competencies   TEXT DEFAULT '',

  skills                    TEXT DEFAULT '[]',   -- JSON
  competency_description    TEXT DEFAULT '',
  experience_areas          TEXT DEFAULT '[]',   -- JSON
  mentor_profile            TEXT DEFAULT '',

  -- Kapasite
  capacity                  INTEGER NOT NULL DEFAULT 1,   -- ARTIK SAYI, string degil
  hours_per_month           TEXT DEFAULT '',
  active_mentee_count       INTEGER NOT NULL DEFAULT 0,

  mentee_levels             TEXT DEFAULT '[]',   -- JSON
  formats                   TEXT DEFAULT '[]',   -- JSON
  languages                 TEXT DEFAULT '[]',   -- JSON

  availability              TEXT DEFAULT '',
  motivations               TEXT DEFAULT '[]',   -- JSON
  message_to_mentee         TEXT DEFAULT '',
  visibility_preference     TEXT DEFAULT '[]',   -- JSON

  status                    TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'inactive')),

  kvkk_consent              INTEGER NOT NULL DEFAULT 0,

  submitted_at              TEXT NOT NULL,
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL,

  FOREIGN KEY (company_id) REFERENCES companies(company_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mentors_company        ON mentors(company_id);
CREATE INDEX IF NOT EXISTS idx_mentors_company_status ON mentors(company_id, status);

-- ------------------------------------------------------------
-- Mentee'ler
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mentees (
  id                 TEXT PRIMARY KEY,
  company_id         TEXT NOT NULL,

  full_name          TEXT NOT NULL DEFAULT '',
  email              TEXT NOT NULL DEFAULT '',

  department         TEXT DEFAULT '',
  role               TEXT DEFAULT '',
  band               TEXT DEFAULT '',
  country            TEXT DEFAULT '',
  region             TEXT DEFAULT '',
  tenure             TEXT DEFAULT '',

  -- Gelisim ihtiyaci
  dev_functional_areas    TEXT DEFAULT '[]',   -- JSON (mentor uzmanlik havuzu ile ayni)
  dev_areas_extra         TEXT DEFAULT '',     -- serbest metin
  development_needs        TEXT DEFAULT '',
  challenge                TEXT DEFAULT '',

  -- Hedefler
  competencies_to_develop  TEXT DEFAULT '[]',  -- JSON (mentor yetkinlik havuzu ile ayni)
  comp_extra               TEXT DEFAULT '',    -- serbest metin
  goals                    TEXT DEFAULT '',    -- serbest metin kariyer hedefi
  expectations             TEXT DEFAULT '',

  -- Tercihler
  formats                  TEXT DEFAULT '[]',  -- JSON
  hours_per_month          TEXT DEFAULT '',
  preferred_mentor_profile TEXT DEFAULT '[]',  -- JSON
  languages          TEXT DEFAULT '[]',   -- JSON
  location           TEXT DEFAULT '',

  -- Yonetici (onay akisi icin)
  manager_name       TEXT DEFAULT '',
  manager_email      TEXT DEFAULT '',

  message            TEXT DEFAULT '',
  kvkk_consent       INTEGER NOT NULL DEFAULT 0,

  status             TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'inactive')),
  submitted_at       TEXT DEFAULT '',

  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,

  FOREIGN KEY (company_id) REFERENCES companies(company_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mentees_company ON mentees(company_id);

-- ------------------------------------------------------------
-- Eslesme talepleri (cift tarafli onay)
--
-- GUVENLIK: mentor_token / mentee_token eklendi.
-- Eski surumde onay linki sadece kayit id'si tasiyordu; id'yi bilen
-- herkes baskasi adina onay verebiliyordu. Artik her taraf icin
-- ayri, tahmin edilemez bir token gerekiyor.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS match_requests (
  id                 TEXT PRIMARY KEY,
  company_id         TEXT NOT NULL,

  mentor_id          TEXT NOT NULL,
  mentee_id          TEXT DEFAULT '',

  mentor_name        TEXT DEFAULT '',
  mentee_name        TEXT DEFAULT '',
  mentor_email       TEXT DEFAULT '',
  mentee_email       TEXT DEFAULT '',
  mentee_role        TEXT DEFAULT '',
  mentee_department  TEXT DEFAULT '',
  development_need   TEXT DEFAULT '',

  -- Mentee'nin yoneticisi. Onay surecinin ILK kapisidir:
  -- yonetici onaylamadan mentor ve mentee'ye link GONDERILMEZ.
  -- Sebep: mentee'nin zamanini taahhut eden kisi yoneticisidir.
  manager_name       TEXT DEFAULT '',
  manager_email      TEXT DEFAULT '',

  match_score        INTEGER DEFAULT 0,
  match_reason       TEXT DEFAULT '',

  mentor_token       TEXT NOT NULL UNIQUE,
  mentee_token       TEXT NOT NULL UNIQUE,
  manager_token      TEXT UNIQUE,

  -- 'not_required' -> yonetici girilmemis, kapi yok (eski kayitlar da boyle)
  manager_approval   TEXT NOT NULL DEFAULT 'not_required'
                     CHECK (manager_approval IN ('not_required', 'pending', 'approved', 'rejected')),
  mentor_approval    TEXT NOT NULL DEFAULT 'pending'
                     CHECK (mentor_approval IN ('pending', 'approved', 'rejected')),
  mentee_approval    TEXT NOT NULL DEFAULT 'pending'
                     CHECK (mentee_approval IN ('pending', 'approved', 'rejected')),
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'approved', 'rejected')),

  -- Red gerekcesi. "Reddedildi" tek basina IK'ya hicbir sey soylemez;
  -- zamanlama mi, mentor mu, oncelik mi? Sebep bilinmeden surec
  -- iyilestirilemez.
  rejected_by        TEXT DEFAULT '',      -- manager | mentor | mentee
  rejection_category TEXT DEFAULT '',      -- yapilandirilmis sebep
  rejection_note     TEXT DEFAULT '',      -- serbest aciklama
  rejected_at        TEXT DEFAULT '',

  mentorship_id      TEXT,

  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,

  FOREIGN KEY (company_id) REFERENCES companies(company_id) ON DELETE CASCADE,
  FOREIGN KEY (mentor_id)  REFERENCES mentors(id)           ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mr_company ON match_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_mr_status  ON match_requests(company_id, status);

-- ------------------------------------------------------------
-- Mentorluk iliskileri (calisma alani)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mentorships (
  id                  TEXT PRIMARY KEY,
  company_id          TEXT NOT NULL,

  mentor_id           TEXT NOT NULL,
  mentee_id           TEXT DEFAULT '',

  mentor_name         TEXT DEFAULT '',
  mentee_name         TEXT DEFAULT '',
  mentor_email        TEXT DEFAULT '',
  mentee_email        TEXT DEFAULT '',
  mentee_role         TEXT DEFAULT '',
  mentee_department   TEXT DEFAULT '',
  development_need    TEXT DEFAULT '',

  goals               TEXT DEFAULT '[]',   -- JSON
  development_areas   TEXT DEFAULT '[]',   -- JSON
  success_criteria    TEXT DEFAULT '[]',   -- JSON

  status              TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'completed', 'paused', 'cancelled')),

  next_meeting_date   TEXT DEFAULT '',
  next_meeting_time   TEXT DEFAULT '',

  -- Calisma alaninin mentee ve mentor icin KAPANACAGI tarih (IK belirler).
  -- Bilgi amaclidir: bu tarih sadece gosterilir; sayfa SILINMEZ ve tarih
  -- gecse bile erisim acik kalir.
  closing_date        TEXT DEFAULT '',

  -- Mentor ve mentee'nin calisma sayfasina GIRIS YAPMADAN ulasmasini
  -- saglar. Bu token SADECE bu iliskiye erisim verir - baska hicbir
  -- veriye degil. Boylece calisma sayfasinda paylasimli API anahtari
  -- tasimaya gerek kalmaz.
  access_token        TEXT UNIQUE,

  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,

  FOREIGN KEY (company_id) REFERENCES companies(company_id) ON DELETE CASCADE,
  FOREIGN KEY (mentor_id)  REFERENCES mentors(id)           ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ms_company ON mentorships(company_id);
CREATE INDEX IF NOT EXISTS idx_ms_mentor  ON mentorships(mentor_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ms_unique_pair
  ON mentorships(company_id, mentor_id, mentee_id);

-- ------------------------------------------------------------
-- Toplantilar
--
-- Eski surumde bu Firestore subcollection'i idi ve SQLite
-- adapter'inda hic karsiligi yoktu -> local'de calismiyordu.
-- Artik normal bir tablo, mentorships'e foreign key ile bagli.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meetings (
  id                          TEXT PRIMARY KEY,
  mentorship_id               TEXT NOT NULL,

  meeting_date                TEXT NOT NULL,
  title                       TEXT NOT NULL,
  agenda                      TEXT DEFAULT '',
  discussed                   TEXT DEFAULT '',
  progress_since_last_meeting TEXT DEFAULT '',
  action_items                TEXT DEFAULT '[]',   -- JSON: [{text, status}]
  next_meeting_focus          TEXT DEFAULT '',
  next_meeting_date           TEXT DEFAULT '',
  next_meeting_time           TEXT DEFAULT '',
  created_by                  TEXT DEFAULT 'unknown',

  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL,

  FOREIGN KEY (mentorship_id) REFERENCES mentorships(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_meetings_mentorship
  ON meetings(mentorship_id, meeting_date);

-- ------------------------------------------------------------
-- Uygulama ayarlari (admin panelinden yonetilir)
--
-- Yapay zeka baglantisi burada tutulur; .env'de DEGIL.
-- Boylece admin panelden degistirince sunucuyu yeniden
-- baslatmaya gerek kalmaz.
--
-- API key'ler AES-256-GCM ile SIFRELI saklanir.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  encrypted   INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT DEFAULT ''
);

-- ------------------------------------------------------------
-- Yapay zeka denetim kaydi
--
-- KVKK icin: "yapay zekaya ne gonderiyorsunuz?" sorusuna tahminle
-- degil KANITLA cevap verebilmek.
--
-- Onceden sadece BELLEKTE tutuluyordu -> sunucu yeniden baslayinca
-- siliniyordu. Artik kalici.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_audit (
  id            TEXT PRIMARY KEY,
  timestamp     TEXT NOT NULL,
  operation     TEXT NOT NULL,
  provider      TEXT,
  model         TEXT,
  prompt_sent   TEXT,          -- AI'a giden TAM metin
  duration_ms   INTEGER,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  ok            INTEGER NOT NULL DEFAULT 1,
  error         TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_time ON ai_audit(timestamp DESC);

-- ------------------------------------------------------------
-- E-posta gonderim kaydi
--
-- IK'nin "bu kisiye link gonderdim mi?" sorusunu cevaplamasi icin.
-- Ayrica basarisiz gonderimler burada gorunur.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_log (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL,
  kind         TEXT NOT NULL,          -- invite | approval | workspace
  recipient    TEXT NOT NULL,
  subject      TEXT DEFAULT '',
  ref_id       TEXT DEFAULT '',        -- talep veya iliski id'si
  ok           INTEGER NOT NULL DEFAULT 1,
  error        TEXT,
  sent_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_ref ON email_log(ref_id);
CREATE INDEX IF NOT EXISTS idx_email_company ON email_log(company_id, sent_at DESC);

-- ------------------------------------------------------------
-- Kurulum kimligi ve deneme takibi
--
-- Deneme suresinin ne zaman basladigi burada tutulur. Ayrica
-- data/ klasoru disinda bir isaret dosyasi da yazilir; ikisinden
-- EN ERKEN tarih gecerli sayilir. Boylece veritabanini silip
-- denemeyi sifirlamak islevsiz kalir.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS install (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  installed_at  TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL
);

-- ------------------------------------------------------------
-- Kapanis anketleri
--
-- Mentorluk bitiminde IK, mentor ve mentee'ye AYRI AYRI anket
-- gonderir. Her anket kendi token'i ile acilir; giris gerekmez.
--
-- GIZLILIK: Cevaplari YALNIZCA IK gorur. Mentor kendi hakkindaki
-- degerlendirmeyi, mentee de kendi hakkindakini goremez. Bu soz
-- anket sayfasinda kullaniciya acikca yazilir - yazdigi seyin
-- karsi tarafa gitmeyecegini bilmeyen kimse durust yazmaz.
--
-- answers: JSON. Soru seti surumlenebilsin diye serbest birakildi;
-- ileride soru eklenirse eski cevaplar bozulmaz.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS surveys (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL,
  mentorship_id  TEXT NOT NULL,
  role           TEXT NOT NULL,          -- mentor | mentee
  token          TEXT NOT NULL UNIQUE,
  status         TEXT NOT NULL DEFAULT 'pending',   -- pending | completed
  recipient_name  TEXT DEFAULT '',
  recipient_email TEXT DEFAULT '',
  language       TEXT DEFAULT 'tr',
  answers        TEXT,                   -- JSON
  sent_at        TEXT NOT NULL,
  completed_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_surveys_mentorship
  ON surveys(mentorship_id, role);

CREATE INDEX IF NOT EXISTS idx_surveys_company
  ON surveys(company_id, sent_at DESC);
