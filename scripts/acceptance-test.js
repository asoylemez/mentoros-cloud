/**
 * MentorOS Cloud - ACCEPTANCE TEST  (safe on the live system)
 *
 * READ-ONLY. It creates, changes and deletes nothing, and sends no
 * email. It can therefore run against https://app.getmentoros.com.
 *
 *     npm run acceptance-test -- --base=https://app.getmentoros.com
 *
 * Optional: also sign in with ONE organisation account, to check that a
 * signed-in organisation gets 404 for record ids that are not its own:
 *
 *     npm run acceptance-test -- --base=https://app.getmentoros.com --user=demo --password="..."
 *
 * (The full cross-organisation check, which needs two accounts with
 * data, is "npm run tenant-test" - it runs on a temporary local server.)
 *
 * Note: a wrong --password counts as a failed sign-in attempt; after 8
 * attempts the IP is locked for 15 minutes.
 */
require("dotenv").config({ quiet: true });
const crypto = require("crypto");

const arg = name => {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a ? a.split("=").slice(1).join("=") : "";
};

const BASE = (arg("base") || process.env.SITE_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const USER = arg("user");
const PASSWORD = arg("password");
const HTTPS = BASE.startsWith("https://");

const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed });
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
}

async function get(url, headers = {}) {
  return fetch(BASE + url, { headers: { Accept: "application/json", ...headers }, redirect: "manual" });
}

async function main() {
  console.log(`\n  Target: ${BASE}\n`);

  // ==================================================================
  console.log("1) THE SERVER IS UP\n");
  // ==================================================================
  const health = await get("/health");
  const h = health.ok ? await health.json() : {};
  check("/health answers", health.status === 200, `HTTP ${health.status}`);
  check("personal data masking for AI is ON", h.piiScrubbing === true);
  check("super admin password is configured", h.adminPasswordSet === true);
  if (HTTPS) {
    // The live (https) system must run with an encrypted database.
    check("database is encrypted", h.databaseEncrypted === true, String(h.databaseEncrypted));
  }

  // ==================================================================
  console.log("\n2) NOTHING WITHOUT SIGNING IN\n");
  // ==================================================================
  const staffApis = [
    "/mentors", "/mentees", "/mentorships",
    "/matching-candidates", "/email/status", "/invite-link",
    "/email/history/x", "/meeting-tracking", "/programs", "/mentee-groups", "/checkin-questions",
    "/announcements", "/announcement-settings", "/reports/management", "/reports/surveys", "/my-company"
  ];
  for (const ep of staffApis) {
    const r = await get(ep);
    check(`unauthenticated ${ep} rejected`, r.status === 401, `HTTP ${r.status}`);
  }

  const r1 = await get("/mentors", { "x-api-key": "mentor-demo-key-2026" });
  check("old shared x-api-key rejected", r1.status === 401, `HTTP ${r1.status}`);

  for (const ep of ["/companies", "/backups"]) {
    const r = await get(ep);
    check(`unauthenticated ${ep} rejected`, r.status === 403, `HTTP ${r.status}`);
  }

  const pages = [
    "/index.html", "/hr_dashboard.html", "/mentor_registry.html",
    "/mentee_registry.html", "/mentee_matching.html", "/super_admin.html",
    "/programs.html", "/checkin_questions.html", "/announcements.html",
    "/reports.html", "/company_settings.html"
  ];
  for (const p of pages) {
    const r = await get(p);
    const loc = r.headers.get("location") || "";
    check(`${p} redirects to sign-in`, r.status === 302 && loc.includes("/login.html"), `HTTP ${r.status}`);
  }

  const old = await get("/match_approval.html");
  const oldText = old.status === 200 ? await old.text() : "";
  check("old approval links show 'no longer used'", oldText.includes("no longer used"), `HTTP ${old.status}`);

  // ==================================================================
  if (USER && PASSWORD) {
    console.log(`\n3) SIGNED IN AS "${USER}" (read-only)\n`);
  // ==================================================================
    const login = await fetch(BASE + "/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: USER, password: PASSWORD })
    });
    const raw = typeof login.headers.getSetCookie === "function"
      ? (login.headers.getSetCookie()[0] || "")
      : (login.headers.get("set-cookie") || "");
    const cookie = raw.split(";")[0];
    check("sign-in succeeded", login.status === 200 && !!cookie, `HTTP ${login.status}`);

    if (login.status === 200 && cookie) {
      check("session cookie is HttpOnly", /httponly/i.test(raw));
      if (HTTPS) check("session cookie is Secure (https)", /;\s*secure/i.test(raw));

      const C = { Cookie: cookie };
      for (const ep of ["/mentors", "/mentees", "/mentorships", "/programs", "/mentee-groups", "/checkin-questions", "/announcements",
                        "/reports/management", "/reports/surveys", "/my-company"]) {
        const r = await get(ep, C);
        check(`own list ${ep}`, r.status === 200, `HTTP ${r.status}`);
      }

      // Meeting tracking: dates and durations only, never content.
      const tr = await get("/meeting-tracking", C);
      const tj = tr.status === 200 ? await tr.json() : null;
      check("meeting tracking answers with summary figures",
            !!tj && typeof tj.stats?.total === "number" && Array.isArray(tj.rows), `HTTP ${tr.status}`);
      const extraKeys = new Set();
      for (const r of tj?.rows || []) for (const m of r.meetings || []) {
        for (const k of Object.keys(m)) if (k !== "date" && k !== "durationMinutes") extraKeys.add(k);
      }
      check("meeting tracking carries only dates and durations",
            !!tj && extraKeys.size === 0, extraKeys.size ? [...extraKeys].join(", ") : "");

      // An id that is not this organisation's must look exactly like a
      // missing one. A random id is used: nothing is read or changed.
      const foreign = crypto.randomBytes(12).toString("hex");
      for (const ep of [`/mentors/${foreign}`, `/mentees/${foreign}`, `/mentorships/${foreign}`]) {
        const r = await get(ep, C);
        check(`unknown id ${ep.replace(foreign, ":id")} -> 404`, r.status === 404, `HTTP ${r.status}`);
      }

      for (const ep of ["/companies", "/backups"]) {
        const r = await get(ep, C);
        check(`organisation cannot reach ${ep}`, r.status === 403, `HTTP ${r.status}`);
      }

      await fetch(BASE + "/company-logout", { method: "POST", headers: C });
    }
  } else {
    console.log("\n3) SIGNED-IN CHECKS SKIPPED  (add --user=... --password=... to run them)");
  }

  const failed = results.filter(r => !r.passed);
  console.log("\n============================================================");
  console.log(`  TOTAL ${results.length} checks - ${results.length - failed.length} passed, ${failed.length} failed`);
  console.log("============================================================\n");
  if (failed.length) {
    console.log("  FAILED:");
    for (const f of failed) console.log(`    - ${f.name}`);
    console.log("");
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch(err => {
  console.error("\n  ACCEPTANCE TEST COULD NOT RUN:", err.message);
  console.error(`  Is the server reachable at ${BASE} ?\n`);
  process.exit(2);
});
