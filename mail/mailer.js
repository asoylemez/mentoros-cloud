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

    managerSubject: "Mentorluk Eslesmesi - Yonetici Onayiniz Bekleniyor",
    managerTitle: "Ekip Uyeniz Icin Bir Mentor Onerildi",
    managerBody: (r) =>
      `Ekibinizden <b>${r.menteeName || "-"}</b> icin mentorluk programinda ` +
      `bir mentor onerildi.` +

      // Yonetici NEYI onayladigini gormeli - mentor kim, ne kadar uyumlu, neden.
      `<br><br>` + card([
        ["Onerilen mentor", `<b>${r.mentorName || "-"}</b>`],
        r.matchScore ? ["Uyum puani", `<b>${r.matchScore}/100</b>`] : null,
        r.menteeRole ? ["Ekip uyesinin rolu", r.menteeRole] : null
      ]) +

      (r.matchReason
        ? `<br><b>Neden bu mentor:</b><br>${r.matchReason}` : "") +

      (r.developmentNeed
        ? `<br><br><b>Gelisim ihtiyaci:</b><br>${r.developmentNeed}` : "") +

      `<br><br>Bu eslesmenin baslamasi <b>oncelikle sizin onayiniza</b> baglidir. ` +
      `Siz onayladiktan sonra mentor ve mentee'ye de onay baglantisi gonderilecektir.`,
    managerButton: "Eslesmeyi Incele",

    approvalSubject: `Mentorluk Eslesmesi - Onayiniz Bekleniyor`,
    approvalTitleMentor: "Size Bir Mentee Onerildi",
    approvalTitleMentee: "Size Bir Mentor Onerildi",
    approvalBodyMentor: (r) =>
      `Mentorluk programinda size <b>${r.menteeName || "-"}</b> mentee olarak onerildi.` +
      `<br><br>` + card([
        ["Mentee", `<b>${r.menteeName || "-"}</b>`],
        r.menteeRole ? ["Rolu", r.menteeRole] : null,
        r.matchScore ? ["Uyum puani", `<b>${r.matchScore}/100</b>`] : null
      ]) +
      (r.matchReason ? `<br><b>Neden siz:</b><br>${r.matchReason}` : "") +
      (r.developmentNeed ? `<br><br><b>Gelisim ihtiyaci:</b><br>${r.developmentNeed}` : "") +
      `<br><br>Asagidaki baglantidan eslesmeyi inceleyip onaylayabilir ` +
      `veya reddedebilirsiniz.`,

    approvalBodyMentee: (r) =>
      `Mentorluk programinda size <b>${r.mentorName || "-"}</b> mentor olarak onerildi.` +
      `<br><br>` + card([
        ["Onerilen mentor", `<b>${r.mentorName || "-"}</b>`],
        r.matchScore ? ["Uyum puani", `<b>${r.matchScore}/100</b>`] : null
      ]) +
      (r.matchReason ? `<br><b>Neden bu mentor:</b><br>${r.matchReason}` : "") +
      (r.developmentNeed ? `<br><br><b>Gelisim ihtiyaciniz:</b><br>${r.developmentNeed}` : "") +
      `<br><br>Asagidaki baglantidan eslesmeyi inceleyip onaylayabilir ` +
      `veya reddedebilirsiniz.`,
    approvalButton: "Eslesmeyi Incele",

    workspaceSubject: "Mentorluk Calisma Alaniniz Hazir",
    workspaceTitle: "Calisma Alaniniz Acildi",
    workspaceBody: (other) =>
      `<b>${other}</b> ile mentorluk iliskiniz basladi.` +
      `<br><br>Calisma alaninda gelisim hedeflerinizi gorebilir, toplanti ` +
      `planlayabilir ve notlarinizi tutabilirsiniz.`,
    workspaceButton: "Calisma Alanini Ac",

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

    managerSubject: "Mentorship Match - Your Approval Needed as Manager",
    managerTitle: "A Mentor Has Been Suggested for Your Team Member",
    managerBody: (r) =>
      `A mentor has been suggested for <b>${r.menteeName || "-"}</b> from your team.` +

      // The manager must see WHAT they are approving - who, how good a fit, and why.
      `<br><br>` + card([
        ["Suggested mentor", `<b>${r.mentorName || "-"}</b>`],
        r.matchScore ? ["Match score", `<b>${r.matchScore}/100</b>`] : null,
        r.menteeRole ? ["Team member's role", r.menteeRole] : null
      ]) +

      (r.matchReason
        ? `<br><b>Why this mentor:</b><br>${r.matchReason}` : "") +

      (r.developmentNeed
        ? `<br><br><b>Development need:</b><br>${r.developmentNeed}` : "") +

      `<br><br>This match can only proceed with <b>your approval first</b>. ` +
      `Once you approve, the mentor and the mentee will be asked to confirm.`,
    managerButton: "Review the Match",

    approvalSubject: `Mentorship Match - Your Approval Needed`,
    approvalTitleMentor: "A Mentee Has Been Suggested for You",
    approvalTitleMentee: "A Mentor Has Been Suggested for You",
    approvalBodyMentor: (r) =>
      `<b>${r.menteeName || "-"}</b> has been suggested as your mentee.` +
      `<br><br>` + card([
        ["Mentee", `<b>${r.menteeName || "-"}</b>`],
        r.menteeRole ? ["Role", r.menteeRole] : null,
        r.matchScore ? ["Match score", `<b>${r.matchScore}/100</b>`] : null
      ]) +
      (r.matchReason ? `<br><b>Why you:</b><br>${r.matchReason}` : "") +
      (r.developmentNeed ? `<br><br><b>Development need:</b><br>${r.developmentNeed}` : "") +
      `<br><br>Use the link below to review the match and approve or decline.`,

    approvalBodyMentee: (r) =>
      `<b>${r.mentorName || "-"}</b> has been suggested as your mentor.` +
      `<br><br>` + card([
        ["Suggested mentor", `<b>${r.mentorName || "-"}</b>`],
        r.matchScore ? ["Match score", `<b>${r.matchScore}/100</b>`] : null
      ]) +
      (r.matchReason ? `<br><b>Why this mentor:</b><br>${r.matchReason}` : "") +
      (r.developmentNeed ? `<br><br><b>Your development need:</b><br>${r.developmentNeed}` : "") +
      `<br><br>Use the link below to review the match and approve or decline.`,
    approvalButton: "Review the Match",

    workspaceSubject: "Your Mentorship Workspace Is Ready",
    workspaceTitle: "Your Workspace Is Open",
    workspaceBody: (other) =>
      `Your mentorship with <b>${other}</b> has started.` +
      `<br><br>In the workspace you can see your development goals, schedule ` +
      `meetings and keep your notes.`,
    workspaceButton: "Open Workspace",

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
          <span style="color:#ffffff;font-size:19px;font-weight:700;">MentorOS</span>
        </td></tr>

        <tr><td style="padding:30px 28px;">
          <h2 style="margin:0 0 16px;color:#1a2b5e;font-size:19px;">
            ${title}
          </h2>
          <div style="color:#444;font-size:15px;line-height:1.65;">
            ${body}
          </div>

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
          </p>
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
      [t.meetingInviteWith, `${mentorship.mentorName || "-"} & ${mentorship.menteeName || "-"}`],
      focus ? [t.meetingInviteFocus, focus] : null,
      // Ek katilimcilar herkese GORUNUR olsun: mentor ve mentee de
      // toplantiya baska kimin cagrildigini bilmeli.
      guestResult.valid.length ? [t.meetingInviteGuests, guestResult.valid.join(", ")] : null
    ]
  });

  // getTransport() SMTP yapilandirilmamissa firlatir - route yakalar.
  const transport = getTransport();
  const results = [];

  for (const to of recipients) {
    try {
      await transport.sendMail({
        from: `"${c.fromName}" <${c.fromEmail}>`,
        to,
        subject: t.meetingInviteSubject,
        html,
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

async function send({ to, subject, html, companyId, kind, refId }) {
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    const error = new Error(`Gecersiz e-posta adresi: ${to || "(bos)"}`);
    log({ companyId, kind, recipient: to || "", subject, refId, ok: false, error: error.message });
    throw error;
  }

  const c = getConfig();

  try {
    const transport = getTransport();

    await transport.sendMail({
      from: `"${c.fromName}" <${c.fromEmail}>`,
      to,
      subject,
      html
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

async function sendApproval({ to, type, request, url, lang = "tr" }) {
  const t = T[lang] || T.tr;

  // Yonetici onayi: mentee'nin yoneticisi. Onay surecinin ILK adimi.
  if (type === "manager") {
    return send({
      to,
      subject: t.managerSubject,
      html: layout({
        title: t.managerTitle,
        body: t.managerBody(request),      // mentor adi, puan, gerekce dahil
        button: t.managerButton,
        url,
        lang
      }),
      companyId: request.companyId,
      kind: "approval",
      refId: request.id
    });
  }

  const isMentor = type === "mentor";

  return send({
    to,
    subject: t.approvalSubject,
    html: layout({
      title: isMentor ? t.approvalTitleMentor : t.approvalTitleMentee,
      body: isMentor
        ? t.approvalBodyMentor(request)
        : t.approvalBodyMentee(request),
      button: t.approvalButton,
      url,
      lang
    }),
    companyId: request.companyId,
    kind: "approval",
    refId: request.id
  });
}

async function sendWorkspace({ to, otherName, mentorship, url, lang = "tr" }) {
  const t = T[lang] || T.tr;

  return send({
    to,
    subject: t.workspaceSubject,
    html: layout({
      title: t.workspaceTitle,
      body: t.workspaceBody(otherName || "-"),
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
      body: t.surveyBody(otherName || "-"),
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
          ? "Your email server is configured correctly. Invitation and approval links can now be sent by email."
          : "E-posta sunucunuz dogru yapilandirilmis. Davet ve onay baglantilari artik e-posta ile gonderilebilir.",
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
function history(refId) {
  return db.prepare(`
    SELECT kind, recipient, ok, error, sent_at AS sentAt
      FROM email_log
     WHERE ref_id = ?
     ORDER BY sent_at DESC
  `).all(refId).map(r => ({ ...r, ok: !!r.ok }));
}

module.exports = {
  getConfig,
  getConfigPublic,
  isConfigured,
  resetTransport,
  testConnection,
  sendInvite,
  sendApproval,
  sendWorkspace,
  sendMeetingInvite,
  sendSurvey,
  history,
  diagnose
};
