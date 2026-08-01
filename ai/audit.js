const crypto = require("crypto");
const { db } = require("../db");

/**
 * ====================================================================
 * YAPAY ZEKA DENETIM KAYDI
 * ====================================================================
 *
 * Yapay zekaya giden HER metni kaydeder.
 *
 * Amac: KVKK denetiminde "yapay zekaya ne gonderiyorsunuz?" sorusuna
 * tahminle degil KANITLA cevap verebilmek. Admin panelinde her cagri
 * icin gonderilen tam metin gorulebilir; isimlerin gercekten
 * maskelendigi gozle dogrulanabilir.
 *
 * ONCEDEN: sadece bellekte tutuluyordu -> sunucu her yeniden
 * baslatildiginda siliniyordu. Bir denetim izi icin bu kabul edilemez.
 *
 * SIMDI: SQLite'ta kalici. Son 1000 kayit saklanir.
 */

const MAX_ROWS = 1000;

function record(entry) {
  try {
    db.prepare(`
      INSERT INTO ai_audit (
        id, timestamp, operation, provider, model, prompt_sent,
        duration_ms, input_tokens, output_tokens, ok, error
      ) VALUES (
        @id, @timestamp, @operation, @provider, @model, @promptSent,
        @durationMs, @inputTokens, @outputTokens, @ok, @error
      )
    `).run({
      id: crypto.randomBytes(8).toString("hex"),
      timestamp: new Date().toISOString(),
      operation: entry.operation || "bilinmeyen",
      provider: entry.provider || "",
      model: entry.model || "",
      promptSent: entry.promptSent || "",
      durationMs: entry.durationMs || 0,
      inputTokens: entry.inputTokens || 0,
      outputTokens: entry.outputTokens || 0,
      ok: entry.ok ? 1 : 0,
      error: entry.error || null
    });

    // Eski kayitlari buda
    db.prepare(`
      DELETE FROM ai_audit
       WHERE id NOT IN (
         SELECT id FROM ai_audit ORDER BY timestamp DESC LIMIT ?
       )
    `).run(MAX_ROWS);

  } catch (error) {
    // Denetim kaydi yazilamazsa uygulama CALISMAYA DEVAM ETMELI.
    // Kaydi tutamamak, kullaniciya hizmeti kesmekten iyidir.
    console.error("Denetim kaydi yazilamadi:", error.message);
  }
}

function list(limit = 25) {
  return db.prepare(`
    SELECT id, timestamp, operation, provider, model,
           prompt_sent   AS promptSent,
           duration_ms   AS durationMs,
           input_tokens  AS inputTokens,
           output_tokens AS outputTokens,
           ok, error
      FROM ai_audit
     ORDER BY timestamp DESC
     LIMIT ?
  `).all(Math.min(Number(limit) || 25, 200))
    .map(row => ({ ...row, ok: !!row.ok }));
}

function stats() {
  const row = db.prepare(`
    SELECT
      COUNT(*)                                  AS totalCalls,
      SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END)   AS failedCalls,
      COALESCE(SUM(input_tokens), 0)            AS inputTokens,
      COALESCE(SUM(output_tokens), 0)           AS outputTokens,
      COALESCE(AVG(CASE WHEN ok = 1 THEN duration_ms END), 0) AS avgDurationMs
    FROM ai_audit
  `).get();

  return {
    totalCalls: row.totalCalls || 0,
    failedCalls: row.failedCalls || 0,
    inputTokens: row.inputTokens || 0,
    outputTokens: row.outputTokens || 0,
    avgDurationMs: Math.round(row.avgDurationMs || 0)
  };
}

function clear() {
  db.prepare(`DELETE FROM ai_audit`).run();
}

module.exports = { record, list, stats, clear };
