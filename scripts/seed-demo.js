/**
 * ====================================================================
 * DEMO VERI YUKLEYICI
 * ====================================================================
 *
 * Kullanim:
 *     npm run seed -- --company=demo
 *     npm run seed -- --company=demo --mentors=12 --mentees=8
 *     npm run seed -- --company=demo --temizle
 *
 * NEDEN --company ZORUNLU?
 *   Bulut surumunde tek veritabani birden fazla kurulusa hizmet
 *   verir. Hedef belirtilmezse veri yanlis kurulusa - ornegin
 *   gercek bir musteriye - yazilabilir. Bu yuzden varsayilan yok.
 *
 * GUVENLIK:
 *   Betik, hedef hesapta ZATEN VERI VARSA durur. Gercek bir
 *   kurulusun uzerine demo veri karistirmak, sonradan ayiklanmasi
 *   cok zor bir karisiklik yaratir. Yine de istiyorsaniz --zorla
 *   kullanin.
 *
 *   Uretilen e-postalar @ornek.test uzantilidir. Bu uzanti gercekte
 *   YOKTUR - demo veriye yanlislikla e-posta gonderilse bile kimseye
 *   ulasmaz.
 */

const path = require("path");

// .env yuklensin (DB_PATH icin)
try { require("dotenv").config(); } catch { /* dotenv yoksa sorun degil */ }

const { companies, mentors, mentees } = require("../db/repos");

// --- Argumanlar -------------------------------------------------------

const args = process.argv.slice(2);

function arg(name, fallback = null) {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
}

const flag = name => args.includes(`--${name}`);

const companyId    = arg("company");
const mentorCount  = Number(arg("mentors", 12));
const menteeCount  = Number(arg("mentees", 8));
const clearFirst   = flag("temizle") || flag("clear");
const force        = flag("zorla")   || flag("force");

if (!companyId) {
  console.error(`
  Hedef kurulus belirtilmedi.

    npm run seed -- --company=<kullanici-adi>

  Ornek:
    npm run seed -- --company=demo
`);
  process.exit(1);
}

// --- Sozluk (kayit formlarindaki seceneklerle BIREBIR ayni) ----------
//
// Buradaki degerler formlardaki secenek listelerinden kopyalanmistir.
// Uydurma bir deger yazmak, eslestirmenin sahte bicimde kotu sonuc
// vermesine yol acar - cunku mentor ve mentee ayni kelime dagarcigini
// paylasmazsa ortak nokta bulunamaz.

const FUNCTIONS = [
  "Commercial / Sales", "Marketing", "Finance & P&L", "Supply Chain",
  "HR & People", "Operations", "Legal & Compliance", "Digital & IT",
  "Strategy", "General Management", "R&D / Innovation"
];

const INDUSTRIES = [
  "FMCG / CPG", "Retail", "Technology", "Manufacturing",
  "Financial services", "Consulting", "Healthcare", "Energy"
];

const BEHAVIOURAL = [
  "Leadership development", "Coaching & feedback", "Team management",
  "Communication & influence", "Change management", "Career planning",
  "Cross-cultural working", "Psychological safety", "Resilience & wellbeing",
  "Inclusion & diversity", "Negotiation & persuasion", "Confidence & visibility"
];

const TECHNICAL = [
  "P&L / financial acumen", "Strategy development", "Customer negotiation",
  "Data & analytics", "Digital transformation", "Project management",
  "Procurement & tendering", "Presenting & storytelling", "Talent management",
  "Category & shopper"
];

const MENTEE_LEVELS = [
  "New joiners", "Mid-level (Band 6–8)", "Senior (Band 9–10)",
  "First-time managers", "Experienced leaders", "No preference"
];

const FORMATS    = ["Video call", "Written / async", "In person", "Flexible / mixed"];
const LANGUAGES  = ["English", "Turkish", "German", "French", "Spanish"];
const MOTIVATIONS = [
  "Giving back", "Gaining new perspectives", "Developing my leadership",
  "Strengthening the organisation", "Personal growth"
];
const MENTOR_PROFILE = ["Same function", "Different function", "Senior leader", "No preference"];

const BANDS   = ["Band 6", "Band 7", "Band 8", "Band 9", "Band 10", "Band 11+"];
const TENURES = ["Less than 2 years", "2–4 years", "5–7 years", "8–10 years", "10+ years"];
const HOURS   = ["1-2", "2-4", "4-6", "6+"];
const CITIES  = ["İstanbul", "Ankara", "İzmir", "Bursa", "Antalya", "Kocaeli"];

const FIRST = [
  "Ayşe", "Mehmet", "Zeynep", "Mustafa", "Elif", "Ahmet", "Fatma", "Emre",
  "Selin", "Burak", "Deniz", "Cem", "Merve", "Onur", "Ceren", "Kaan",
  "Gizem", "Serkan", "Pınar", "Tolga", "Ebru", "Barış", "Nihan", "Umut"
];

const LAST = [
  "Yılmaz", "Kaya", "Demir", "Şahin", "Çelik", "Yıldız", "Aydın", "Öztürk",
  "Arslan", "Doğan", "Kılıç", "Aslan", "Çetin", "Kurt", "Koç", "Özdemir",
  "Şimşek", "Polat", "Erdoğan", "Güneş", "Taş", "Bulut", "Akın", "Sezer"
];

// --- Rastgelelik ------------------------------------------------------
//
// Sabit tohum kullaniliyor: betigi iki kez calistirinca AYNI veri
// uretilir. Boylece "dun gordugum eslestirme neden bugun farkli"
// sorusu ortadan kalkar; bir hatayi yeniden uretebilmek onemli.

let seed = 20260801;
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
const pick   = arr => arr[Math.floor(rnd() * arr.length)];
const int    = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const sample = (arr, n) => {
  const copy = [...arr];
  const out = [];
  for (let i = 0; i < n && copy.length; i++) {
    out.push(copy.splice(Math.floor(rnd() * copy.length), 1)[0]);
  }
  return out;
};

const usedNames = new Set();
function personName() {
  for (let i = 0; i < 200; i++) {
    const n = `${pick(FIRST)} ${pick(LAST)}`;
    if (!usedNames.has(n)) { usedNames.add(n); return n; }
  }
  return `${pick(FIRST)} ${pick(LAST)} ${usedNames.size}`;
}

function emailFor(name, i) {
  const slug = name
    .toLowerCase()
    .replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u")
    .replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/[^a-z]+/g, ".");
  // @ornek.test gercek bir alan adi degildir - kazara e-posta gitmez.
  return `${slug}.${i}@ornek.test`;
}

// --- Metin ureticiler -------------------------------------------------

function careerBio(fn, ind, years) {
  return `${years} yıldır ${ind} sektöründe ${fn} alanında çalışıyorum. ` +
         `Saha ve merkez rollerinde görev aldım; son yıllarda ekip yönetimi ve ` +
         `süreç iyileştirme projelerine odaklandım.`;
}

function mentorMessage() {
  return pick([
    "Deneyimlerimi paylaşarak birinin yolunu kısaltabilmek beni motive ediyor.",
    "Kariyerimin başında bana destek olan mentorların değerini biliyorum; aynısını yapmak istiyorum.",
    "Soru sormaktan çekinmeyin. Birlikte düşünmek, hazır cevap vermekten daha faydalı oluyor.",
    "Somut hedeflerle çalışmayı seviyorum. Ne üzerinde ilerlemek istediğinizi netleştirelim."
  ]);
}

function menteeChallenge() {
  return pick([
    "Ekip yönetimine yeni geçtim; delegasyon ve geri bildirim konusunda zorlanıyorum.",
    "Teknik tarafta güçlüyüm ama üst yönetime sunum yaparken etkili olamıyorum.",
    "Kariyerimde bir sonraki adımın ne olması gerektiğine karar veremiyorum.",
    "Farklı departmanlarla çalışırken önceliklerimi kabul ettirmekte zorlanıyorum.",
    "Yoğunluk arttıkça öncelik belirlemekte ve hayır demekte zorlanıyorum."
  ]);
}

function menteeGoal() {
  return pick([
    "Önümüzdeki iki yıl içinde ekip liderliği rolüne geçmek.",
    "Kendi fonksiyonum dışında bir projede sorumluluk almak.",
    "Üst yönetime düzenli sunum yapabilecek özgüveni kazanmak.",
    "Uzmanlık alanımı derinleştirip organizasyonda referans kişi olmak."
  ]);
}

// --- Kayit uretimi ----------------------------------------------------

function makeMentor(i) {
  const name  = personName();
  const funcs = sample(FUNCTIONS, int(1, 3));
  const inds  = sample(INDUSTRIES, int(1, 2));
  const years = int(6, 22);

  return {
    fullName: name,
    email: emailFor(name, i),
    role: `${funcs[0]} — ${pick(["Müdür", "Kıdemli Uzman", "Direktör", "Takım Lideri", "Grup Müdürü"])}`,
    band: pick(BANDS.slice(2)),          // mentorlar daha kidemli
    country: "Türkiye",
    location: pick(CITIES),
    region: "Türkiye",
    tenure: pick(TENURES.slice(2)),

    functionalAreas: funcs,
    industries: inds,
    careerBio: careerBio(funcs[0], inds[0], years),

    behaviouralCompetencies: sample(BEHAVIOURAL, int(2, 4)),
    technicalCompetencies: sample(TECHNICAL, int(2, 4)),
    additionalCompetencies: "",

    capacity: int(1, 3),
    hoursPerMonth: pick(HOURS),
    activeMenteeCount: 0,

    menteeLevels: sample(MENTEE_LEVELS, int(1, 3)),
    formats: sample(FORMATS, int(1, 2)),
    languages: rnd() > 0.6 ? ["Turkish", "English"] : ["Turkish"],

    availability: pick(["Available", "Available", "Available", "At capacity"]),
    motivations: sample(MOTIVATIONS, int(1, 3)),
    messageToMentee: mentorMessage(),
    visibilityPreference: ["Visible to HR only"],

    status: "active",
    kvkkConsent: 1
  };
}

function makeMentee(i) {
  const name  = personName();
  const funcs = sample(FUNCTIONS, int(1, 2));

  return {
    fullName: name,
    email: emailFor(name, 900 + i),
    department: funcs[0],
    role: `${funcs[0]} — ${pick(["Uzman", "Kıdemli Uzman", "Analist", "Takım Lideri", "Yeni Müdür"])}`,
    band: pick(BANDS.slice(0, 4)),       // mentee'ler daha az kidemli
    country: "Türkiye",
    region: "Türkiye",
    location: pick(CITIES),
    tenure: pick(TENURES.slice(0, 3)),

    devFunctionalAreas: funcs,
    devAreasExtra: "",
    developmentNeeds: menteeChallenge(),
    challenge: menteeChallenge(),

    competenciesToDevelop: sample([...BEHAVIOURAL, ...TECHNICAL], int(2, 4)),
    compExtra: "",
    goals: menteeGoal(),
    expectations: pick([
      "Ayda bir görüşüp somut hedefler üzerinde ilerlemek istiyorum.",
      "Deneyimli birinin bakış açısını duymak ve kör noktalarımı görmek istiyorum.",
      "Düzenli geri bildirim alabileceğim bir yapı arıyorum."
    ]),

    formats: sample(FORMATS, int(1, 2)),
    hoursPerMonth: pick(HOURS),
    preferredMentorProfile: sample(MENTOR_PROFILE, int(1, 2)),
    languages: ["Turkish"],

    managerName: personName(),
    managerEmail: emailFor("yonetici", 500 + i),

    message: "",
    kvkkConsent: 1,
    status: "active"
  };
}

// --- Calistir ---------------------------------------------------------

(function run() {
  const company = companies.get(companyId);

  if (!company) {
    console.error(`
  "${companyId}" adinda bir kurulus bulunamadi.

  Once yonetim panelinden hesabi olusturun:
      /super_admin.html
`);
    process.exit(1);
  }

  const existing = companies.counts(companyId);
  const hasData  = existing.mentors > 0 || existing.mentees > 0;

  if (hasData && !clearFirst && !force) {
    console.error(`
  "${company.name}" hesabinda ZATEN VERI VAR:
      ${existing.mentors} mentor, ${existing.mentees} mentee

  Demo veriyi gercek verinin uzerine eklemek, sonradan ayiklanmasi
  cok zor bir karisiklik yaratir. Once ne yapmak istediginize karar verin:

      --temizle   mevcut mentor/mentee kayitlarini SILIP demo veri yukler
      --zorla     mevcut verinin USTUNE demo veri ekler

  Ornek:
      npm run seed -- --company=${companyId} --temizle
`);
    process.exit(1);
  }

  if (clearFirst) {
    const before = companies.counts(companyId);

    // Not: remove(id) firma parametresi almaz; bu yuzden SADECE bu
    // kurulusa ait kayitlari listeleyip onlarin id'lerini siliyoruz.
    for (const m of mentors.listByCompany(companyId)) mentors.remove(m.id);
    for (const m of mentees.listByCompany(companyId)) mentees.remove(m.id);

    console.log(`  Temizlendi: ${before.mentors} mentor, ${before.mentees} mentee silindi.`);
  }

  console.log(`\n  Hedef kurulus : ${company.name}  (${companyId})`);
  console.log(`  Uretiliyor    : ${mentorCount} mentor, ${menteeCount} mentee\n`);

  for (let i = 0; i < mentorCount; i++) mentors.create(companyId, makeMentor(i));
  for (let i = 0; i < menteeCount; i++) mentees.create(companyId, makeMentee(i));

  const after = companies.counts(companyId);

  console.log(`  Tamamlandi.
  ---------------------------------------------------------
  Mentor  : ${after.mentors}
  Mentee  : ${after.mentees}
  ---------------------------------------------------------

  E-postalar @ornek.test uzantilidir; bu alan adi gercekte YOKTUR,
  bu yuzden demo kayitlara yanlislikla e-posta gonderilemez.

  Temizlemek icin:
      npm run seed -- --company=${companyId} --temizle --mentors=0 --mentees=0
`);
})();
