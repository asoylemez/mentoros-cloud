const crypto = require("crypto");
const nodemailer = require("nodemailer");

const { db, now } = require("../db");
const settings = require("../db/settings");

/**
 * ====================================================================
 * E-POSTA GONDERIMI
 * ====================================================================
 *
 * SMTP ayarlari, Claude ayarlari gibi VERITABANINDA tutulur ve
 * yonetici panelinden yapilandirilir. Sifre AES-256-GCM ile
 * sifrelenerek saklanir ve tarayiciya bir daha donmez.
 *
 * GIZLILIK NOTU:
 * Bu modul yapay zeka ile hicbir sekilde temas etmez. E-postalar
 * dogrudan firmanin kendi SMTP sunucusundan gider; icerik hicbir
 * ucuncu tarafa ulasmaz.
 */

// --- Ayarlar -----------------------------------------------------------

function getConfig() {
  const port = Number(settings.get("smtp.port", "587"));

  return {
    host: settings.get("smtp.host", ""),
    port,
    secure: settings.get("smtp.secure", "false") === "true",
    user: settings.get("smtp.user", ""),
    password: settings.get("smtp.password", ""),
    fromName: settings.get("smtp.fromName", "Mentorluk Programi"),
    fromEmail: settings.get("smtp.fromEmail", "")
  };
}

function isConfigured() {
  const c = getConfig();
  return !!(c.host && c.fromEmail);
}

/** Panelde gosterilecek hali - SIFRE ICERMEZ. */
function getConfigPublic() {
  const c = getConfig();

  return {
    host: c.host,
    port: c.port,
    secure: c.secure,
    user: c.user,
    passwordMasked: settings.mask(c.password),
    fromName: c.fromName,
    fromEmail: c.fromEmail,
    configured: isConfigured()
  };
}

let cached = null;

function resetTransport() {
  cached = null;
}

function getTransport() {
  const c = getConfig();

  if (!isConfigured()) {
    const err = new Error(
      "E-posta sunucusu yapilandirilmamis. " +
      "Yonetici panelinden ayarlayin: /admin.html"
    );
    err.code = "SMTP_NOT_CONFIGURED";
    throw err;
  }

  const signature = [c.host, c.port, c.secure, c.user, c.password].join("|");
  if (cached && cached.signature === signature) return cached.transport;

  const transport = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,               // 465 -> true, 587 -> false (STARTTLS)
    auth: c.user ? { user: c.user, pass: c.password } : undefined,
    tls: {
      // Kurumsal SMTP sunucularinda kendinden imzali sertifika yaygin.
      rejectUnauthorized: false
    }
  });

  cached = { transport, signature };
  return transport;
}

// --- Hata teshisi ------------------------------------------------------

function diagnose(error, lang = "en") {
  const msg = String(error?.message || "");
  const code = error?.code || "";
  const c = getConfig();
  const en = lang !== "tr";

  const D = {
    notConfigured: {
      tr: {
        title: "E-posta sunucusu yapilandirilmamis",
        detail: "Asagidaki formdan SMTP bilgilerinizi girin.",
        action: null
      },
      en: {
        title: "Email server not configured",
        detail: "Enter your SMTP details in the form below.",
        action: null
      }
    },
    auth: {
      tr: {
        title: "Kimlik dogrulama basarisiz",
        detail: "Kullanici adi veya sifre reddedildi.",
        action: "Bilgileri kontrol edin. Office 365 / Google Workspace kullaniyorsaniz normal sifre yerine 'uygulama sifresi' (app password) gerekebilir."
      },
      en: {
        title: "Authentication failed",
        detail: "The username or password was rejected.",
        action: "Check the credentials. With Office 365 or Google Workspace you may need an 'app password' instead of the normal account password."
      }
    },
    connect: {
      tr: {
        title: "Sunucuya baglanilamadi",
        detail: `${c.host}:${c.port} adresine erisilemiyor.`,
        action: "Sunucu adresini ve portu kontrol edin. Guvenlik duvari bu portu engelliyor olabilir - IT ekibinize danisin."
      },
      en: {
        title: "Could not connect to the server",
        detail: `Cannot reach ${c.host}:${c.port}.`,
        action: "Check the host and port. A firewall may be blocking this port - ask your IT team."
      }
    },
    tls: {
      tr: {
        title: "Guvenlik sertifikasi sorunu",
        detail: msg,
        action: "Port 587 icin SSL kutusunu KAPALI birakin (STARTTLS kullanilir). Port 465 icin ACIK olmali."
      },
      en: {
        title: "TLS / certificate problem",
        detail: msg,
        action: "For port 587 leave the SSL box UNCHECKED (STARTTLS is used). For port 465 it must be CHECKED."
      }
    },
    relay: {
      tr: {
        title: "Gonderim izni yok",
        detail: "Sunucu bu adresten e-posta gondermenize izin vermiyor.",
        action: "'Gonderen e-posta' adresinin, giris yaptiginiz hesapla ayni olmasi gerekebilir."
      },
      en: {
        title: "Not allowed to send",
        detail: "The server will not let you send from this address.",
        action: "The 'sender email' usually has to match the account you log in with."
      }
    },
    unknown: {
      tr: { title: "E-posta gonderilemedi", detail: msg || "Bilinmeyen hata.", action: null },
      en: { title: "Could not send email", detail: msg || "Unknown error.", action: null }
    }
  };

  const pick = key => ({ ok: false, code: key, ...D[key][en ? "en" : "tr"] });

  if (error?.code === "SMTP_NOT_CONFIGURED") return pick("notConfigured");

  if (code === "EAUTH" || /535|authentication failed|invalid login/i.test(msg)) {
    return pick("auth");
  }

  if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "ENOTFOUND") {
    return pick("connect");
  }

  if (/certificate|self.signed|SSL|TLS/i.test(msg)) return pick("tls");

  if (/must be authenticated|not allowed to send|relay/i.test(msg)) return pick("relay");

  return pick("unknown");
}

// --- Sablonlar ---------------------------------------------------------

/**
 * E-posta icinde kucuk bir bilgi karti. Yoneticinin tek bakista
 * "kim, ne kadar uyumlu" gorebilmesi icin.
 * Tablo kullaniyoruz - eski e-posta istemcilerinde flexbox calismaz.
 */
function card(rows) {
  const cells = rows
    .filter(Boolean)
    .map(([label, value]) => `
      <tr>
        <td style="padding:6px 0;color:#6b7280;font-size:13px;width:42%;">${label}</td>
        <td style="padding:6px 0;color:#23262d;font-size:14px;">${value}</td>
      </tr>`)
    .join("");

  return `<table cellpadding="0" cellspacing="0" style="width:100%;
    background:#f7f8fa;border:1px solid #e5e7eb;border-radius:8px;
    padding:12px 16px;margin:4px 0;">${cells}</table>`;
}

const T = {
  tr: {
    inviteSubject: c => `${c} - Mentor Kaydi Daveti`,
    inviteTitle: "Mentor Olarak Katilin",
    inviteBody: c =>
      `${c} mentorluk programina mentor olarak katilmaniz icin davet edildiniz.` +
      `<br><br>Asagidaki baglantiya tiklayarak kisa bir form doldurmaniz yeterli. ` +
      `Giris yapmaniza veya hesap olusturmaniza gerek yok.`,
    inviteButton: "Kayit Formunu Ac",

    inviteSubjectMentee: c => `${c} - Mentee Kaydi Daveti`,
    inviteTitleMentee: "Mentee Olarak Katilin",
    inviteBodyMentee: c =>
      `${c} mentorluk programina mentee olarak katilmaniz icin davet edildiniz.` +
      `<br><br>Asagidaki baglantiya tiklayarak kisa bir form doldurmaniz yeterli. ` +
      `Giris yapmaniza veya hesap olusturmaniza gerek yok.`,
    inviteButtonMentee: "Kayit Formunu Ac",

    // The ONLY mail of a new match (sent by HR from the HR Dashboard).
    workspaceSubject: "Mentorluk eşleşmeniz: çalışma sayfanız hazır",
    workspaceTitle: "Mentorluk eşleşmeniz oluşturuldu",
    workspaceBody: ({ name, other, isMentor, period, group, members }) =>
      `Merhaba ${name},<br><br>` +
      (group
        ? (isMentor
            ? `<b>${group}</b> grubuyla mentorluk eşleşmeniz oluşturuldu; bu grubun mentoru sizsiniz.` +
              `<br><b>Gruptaki katılımcılar:</b> ${members}`
            : `<b>${group}</b> grubunun bir üyesi olarak mentorluk eşleşmeniz oluşturuldu; grubun mentoru <b>${other}</b>.` +
              `<br><b>Gruptaki katılımcılar:</b> ${members}`)
        : (isMentor
            ? `<b>${other}</b> ile mentorluk eşleşmeniz oluşturuldu; bu eşleşmede mentor sizsiniz.`
            : `<b>${other}</b> ile mentorluk eşleşmeniz oluşturuldu; ${other} sizin mentorunuz olacak.`)) +
      (period ? `<br><br><b>Eşleşmenin süresi:</b> ${period}` : "") +
      `<br><br>Aşağıdaki bağlantıdan ortak çalışma sayfanıza girebilirsiniz. ` +
      (group ? `Bu sayfa mentor ile bütün grubun ortak alanıdır: gelişim planını burada oluşturur, `
             : `Bu sayfa ikinizin ortak alanıdır: gelişim planınızı burada oluşturur, `) +
      `her görüşmeden sonra toplantı notunu ve süresini kaydeder, aksiyonları ` +
      `takip eder ve bir sonraki görüşmeyi planlarsınız.` +
      `<br><br>Sayfa giriş gerektirmez, yalnızca bu bağlantıyla açılır. ` +
      `Lütfen bağlantıyı başkalarıyla paylaşmayın.`,
    workspaceButton: "Çalışma sayfasını aç",
    workspacePeriod: (start, end) => `${start} – ${end}`,

    meetingInviteSummary: "Mentorluk Gorusmesi",
    meetingInviteSubject: "Mentorluk Gorusmesi Daveti",
    meetingInviteTitle: "Yeni Bir Gorusme Planlandi",
    meetingInviteIntro:
      "Asagidaki tarihte bir mentorluk gorusmesi planlandi. " +
      "Takviminize eklemek icin ekteki daveti kabul edin.",
    meetingInviteWhen: "Tarih ve saat",
    meetingInviteWith: "Katilimcilar",
    meetingInviteFocus: "Gorusme odagi",
    meetingInviteGuests: "Ek katilimcilar",
    surveySubject: "Mentorluk sureciniz tamamlandi - kisa bir anket",
    surveyTitle: "Mentorluk sureciniz tamamlandi",
    surveyBody: (other) =>
      `${other || "-"} ile yurutugunuz mentorluk sureci tamamlandi. Emeginiz icin tesekkur ederiz.<br><br>` +
      "Asagidaki baglantidan kisa bir degerlendirme anketi doldurmanizi rica ediyoruz. " +
      "Doldurmasi yaklasik 3-4 dakika suruyor ve programi gelistirmemize dogrudan katki sagliyor.<br><br>" +
      "<b>Cevaplarinizi yalnizca Insan Kaynaklari gorur.</b> Karsi taraf bu ankete verdiginiz " +
      "yanitlari goremez.",
    surveyButton: "Anketi Doldur",

    linkNote: "Baglanti calismiyorsa adresi tarayiciniza kopyalayin:",
    footer: "Bu e-posta mentorluk programi kapsaminda gonderilmistir."
  },

  en: {
    inviteSubject: c => `${c} - Mentor Registration Invitation`,
    inviteTitle: "Join as a Mentor",
    inviteBody: c =>
      `You have been invited to join the ${c} mentoring programme as a mentor.` +
      `<br><br>Just click the link below and fill in a short form. ` +
      `No sign-in or account needed.`,
    inviteButton: "Open Registration Form",

    inviteSubjectMentee: c => `${c} - Mentee Registration Invitation`,
    inviteTitleMentee: "Join as a Mentee",
    inviteBodyMentee: c =>
      `You have been invited to join the ${c} mentoring programme as a mentee.` +
      `<br><br>Just click the link below and fill in a short form. ` +
      `No sign-in or account needed.`,
    inviteButtonMentee: "Open Registration Form",

    // The ONLY mail of a new match (sent by HR from the HR Dashboard).
    workspaceSubject: "Your mentorship match: your workspace is ready",
    workspaceTitle: "Your mentorship match has been created",
    workspaceBody: ({ name, other, isMentor, period, group, members }) =>
      `Hello ${name},<br><br>` +
      (group
        ? (isMentor
            ? `You have been matched with the group <b>${group}</b>; you are the group's mentor.` +
              `<br><b>Participants:</b> ${members}`
            : `You have been matched as a member of the group <b>${group}</b>; the group's mentor is <b>${other}</b>.` +
              `<br><b>Participants:</b> ${members}`)
        : (isMentor
            ? `You have been matched with <b>${other}</b>; you are the mentor in this match.`
            : `You have been matched with <b>${other}</b>, who will be your mentor.`)) +
      (period ? `<br><br><b>Duration of the match:</b> ${period}` : "") +
      `<br><br>Use the link below to open your shared workspace. ` +
      (group ? `It is the space the mentor and the whole group share: you build the development plan there, `
             : `It is the space you share: you build your development plan there, `) +
      `record a short note and the duration after every meeting, follow up ` +
      `on actions and plan your next meeting.` +
      `<br><br>No sign-in is needed - the page opens only with this link. ` +
      `Please do not share it with anyone else.`,
    workspaceButton: "Open the workspace",
    workspacePeriod: (start, end) => `${start} – ${end}`,

    meetingInviteSummary: "Mentoring Session",
    meetingInviteSubject: "Mentoring Session Invitation",
    meetingInviteTitle: "A New Session Has Been Scheduled",
    meetingInviteIntro:
      "A mentoring session has been scheduled for the date below. " +
      "Accept the attached invitation to add it to your calendar.",
    meetingInviteWhen: "Date and time",
    meetingInviteWith: "Participants",
    meetingInviteFocus: "Session focus",
    meetingInviteGuests: "Additional guests",
    surveySubject: "Your mentoring relationship has ended - a short survey",
    surveyTitle: "Your mentoring relationship has ended",
    surveyBody: (other) =>
      `Your mentoring relationship with ${other || "-"} has come to an end. Thank you for taking part.<br><br>` +
      "Please take a moment to complete a short feedback survey using the link below. " +
      "It takes about 3-4 minutes and directly helps us improve the programme.<br><br>" +
      "<b>Only Human Resources can see your answers.</b> The other party cannot see the " +
      "responses you give in this survey.",
    surveyButton: "Complete the Survey",

    linkNote: "If the button does not work, copy this address into your browser:",
    footer: "This email was sent as part of the mentoring programme."
  }
};

/** Sade, her e-posta istemcisinde calisan HTML sablonu. */
function layout({ title, body, button, url, lang }) {
  const t = T[lang] || T.tr;

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f5f7;
             font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0"
             style="max-width:560px;background:#ffffff;border-radius:10px;
                    border:1px solid #e0e0e0;overflow:hidden;">

        <tr><td style="background:#1a2b5e;padding:22px 28px;">
          <!--COMPANY_LOGO-->
          <span style="color:#ffffff;font-size:19px;font-weight:700;">MentorOS</span>
        </td></tr>

        <tr><td style="padding:30px 28px;">
          <h2 style="margin:0 0 16px;color:#1a2b5e;font-size:19px;">
            ${title}
          </h2>
          <div style="color:#444;font-size:15px;line-height:1.65;">
            ${body}
          </div>

          ${url ? `
          <div style="margin:28px 0 8px;">
            <a href="${url}"
               style="display:inline-block;background:#b5651d;color:#ffffff;
                      text-decoration:none;padding:13px 26px;border-radius:6px;
                      font-size:15px;font-weight:600;">
              ${button}
            </a>
          </div>

          <p style="color:#888;font-size:12px;line-height:1.6;margin-top:22px;">
            ${t.linkNote}<br>
            <span style="color:#1a2b5e;word-break:break-all;">${url}</span>
          </p>` : ""}
        </td></tr>

        <tr><td style="background:#fafbfc;padding:16px 28px;
                       border-top:1px solid #e0e0e0;">
          <span style="color:#999;font-size:12px;">${t.footer}</span>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// --- Takvim daveti (ICS / iCalendar) -----------------------------------
//
// GIZLILIK NOTU: Bu bolum de yapay zeka ile temas etmez. Davet dogrudan
// firmanin SMTP sunucusundan mentor ve mentee'ye gider.
//
// Calisma sayfasindaki tarih alani (type="date") yalnizca gun verir.
// Davet icin bir saat gerektiginden varsayilan 10:00 / 60 dk kullanilir
// (Europe/Istanbul). Turkiye tum yil +03:00 oldugu icin sabit bir
// VTIMEZONE yeterli.

function icsPad(n) {
  return String(n).padStart(2, "0");
}

/** 'YYYY-MM-DD' + saat/dakika -> 'YYYYMMDDTHHMMSS' (yerel, TZID ile) */
function icsLocal(dateStr, hour, minute) {
  const [y, m, d] = String(dateStr).split("-");
  return `${y}${m}${d}T${icsPad(hour)}${icsPad(minute)}00`;
}

/** Su anki UTC zaman damgasi -> 'YYYYMMDDTHHMMSSZ' */
function icsStamp(date) {
  return (
    date.getUTCFullYear() +
    icsPad(date.getUTCMonth() + 1) +
    icsPad(date.getUTCDate()) + "T" +
    icsPad(date.getUTCHours()) +
    icsPad(date.getUTCMinutes()) +
    icsPad(date.getUTCSeconds()) + "Z"
  );
}

function icsEscape(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** RFC 5545 uyumlu, davet (REQUEST) tipinde bir VEVENT uretir. */
function buildMeetingICS({
  meetingDate,
  startHour = 10,
  startMinute = 0,
  durationMinutes = 60,
  organizerEmail,
  organizerName = "MentorOS",
  mentorEmail,
  mentorName = "Mentor",
  menteeEmail,
  menteeName = "Mentee",
  guests = [],
  summary = "Mentorluk Gorusmesi",
  description = ""
}) {
  const uid = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}@mentoros`;
  const totalStart = startHour * 60 + startMinute;
  const totalEnd = totalStart + durationMinutes;

  // Ek katilimcilar OPSIYONEL (OPT-PARTICIPANT) olarak eklenir: toplanti
  // mentor ile mentee'nindir, misafirin katilmamasi toplantiyi iptal
  // etmez. Takvim istemcileri bu ayrimi kullaniciya gosterir.
  const guestLines = guests.map(email =>
    `ATTENDEE;CN=${icsEscape(email)};ROLE=OPT-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${email}`
  );

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MentorOS//Meeting Scheduler//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VTIMEZONE",
    "TZID:Europe/Istanbul",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0300",
    "TZOFFSETTO:+0300",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART;TZID=Europe/Istanbul:${icsLocal(meetingDate, Math.floor(totalStart / 60), totalStart % 60)}`,
    `DTEND;TZID=Europe/Istanbul:${icsLocal(meetingDate, Math.floor(totalEnd / 60), totalEnd % 60)}`,
    `SUMMARY:${icsEscape(summary)}`,
    description ? `DESCRIPTION:${icsEscape(description)}` : null,
    `ORGANIZER;CN=${icsEscape(organizerName)}:mailto:${organizerEmail}`,
    `ATTENDEE;CN=${icsEscape(mentorName)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${mentorEmail}`,
    `ATTENDEE;CN=${icsEscape(menteeName)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${menteeEmail}`,
    ...guestLines,
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR"
  ].filter(Boolean);

  // iCalendar standardi CRLF satir sonu bekler.
  return lines.join("\r\n");
}

/**
 * Serbest yazilmis misafir listesini temiz e-posta dizisine cevirir.
 *
 * Virgul, noktali virgul, bosluk ve satir sonu ayirici sayilir - IK'nin
 * adresleri nasil yapistirdigini tahmin etmeye calismak yerine hepsini
 * kabul ederiz.
 *
 * GECERSIZ ADRESLER SESSIZCE ATILMAZ: cagirana ayri bir liste olarak
 * doner, cunku "davet gitti" deyip bir kisiyi disarida birakmak en kotu
 * sonuctur.
 */
const MAX_GUESTS = 10;

function parseGuestEmails(input, exclude = []) {
  const raw = Array.isArray(input) ? input.join(",") : String(input || "");

  const excluded = new Set(
    exclude.filter(Boolean).map(e => String(e).trim().toLowerCase())
  );

  const valid = [];
  const invalid = [];
  const seen = new Set();

  for (const piece of raw.split(/[,;\s\n\r]+/)) {
    const email = piece.trim();
    if (!email) continue;

    const key = email.toLowerCase();

    // Mentor/mentee zaten davetli - ikinci kez eklenmesin.
    if (excluded.has(key) || seen.has(key)) continue;

    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      seen.add(key);
      valid.push(email);
    } else {
      invalid.push(email);
    }
  }

  // Kazara toplu gonderime karsi ust sinir.
  const skipped = valid.slice(MAX_GUESTS);
  return { valid: valid.slice(0, MAX_GUESTS), invalid, skipped };
}

/** Davet e-postasi govdesi - butonsuz, detay kartli, MentorOS temasi. */
function meetingInviteLayout({ title, intro, rows, lang }) {
  const t = T[lang] || T.tr;
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f5f7;
             font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0"
             style="max-width:560px;background:#ffffff;border-radius:10px;
                    border:1px solid #e0e0e0;overflow:hidden;">
        <tr><td style="background:#1a2b5e;padding:22px 28px;">
          <!--COMPANY_LOGO-->
          <span style="color:#ffffff;font-size:19px;font-weight:700;">MentorOS</span>
        </td></tr>
        <tr><td style="padding:30px 28px;">
          <h2 style="margin:0 0 16px;color:#1a2b5e;font-size:19px;">${title}</h2>
          <div style="color:#444;font-size:15px;line-height:1.65;">${intro}</div>
          <div style="margin:20px 0 4px;">${card(rows)}</div>
        </td></tr>
        <tr><td style="background:#fafbfc;padding:16px 28px;border-top:1px solid #e0e0e0;">
          <span style="color:#999;font-size:12px;">${t.footer}</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Mentor ve mentee'ye takvim daveti gonderir.
 *
 * Cagiran taraf (route) bunu try/catch icinde cagirmalidir; e-posta
 * hatasi toplanti notunun kaydedilmesini ENGELLEMEMELIDIR.
 *
 * @param {object}  args.mentorship       mentorEmail, menteeEmail, isimler, companyId iceren iliski
 * @param {string}  args.meetingDate      'YYYY-MM-DD'
 * @param {string} [args.focus]           gorusme odagi (aciklamaya eklenir)
 * @param {number} [args.startHour=10]
 * @param {number} [args.durationMinutes=60]
 * @param {string} [args.lang='tr']
 */
async function sendMeetingInvite({
  mentorship,
  meetingDate,
  time = "10:00",
  focus = "",
  guests = "",
  durationMinutes = 60,
  lang = "tr"
}) {
  const t = T[lang] || T.tr;
  const c = getConfig();

  // "HH:MM" -> saat/dakika. Gecersiz/bos ise 10:00 varsayilir.
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || "").trim());
  const startHour = m ? Math.min(23, Number(m[1])) : 10;
  const startMinute = m ? Math.min(59, Number(m[2])) : 0;
  const timeLabel = `${icsPad(startHour)}:${icsPad(startMinute)}`;

  const core = [mentorship.mentorEmail, mentorship.menteeEmail]
    .filter(e => e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));

  if (core.length === 0) {
    const err = new Error("Mentor/mentee e-posta adresi bulunamadi");
    err.code = "NO_RECIPIENTS";
    throw err;
  }

  // Ek katilimcilar (opsiyonel). Mentor/mentee zaten listede oldugundan
  // onlar disarida birakilir.
  const guestResult = parseGuestEmails(guests, [
    mentorship.mentorEmail,
    mentorship.menteeEmail
  ]);

  const recipients = [...core, ...guestResult.valid];

  const description = [t.meetingInviteIntro, focus ? `${t.meetingInviteFocus}: ${focus}` : ""]
    .filter(Boolean)
    .join(" ");

  const ics = buildMeetingICS({
    meetingDate,
    startHour,
    startMinute,
    durationMinutes,
    organizerEmail: c.fromEmail,
    organizerName: c.fromName,
    mentorEmail: mentorship.mentorEmail,
    mentorName: mentorship.mentorName || "Mentor",
    menteeEmail: mentorship.menteeEmail,
    menteeName: mentorship.menteeName || "Mentee",
    guests: guestResult.valid,
    summary: t.meetingInviteSummary,
    description
  });

  const html = meetingInviteLayout({
    lang,
    title: t.meetingInviteTitle,
    intro: t.meetingInviteIntro,
    rows: [
      [t.meetingInviteWhen, `<b>${meetingDate} &nbsp; ${timeLabel}</b> (Istanbul)`],
      [t.meetingInviteWith, `${escapeHtml(mentorship.mentorName || "-")} &amp; ${escapeHtml(mentorship.menteeName || "-")}`],
      focus ? [t.meetingInviteFocus, focus] : null,
      // Ek katilimcilar herkese GORUNUR olsun: mentor ve mentee de
      // toplantiya baska kimin cagrildigini bilmeli.
      guestResult.valid.length ? [t.meetingInviteGuests, guestResult.valid.join(", ")] : null
    ]
  });

  // getTransport() SMTP yapilandirilmamissa firlatir - route yakalar.
  const transport = getTransport();
  const results = [];
  const branded = withCompanyLogo(html, mentorship.companyId);

  for (const to of recipients) {
    try {
      await transport.sendMail({
        from: `"${c.fromName}" <${c.fromEmail}>`,
        to,
        subject: t.meetingInviteSubject,
        html: branded.html,
        ...(branded.files.length ? { attachments: branded.files } : {}),
        icalEvent: { method: "REQUEST", filename: "davet.ics", content: ics }
      });
      log({
        companyId: mentorship.companyId, kind: "meeting_invite",
        recipient: to, subject: t.meetingInviteSubject, refId: mentorship.id, ok: true
      });
      results.push({ to, ok: true });
    } catch (error) {
      log({
        companyId: mentorship.companyId, kind: "meeting_invite",
        recipient: to, subject: t.meetingInviteSubject, refId: mentorship.id,
        ok: false, error: error.message
      });
      results.push({ to, ok: false, error: error.message });
    }
  }

  return {
    ok: results.some(r => r.ok),
    results,
    guests: {
      invited: guestResult.valid,
      invalid: guestResult.invalid,
      skipped: guestResult.skipped
    }
  };
}

// --- Gonderim ----------------------------------------------------------

function log({ companyId, kind, recipient, subject, refId, ok, error }) {
  try {
    db.prepare(`
      INSERT INTO email_log
        (id, company_id, kind, recipient, subject, ref_id, ok, error, sent_at)
      VALUES (@id, @companyId, @kind, @recipient, @subject, @refId, @ok, @error, @sentAt)
    `).run({
      id: crypto.randomBytes(8).toString("hex"),
      companyId: companyId || "",
      kind,
      recipient,
      subject: subject || "",
      refId: refId || "",
      ok: ok ? 1 : 0,
      error: error || null,
      sentAt: now()
    });
  } catch (e) {
    console.error("E-posta kaydi yazilamadi:", e.message);
  }
}

/**
 * The organisation's logo, embedded in the mail (CID): mail programs
 * block remote images by default, an embedded one is always shown.
 * Fills the <!--COMPANY_LOGO--> place in the layout, or removes it.
 */
function withCompanyLogo(html, companyId, attachments) {
  const files = attachments && attachments.length ? [...attachments] : [];
  if (!String(html).includes("<!--COMPANY_LOGO-->")) return { html, files };
  const img = companyId ? require("../lib/logo").logos.image(companyId) : null;
  if (!img) return { html: html.replace("<!--COMPANY_LOGO-->", ""), files };
  files.push({ filename: img.mime === "image/png" ? "logo.png" : "logo.jpg", content: img.data,
               contentType: img.mime, cid: "company-logo@mentoros" });
  return {
    html: html.replace("<!--COMPANY_LOGO-->",
      `<img src="cid:company-logo@mentoros" alt="" style="display:block;max-height:44px;max-width:200px;` +
      `background:#ffffff;padding:6px 8px;border-radius:6px;margin:0 0 10px;">`),
    files
  };
}

/**
 * fromName / replyTo (optional): announcements go out with the
 * organisation's name as sender name and its own reply address, so that
 * replies reach HR instead of the platform's no-reply mailbox.
 */
async function send({ to, subject, html, companyId, kind, refId, fromName, replyTo, attachments, icalEvent }) {
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    const error = new Error(`Gecersiz e-posta adresi: ${to || "(bos)"}`);
    log({ companyId, kind, recipient: to || "", subject, refId, ok: false, error: error.message });
    throw error;
  }

  const c = getConfig();

  try {
    const transport = getTransport();

    const name = String(fromName || c.fromName || "").replace(/["\r\n]/g, "").trim();
    let files;
    ({ html, files } = withCompanyLogo(html, companyId, attachments));
    await transport.sendMail({
      from: `"${name}" <${c.fromEmail}>`,
      to,
      subject,
      html,
      ...(replyTo ? { replyTo } : {}),
      ...(files.length ? { attachments: files } : {}),
      // calendar invitation (text/calendar part): Outlook / Gmail offer
      // "add to calendar" and update or remove the entry later
      ...(icalEvent ? { icalEvent } : {})
    });

    log({ companyId, kind, recipient: to, subject, refId, ok: true });
    return { ok: true, to };

  } catch (error) {
    log({ companyId, kind, recipient: to, subject, refId, ok: false, error: error.message });
    error.diagnosis = diagnose(error, "en");
    throw error;
  }
}

// --- Hazir e-postalar --------------------------------------------------

async function sendInvite({ to, companyName, companyId, url, lang = "tr", form }) {
  const t = T[lang] || T.tr;
  const isMentee = form === "mentee";

  const subject = (isMentee ? t.inviteSubjectMentee : t.inviteSubject)(companyName);
  const title   = isMentee ? t.inviteTitleMentee : t.inviteTitle;
  const body    = (isMentee ? t.inviteBodyMentee : t.inviteBody)(companyName);
  const button  = isMentee ? t.inviteButtonMentee : t.inviteButton;

  return send({
    to,
    subject,
    html: layout({ title, body, button, url, lang }),
    companyId,
    kind: "invite"
  });
}

/**
 * "Programme: X" line at the top of a mail, when the match belongs to a
 * mentoring programme. HR typed the name, so it is escaped.
 */
function programLine(programId, lang) {
  if (!programId) return "";
  let row;
  try { row = db.prepare(`SELECT name FROM programs WHERE id = ?`).get(programId); } catch { row = null; }
  if (!row) return "";
  const name = String(row.name).replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  return lang === "en"
    ? `<div style="margin-bottom:14px">This match is part of the <b>${name}</b> programme.</div>`
    : `<div style="margin-bottom:14px">Bu eşleşme <b>${name}</b> programı kapsamındadır.</div>`;
}

/**
 * Check-in (mid-programme feedback) request. The link is personal: it
 * opens this person's own round only. A repeat for an unanswered round
 * is a reminder (same link).
 */
const CHECKIN_TEXT = {
  tr: {
    subject: "Ara geri bildirim: mentorluk süreciniz nasıl gidiyor?",
    reminderSubject: "Hatırlatma - ara geri bildirim: mentorluk süreciniz nasıl gidiyor?",
    title: "Kısa bir ara geri bildirim",
    body: ({ name, other, group }) =>
      `Merhaba ${name},<br><br>` +
      (group ? `<b>${group}</b> grubundaki ` : `<b>${other}</b> ile yürüttüğünüz `) +
      `mentorluk süreci için kısa bir ara geri bildirim rica ediyoruz. ` +
      `Birkaç soru, yaklaşık 2 dakika.` +
      `<br><br>Bu bir kapanış anketi değildir; süreç devam ederken nasıl gittiğini anlamak içindir. ` +
      `Cevaplarınızı yalnızca İnsan Kaynakları görür` +
      (group ? `; mentorunuz ve diğer katılımcılar görmez.` : `; ${other} görmez.`),
    button: "Geri bildirim formunu aç"
  },
  en: {
    subject: "Mid-programme feedback: how is your mentorship going?",
    reminderSubject: "Reminder - mid-programme feedback: how is your mentorship going?",
    title: "A short mid-programme feedback",
    body: ({ name, other, group }) =>
      `Hello ${name},<br><br>` +
      `We would like a short piece of feedback on your mentorship ` +
      (group ? `in the group <b>${group}</b>. ` : `with <b>${other}</b>. `) +
      `A few questions, about 2 minutes.` +
      `<br><br>This is not the closing survey; it is to see how things are going while the mentorship runs. ` +
      `Only HR sees your answers` +
      (group ? `; your mentor and the other participants do not.` : `; ${other} does not.`),
    button: "Open the feedback form"
  }
};

async function sendCheckin({ to, name, otherName, groupName, checkin, mentorship, url, reminder = false, lang = "tr" }) {
  const t = CHECKIN_TEXT[lang === "en" ? "en" : "tr"];
  return send({
    to,
    subject: reminder ? t.reminderSubject : t.subject,
    html: layout({
      title: t.title,
      body: programLine(mentorship.programId, lang) + t.body({
        name: escapeHtml(name || ""),
        other: escapeHtml(otherName || "-"),
        group: groupName ? escapeHtml(groupName) : ""
      }),
      button: t.button,
      url,
      lang
    }),
    companyId: mentorship.companyId,
    kind: "checkin",
    refId: mentorship.id
  });
}

/**
 * ANNOUNCEMENT - one e-mail per recipient (nobody sees the other
 * addresses). The body is HR's plain text: escaped, line breaks kept.
 * {ad} (also {name}) becomes the recipient's name.
 */
function personalise(text, name) {
  return String(text || "")
    .replace(/\{(ad|name)\}/gi, name || "")
    .replace(/[ \t]+([,.!?;:])/g, "$1");          // "Merhaba ," -> "Merhaba," when there is no name
}

async function sendAnnouncement({ to, name, subject, body, companyName, replyTo, companyId, refId, lang = "tr", attachments }) {
  const subj = personalise(subject, name).replace(/[\r\n]+/g, " ").trim();
  const html = escapeHtml(personalise(body, name)).replace(/\n/g, "<br>");
  return send({
    to,
    subject: subj,
    html: layout({ title: escapeHtml(subj), body: html, lang }),
    companyId,
    kind: "announcement",
    refId,
    fromName: companyName ? `${companyName} - MentorOS` : "",
    replyTo: replyTo || undefined,
    attachments
  });
}

/** The platform's sending address (organiser of calendar invitations without a reply address). */
function fromAddress() {
  return getConfig().fromEmail || "";
}

/**
 * EVENT MAILS  (stage 6a): invite, reminder, update, cancel, removed.
 * Every mail carries the calendar file; the time is written in the
 * event's own time zone with its name ("14:00 – 15:30 (Istanbul, GMT+3)").
 */
const EVENT_TEXT = {
  tr: {
    subject: { invite: "Davet: {t}", reminder: "Hatırlatma: {t}", update: "Güncellendi: {t}", cancel: "İptal: {t}", removed: "Katılımcı listesinden çıkarıldınız: {t}" },
    title: { invite: "Etkinlik daveti", reminder: "Etkinlik hatırlatması", update: "Etkinlik güncellendi", cancel: "Etkinlik iptal edildi", removed: "Etkinlik listesinden çıkarıldınız" },
    hello: "Merhaba {ad},",
    intro: {
      invite: "Sizi aşağıdaki etkinliğe davet ediyoruz.",
      reminder: "Aşağıdaki etkinliğe katılıp katılamayacağınızı henüz bildirmediniz.",
      update: "Aşağıdaki etkinliğin bilgileri değişti. Takviminizdeki kayıt da güncellenecek.",
      cancel: "Aşağıdaki etkinlik iptal edildi. Takviminizdeki kayıt kaldırılacak.",
      removed: "Artık aşağıdaki etkinliğin katılımcıları arasında değilsiniz. Takviminizdeki kayıt kaldırılacak."
    },
    reanswer: "Tarih veya saat değiştiği için lütfen katılım durumunuzu yeniden bildirin.",
    reason: "İptal nedeni",
    date: "Tarih", time: "Saat", duration: "Süre", place: "Yer", online: "Online bağlantı", about: "Açıklama",
    minutes: "dk", button: "Katılım durumunu bildir",
    calendar: "E-postadaki takvim davetiyle etkinliği takviminize ekleyebilirsiniz; saat takviminizde kendi yerel saatinize göre görünür."
  },
  en: {
    subject: { invite: "Invitation: {t}", reminder: "Reminder: {t}", update: "Updated: {t}", cancel: "Cancelled: {t}", removed: "Removed from the participants: {t}" },
    title: { invite: "Event invitation", reminder: "Event reminder", update: "Event updated", cancel: "Event cancelled", removed: "Removed from the event" },
    hello: "Hello {ad},",
    intro: {
      invite: "You are invited to the event below.",
      reminder: "You have not told us yet whether you can attend the event below.",
      update: "The details of the event below have changed. The entry in your calendar will be updated too.",
      cancel: "The event below has been cancelled. It will be removed from your calendar.",
      removed: "You are no longer among the participants of the event below. It will be removed from your calendar."
    },
    reanswer: "The date or time has changed, so please tell us again whether you can attend.",
    reason: "Reason",
    date: "Date", time: "Time", duration: "Duration", place: "Place", online: "Online link", about: "About",
    minutes: "min", button: "Answer the invitation",
    calendar: "Add the event to your calendar with the invitation in this e-mail; your calendar shows it in your own local time."
  }
};

/** "Europe/Istanbul" -> "Istanbul"/"İstanbul" */
function zoneCity(tz, lang) {
  const city = String(tz || "").split("/").pop().replace(/_/g, " ");
  return lang === "tr" && city === "Istanbul" ? "İstanbul" : city;
}

async function sendEventMail({ kind, event, participant, company, url, ics }) {
  const { startEnd, gmtLabel } = require("../lib/events");
  const lang = event.language === "en" ? "en" : "tr";
  const t = EVENT_TEXT[lang];
  const { start, end } = startEnd(event);
  const tz = event.timezone;
  const fmt = (d, o) => d.toLocaleString(lang === "en" ? "en-GB" : "tr-TR", { timeZone: tz, ...o });
  const date = fmt(start, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const time = `${fmt(start, { hour: "2-digit", minute: "2-digit" })} – ${fmt(end, { hour: "2-digit", minute: "2-digit" })} (${zoneCity(tz, lang)}, ${gmtLabel(tz, start)})`;

  const own = kind === "invite" ? event.inviteMessage : kind === "reminder" ? event.reminderMessage : "";
  const name = escapeHtml(participant.fullName || "");
  const greeting = name ? t.hello.replace("{ad}", name) : t.hello.replace(" {ad}", "");
  const intro = own
    ? escapeHtml(personalise(own, participant.fullName || "")).replace(/\n/g, "<br>")
    : `${greeting}<br><br>${t.intro[kind]}`;
  const rows = [
    [t.date, escapeHtml(date)],
    [t.time, escapeHtml(time)],
    event.location ? [t.place, escapeHtml(event.location)] : null,
    event.onlineUrl ? [t.online, `<a href="${escapeHtml(event.onlineUrl)}">${escapeHtml(event.onlineUrl)}</a>`] : null,
    event.description ? [t.about, escapeHtml(event.description).replace(/\n/g, "<br>")] : null,
    kind === "cancel" && event.cancelReason ? [t.reason, escapeHtml(event.cancelReason)] : null
  ].filter(Boolean);

  const body =
    intro +
    (kind === "update" && participant.response === "pending" ? `<br><br><b>${t.reanswer}</b>` : "") +
    `<br><br><b style="font-size:16px;color:#1a2b5e">${escapeHtml(event.title)}</b>` +
    `<table style="margin-top:10px;border-collapse:collapse;font-size:14px">` +
    rows.map(([k, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#6b7280;vertical-align:top;white-space:nowrap">${k}</td><td style="padding:4px 0">${v}</td></tr>`).join("") +
    `</table>` +
    (["invite", "reminder", "update"].includes(kind) ? `<p style="color:#6b7280;font-size:12.5px;margin-top:14px">${t.calendar}</p>` : "");

  return send({
    to: participant.email,
    subject: t.subject[kind].replace("{t}", event.title).replace(/[\r\n]+/g, " "),
    html: layout({
      title: t.title[kind], body,
      button: ["invite", "reminder", "update"].includes(kind) ? t.button : "",
      url: ["invite", "reminder", "update"].includes(kind) ? url : "",
      lang
    }),
    companyId: event.companyId,
    kind: "event",
    refId: event.id,
    fromName: company && company.name ? `${company.name} - MentorOS` : "",
    replyTo: (company && company.replyTo) || undefined,
    icalEvent: { method: ["cancel", "removed"].includes(kind) ? "CANCEL" : "REQUEST", filename: "event.ics", content: ics }
  });
}

/** Text that came from people (names) is escaped before it goes into a mail. */
function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** "2026-10-03" -> "3 Ekim 2026" / "3 October 2026" */
function longDate(iso, lang) {
  const d = new Date(String(iso || "").slice(0, 10) + "T00:00:00Z");
  if (isNaN(d)) return "";
  return d.toLocaleDateString(lang === "en" ? "en-GB" : "tr-TR",
    { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * The match e-mail: who the person is matched with, the period of the
 * match, the workspace link and what the workspace is for.
 *   role: "mentor" | "mentee"  - the RECIPIENT's role
 */
async function sendWorkspace({ to, role, name, otherName, mentorship, url, lang = "tr" }) {
  const t = T[lang] || T.tr;
  const start = longDate(mentorship.createdAt, lang);
  const end = longDate(mentorship.closingDate, lang);

  return send({
    to,
    subject: t.workspaceSubject,
    html: layout({
      title: t.workspaceTitle,
      body: programLine(mentorship.programId, lang) + t.workspaceBody({
        name: escapeHtml(name || ""),
        other: escapeHtml(otherName || "-"),
        isMentor: role === "mentor",
        period: start && end ? t.workspacePeriod(start, end) : "",
        group: mentorship.groupId ? escapeHtml(mentorship.groupName || mentorship.menteeName) : "",
        members: (mentorship.members || []).map(m => escapeHtml(m.fullName)).join(", ")
      }),
      button: t.workspaceButton,
      url,
      lang
    }),
    companyId: mentorship.companyId,
    kind: "workspace",
    refId: mentorship.id
  });
}

/**
 * Kapanis anketi daveti.
 *
 * Anket linki KISIYE OZELDIR - token o kisinin anketini acar. Bu yuzden
 * tek alicili gonderilir; toplu gonderim yapilmaz.
 */
async function sendSurvey({ to, otherName, survey, mentorship, url, lang = "tr" }) {
  const t = T[lang] || T.tr;

  return send({
    to,
    subject: t.surveySubject,
    html: layout({
      title: t.surveyTitle,
      body: t.surveyBody(escapeHtml(otherName || "-")),
      button: t.surveyButton,
      url,
      lang
    }),
    companyId: mentorship.companyId,
    kind: "survey",
    refId: survey.id
  });
}

/** Baglanti testi - kendine bir deneme e-postasi gonderir. */
async function testConnection(lang = "tr") {
  const c = getConfig();

  try {
    const transport = getTransport();

    await transport.verify();

    await transport.sendMail({
      from: `"${c.fromName}" <${c.fromEmail}>`,
      to: c.fromEmail,
      subject: lang === "en"
        ? "MentorOS - Test email"
        : "MentorOS - Test e-postasi",
      html: layout({
        title: lang === "en" ? "Connection successful" : "Baglanti basarili",
        body: lang === "en"
          ? "Your email server is configured correctly. Invitations and match e-mails can now be sent."
          : "E-posta sunucunuz dogru yapilandirilmis. Davetler ve eslesme e-postalari artik gonderilebilir.",
        button: lang === "en" ? "All good" : "Her sey yolunda",
        url: settings.get("site.baseUrl", "#"),
        lang
      })
    });

    return {
      ok: true,
      title: lang === "tr" ? "Baglanti basarili" : "Connection successful",
      detail: lang === "tr"
        ? `Test e-postasi ${c.fromEmail} adresine gonderildi. Gelen kutunuzu kontrol edin.`
        : `A test email was sent to ${c.fromEmail}. Check your inbox.`
    };

  } catch (error) {
    return diagnose(error, lang);
  }
}

/** Bir talep/iliski icin gonderim gecmisi. */
/** Send history of one record, limited to the given company's rows. */
function history(refId, companyId) {
  return db.prepare(`
    SELECT kind, recipient, ok, error, sent_at AS sentAt
      FROM email_log
     WHERE ref_id = ? AND company_id = ?
     ORDER BY sent_at DESC
  `).all(refId, companyId).map(r => ({ ...r, ok: !!r.ok }));
}

module.exports = {
  getConfig,
  getConfigPublic,
  isConfigured,
  resetTransport,
  testConnection,
  sendInvite,
  sendWorkspace,
  sendMeetingInvite,
  sendSurvey,
  sendCheckin,
  sendAnnouncement,
  personalise,
  sendEventMail,
  fromAddress,
  history,
  diagnose
};
